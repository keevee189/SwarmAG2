/**
 * Shared audio, header wiring, and utility helpers for Nexus Arcade.
 * Safe to import in both browser modules and Node.js unit tests.
 */

const MUTE_STORAGE_KEY = 'nexus-arcade:muted';

export type ArcadeGameId =
  | 'tetris'
  | 'tictactoe'
  | 'chess'
  | 'mahjong'
  | 'minesweeper'
  | 'game2048';

export interface GameRuleControlItem {
  keys: string;
  action: string;
}

export interface GameRulesEntry {
  id: ArcadeGameId;
  title: string;
  subtitle: string;
  badge: string;
  goal: string;
  howToPlay: string[];
  tips: string[];
  controls: GameRuleControlItem[];
}

export const GAME_RULES: Record<ArcadeGameId, GameRulesEntry> = {
  tetris: {
    id: 'tetris',
    title: 'TETROMINO OVERDRIVE',
    subtitle: 'Friendly Guide & Rules // Tetris',
    badge: '01 // STACKING',
    goal: 'Steer and rotate falling neon blocks (Tetrominoes) to pack complete horizontal rows — reach 10,000 points for Victory Rank or chase an all-time High Score!',
    howToPlay: [
      'Shapes fall from the top of the 10×20 well one at a time. Move them left or right and rotate them so they pack together cleanly without gaps.',
      'Whenever an entire horizontal row is filled from left to right, that line vaporizes and awards points! Clearing 4 lines at once with the long cyan bar scores a high-value TETRIS.',
      'Watch the faint Ghost Piece at the bottom of the well — it shows the exact landing spot if you drop your piece right now.',
      'Use the HOLD slot (C or Shift) to stash an awkward piece for later and swap it once per drop. If the stack reaches the very top of the well, the game is over!',
    ],
    tips: [
      'Keep your stack flat and leave one outer column open so a long I-piece can clear 4 lines at once.',
      'Opening this Rules window while playing automatically pauses your run, and closing it resumes where you left off!',
    ],
    controls: [
      { keys: '← → / A D', action: 'Move block Left or Right' },
      { keys: '↑ / W / X / Z', action: 'Rotate Clockwise (↑/W/X) or Counter-Clockwise (Z)' },
      { keys: '↓ / S', action: 'Soft Drop (+1 pt per cell)' },
      { keys: 'Space', action: 'Instant Hard Drop (+2 pts per cell)' },
      { keys: 'C / Shift', action: 'Hold current piece (once per drop)' },
      { keys: 'P / R / ?', action: 'Pause (P), Reset (R), or Toggle Rules (?)' },
    ],
  },
  tictactoe: {
    id: 'tictactoe',
    title: 'NEURAL GRID DUEL',
    subtitle: 'Friendly Guide & Rules // Tic-Tac-Toe',
    badge: '02 // DUEL GRID',
    goal: 'Outsmart the Nexus AI by being the first player to connect 3 of your glowing X marks in a straight line — horizontally, vertically, or diagonally!',
    howToPlay: [
      'You play as X (Cyan) and the computer plays as O (Magenta) on a 3×3 grid. Press Start, then click any empty square (or press keys 1–9) to place your mark.',
      'Players take turns placing one mark per turn. The first player to line up 3 matching marks triggers the winning laser strike and scores a point.',
      'If all 9 squares fill up without either player making 3-in-a-row, the round ends in a Draw.',
      'Pick your AI opponent in the sidebar: Casual for relaxed play, Tactical for a sharp duel, or Unbeatable to test yourself against a mathematically perfect Minimax AI!',
    ],
    tips: [
      'Opening in the center square (5) or a corner gives you the best chance to create a double threat ("fork") that forces a win.',
      'Watch the Predicted Winner bar in the sidebar — it computes the exact win, draw, and loss probabilities after every move!',
    ],
    controls: [
      { keys: 'Click / 1–9', action: 'Place your X in square 1 through 9' },
      { keys: '↑ ↓ ← →', action: 'Move keyboard cursor across the 3×3 grid' },
      { keys: 'Enter / Space', action: 'Place mark at cursor (Enter starts match when idle)' },
      { keys: 'R / ?', action: 'Reset board (R) or Toggle Rules (?)' },
    ],
  },
  chess: {
    id: 'chess',
    title: 'GRANDMASTER PROTOCOL',
    subtitle: 'Friendly Guide & Rules // Chess',
    badge: '03 // TACTICAL',
    goal: 'Command the White pieces and trap the Black AI King in Checkmate — where the enemy King is under attack and has no legal move to escape!',
    howToPlay: [
      'Click (or use Arrow keys + Enter) on any of your White pieces to see all of its legal moves: cyan dots show open squares, and glowing rings show enemy pieces you can capture.',
      'Each piece moves in its classic way: Pawns advance forward and capture diagonally; Knights jump in an L-shape over obstacles; Bishops glide diagonally; Rooks slide along ranks and files; the Queen combines Rook + Bishop; the King steps 1 square in any direction.',
      'All special chess rules are built in: Castling (move your King 2 squares toward an unmoved Rook), En Passant pawn captures, and Pawn Promotion (pick Queen, Rook, Bishop, or Knight when a Pawn reaches the top row).',
      'If your King is under attack, it pulses crimson for Check and you must defend it on that turn. If a player has no legal moves and is not in check, the match ends in a Stalemate draw.',
    ],
    tips: [
      'Stuck on a tricky position? Click Hint (H) to highlight the Master AI recommendation, or click Undo (U) to take back a move pair and try a new idea.',
      'Control the center squares early, castle to keep your King safe, and watch the Evaluation Bar to see who holds the advantage!',
    ],
    controls: [
      { keys: 'Click / Arrows + Enter', action: 'Select a White piece and play a highlighted move' },
      { keys: 'H', action: 'Highlight Master AI move Hint' },
      { keys: 'U', action: 'Undo last White + Black move pair' },
      { keys: 'S / R / ?', action: 'Start (S), Reset (R), or Toggle Rules (?)' },
      { keys: 'Q / R / B / N', action: 'Choose piece during Pawn Promotion' },
    ],
  },
  mahjong: {
    id: 'mahjong',
    title: 'IMPERIAL TILE DYNASTY',
    subtitle: 'Friendly Guide & Rules // Mahjong Solitaire',
    badge: '04 // SOLITAIRE',
    goal: 'Clear the entire layered pyramid of tiles by matching identical "free" tiles two at a time until zero tiles remain!',
    howToPlay: [
      'You can only pick a tile if it is FREE — meaning no other tile rests on top of it, AND at least one of its long left or right sides is completely unblocked (able to slide out sideways).',
      'Click one free tile to select it, then click a second free tile with the matching face (Bamboo, Characters, Circles, Winds, or Dragons) to clear the pair and score points.',
      'Bonus Tile Rule: any Season tile matches with ANY other Season tile, and any Flower tile matches with ANY other Flower tile — even though their individual artwork differs!',
      'Every board is constructively dealt in reverse so at least one full solution always exists. Match pairs quickly to build up your Combo Multiplier!',
    ],
    tips: [
      'Click Highlight Free (F) to brighten every currently playable tile and dim blocked tiles — it makes spotting pairs effortless.',
      'Clear tiles from the top layers and long horizontal rows first to unlock buried tiles underneath. Use Hint (H), Undo (U), or Shuffle (S) anytime you get stuck!',
    ],
    controls: [
      { keys: 'Click / Tap', action: 'Select two matching free tiles to remove the pair' },
      { keys: 'F', action: 'Toggle Highlight Free tiles' },
      { keys: 'H', action: 'Highlight an available matching pair (Hint)' },
      { keys: 'U / Z', action: 'Undo last match or shuffle' },
      { keys: 'S / R / ?', action: 'Shuffle (S), Reset (R), or Toggle Rules (?)' },
    ],
  },
  minesweeper: {
    id: 'minesweeper',
    title: 'QUANTUM MINESWEEPER',
    subtitle: 'Friendly Guide & Rules // Minesweeper',
    badge: '05 // LOGIC GRID',
    goal: 'Reveal every safe square on the grid using number clues without detonating a single hidden quantum mine!',
    howToPlay: [
      'Click any square to begin — your very first click is always 100% safe and automatically opens a clear starting zone.',
      'Every revealed number (1–8) tells you the exact count of mines hidden in the 8 squares immediately touching that number (horizontally, vertically, and diagonally).',
      'When you deduce that a hidden square contains a mine, Right-Click it (or press F / toggle Flag Mode) to plant a flag so you never click it accidentally.',
      'Quick Clear (Chording): once a revealed number already has the matching number of flags around it, click that number (or press C) to automatically reveal all of its remaining neighbors at once!',
    ],
    tips: [
      'Start at corners and edges: if a "1" only touches a single unrevealed square, that square is guaranteed to be a mine!',
      'Need a hand? Press Hint (H) — the frontier logic solver will highlight a 100%-provably safe square or mine for you.',
    ],
    controls: [
      { keys: 'Left Click / Enter / Space', action: 'Reveal square (or chord a satisfied number)' },
      { keys: 'Right Click / F', action: 'Plant or remove a Flag' },
      { keys: 'C', action: 'Chord neighbors around cursor' },
      { keys: 'H', action: 'Highlight a logical deduction Hint' },
      { keys: 'S / R / ?', action: 'Start (S), Reset (R), or Toggle Rules (?)' },
    ],
  },
  game2048: {
    id: 'game2048',
    title: 'HYPER 2048',
    subtitle: 'Friendly Guide & Rules // 2048',
    badge: '06 // MERGE PUZZLE',
    goal: 'Slide and fuse matching numbered tiles on the 4×4 grid until you forge the glowing 2048 tile (and continue in Endless mode for an even bigger high score)!',
    howToPlay: [
      'Press an Arrow key (↑ ↓ ← →), W A S D, swipe, or click the on-screen D-pad to slide every tile on the board as far as it can go in that direction.',
      'Whenever two tiles with the same number collide during a slide, they merge into a single tile worth their sum (2 + 2 = 4, 4 + 4 = 8, 8 + 8 = 16 ... all the way to 2048!).',
      'After every slide that moves or merges at least one tile, a new 2 (or occasionally a 4) appears on a random empty square.',
      'Single-merge rule: each tile can only merge once per turn — for example, a row of [2, 2, 2, 2] merges into [4, 4], not [8]. If all 16 squares fill up and no adjacent tiles match, the game is over!',
    ],
    tips: [
      'Pick one corner (such as the bottom-left or bottom-right) as home base for your biggest tile, and line up descending tiles next to it like a snake.',
      'Not sure which direction is best? Press Hint (H) for a 2-ply Expectimax recommendation, or press Undo (U / Z) to rewind a move!',
    ],
    controls: [
      { keys: '↑ ↓ ← → / W A S D', action: 'Slide & merge all tiles in that direction' },
      { keys: 'H', action: 'Show Expectimax best-move direction Hint' },
      { keys: 'U / Z', action: 'Undo previous move (multi-step stack)' },
      { keys: 'Enter / R / ?', action: 'Start (Enter), Reset (R), or Toggle Rules (?)' },
    ],
  },
};

