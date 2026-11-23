/**
 * Browser UI controller for Quantum Minesweeper ("NEXUS ARCADE").
 * Connects DOM sector grid, SVG icons, keyboard cursor navigation,
 * Flag Mode, chording, Web Audio SFX, localStorage best scores, and timer lifecycle.
 */

import { ArcadeAudio, clamp, formatTime, initArcadeHeader } from '../../shared/arcade.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MinesweeperEngine,
  type CellView,
  type Difficulty,
  type ForecastLabel,
  type HintResult,
} from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HIGH_SCORE_STORAGE_PREFIX = 'nexus-arcade:minesweeper:highscore:';
const TIMER_INTERVAL_MS = 200;

function isDifficulty(value: string | undefined): value is Difficulty {
  return value !== undefined && (DIFFICULTY_ORDER as readonly string[]).includes(value);
}

function readStoredHighScore(difficulty: Difficulty): number {
  try {
    if (typeof localStorage === 'undefined') {
      return 0;
    }
    const raw = localStorage.getItem(`${HIGH_SCORE_STORAGE_PREFIX}${difficulty}`);
    if (!raw) {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredHighScore(difficulty: Difficulty, score: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        `${HIGH_SCORE_STORAGE_PREFIX}${difficulty}`,
        String(Math.max(0, Math.floor(score))),
      );
    }
  } catch {
    // Ignore storage quota or sandbox restrictions.
  }
}

