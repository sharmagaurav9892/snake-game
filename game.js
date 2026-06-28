/* =====================================================================
 * Snake
 * Arrow keys / WASD to move, SPACE to pause/resume, R to restart.
 * Smooth inter-tick movement, connected snake body, input buffer.
 * ===================================================================== */

(() => {
  "use strict";

  // -------------------- Config --------------------
  const GRID = 22;            // 22x22 board
  const TICK_BASE_MS = 140;
  const TICK_MIN_MS = 65;
  const SPEED_STEP_EVERY = 5;
  const SPEED_STEP_MS = 8;
  const MAX_LEADERS = 3;
  const INPUT_QUEUE_MAX = 2;

  const COLORS = {
    boardBg:   "#0b0e13",
    grid:      "rgba(255, 255, 255, 0.025)",
    bodyShadow:"rgba(0, 0, 0, 0.35)",
    bodyDark:  "#10805f",
    bodyMain:  "#22c997",
    bodyLite:  "#54e6b8",
    head:      "#2bd9a6",
    eyeWhite:  "#f5fffb",
    eyeDark:   "#08171f",
    tongue:    "#e5484d",
    food:      "#f0b429",
    foodSoft:  "rgba(240, 180, 41, 0.35)",
    foodCore:  "#fff0c2",
  };

  const LS_KEYS = {
    name: "snake.player",
    leaderboard: "snake.leaderboard",
  };

  const DIRS = {
    Up:    { x: 0,  y: -1 },
    Down:  { x: 0,  y:  1 },
    Left:  { x: -1, y:  0 },
    Right: { x: 1,  y:  0 },
  };

  // -------------------- DOM --------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const els = {
    scoreValue: document.getElementById("scoreValue"),
    bestValue:  document.getElementById("bestValue"),
    speedValue: document.getElementById("speedValue"),
    playerName: document.getElementById("playerName"),
    changePlayerBtn: document.getElementById("changePlayerBtn"),

    overlayStart:  document.getElementById("overlayStart"),
    overlayPaused: document.getElementById("overlayPaused"),
    overlayOver:   document.getElementById("overlayOver"),
    overScore: document.getElementById("overScore"),
    overBest:  document.getElementById("overBest"),
    overTitle: document.getElementById("overTitle"),
    overMsg:   document.getElementById("overMsg"),
    playAgainBtn: document.getElementById("playAgainBtn"),

    leaderboardList: document.getElementById("leaderboardList"),
    resetScoresBtn: document.getElementById("resetScoresBtn"),

    nameModal: document.getElementById("nameModal"),
    nameForm:  document.getElementById("nameForm"),
    nameInput: document.getElementById("nameInput"),
    nameCancelBtn: document.getElementById("nameCancelBtn"),

    touchPause: document.getElementById("touchPause"),
    touchUp:    document.getElementById("touchUp"),
    touchDown:  document.getElementById("touchDown"),
    touchLeft:  document.getElementById("touchLeft"),
    touchRight: document.getElementById("touchRight"),
  };

  // ▶ when idle / paused / over, ❚❚ when playing
  const PLAY_ICON  = "\u25B6";
  const PAUSE_ICON = "\u275A\u275A";

  // -------------------- State --------------------
  /** @typedef {{x:number, y:number}} Vec */
  /** @typedef {"idle"|"playing"|"paused"|"over"} GameState */

  const state = {
    /** @type {GameState} */
    status: "idle",
    snake: /** @type {Vec[]} */ ([]),
    snakePrev: /** @type {Vec[]|null} */ (null),
    dir: { ...DIRS.Right },
    inputQueue: /** @type {Vec[]} */ ([]),
    food: { x: 11, y: 11 },
    score: 0,
    best: 0,
    eaten: 0,
    tickMs: TICK_BASE_MS,
    lastTick: 0,
    lastFrame: 0,
    foodSpawnAt: 0,
    particles: /** @type {Particle[]} */ ([]),
    shake: 0,
    player: "",
    leaders: /** @type {{name:string, score:number, at:number}[]} */ ([]),
  };

  /** @typedef {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}} Particle */

  // -------------------- Audio (tiny synth) --------------------
  /** @type {AudioContext|null} */
  let audio = null;
  function ensureAudio() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { audio = null; }
    }
    if (audio && audio.state === "suspended") audio.resume();
  }
  function beep(freq = 660, dur = 0.08, type = "triangle", gain = 0.04) {
    if (!audio) return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  const sfx = {
    eat()    { beep(820, 0.07); setTimeout(() => beep(1240, 0.06), 50); },
    die()    { beep(220, 0.14, "sawtooth", 0.06); setTimeout(() => beep(110, 0.18, "sawtooth", 0.06), 90); },
    pause()  { beep(440, 0.05); },
    resume() { beep(660, 0.05); },
    start()  { beep(523, 0.07); setTimeout(() => beep(784, 0.09), 80); },
    high()   { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.09), i * 90)); },
  };

  // -------------------- Storage (localStorage only) --------------------
  // The leaderboard and player name are persisted in this browser's
  // localStorage. Clearing site data wipes them.

  function loadPlayer() {
    try { return localStorage.getItem(LS_KEYS.name) || ""; }
    catch (_) { return ""; }
  }
  function savePlayer(name) {
    try { localStorage.setItem(LS_KEYS.name, name); } catch (_) {}
  }

  function loadLeadersLocal() {
    try {
      const raw = localStorage.getItem(LS_KEYS.leaderboard);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(e => e && typeof e.score === "number" && typeof e.name === "string")
        .slice(0, MAX_LEADERS);
    } catch (_) { return []; }
  }
  function saveLeadersLocal(list) {
    try { localStorage.setItem(LS_KEYS.leaderboard, JSON.stringify(list.slice(0, MAX_LEADERS))); }
    catch (_) {}
  }

  function setLeaders(list) {
    state.leaders = (list || []).slice(0, MAX_LEADERS);
    saveLeadersLocal(state.leaders);
    renderLeaderboard();
    updateHud();
  }

  // -------------------- Game lifecycle --------------------
  function resetGame() {
    const mid = Math.floor(GRID / 2);
    state.snake = [
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
      { x: mid - 3, y: mid },
    ];
    state.snakePrev = state.snake.map(s => ({ ...s }));
    state.dir = { ...DIRS.Right };
    state.inputQueue.length = 0;
    state.score = 0;
    state.eaten = 0;
    state.tickMs = TICK_BASE_MS;
    state.particles.length = 0;
    state.shake = 0;
    spawnFood();
    updateHud();
  }

  function startGame() {
    if (state.status === "playing") return;
    if (state.status === "over" || state.status === "idle") resetGame();
    state.status = "playing";
    state.lastTick = performance.now();
    hideAllOverlays();
    sfx.start();
    updateTouchPauseIcon();
  }

  function pauseGame() {
    if (state.status !== "playing") return;
    state.status = "paused";
    showOverlay("paused");
    sfx.pause();
    updateTouchPauseIcon();
  }

  function resumeGame() {
    if (state.status !== "paused") return;
    state.status = "playing";
    state.lastTick = performance.now();
    hideOverlay("paused");
    sfx.resume();
    updateTouchPauseIcon();
  }

  function endGame() {
    state.status = "over";
    state.shake = 320;
    sfx.die();
    updateTouchPauseIcon();

    const topBefore = getTopScore();
    submitToLeaderboard(state.player, state.score);
    const topAfter = getTopScore();
    const isHigh = state.score > 0 && topAfter > topBefore && topAfter === state.score;
    if (isHigh) setTimeout(() => sfx.high(), 220);

    els.overScore.textContent = String(state.score);
    els.overBest.textContent = String(topAfter);
    els.overTitle.textContent = pickGameOverTitle(state.score, isHigh);
    els.overMsg.innerHTML = isHigh
      ? `New high score! Press <span class="kbd">Space</span> or <span class="kbd">R</span> to play again.`
      : `Press <span class="kbd">Space</span> or <span class="kbd">R</span> to play again.`;
    showOverlay("over");
    updateHud();
    renderLeaderboard();
  }

  function pickGameOverTitle(score, isHigh) {
    if (isHigh)        return "New high score!";
    if (score === 0)   return "Got tangled fast.";
    if (score < 5)     return "Just a warm-up.";
    if (score < 15)    return "Not bad.";
    if (score < 30)    return "Nice run!";
    if (score < 60)    return "You're cooking!";
    return "Legendary slither.";
  }

  function togglePause() {
    if (state.status === "idle" || state.status === "over") startGame();
    else if (state.status === "playing") pauseGame();
    else if (state.status === "paused")  resumeGame();
  }

  // -------------------- Food --------------------
  function spawnFood() {
    const occupied = new Set(state.snake.map(s => `${s.x},${s.y}`));
    let x, y, tries = 0;
    do {
      x = Math.floor(Math.random() * GRID);
      y = Math.floor(Math.random() * GRID);
      tries++;
    } while (occupied.has(`${x},${y}`) && tries < 500);
    state.food = { x, y };
    state.foodSpawnAt = performance.now();
  }

  // -------------------- Tick (logic) --------------------
  function tick() {
    // Snapshot for visual interpolation
    state.snakePrev = state.snake.map(s => ({ x: s.x, y: s.y }));

    // Apply queued direction (one per tick)
    if (state.inputQueue.length > 0) {
      const next = state.inputQueue.shift();
      // Defense in depth: never reverse into our own neck
      if (!(next.x === -state.dir.x && next.y === -state.dir.y)) {
        state.dir = next;
      }
    }

    const head = state.snake[0];
    const newHead = { x: head.x + state.dir.x, y: head.y + state.dir.y };

    // Wall collision
    if (newHead.x < 0 || newHead.x >= GRID || newHead.y < 0 || newHead.y >= GRID) {
      return endGame();
    }

    const willEat = newHead.x === state.food.x && newHead.y === state.food.y;
    // When not eating, the tail will move out of its current cell, so it's safe to enter.
    const bodyToCheck = willEat ? state.snake : state.snake.slice(0, -1);
    if (bodyToCheck.some(s => s.x === newHead.x && s.y === newHead.y)) {
      return endGame();
    }

    state.snake.unshift(newHead);

    if (willEat) {
      state.score += 1;
      state.eaten += 1;
      sfx.eat();
      spawnParticles(state.food.x, state.food.y);
      bumpStat(els.scoreValue.parentElement);
      // Speed up
      if (state.eaten % SPEED_STEP_EVERY === 0) {
        state.tickMs = Math.max(TICK_MIN_MS, state.tickMs - SPEED_STEP_MS);
      } else {
        state.tickMs = Math.max(TICK_MIN_MS, state.tickMs - 1);
      }
      spawnFood();
      updateHud();
    } else {
      state.snake.pop();
    }
  }

  function bumpStat(node) {
    if (!node) return;
    node.classList.remove("stat--bump");
    void node.offsetWidth;
    node.classList.add("stat--bump");
  }

  // -------------------- Particles --------------------
  function spawnParticles(gx, gy) {
    const cs = cellSize();
    const px = (gx + 0.5) * cs;
    const py = (gy + 0.5) * cs;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.4;
      state.particles.push({
        x: px, y: py,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        maxLife: 360 + Math.random() * 220,
        size: 1.2 + Math.random() * 1.6,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life += dt;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.93;
      p.vy *= 0.93;
      if (p.life >= p.maxLife) state.particles.splice(i, 1);
    }
  }

  // -------------------- Smooth visual positions --------------------
  function currentProgress(now) {
    if (state.status !== "playing") return 1;
    const p = (now - state.lastTick) / state.tickMs;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /**
   * Compute the visual (sub-cell) position of each snake segment by lerping
   * from where it was last tick to where it is now.
   * Rule: from[i] = current[i+1] ?? prev[i] ?? current[i]
   */
  function getVisualSnake(progress) {
    const cur  = state.snake;
    const prev = state.snakePrev || cur;
    const n = cur.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const from = cur[i + 1] || prev[i] || cur[i];
      const to   = cur[i];
      out[i] = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      };
    }
    return out;
  }

  // -------------------- Rendering --------------------
  function cellSize() { return canvas.width / GRID; }

  function draw(now) {
    const w = canvas.width;
    const h = canvas.height;
    const cs = cellSize();

    // Camera shake
    let ox = 0, oy = 0;
    if (state.shake > 0) {
      const mag = Math.min(6, state.shake / 60);
      ox = (Math.random() - 0.5) * mag;
      oy = (Math.random() - 0.5) * mag;
    }

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(ox, oy);

    // Board background
    ctx.fillStyle = COLORS.boardBg;
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < GRID; i++) {
      const p = i * cs;
      ctx.moveTo(p + 0.5, 0);
      ctx.lineTo(p + 0.5, h);
      ctx.moveTo(0, p + 0.5);
      ctx.lineTo(w, p + 0.5);
    }
    ctx.stroke();

    const progress = currentProgress(now);
    const visual = getVisualSnake(progress);

    drawFood(now, cs);
    drawSnake(visual, cs, now);
    drawParticles();

    ctx.restore();
  }

  function drawFood(now, cs) {
    const f = state.food;
    const cx = (f.x + 0.5) * cs;
    const cy = (f.y + 0.5) * cs;
    const t  = (now - state.foodSpawnAt) / 1000;
    const pulse = 0.5 + Math.sin(t * 4) * 0.5;
    const r = cs * 0.30 + pulse * cs * 0.04;

    // Soft glow
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.85);
    grad.addColorStop(0, COLORS.foodSoft);
    grad.addColorStop(1, "rgba(240, 180, 41, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.85, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = COLORS.foodCore;
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.32, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnake(visual, cs, now) {
    if (!visual.length) return;
    const bodyW = cs * 0.78;

    // Build a path from tail -> head through the visual centers
    ctx.beginPath();
    for (let i = visual.length - 1; i >= 0; i--) {
      const px = (visual[i].x + 0.5) * cs;
      const py = (visual[i].y + 0.5) * cs;
      if (i === visual.length - 1) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Soft shadow
    ctx.strokeStyle = COLORS.bodyShadow;
    ctx.lineWidth = bodyW + 4;
    ctx.stroke();

    // Dark outline / underbody
    ctx.strokeStyle = COLORS.bodyDark;
    ctx.lineWidth = bodyW + 2;
    ctx.stroke();

    // Main body
    ctx.strokeStyle = COLORS.bodyMain;
    ctx.lineWidth = bodyW;
    ctx.stroke();

    // Inner highlight stripe (thin, slightly brighter)
    ctx.strokeStyle = COLORS.bodyLite;
    ctx.lineWidth = bodyW * 0.28;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Head emphasis + face
    drawHead(visual[0], cs, now);
  }

  function drawHead(head, cs, now) {
    const cx = (head.x + 0.5) * cs;
    const cy = (head.y + 0.5) * cs;
    const dx = state.dir.x;
    const dy = state.dir.y;
    const perpX = -dy;
    const perpY = dx;

    // Slightly larger rounded head cap (gives the head visual presence)
    const headR = cs * 0.44;
    ctx.fillStyle = COLORS.head;
    ctx.beginPath();
    ctx.arc(cx, cy, headR, 0, Math.PI * 2);
    ctx.fill();

    // Tongue — flicks while playing
    if (state.status === "playing") {
      const phase = (Math.sin(now * 0.012) + 1) * 0.5; // 0..1
      const visible = phase > 0.55;
      if (visible) {
        const k = (phase - 0.55) / 0.45; // 0..1 during visible window
        const len = cs * (0.25 + k * 0.45);
        const startX = cx + dx * cs * 0.35;
        const startY = cy + dy * cs * 0.35;
        const tipX = startX + dx * len;
        const tipY = startY + dy * len;
        ctx.strokeStyle = COLORS.tongue;
        ctx.lineWidth = Math.max(1.5, cs * 0.06);
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        const forkLen = cs * 0.13;
        const forkW = cs * 0.10;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + dx * forkLen + perpX * forkW, tipY + dy * forkLen + perpY * forkW);
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + dx * forkLen - perpX * forkW, tipY + dy * forkLen - perpY * forkW);
        ctx.stroke();
      }
    }

    // Eyes
    const eyeOffset = cs * 0.20;
    const eyeForward = cs * 0.10;
    const eyeR = cs * 0.11;
    const pupilR = cs * 0.055;
    for (const sgn of [-1, 1]) {
      const ex = cx + perpX * eyeOffset * sgn + dx * eyeForward;
      const ey = cy + perpY * eyeOffset * sgn + dy * eyeForward;
      ctx.fillStyle = COLORS.eyeWhite;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.eyeDark;
      ctx.beginPath();
      ctx.arc(ex + dx * eyeR * 0.4, ey + dy * eyeR * 0.4, pupilR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const k = 1 - p.life / p.maxLife;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.fillStyle = COLORS.food;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // -------------------- Loop --------------------
  function loop(now) {
    const dt = now - state.lastFrame;
    state.lastFrame = now;

    if (state.status === "playing") {
      // If the tab was backgrounded, don't fire a flood of catch-up ticks.
      if (now - state.lastTick > 500) state.lastTick = now;
      let safety = 4;
      while (state.status === "playing" && now - state.lastTick >= state.tickMs && safety-- > 0) {
        state.lastTick += state.tickMs;
        tick();
      }
    }
    updateParticles(dt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);

    draw(now);
    requestAnimationFrame(loop);
  }

  // -------------------- HUD --------------------
  function updateHud() {
    els.scoreValue.textContent = String(state.score);
    els.bestValue.textContent  = String(getTopScore());
    const mul = TICK_BASE_MS / state.tickMs;
    els.speedValue.textContent = `${mul.toFixed(1)}×`;
    els.playerName.textContent = state.player || "Guest";
  }
  function getTopScore() {
    return state.leaders.length ? state.leaders[0].score : 0;
  }
  function showOverlay(which) {
    if (which === "start")  els.overlayStart.classList.remove("hidden");
    if (which === "paused") els.overlayPaused.classList.remove("hidden");
    if (which === "over")   els.overlayOver.classList.remove("hidden");
  }
  function hideOverlay(which) {
    if (which === "start")  els.overlayStart.classList.add("hidden");
    if (which === "paused") els.overlayPaused.classList.add("hidden");
    if (which === "over")   els.overlayOver.classList.add("hidden");
  }
  function hideAllOverlays() {
    hideOverlay("start"); hideOverlay("paused"); hideOverlay("over");
  }

  function updateTouchPauseIcon() {
    if (!els.touchPause) return;
    const playing = state.status === "playing";
    els.touchPause.textContent = playing ? PAUSE_ICON : PLAY_ICON;
    els.touchPause.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function bindTouchControls() {
    const dirMap = [
      [els.touchUp,    "Up"],
      [els.touchDown,  "Down"],
      [els.touchLeft,  "Left"],
      [els.touchRight, "Right"],
    ];
    for (const [btn, dirName] of dirMap) {
      if (!btn) continue;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        ensureAudio();
        queueDirection(dirName);
        if (state.status === "idle" || state.status === "over") startGame();
      });
      // Suppress the synthesized click so audio/state aren't double-triggered.
      btn.addEventListener("click", (e) => e.preventDefault());
    }
    if (els.touchPause) {
      els.touchPause.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        ensureAudio();
        togglePause();
        updateTouchPauseIcon();
      });
      els.touchPause.addEventListener("click", (e) => e.preventDefault());
    }
  }

  // -------------------- Leaderboard --------------------
  function submitToLeaderboard(name, score) {
    if (!name || score <= 0) return;
    const merged = state.leaders.concat([{ name, score, at: Date.now() }]);
    merged.sort((a, b) => b.score - a.score || a.at - b.at);
    setLeaders(merged);
  }

  function renderLeaderboard() {
    const list = state.leaders;
    els.leaderboardList.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "leaderboard__empty";
      li.textContent = "No scores yet.";
      els.leaderboardList.appendChild(li);
      return;
    }
    list.forEach((entry, idx) => {
      const li = document.createElement("li");
      if (entry.name === state.player) li.classList.add("you");
      li.innerHTML = `
        <span class="lb-rank">${idx + 1}</span>
        <span class="lb-name">${escapeHtml(entry.name)}</span>
        <span class="lb-score">${entry.score}</span>
      `;
      els.leaderboardList.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // -------------------- Input --------------------
  function queueDirection(dirName) {
    const next = DIRS[dirName];
    if (!next) return;
    // Compare against the last queued (or current) direction, so quick combos work
    const last = state.inputQueue.length > 0
      ? state.inputQueue[state.inputQueue.length - 1]
      : state.dir;
    if (next.x === -last.x && next.y === -last.y) return; // no reverse
    if (next.x ===  last.x && next.y ===  last.y) return; // no duplicate
    if (state.inputQueue.length >= INPUT_QUEUE_MAX) return;
    state.inputQueue.push(next);
  }

  function onKeyDown(e) {
    if (document.activeElement === els.nameInput) return;

    const k = e.key;
    if (k === "ArrowUp" || k === "w" || k === "W") {
      e.preventDefault(); ensureAudio(); queueDirection("Up");
      if (state.status === "idle") startGame();
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
      e.preventDefault(); ensureAudio(); queueDirection("Down");
      if (state.status === "idle") startGame();
    } else if (k === "ArrowLeft" || k === "a" || k === "A") {
      e.preventDefault(); ensureAudio(); queueDirection("Left");
      if (state.status === "idle") startGame();
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
      e.preventDefault(); ensureAudio(); queueDirection("Right");
      if (state.status === "idle") startGame();
    } else if (k === " " || k === "Spacebar") {
      e.preventDefault(); ensureAudio(); togglePause();
    } else if (k === "r" || k === "R") {
      e.preventDefault(); ensureAudio();
      resetGame();
      state.status = "playing";
      state.lastTick = performance.now();
      hideAllOverlays();
      updateTouchPauseIcon();
    }
  }

  // -------------------- Player name modal --------------------
  let wasPlayingBeforeModal = false;
  function openNameModal(canCancel) {
    els.nameModal.classList.remove("hidden");
    els.nameModal.setAttribute("aria-hidden", "false");
    els.nameInput.value = state.player || "";
    wasPlayingBeforeModal = state.status === "playing";
    if (wasPlayingBeforeModal) pauseGame();
    if (canCancel) els.nameCancelBtn.classList.remove("hidden");
    else els.nameCancelBtn.classList.add("hidden");
    setTimeout(() => { els.nameInput.focus(); els.nameInput.select(); }, 30);
  }
  function closeNameModal() {
    els.nameModal.classList.add("hidden");
    els.nameModal.setAttribute("aria-hidden", "true");
  }

  els.nameForm.addEventListener("submit", e => {
    e.preventDefault();
    const clean = els.nameInput.value.trim().replace(/\s+/g, " ").slice(0, 14);
    if (!clean) return;
    state.player = clean;
    savePlayer(clean);
    updateHud();
    renderLeaderboard();
    closeNameModal();
  });

  els.nameCancelBtn.addEventListener("click", () => {
    if (!state.player) return; // must enter a name on first run
    closeNameModal();
  });

  els.changePlayerBtn.addEventListener("click", e => {
    e.stopPropagation();
    openNameModal(/*canCancel*/ true);
  });

  els.playAgainBtn.addEventListener("click", () => startGame());

  els.resetScoresBtn.addEventListener("click", () => {
    if (confirm("Clear the Top 3 leaderboard?")) {
      setLeaders([]);
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !els.nameModal.classList.contains("hidden") && state.player) {
      closeNameModal();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.status === "playing") pauseGame();
  });

  // -------------------- DPI / resize --------------------
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const target = Math.round(Math.min(rect.width, rect.height) * dpr);
    // Snap so each cell is whole pixels — keeps lines crisp
    const snapped = Math.max(GRID * 16, Math.floor(target / GRID) * GRID);
    if (canvas.width !== snapped) {
      canvas.width = snapped;
      canvas.height = snapped;
    }
  }
  window.addEventListener("resize", fitCanvas);

  // -------------------- Init --------------------
  function init() {
    document.addEventListener("keydown", onKeyDown);
    bindTouchControls();

    state.player = loadPlayer();

    fitCanvas();
    resetGame();

    state.leaders = loadLeadersLocal();
    renderLeaderboard();
    updateHud();
    updateTouchPauseIcon();

    showOverlay("start");

    if (!state.player) openNameModal(/*canCancel*/ false);

    requestAnimationFrame(t => {
      state.lastFrame = t;
      loop(t);
    });
  }

  init();
})();