export function getGameRules(gameId: string | null | undefined): GameRulesEntry | null {
  if (!gameId) {
    return null;
  }
  const normalized = gameId.trim().toLowerCase() as ArcadeGameId;
  return Object.prototype.hasOwnProperty.call(GAME_RULES, normalized)
    ? GAME_RULES[normalized]
    : null;
}

interface SynthNote {
  freq: number;
  endFreq?: number;
  delay?: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

type AudioContextCtor = typeof AudioContext;

/**
 * Synthesizes crisp Web Audio arcade sound effects without external audio assets.
 */
export class ArcadeAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(nextMuted: boolean): boolean {
    this.muted = Boolean(nextMuted);
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public playClick(): void {
    this.playSequence([{ freq: 640, endFreq: 860, duration: 0.055, type: 'triangle', gain: 0.07 }]);
  }

  public playMove(): void {
    this.playSequence([{ freq: 320, endFreq: 420, duration: 0.06, type: 'sine', gain: 0.06 }]);
  }

  public playMatch(): void {
    this.playSequence([
      { freq: 523.25, duration: 0.08, type: 'triangle', gain: 0.08 },
      { freq: 659.25, delay: 0.06, duration: 0.1, type: 'triangle', gain: 0.08 },
      { freq: 783.99, delay: 0.12, duration: 0.13, type: 'sine', gain: 0.09 },
    ]);
  }

