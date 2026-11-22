# NEXUS ARCADE — Product & Technical Requirements

## 1. Overview & Architecture
- **Product Name**: **NEXUS ARCADE** — a cyber-arcade browser gaming hub featuring 4 full-featured, interactive games built with **Node.js**, **strict TypeScript (`strict: true`)**, **HTML5**, and **CSS3** (zero runtime npm dependencies).
- **Module Structure**:
  - `ts/server.ts`: Zero-dependency Node HTTP static server (`PORT=4173` default) supporting foreground, `--daemon`, and `--stop` modes, proper MIME types, and path-traversal guards (`403`/`404`).
  - `ts/shared/arcade.ts`: Synthesized Web Audio SFX singleton (`ArcadeAudio`), persistent mute header wiring (`initArcadeHeader()`), `formatTime()`, and `clamp()`.
  - `styles/theme.css`: Shared cyber-arcade obsidian dark theme (`#060812` backdrop, radial atmospheric glows, neon cyan `#00f5ff`, magenta `#ff2bd6`, violet `#8b5cf6`, emerald `#10b981`, gold `#fbbf24`, crimson `#fb7185`), HUD cards, predictor meters, status banners, and responsive `.game-shell` layout.
  - `index.html`, `styles/landing.css`, `ts/landing.ts`: Landing hub page.
  - `games/<game>.html`, `styles/<game>.css`, `ts/games/<game>/*.ts`: Self-contained game experiences with pure TypeScript engines tested under Node.js and end-to-end under headless Chrome CDP.

---

## 2. Landing Page (`index.html`, `styles/landing.css`, `ts/landing.ts`)
- **Visual Atmosphere**:
  - Cyber-arcade dark backdrop with animated ambient starfield and synthwave perspective horizon `<canvas id="arcade-backdrop">`, sharp neon header (`NEXUS ARCADE`), global sound mute toggle (`[data-mute-toggle]`), and keyboard navigation hints.
- **2x2 Game Grid Layout**:
  - `.game-grid` occupies **80% of the viewport width** (`width: 80%; margin: 0 auto; display: grid; grid-template-columns: repeat(2, 1fr)`).
  - Contains **4 large square cards** (`aspect-ratio: 1 / 1`) with **rounded corners** (`border-radius: 26px`) linking directly to:
    1. `games/tetris.html` — **Tetris** (`TETROMINO OVERDRIVE`)
    2. `games/tictactoe.html` — **Tic-Tac-Toe** (`NEURAL GRID DUEL`)
    3. `games/chess.html` — **Chess** (`GRANDMASTER PROTOCOL`)
    4. `games/mahjong.html` — **Mahjong** (`IMPERIAL TILE DYNASTY`)
- **Inactive Card Mode** (`data-active="false"`, default when not hovered or focused):
  - Displays custom glowing SVG emblem/icon, bold game name, stylized cool title, slot tag, key chip, and subtle breathing neon border frame.
- **Active Card Mode** (`data-active="true"`, activated on mouse hover / pointer enter OR keyboard focus):
  - **3D Mouse-Tracked Tilt & Radial Spotlight Glow**: Pointer movement tilts the card in 3D space and moves a luminous spotlight radial gradient under the cursor.
  - **Rotating Conic-Gradient Neon Laser Border**: Animated high-contrast glowing rim surrounding the active card.
  - **Live Per-Game Mini-Animation (`<canvas class="card-preview-canvas">`)**:
    - *Tetris*: Falling glowing neon tetrominoes and periodic line-clear laser flashes.
    - *Tic-Tac-Toe*: Animated 3×3 neon X/O laser duel culminating in a pulsing winning laser strike.
    - *Chess*: Tactical holographic 8×8 grid with sweeping attack lines and animated glowing pieces.
    - *Mahjong*: Floating beveled tiles with glowing pair-match laser connectors.
  - **Revealed HUD Telemetry & Action Badge**: Reveals live feature pills and a pulsing `PLAY NOW →` badge.
  - **Sibling Focus-Off Dimming**: Non-active cards smoothly transition to `data-dimmed="true"` (lower opacity and subtle scale-down) while one card is active; leaving/blurring cleanly returns all cards to inactive mode.
