# NEXUS ARCADE

Welcome to **NEXUS ARCADE**, a sleek cyber-arcade gaming hub where you can jump straight into four classic games right in your browser: **Tetris**, **Tic-Tac-Toe**, **Chess**, and **Mahjong Solitaire**. Every cabinet features responsive controls, synthesized Web Audio sound effects, live scoreboards, smart AI opponents, and a real-time win/outcome predictor that forecasts how your match is progressing as you play.

---

## Prerequisites & Installation

- **Node.js** `>= 22.0.0` (tested with Node `v22.22.1`) and **npm**
- Install development dependencies:

```bash
npm install
```

---

## Build, Test, Start & Stop Commands

| Task | Command |
| :--- | :--- |
| Typecheck TypeScript (`strict: true`) | `npm run typecheck` |
| Build client & server TypeScript to `dist/` | `npm run build` |
| Compile test suite to `dist-test/` | `npm run test:compile` |
| Build & run full automated test suite | `npm test` |
| Start server in **foreground** | `npm start` |
| Start server in **background daemon** (`server.log`, `.server.pid`) | `npm run start:bg` |
| Stop background server | `npm run stop` |

---

## Accessing the Web App

Once the server is running (`npm start` or `npm run start:bg`), open your browser to:

- **URL**: `http://localhost:4173`
- Optional custom port: `PORT=8080 npm start` (or `PORT=8080 npm run start:bg`)

Direct game URLs:
- `http://localhost:4173/games/tetris.html` — Tetris (*TETROMINO OVERDRIVE*)
- `http://localhost:4173/games/tictactoe.html` — Tic-Tac-Toe (*NEURAL GRID DUEL*)
- `http://localhost:4173/games/chess.html` — Chess (*GRANDMASTER PROTOCOL*)
- `http://localhost:4173/games/mahjong.html` — Mahjong Solitaire (*IMPERIAL TILE DYNASTY*)

---

## Keyboard Shortcuts & Interactive Controls

### Landing Hub (`index.html`)
| Input | Action |
| :--- | :--- |
| Mouse Hover / Pointer | Activates 3D tilt, radial spotlight, rotating laser rim, live canvas preview, and dims sibling cards |
| `←` `→` `↑` `↓` | Navigate across the 2×2 game cabinet grid (activates focused card) |
| `Enter` / `Space` | Launch the currently focused game |
| `1` `2` `3` `4` | Launch Tetris (`1`), Tic-Tac-Toe (`2`), Chess (`3`), or Mahjong (`4`) directly |
| `Esc` | Clear active card focus |
| Sound Toggle (`🔊` / `🔇`) | Mute or unmute synthesized Web Audio SFX across the arcade |

### Tetris — *TETROMINO OVERDRIVE* (`games/tetris.html`)
- **Cabinet Controls**: **Start** (`#start-btn`), **Pause** (`#pause-btn`), **Reset** (`#reset-btn`), plus on-screen touch/mouse buttons (Left, Right, Down, Rotate CCW, Rotate CW, Hard Drop, Hold).
- **Live Telemetry**: Score, High Score (`localStorage`), Level (advances every 10 lines), Lines, Timer, Combo, Back-to-Back (B2B), Next-3 Queue, Hold slot, and **Survival Outlook / Victory Forecast**.

| Key | Action |
| :--- | :--- |
| `←` / `A` | Move Left |
| `→` / `D` | Move Right |
| `↓` / `S` | Soft Drop (+1 pt/cell) |
| `↑` / `W` / `X` | Rotate Clockwise (CW) |
| `Z` | Rotate Counter-Clockwise (CCW) |
| `Space` | Hard Drop (+2 pts/cell) |
| `C` / `Shift` | Hold Piece |
| `P` | Pause / Resume |
| `Enter` | Start (when idle, paused, or game over) |
| `R` | Reset |

### Tic-Tac-Toe — *NEURAL GRID DUEL* (`games/tictactoe.html`)
- **Cabinet Controls**: **Start** (`#start-btn`), **Reset** (`#reset-btn`), Difficulty selector (**Unbeatable** default, **Tactical**, **Casual**), and First Mover selector (`X` default or `O`).
- **Live Telemetry**: Player / Draw / AI session scores, Streak counter, winning laser overlay, and **Exact Minimax Winner & Outcome Probability Predictor** (`Player %`, `Draw %`, `AI %`).

| Key | Action |
| :--- | :--- |
| `1`–`9` | Mark cell `0`–`8` (top-left to bottom-right) |
| `←` `→` `↑` `↓` | Move cursor across the 3×3 grid |
| `Enter` / `Space` | Place mark on focused cell (`Enter` starts match when idle) |
| `R` | Reset board and cancel any pending AI move |

### Chess — *GRANDMASTER PROTOCOL* (`games/chess.html`)
- **Cabinet Controls**: **Start** (`#start-btn`), **Reset** (`#reset-btn`), **Undo** (`#undo-btn`), **Hint** (`#hint-btn`), Difficulty selector (**Novice**, **Club** default, **Master**), and interactive **Promotion Modal** (`Queen`, `Rook`, `Bishop`, `Knight`).
- **Live Telemetry**: White/Black material & advantage, captured pieces, SAN move history, session W/D/L stats (`localStorage`), and **Evaluation Bar & Predicted Winner** (`White %` vs `Black %`).

| Key | Action |
| :--- | :--- |
| `←` `→` `↑` `↓` | Move cursor across the 8×8 board |
| `Enter` / `Space` | Select piece or play move at cursor |
| `S` | Start / New Match |
| `R` | Reset board and cancel pending AI move (or select Rook when promoting) |
| `U` | Undo move pair (or pending move) |
| `H` | Show Master AI hint highlight |
| `Esc` | Cancel promotion modal or clear selection/hint |
| `Q` / `R` / `B` / `N` | Select promotion piece while promotion modal is open |

### Mahjong Solitaire — *IMPERIAL TILE DYNASTY* (`games/mahjong.html`)
- **Cabinet Controls**: **Start** (`#start-btn`), **Reset** (`#reset-btn`), **Hint** (`#hint-btn`), **Undo** (`#undo-btn`), **Shuffle** (`#shuffle-btn`), **Highlight Free** toggle (`#highlight-btn`), and Layout selector (**Classic Turtle 144** default or **Quick Dragon 72**).
- **Live Telemetry**: Score, High Score (`localStorage`), Tiles Remaining, Available Pairs, Combo Multiplier, Timer, and **Win Forecast / Solvability Outlook**.

| Key | Action |
| :--- | :--- |
| Click / Tap | Select a free tile and click a matching free tile to clear the pair |
| `H` | Highlight a valid open pair (Hint) |
| `U` / `Z` | Undo last match or shuffle |
| `S` | Shuffle remaining tiles |
| `F` | Toggle Highlight Free tiles |
| `Enter` | Start (when ready) |
| `R` | Reset board |
| `Esc` | Deselect active tile / clear hint |