  public playScore(): void {
    this.playSequence([
      { freq: 587.33, duration: 0.07, type: 'square', gain: 0.05 },
      { freq: 880, delay: 0.06, duration: 0.12, type: 'triangle', gain: 0.08 },
    ]);
  }

  public playWin(): void {
    this.playSequence([
      { freq: 523.25, duration: 0.11, type: 'triangle', gain: 0.09 },
      { freq: 659.25, delay: 0.09, duration: 0.11, type: 'triangle', gain: 0.09 },
      { freq: 783.99, delay: 0.18, duration: 0.12, type: 'triangle', gain: 0.09 },
      { freq: 1046.5, delay: 0.28, duration: 0.26, type: 'sine', gain: 0.11 },
    ]);
  }

  public playLose(): void {
    this.playSequence([
      { freq: 392, endFreq: 311.13, duration: 0.15, type: 'sawtooth', gain: 0.06 },
      { freq: 311.13, endFreq: 233.08, delay: 0.14, duration: 0.22, type: 'sawtooth', gain: 0.06 },
      { freq: 220, endFreq: 146.83, delay: 0.3, duration: 0.3, type: 'triangle', gain: 0.08 },
    ]);
  }

  public playError(): void {
    this.playSequence([
      { freq: 190, endFreq: 140, duration: 0.1, type: 'sawtooth', gain: 0.07 },
      { freq: 150, endFreq: 110, delay: 0.08, duration: 0.12, type: 'sawtooth', gain: 0.06 },
    ]);
  }