- **Keyboard Navigation**:
  - `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown` navigate the 2×2 grid and activate focus mode on the targeted card.
  - Number keys `1`–`4` launch the corresponding game directly.
  - `Enter` or `Space` launches the focused card; `Escape` clears card focus.

---

## 3. Shared Game Standards (All 4 Games)
Every game page in `games/` implements:
1. **Shared Topbar & Navigation**: Sticky `.arcade-topbar` with Back to Arcade link (`../index.html`), game badge, and `[data-mute-toggle]` sound button wired via `initArcadeHeader()`.
2. **Essential Controls**: Explicit **Start** and **Reset** buttons alongside game-specific actions (Pause, Undo, Hint, Shuffle, Difficulty/Layout selectors).
3. **Live Score & Match Telemetry**: `.hud-card` showing real-time Score, High Score / Session Stats, Timer (`formatTime()`), and domain-specific counters.
4. **Live Predicted Winner / Outcome Forecast**: `.predictor-card` with `.predictor-bar` / `.predictor-fill` and dynamic search/heuristic forecast updating on moves and game ticks.
5. **Victory / Defeat / Draw Feedback**: `.status-banner` state transitions plus Web Audio SFX via `ArcadeAudio`.
6. **Zero-Error Execution**: Runs cleanly with zero uncaught page errors, zero console errors, and zero failed network requests.

---

## 4. Game-Specific Requirements

### 4.1 Tetris — *TETROMINO OVERDRIVE* (`games/tetris.html`, `ts/games/tetris/*`)
- **Gameplay**: 10×20 visible playfield + 4 buffer rows, 7-bag tetromino randomizer (`I, O, T, S, Z, J, L`), SRS rotation + wall kicks, ghost drop projection, Hold slot (1 swap per drop), Next-3 piece queue, soft drop (+1/cell), hard drop (+2/cell), pause/resume, and level progression every 10 lines.
- **Scoring & Forecast**: Single/Double/Triple/Tetris line clears, T-Spin detection, Back-to-Back bonus, consecutive combo bonus, `localStorage` high-score persistence, and `getSurvivalForecast()` (`DOMINATING`, `ON TRACK`, `PRESSURE`, `CRITICAL`, `VICTORY`, `GAME OVER`) computed from stack height, buried holes, bumpiness, and progress toward Victory rank.
- **Controls & UI**: `#start-btn`, `#pause-btn`, `#reset-btn`, on-screen action buttons (`#btn-left`, `#btn-right`, `#btn-down`, `#btn-rotate-ccw`, `#btn-rotate-cw`, `#btn-drop`, `#btn-hold`), and keyboard (`ArrowLeft`/`A`, `ArrowRight`/`D`, `ArrowDown`/`S`, `ArrowUp`/`W`/`X`, `Z`, `Space`, `C`/`Shift`, `P`, `Enter`, `R`).

### 4.2 Tic-Tac-Toe — *NEURAL GRID DUEL* (`games/tictactoe.html`, `ts/games/tictactoe/*`)
- **Gameplay**: Interactive 3×3 cyber-grid (`[data-cell="0".."8"]`) with animated SVG X/O stroke drawing, hover ghost previews, winning laser line overlay, first-mover selector (`X` default or `O`), and session scoreboard (Player, Draw, AI, Streak).
- **AI & Forecast**: Three AI tiers — **Unbeatable** (default — exact alpha-beta Minimax with depth scoring and center/corner priority), **Tactical**, and **Casual** — with `matchGeneration` cancellation for stale AI timeouts. `predictWinner(board, nextTurn)` computes exact Minimax outcome probabilities (`#player-prob`, `#draw-prob`, `#ai-prob`) and predicted winner banner.
- **Controls & UI**: `#start-btn`, `#reset-btn`, difficulty selector, first-mover selector, click/tap cells, and keyboard (`1`–`9`, Arrow keys + `Enter`/`Space`, `R`).