function loadAllStoredHighScores(): Record<Difficulty, number> {
  return {
    beginner: readStoredHighScore('beginner'),
    intermediate: readStoredHighScore('intermediate'),
    expert: readStoredHighScore('expert'),
  };
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

function createFlagSvg(): SVGSVGElement {
  const svg = createSvgElement('svg', {
    viewBox: '0 0 32 32',
    class: 'cell-svg cell-svg-flag',
    'aria-hidden': 'true',
  });
  svg.append(
    createSvgElement('path', {
      d: 'M10 26V6',
      stroke: '#f8fafc',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
    }),
    createSvgElement('path', {
      d: 'M11 7l13 4.8L11 17.2Z',
      fill: '#ff2bd6',
      stroke: '#f9a8d4',
      'stroke-width': '1.2',
      'stroke-linejoin': 'round',
    }),
    createSvgElement('path', {
      d: 'M7 26h10',
      stroke: '#00f5ff',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
    }),
  );
  return svg;
}

function createWrongFlagSvg(): SVGSVGElement {
  const svg = createFlagSvg();
  svg.append(
    createSvgElement('path', {
      d: 'M6 6L26 26M26 6L6 26',
      stroke: '#fb7185',
      'stroke-width': '2.8',
      'stroke-linecap': 'round',
    }),
  );
  return svg;
}

function createMineSvg(detonated: boolean): SVGSVGElement {
  const svg = createSvgElement('svg', {
    viewBox: '0 0 32 32',
    class: 'cell-svg cell-svg-mine',
    'aria-hidden': 'true',
  });
  const spikeColor = detonated ? '#fbbf24' : '#fb7185';
  const coreFill = detonated ? '#fb7185' : '#e11d48';
  svg.append(
    createSvgElement('path', {
      d: 'M16 3v5M16 24v5M3 16h5M24 16h5M6.8 6.8l3.6 3.6M21.6 21.6l3.6 3.6M25.2 6.8l-3.6 3.6M10.4 21.6l-3.6 3.6',
      stroke: spikeColor,
      'stroke-width': '2.3',
      'stroke-linecap': 'round',
    }),
    createSvgElement('circle', {
      cx: '16',
      cy: '16',
      r: '7.5',
      fill: coreFill,
      stroke: '#ffe4e6',
      'stroke-width': '1.4',
    }),
    createSvgElement('circle', {
      cx: '13.5',
      cy: '13.5',
      r: '2.1',
      fill: '#ffffff',
      opacity: '0.85',
    }),
  );
  return svg;
}

function forecastFillClass(label: ForecastLabel): string {
  switch (label) {
    case 'VICTORY':
    case 'CERTAIN WIN':
      return 'is-emerald';
    case 'DEDUCTIBLE':
    case 'FAVORABLE':
      return 'is-cyan';
    case 'RISKY':
      return 'is-gold';
    case 'DETONATED':
      return 'is-crimson';
  }
}

function formatCellAriaLabel(cell: CellView, isWon: boolean): string {
  const pos = `Row ${cell.row + 1}, Column ${cell.col + 1}`;
  if (cell.wrongFlag) {
    return `${pos}: wrong flag`;
  }
  if (cell.detonated) {
    return `${pos}: detonated mine`;
  }
  if (cell.revealed && cell.hasMine) {
    return `${pos}: mine`;
  }
  if (cell.flagged) {
    return isWon ? `${pos}: neutralized mine` : `${pos}: flagged`;
  }
  if (!cell.revealed) {
    return `${pos}: unrevealed`;
  }
  return cell.adjacentMines === 0
    ? `${pos}: revealed empty`
    : `${pos}: revealed ${cell.adjacentMines} adjacent mines`;
}

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing required Minesweeper element: ${selector}`);
  }
  return el;
}

class MinesweeperController {
  private readonly engine: MinesweeperEngine;

  private readonly statusBanner = requireElement<HTMLElement>('#status-banner');
  private readonly statusText = requireElement<HTMLElement>('#status-text');
  private readonly modePill = requireElement<HTMLElement>('#mode-pill');

  private readonly boardFrame = requireElement<HTMLElement>('#mine-board-frame');
  private readonly boardEl = requireElement<HTMLElement>('#mine-board');

  private readonly startBtn = requireElement<HTMLButtonElement>('#start-btn');
  private readonly resetBtn = requireElement<HTMLButtonElement>('#reset-btn');
  private readonly hintBtn = requireElement<HTMLButtonElement>('#hint-btn');
  private readonly flagModeBtn = requireElement<HTMLButtonElement>('#flag-mode-btn');
  private readonly flagModeLabel = requireElement<HTMLElement>('#flag-mode-label');

  private readonly difficultyButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#difficulty-control [data-difficulty]'),
  );

  private readonly scoreValue = requireElement<HTMLElement>('#score-value');
  private readonly highScoreValue = requireElement<HTMLElement>('#high-score-value');
  private readonly minesLeftValue = requireElement<HTMLElement>('#mines-left-value');
  private readonly safeLeftValue = requireElement<HTMLElement>('#safe-left-value');
  private readonly timerValue = requireElement<HTMLElement>('#timer-value');

  private readonly forecastFill = requireElement<HTMLElement>('#forecast-fill');
  private readonly forecastLabel = requireElement<HTMLElement>('#forecast-label');
  private readonly forecastPercent = requireElement<HTMLElement>('#forecast-percent');
  private readonly forecastDetail = requireElement<HTMLElement>('#forecast-detail');
  private readonly forecastGridMeta = document.getElementById('forecast-grid-meta');

  private cellButtons: HTMLButtonElement[] = [];
  private builtDifficulty: Difficulty | null = null;
  private flagMode = false;
  private cursorRow = 4;
  private cursorCol = 4;
  private timerIntervalId: number | null = null;
  private lastTickMs = 0;

  constructor() {
    initArcadeHeader();
    this.engine = new MinesweeperEngine({
      difficulty: 'beginner',
      highScores: loadAllStoredHighScores(),
    });
    this.resetCursorToCenter();
    this.rebuildBoardDomIfNeeded();
    this.bindEvents();
    this.render();
  }

  private resetCursorToCenter(): void {
    this.cursorRow = Math.floor(this.engine.getRows() / 2);
    this.cursorCol = Math.floor(this.engine.getCols() / 2);
  }

  private startTimer(): void {
    this.stopTimer();
    this.lastTickMs = performance.now();
    this.timerIntervalId = window.setInterval(() => {
      if (this.engine.getStatus() !== 'playing') {
        this.stopTimer();
        return;
      }
      const now = performance.now();
      const dt = Math.max(0, now - this.lastTickMs);
      this.lastTickMs = now;
      this.engine.tick(dt);
      this.timerValue.textContent = formatTime(this.engine.getElapsedSeconds());
    }, TIMER_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  private rebuildBoardDomIfNeeded(): void {
    const diff = this.engine.getDifficulty();
    if (this.builtDifficulty === diff && this.cellButtons.length > 0) {
      return;
    }
    this.builtDifficulty = diff;
    const rows = this.engine.getRows();
    const cols = this.engine.getCols();

    this.boardFrame.style.setProperty('--grid-cols', String(cols));
    this.boardFrame.style.setProperty('--grid-rows', String(rows));
    this.boardFrame.setAttribute('data-difficulty', diff);

    const fragment = document.createDocumentFragment();
    const nextButtons: HTMLButtonElement[] = [];

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mine-cell';
        btn.dataset.row = String(r);
        btn.dataset.col = String(c);
        btn.dataset.index = String(idx);
        btn.setAttribute('role', 'gridcell');
        btn.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: unrevealed`);
        fragment.appendChild(btn);
        nextButtons.push(btn);
      }
    }

    this.boardEl.replaceChildren(fragment);
    this.cellButtons = nextButtons;
  }

  private bindEvents(): void {
    this.startBtn.addEventListener('click', () => this.handleStart());
    this.resetBtn.addEventListener('click', () => this.handleReset());
    this.hintBtn.addEventListener('click', () => this.handleHint());
    this.flagModeBtn.addEventListener('click', () => this.toggleFlagMode());

    for (const btn of this.difficultyButtons) {
      btn.addEventListener('click', () => {
        const nextDiff = btn.dataset.difficulty;
        if (!isDifficulty(nextDiff) || nextDiff === this.engine.getDifficulty()) {
          return;
        }
        this.handleDifficultyChange(nextDiff);
      });
    }

    this.boardEl.addEventListener('click', (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.mine-cell');
      if (!target) {
        return;
      }
      const row = Number(target.dataset.row);
      const col = Number(target.dataset.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        return;
      }
      this.cursorRow = row;
      this.cursorCol = col;

      const cell = this.engine.getCell(row, col);
      if (!cell) {
        return;
      }

      if (cell.revealed) {
        if (cell.adjacentMines > 0) {
          this.handleChord(row, col);
        }
        return;
      }

      if (this.flagMode) {
        this.handleToggleFlag(row, col);
      } else {
        this.handleReveal(row, col);
      }
    });

    this.boardEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.mine-cell');
      if (!target) {
        return;
      }
      const row = Number(target.dataset.row);
      const col = Number(target.dataset.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        return;
      }
      this.cursorRow = row;
      this.cursorCol = col;
      this.handleToggleFlag(row, col);
    });

    this.boardEl.addEventListener('focusin', (e: FocusEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.mine-cell');
      if (!target) {
        return;
      }
      const row = Number(target.dataset.row);
      const col = Number(target.dataset.col);
      if (Number.isInteger(row) && Number.isInteger(col)) {
        this.cursorRow = row;
        this.cursorCol = col;
        this.syncCursorClasses();
      }
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeyDown(e));

    window.addEventListener('pagehide', () => this.stopTimer());
    window.addEventListener('beforeunload', () => this.stopTimer());
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    const key = e.key;

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const rows = this.engine.getRows();
      const cols = this.engine.getCols();
      if (key === 'ArrowUp') {
        this.cursorRow = (this.cursorRow + rows - 1) % rows;
      } else if (key === 'ArrowDown') {
        this.cursorRow = (this.cursorRow + 1) % rows;
      } else if (key === 'ArrowLeft') {
        this.cursorCol = (this.cursorCol + cols - 1) % cols;
      } else {
        this.cursorCol = (this.cursorCol + 1) % cols;
      }
      this.focusCursorCell();
      return;
    }

    if (key === 'Enter' || key === ' ') {
      const activeEl = document.activeElement;
      const isOtherInteractive =
        activeEl instanceof HTMLElement &&
        !activeEl.classList.contains('mine-cell') &&
        (activeEl.tagName === 'BUTTON' ||
          activeEl.tagName === 'A' ||
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT');
      if (isOtherInteractive) {
        return;
      }

      e.preventDefault();
      if (activeEl instanceof HTMLElement && activeEl.classList.contains('mine-cell')) {
        const r = Number(activeEl.dataset.row);
        const c = Number(activeEl.dataset.col);
        if (Number.isInteger(r) && Number.isInteger(c)) {
          this.cursorRow = r;
          this.cursorCol = c;
        }
      }
      this.handleReveal(this.cursorRow, this.cursorCol);
      return;
    }

    if (key === 'f' || key === 'F') {
      e.preventDefault();
      this.handleToggleFlag(this.cursorRow, this.cursorCol);
      return;
    }

    if (key === 'c' || key === 'C') {
      e.preventDefault();
      this.handleChord(this.cursorRow, this.cursorCol);
      return;
    }

    if (key === 'h' || key === 'H') {
      e.preventDefault();
      this.handleHint();
      return;
    }

    if (key === 's' || key === 'S') {
      e.preventDefault();
      this.handleStart();
      return;
    }

    if (key === 'r' || key === 'R') {
      e.preventDefault();
      this.handleReset();
    }
  }

  private focusCursorCell(): void {
    const idx = this.cursorRow * this.engine.getCols() + this.cursorCol;
    const btn = this.cellButtons[idx];
    if (btn) {
      btn.focus({ preventScroll: true });
    }
    this.syncCursorClasses();
  }

  private syncCursorClasses(): void {
    const activeIdx = this.cursorRow * this.engine.getCols() + this.cursorCol;
    for (let i = 0; i < this.cellButtons.length; i += 1) {
      const isCursor = i === activeIdx;
      this.cellButtons[i].classList.toggle('is-cursor', isCursor);
      if (isCursor) {
        this.cellButtons[i].setAttribute('data-cursor', 'true');
      } else {
        this.cellButtons[i].removeAttribute('data-cursor');
      }
    }
  }

  private handleStart(): void {
    this.engine.start();
    this.startTimer();
    ArcadeAudio.playClick();
    this.render('Sweep active — first click is shielded for a clean opening cascade.');
  }

  private handleReset(): void {
    this.stopTimer();
    this.engine.reset();
    this.resetCursorToCenter();
    ArcadeAudio.playClick();
    this.render('Board reset. Press Start (S) or click any cell to deploy.');
  }

  private handleDifficultyChange(nextDiff: Difficulty): void {
    this.stopTimer();
    this.engine.setDifficulty(nextDiff);
    this.resetCursorToCenter();
    this.rebuildBoardDomIfNeeded();
    ArcadeAudio.playClick();
    const cfg = DIFFICULTIES[nextDiff];
    this.render(`${cfg.label} sector (${cfg.rows}×${cfg.cols}, ${cfg.mines} mines) armed.`);
  }

  private toggleFlagMode(): void {
    this.flagMode = !this.flagMode;
    ArcadeAudio.playClick();
    this.render(
      this.flagMode
        ? 'Flag Mode enabled — left-clicking sealed cells places or removes flags.'
        : 'Reveal Mode enabled — left-clicking sealed cells scans sectors.',
    );
  }

  private handleReveal(row: number, col: number): void {
    const wasIdle = this.engine.getStatus() === 'idle';
    const result = this.engine.reveal(row, col);
    if (!result.ok) {
      ArcadeAudio.playError();
      if (result.reason === 'flagged') {
        this.render('Cell is flagged. Unflag it first (Right-click or F) to reveal.');
      } else {
        this.render();
      }
      return;
    }

    if (wasIdle && this.engine.getStatus() === 'playing') {
      this.startTimer();
    }

    if (result.detonated) {
      this.stopTimer();
      ArcadeAudio.playLose();
      this.render(`Detonation at (${row + 1}, ${col + 1})! Press Start (S) or Reset (R) to retry.`);
      return;
    }

    if (result.status === 'won') {
      this.stopTimer();
      writeStoredHighScore(this.engine.getDifficulty(), this.engine.getHighScore());
      ArcadeAudio.playWin();
      this.render(
        `Sector cleared! Victory score: ${this.engine.getScore()} in ${formatTime(this.engine.getElapsedSeconds())}.`,
      );
      return;
    }

    writeStoredHighScore(this.engine.getDifficulty(), this.engine.getHighScore());
    if (result.newlyRevealed.length >= 2) {
      ArcadeAudio.playMatch();
      this.render(
        `Cascade opened ${result.newlyRevealed.length} safe sectors (+${result.pointsAwarded} pts).`,
      );
    } else {
      ArcadeAudio.playMove();
      this.render();
    }
  }

  private handleToggleFlag(row: number, col: number): void {
    const result = this.engine.toggleFlag(row, col);
    if (!result.ok) {
      ArcadeAudio.playError();
      return;
    }
    ArcadeAudio.playMove();
    this.render(
      result.flagged
        ? `Flag planted at (${row + 1}, ${col + 1}).`
        : `Flag removed from (${row + 1}, ${col + 1}).`,
    );
  }

  private handleChord(row: number, col: number): void {
    const result = this.engine.chord(row, col);
    if (!result.ok) {
      if (result.reason === 'flag-count-mismatch') {
        ArcadeAudio.playError();
        this.render('Chord requires adjacent flag count to match the cell number.');
      }
      return;
    }

    if (result.detonated) {
      this.stopTimer();
      ArcadeAudio.playLose();
      this.render('Chord triggered an unflagged mine due to a misplaced flag!');
      return;
    }

    if (result.status === 'won') {
      this.stopTimer();
      writeStoredHighScore(this.engine.getDifficulty(), this.engine.getHighScore());
      ArcadeAudio.playWin();
      this.render(
        `Precision chord cleared the final sectors! Score: ${this.engine.getScore()}.`,
      );
      return;
    }

    writeStoredHighScore(this.engine.getDifficulty(), this.engine.getHighScore());
    ArcadeAudio.playMatch();
    this.render(
      `Chord cleared ${result.newlyRevealed.length} neighbor${result.newlyRevealed.length === 1 ? '' : 's'} (+${result.pointsAwarded} pts).`,
    );
  }

  private handleHint(): void {
    const hint = this.engine.requestHint();
    if (!hint) {
      ArcadeAudio.playError();
      return;
    }
    this.cursorRow = hint.row;
    this.cursorCol = hint.col;
    ArcadeAudio.playClick();
    this.render(hint.reason);
  }

  private hintAttributeFor(hint: HintResult | null, index: number): string | null {
    if (!hint || hint.index !== index) {
      return null;
    }
    if (hint.kind === 'mine') {
      return 'mine';
    }
    if (hint.kind === 'guess') {
      return 'guess';
    }
    return 'safe';
  }

  private render(customBannerMessage?: string): void {
    const snapshot = this.engine.getSnapshot();
    const isWon = snapshot.status === 'won';

    this.boardFrame.setAttribute('data-difficulty', snapshot.difficulty);
    this.boardFrame.setAttribute('data-status', snapshot.status);
    this.boardFrame.setAttribute('data-flag-mode', String(this.flagMode));

    // Render board cells
    for (let i = 0; i < snapshot.board.length; i += 1) {
      const cell = snapshot.board[i];
      const btn = this.cellButtons[i];
      if (!btn) {
        continue;
      }

      btn.classList.toggle('is-revealed', cell.revealed && !cell.hasMine);
      btn.classList.toggle('has-number', cell.revealed && !cell.hasMine && cell.adjacentMines > 0);
      btn.classList.toggle('is-flagged', cell.flagged && !cell.wrongFlag);
      btn.classList.toggle('is-wrong-flag', cell.wrongFlag);
      btn.classList.toggle('is-mine', cell.revealed && cell.hasMine && !cell.detonated);
      btn.classList.toggle('is-detonated', cell.detonated);

      for (let n = 1; n <= 8; n += 1) {
        btn.classList.toggle(`num-${n}`, cell.revealed && !cell.hasMine && cell.adjacentMines === n);
      }

      const hintKind = this.hintAttributeFor(snapshot.activeHint, i);
      if (hintKind) {
        btn.setAttribute('data-hint', hintKind);
      } else {
        btn.removeAttribute('data-hint');
      }

      btn.setAttribute('data-revealed', String(cell.revealed));
      btn.setAttribute('data-flagged', String(cell.flagged));
      btn.setAttribute('aria-label', formatCellAriaLabel(cell, isWon));

      if (cell.wrongFlag) {
        btn.replaceChildren(createWrongFlagSvg());
      } else if (cell.detonated || (cell.revealed && cell.hasMine)) {
        btn.replaceChildren(createMineSvg(cell.detonated));
      } else if (cell.flagged) {
        btn.replaceChildren(createFlagSvg());
      } else if (cell.revealed) {
        btn.textContent = cell.adjacentMines > 0 ? String(cell.adjacentMines) : '';
      } else {
        btn.textContent = '';
      }
    }

    this.syncCursorClasses();

    // Controls state
    this.flagModeBtn.classList.toggle('is-active', this.flagMode);
    this.flagModeBtn.setAttribute('aria-pressed', String(this.flagMode));
    this.flagModeLabel.textContent = this.flagMode ? 'Flag Mode: ON' : 'Flag Mode: OFF';

    for (const btn of this.difficultyButtons) {
      const active = btn.dataset.difficulty === snapshot.difficulty;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    if (snapshot.status === 'idle') {
      this.startBtn.textContent = 'Start';
    } else if (snapshot.status === 'playing') {
      this.startBtn.textContent = 'Restart';
    } else {
      this.startBtn.textContent = 'Play Again';
    }

    this.hintBtn.disabled = snapshot.status === 'won' || snapshot.status === 'lost';

    // Scoreboard HUD
    this.scoreValue.textContent = String(snapshot.score);
    this.highScoreValue.textContent = String(snapshot.highScore);
    this.minesLeftValue.textContent = String(snapshot.minesLeft);
    this.safeLeftValue.textContent = String(snapshot.safeLeft);
    this.timerValue.textContent = formatTime(snapshot.elapsedSeconds);

    // Status Banner & Mode Pill
    this.statusBanner.classList.remove('is-info', 'is-active', 'is-victory', 'is-defeat');
    this.modePill.classList.toggle(
      'is-flag-mode',
      this.flagMode && (snapshot.status === 'idle' || snapshot.status === 'playing'),
    );

    if (snapshot.status === 'won') {
      this.statusBanner.classList.add('is-victory');
      this.modePill.textContent = 'CLEARED';
      this.statusText.textContent =
        customBannerMessage ??
        `Victory! All ${snapshot.totalSafeCells} safe sectors swept in ${formatTime(snapshot.elapsedSeconds)}.`;
    } else if (snapshot.status === 'lost') {
      this.statusBanner.classList.add('is-defeat');
      this.modePill.textContent = 'DETONATED';
      this.statusText.textContent =
        customBannerMessage ?? 'Detonation! Press Start (S) or Reset (R) to launch a new sweep.';
    } else if (snapshot.status === 'playing') {
      this.statusBanner.classList.add('is-active');
      this.modePill.textContent = this.flagMode ? 'FLAG MODE' : 'REVEAL MODE';
      this.statusText.textContent =
        customBannerMessage ??
        (this.flagMode
          ? 'Flag Mode active — click cells to flag mines, or toggle off to reveal.'
          : `${snapshot.safeLeft} safe sectors remaining — click a number to chord.`);
    } else {
      this.statusBanner.classList.add('is-info');
      this.modePill.textContent = this.flagMode ? 'FLAG MODE' : 'STANDBY';
      this.statusText.textContent =
        customBannerMessage ??
        'Shielded first click ready. Press Start (S) or click any cell.';
    }

    // Deduction Outlook Predictor
    const forecast = this.engine.getWinForecast();
    const cfg = DIFFICULTIES[snapshot.difficulty];
    this.forecastLabel.textContent = forecast.label;
    this.forecastPercent.textContent = `${forecast.percent}%`;
    this.forecastDetail.textContent = forecast.detail;
    this.forecastFill.style.width = `${clamp(forecast.percent, 0, 100)}%`;
    this.forecastFill.classList.remove('is-emerald', 'is-cyan', 'is-gold', 'is-crimson');
    this.forecastFill.classList.add(forecastFillClass(forecast.label));
    if (this.forecastGridMeta) {
      this.forecastGridMeta.textContent = `${cfg.rows}×${cfg.cols} // ${cfg.mines} MINES`;
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new MinesweeperController();
    });
  } else {
    new MinesweeperController();
  }
}