  private getContext(): AudioContext | null {
    if (this.muted) {
      return null;
    }
    try {
      if (typeof window === 'undefined') {
        return null;
      }
      if (!this.ctx) {
        const win = window as unknown as {
          AudioContext?: AudioContextCtor;
          webkitAudioContext?: AudioContextCtor;
        };
        const Ctor = win.AudioContext ?? win.webkitAudioContext;
        if (!Ctor) {
          return null;
        }
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playSequence(notes: SynthNote[]): void {
    try {
      const ctx = this.getContext();
      if (!ctx) {
        return;
      }
      const baseTime = ctx.currentTime;
      for (const note of notes) {
        const start = baseTime + (note.delay ?? 0);
        const end = start + Math.max(0.02, note.duration);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type;
        osc.frequency.setValueAtTime(note.freq, start);
        if (note.endFreq !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, note.endFreq), end);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(note.gain, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.01);
      }
    } catch {
      // Headless or locked audio contexts must never break gameplay.
    }
  }
}

export const ArcadeAudio = new ArcadeAudioEngine();

function readStoredMute(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredMute(muted: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    }
  } catch {
    // Ignore storage quota or sandbox restrictions.
  }
}

function syncMuteButton(btn: HTMLElement, muted: boolean): void {
  btn.setAttribute('aria-pressed', String(muted));
  btn.setAttribute('data-muted', String(muted));
  btn.setAttribute('title', muted ? 'Unmute arcade audio' : 'Mute arcade audio');

  const labelEl = btn.querySelector<HTMLElement>('[data-mute-label]');
  if (labelEl) {
    labelEl.textContent = muted ? 'Muted' : 'Sound On';
  }
  const iconEl = btn.querySelector<HTMLElement>('[data-mute-icon]');
  if (iconEl) {
    iconEl.textContent = muted ? '🔇' : '🔊';
  }
  if (!labelEl && !iconEl && btn.children.length === 0) {
    btn.textContent = muted ? '🔇 Muted' : '🔊 Sound On';
  }
}

let autoPausedOnRulesOpen = false;
let rulesKeyListenerBound = false;

function detectCurrentGameId(): ArcadeGameId | null {
  try {
    if (typeof document !== 'undefined') {
      const btn = document.querySelector<HTMLElement>('[data-rules-toggle]');
      const attr = btn?.getAttribute('data-rules-toggle');
      const fromBtn = getGameRules(attr);
      if (fromBtn) {
        return fromBtn.id;
      }
    }
    if (typeof window !== 'undefined' && window.location?.pathname) {
      const match = window.location.pathname.match(
        /\/games\/(tetris|tictactoe|chess|mahjong|minesweeper|game2048)\.html/i,
      );
      if (match?.[1]) {
        const fromPath = getGameRules(match[1]);
        if (fromPath) {
          return fromPath.id;
        }
      }
    }
  } catch {
    // Ignore outside browser DOM.
  }
  return null;
}

function syncRulesToggleButtons(open: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.querySelectorAll<HTMLElement>('[data-rules-toggle]').forEach((btn) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-active', open);
    btn.setAttribute('title', open ? 'Close game rules (Esc)' : 'View game rules & controls (?)');
  });
}

function buildRulesModalDOM(entry: GameRulesEntry): HTMLElement {
  let modal = document.getElementById('arcade-rules-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'arcade-rules-modal';
    modal.className = 'rules-modal-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rules-modal-title');
    modal.setAttribute('data-open', 'false');
    modal.hidden = true;

    modal.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === modal) {
        closeRulesModal();
      }
    });

    document.body.appendChild(modal);
  }

  modal.replaceChildren();
  modal.setAttribute('data-rules-game', entry.id);

  const card = document.createElement('div');
  card.className = 'rules-modal-card';

  // Header
  const header = document.createElement('div');
  header.className = 'rules-modal-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'rules-modal-title-group';

  const badge = document.createElement('span');
  badge.id = 'rules-modal-badge';
  badge.className = 'game-badge';
  badge.textContent = entry.badge;

  const title = document.createElement('h2');
  title.id = 'rules-modal-title';
  title.className = 'rules-modal-title';
  title.textContent = entry.title;

  const subtitle = document.createElement('p');
  subtitle.id = 'rules-modal-subtitle';
  subtitle.className = 'rules-modal-subtitle';
  subtitle.textContent = entry.subtitle;

  titleGroup.append(badge, title, subtitle);

  const closeIconBtn = document.createElement('button');
  closeIconBtn.type = 'button';
  closeIconBtn.id = 'rules-close-btn';
  closeIconBtn.className = 'btn btn-ghost btn-sm rules-close-icon';
  closeIconBtn.setAttribute('data-rules-close', 'true');
  closeIconBtn.setAttribute('aria-label', 'Close rules popup');
  closeIconBtn.textContent = '✕';
  closeIconBtn.addEventListener('click', () => {
    closeRulesModal();
  });

  header.append(titleGroup, closeIconBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'rules-modal-body';

  // Goal section
  const goalBox = document.createElement('div');
  goalBox.className = 'rules-goal-box';

  const goalLabel = document.createElement('div');
  goalLabel.className = 'rules-section-label';
  goalLabel.textContent = '🎯 THE GOAL';

  const goalText = document.createElement('p');
  goalText.id = 'rules-goal-text';
  goalText.className = 'rules-goal-text';
  goalText.textContent = entry.goal;

  goalBox.append(goalLabel, goalText);

  // How to Play section
  const howSection = document.createElement('div');
  howSection.className = 'rules-section';

  const howTitle = document.createElement('h3');
  howTitle.className = 'rules-section-title';
  howTitle.textContent = '🕹️ How to Play';

  const howList = document.createElement('ol');
  howList.id = 'rules-how-list';
  howList.className = 'rules-list';
  for (const stepText of entry.howToPlay) {
    const li = document.createElement('li');
    li.className = 'rules-list-item';
    li.textContent = stepText;
    howList.appendChild(li);
  }
  howSection.append(howTitle, howList);

  // Friendly Tips section
  const tipsSection = document.createElement('div');
  tipsSection.className = 'rules-section';

  const tipsTitle = document.createElement('h3');
  tipsTitle.className = 'rules-section-title';
  tipsTitle.textContent = '💡 Friendly Tips';

  const tipsList = document.createElement('ul');
  tipsList.id = 'rules-tips-list';
  tipsList.className = 'rules-tips-list';
  for (const tipText of entry.tips) {
    const li = document.createElement('li');
    li.className = 'rules-tip-item';
    li.textContent = tipText;
    tipsList.appendChild(li);
  }
  tipsSection.append(tipsTitle, tipsList);

  // Controls section
  const controlsSection = document.createElement('div');
  controlsSection.className = 'rules-section';

  const controlsTitle = document.createElement('h3');
  controlsTitle.className = 'rules-section-title';
  controlsTitle.textContent = '⌨️ Controls & Shortcuts';

  const controlsGrid = document.createElement('div');
  controlsGrid.id = 'rules-controls-grid';
  controlsGrid.className = 'rules-controls-grid';
  for (const item of entry.controls) {
    const row = document.createElement('div');
    row.className = 'rules-control-row';

    const kbd = document.createElement('span');
    kbd.className = 'kbd rules-kbd';
    kbd.textContent = item.keys;

    const desc = document.createElement('span');
    desc.className = 'rules-control-action';
    desc.textContent = item.action;

    row.append(kbd, desc);
    controlsGrid.appendChild(row);
  }
  controlsSection.append(controlsTitle, controlsGrid);

  body.append(goalBox, howSection, tipsSection, controlsSection);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'rules-modal-footer';

  const footerHint = document.createElement('span');
  footerHint.className = 'rules-footer-hint';
  footerHint.textContent = 'Press ? anytime to view rules • Esc to close';

  const gotItBtn = document.createElement('button');
  gotItBtn.type = 'button';
  gotItBtn.id = 'rules-got-it-btn';
  gotItBtn.className = 'btn btn-primary';
  gotItBtn.setAttribute('data-rules-close', 'true');
  gotItBtn.textContent = "Got It — Let's Play!";
  gotItBtn.addEventListener('click', () => {
    closeRulesModal();
  });

  footer.append(footerHint, gotItBtn);
  card.append(header, body, footer);
  modal.appendChild(card);

  return modal;
}

