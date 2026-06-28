# Snake

A snake game with smooth motion, a clean emerald UI, and a Top‑3 leaderboard. Pure HTML / CSS / JS — no server, no build step, no dependencies.

## Quick start

Just open `index.html` in a browser.

If you prefer serving it locally (some browsers restrict `file://` for things like fonts), any one‑liner static server works, e.g.:

```bash
python3 -m http.server 3000
# then open http://localhost:3000
```

## How scores are stored

Everything is stored in this browser's `localStorage`:

| Key | What |
| --- | ---- |
| `snake.leaderboard` | The Top 3 leaderboard. |
| `snake.player` | Your current player name on this device. |

Clearing site data (or the **Clear** button in the leaderboard) wipes scores. Scores are per‑browser/per‑device — they don't sync across machines.

## Controls

| Key                              | Action            |
| -------------------------------- | ----------------- |
| `←` `↑` `↓` `→` (or `W A S D`)   | Move the snake    |
| `Space`                          | Play / Pause      |
| `R`                              | Restart           |
| **Change** (top right)           | Switch player     |
| **Clear** (leaderboard header)   | Wipe Top 3        |

Notes:

- Two queued moves are buffered, so quick combos like `→` then `↑` both register.
- The tab auto-pauses when hidden, so you don't lose a run by alt-tabbing.
- Reversing directly into your own neck is blocked.

## Files

```
snake-game/
├── index.html       # Markup
├── styles.css       # Theme
├── game.js          # Game loop, rendering, input, leaderboard
└── README.md
```