### 4.3 Chess — *GRANDMASTER PROTOCOL* (`games/chess.html`, `ts/games/chess/*`)
- **Gameplay**: Full FIDE-compliant 8×8 Chess rules engine (`types.ts`, `engine.ts`): all 6 piece types, absolute pin filtering, check detection, kingside/queenside castling, *en passant* (including horizontal rank pin validation), 4-piece pawn promotion modal (`Q`, `R`, `B`, `N`), checkmate, stalemate, insufficient material, threefold repetition, 50-move rule, SAN move history, FEN import/export, undo stack, captured pieces, material differential, and `localStorage` session W/D/L stats.
- **AI & Forecast**: **Novice**, **Club** (default — depth 2 + quiescence), and **Master** (depth 3 iterative deepening alpha-beta + MVV-LVA + piece-square tables + capture quiescence) with `matchGeneration` timeout cancellation. `evaluateBoard` and `predictWinner` drive the live evaluation bar (`#eval-bar-fill`), win probabilities (`#white-win-pct`, `#black-win-pct`), and predicted winner label.
- **Controls & UI**: `#start-btn`, `#reset-btn`, `#undo-btn`, `#hint-btn`, difficulty selector, `#promotion-modal`, click-to-select/move squares, and keyboard (Arrow keys + `Enter`/`Space`, `S`, `R`, `U`, `H`, `Escape`, and `Q`/`R`/`B`/`N` during promotion).

### 4.4 Mahjong Solitaire — *IMPERIAL TILE DYNASTY* (`games/mahjong.html`, `ts/games/mahjong/*`)
- **Gameplay**: Authentic 144-tile classic deck (Bamboo/Characters/Circles 1–9 ×4, Winds E/S/W/N ×4, Dragons Red/Green/White ×4, 4 Seasons matching any Season, 4 Flowers matching any Flower) with custom inline SVG artwork for all 42 faces on 3D ivory/jade beveled tiles. Selectable **Classic Turtle (144)** (5 layers, default) and **Quick Dragon (72)** (4 layers) layouts auto-scaled cleanly inside `1440×900`.
- **Engine & Forecast**: Exact top/left/right free-tile blocking rules, constructive reverse-deal solvable generator (`>= 3` open pairs at start), combo + layer bonus scoring, `localStorage` best score, undo stack (matches and shuffles), hint finder, constructive shuffle, deadlock & victory detection, and `getWinForecast()` (`HIGH CHANCE`, `FAVORABLE`, `RISKY`, `NO MOVES — SHUFFLE`, `VICTORY`).
- **Controls & UI**: `#start-btn`, `#reset-btn`, `#hint-btn`, `#undo-btn`, `#shuffle-btn`, `#highlight-btn`, layout selector, click tile pairs, and keyboard (`H`, `U`/`Z`, `S`, `F`, `Enter`, `R`, `Escape`).

---

## 5. Automated Testing Requirements
- **Unit & Server Tests** (`tests/hub.test.ts`, `tests/tetris.test.ts`, `tests/tictactoe.test.ts`, `tests/chess.test.ts`, `tests/mahjong.test.ts`):
  - Validate static HTTP server routes, MIME types, 404, 405, and path-traversal protection (`403`).
  - Validate shared helpers (`formatTime`, `clamp`, `ArcadeAudio`) and pure TypeScript engines across all 4 games.
- **Headless Chrome CDP End-to-End Tests** (`tests/helpers/cdp.ts`):
  - Verify landing page 2×2 80%-width square rounded cards, hover & keyboard active/dimmed state transitions, and zero runtime/network errors.
  - Verify all 4 games render cleanly at `1440×900` and execute interactive Start, Gameplay/AI turn, Score, Predictor/Forecast, and Reset flows with zero `pageErrors`, zero `consoleErrors`, and zero `failedRequests`.