/**
 * Returns `true` if the shared game rules modal is currently open in the DOM.
 */
export function isRulesModalOpen(): boolean {
  try {
    if (typeof document === 'undefined') {
      return false;
    }
    const modal = document.getElementById('arcade-rules-modal');
    return Boolean(modal && !modal.hidden && modal.getAttribute('data-open') === 'true');
  } catch {
    return false;
  }
}

/**
 * Opens the friendly rules popup for the specified game (or the current page's detected game).
 */
export function openRulesModal(gameId?: string | null): boolean {
  try {
    if (typeof document === 'undefined') {
      return false;
    }
    const entry = getGameRules(gameId ?? detectCurrentGameId());
    if (!entry) {
      return false;
    }

    // Auto-pause Tetris if actively dropping when the player opens Rules
    if (entry.id === 'tetris' && !isRulesModalOpen()) {
      const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
      if (pauseBtn && !pauseBtn.disabled && (pauseBtn.textContent ?? '').trim() === 'Pause') {
        autoPausedOnRulesOpen = true;
        pauseBtn.click();
      } else {
        autoPausedOnRulesOpen = false;
      }
    }

    const modal = buildRulesModalDOM(entry);
    modal.hidden = false;
    modal.setAttribute('data-open', 'true');
    syncRulesToggleButtons(true);
    ArcadeAudio.playClick();

    const gotItBtn = document.getElementById('rules-got-it-btn') as HTMLButtonElement | null;
    gotItBtn?.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes the game rules popup if currently open.
 */
export function closeRulesModal(): boolean {
  try {
    if (typeof document === 'undefined') {
      return false;
    }
    const modal = document.getElementById('arcade-rules-modal');
    if (!modal || modal.hidden || modal.getAttribute('data-open') !== 'true') {
      return false;
    }

    modal.hidden = true;
    modal.setAttribute('data-open', 'false');
    syncRulesToggleButtons(false);

    if (autoPausedOnRulesOpen) {
      autoPausedOnRulesOpen = false;
      const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
      if (pauseBtn && !pauseBtn.disabled && (pauseBtn.textContent ?? '').trim() === 'Resume') {
        pauseBtn.click();
      }
    }

    ArcadeAudio.playClick();
    return true;
  } catch {
    return false;
  }
}

function bindRulesKeyboardShortcut(): void {
  if (typeof window === 'undefined' || rulesKeyListenerBound) {
    return;
  }
  rulesKeyListenerBound = true;

  window.addEventListener(
    'keydown',
    (ev: KeyboardEvent) => {
      if (isRulesModalOpen()) {
        // Intercept all keys in capture phase so background games never react while reading rules
        ev.stopImmediatePropagation();
        if (ev.key === 'Escape' || ev.key === '?') {
          ev.preventDefault();
          closeRulesModal();
          return;
        }
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          closeRulesModal();
          return;
        }
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
        }
        return;
      }

      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        return;
      }
      const target = ev.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (ev.key === '?' || ev.key === 'F1') {
        const gameId = detectCurrentGameId();
        if (gameId) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          openRulesModal(gameId);
        }
      }
    },
    true,
  );
}

/**
 * Wires `[data-mute-toggle]` and `[data-rules-toggle]` controls in the arcade header.
 */
export function initArcadeHeader(): void {
  try {
    if (typeof document === 'undefined') {
      return;
    }
    const initialMuted = readStoredMute();
    ArcadeAudio.setMuted(initialMuted);

    const buttons = document.querySelectorAll<HTMLElement>('[data-mute-toggle]');
    buttons.forEach((btn) => {
      syncMuteButton(btn, ArcadeAudio.isMuted());
      if (btn.dataset.arcadeBound === 'true') {
        return;
      }
      btn.dataset.arcadeBound = 'true';
      btn.addEventListener('click', () => {
        const nextMuted = ArcadeAudio.toggleMute();
        writeStoredMute(nextMuted);
        document.querySelectorAll<HTMLElement>('[data-mute-toggle]').forEach((el) => {
          syncMuteButton(el, nextMuted);
        });
        if (!nextMuted) {
          ArcadeAudio.playClick();
        }
      });
    });

    const rulesButtons = document.querySelectorAll<HTMLElement>('[data-rules-toggle]');
    rulesButtons.forEach((btn) => {
      syncRulesToggleButtons(isRulesModalOpen());
      if (btn.dataset.rulesBound === 'true') {
        return;
      }
      btn.dataset.rulesBound = 'true';
      btn.addEventListener('click', () => {
        btn.blur();
        if (isRulesModalOpen()) {
          closeRulesModal();
        } else {
          const explicitId = btn.getAttribute('data-rules-toggle');
          openRulesModal(explicitId);
        }
      });
    });

    bindRulesKeyboardShortcut();
  } catch {
    // Safe no-op outside browser DOM.
  }
}

/**
 * Formats a non-negative duration in seconds as `MM:SS`.
 */
export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Clamps `v` into the inclusive `[min, max]` interval.
 */
export function clamp(v: number, min: number, max: number): number {
  const lo = min <= max ? min : max;
  const hi = min <= max ? max : min;
  if (Number.isNaN(v)) {
    return lo;
  }
  return Math.min(hi, Math.max(lo, v));
}
