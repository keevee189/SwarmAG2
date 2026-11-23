/**
 * Browser UI controller for Hyper 2048 ("Merge Matrix").
 * Wires 4x4 neon glassmorphic tiles, directional/swipe/keyboard controls,
 * 2-ply expectimax hints, Win Forecast telemetry, localStorage best score, and Web Audio SFX.
 */

import { ArcadeAudio, initArcadeHeader } from '../../shared/arcade.js';
import {
  CELL_COUNT,
  Direction,
  ForecastLabel,
  Game2048Engine,
  Game2048Snapshot,
  GameMode,
  MoveResult,
} from './engine.js';

const HIGH_SCORE_STORAGE_KEY = 'nexus-arcade:game2048-highscore';
const SWIPE_THRESHOLD_PX = 24;

const DIRECTION_ARROWS: Record<Direction, string> = {
  up: '↑ UP',
  down: '↓ DOWN',
  left: '← LEFT',
  right: '→ RIGHT',
};

function readStoredHighScore(): number {
  try {
    if (typeof localStorage === 'undefined') {
      return 0;
    }
    const raw = localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredHighScore(score: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(Math.floor(score)));
    }
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

function forecastFillClass(label: ForecastLabel): string {
  switch (label) {
    case '2048 REACHED':
    case 'LOCKED IN':
      return 'is-emerald';
    case 'STRONG FLOW':
    case 'BALANCED':
      return 'is-cyan';
    case 'TIGHT GRID':
      return 'is-gold';
    case 'CRITICAL':
    case 'GRID LOCKED':
      return 'is-crimson';
  }
}

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing required Hyper 2048 element: ${selector}`);
  }
  return el;
}

class Game2048Controller {
  private readonly engine: Game2048Engine;

  private readonly gridEl: HTMLElement;
  private readonly cellEls: HTMLElement[] = [];

  private readonly statusBannerEl: HTMLElement;
  private readonly statusTextEl: HTMLElement;
  private readonly modePillEl: HTMLElement;

  private readonly gameOverlayEl: HTMLElement;
  private readonly overlayKickerEl: HTMLElement;
  private readonly overlayTitleEl: HTMLElement;
  private readonly overlaySubtitleEl: HTMLElement;
  private readonly overlayContinueBtn: HTMLButtonElement;
  private readonly overlayResetBtn: HTMLButtonElement;

  private readonly startBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly hintBtn: HTMLButtonElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly modeButtons: HTMLButtonElement[];

  private readonly dpadButtons: Record<Direction, HTMLButtonElement>;
  private readonly hintBadgeEl: HTMLElement;

  private readonly scoreValueEl: HTMLElement;
  private readonly highScoreValueEl: HTMLElement;
  private readonly bestTileValueEl: HTMLElement;
  private readonly movesValueEl: HTMLElement;
  private readonly mergeStreakValueEl: HTMLElement;

  private readonly forecastPercentEl: HTMLElement;
  private readonly forecastFillEl: HTMLElement;
  private readonly forecastBarEl: HTMLElement | null;
  private readonly forecastLabelEl: HTMLElement;
  private readonly forecastDetailEl: HTMLElement;

  private persistedHighScore: number;
  private activeHintDir: Direction | null = null;
  private pointerSwipeStart: { id: number; x: number; y: number } | null = null;
  private statusOverride: string | null = null;

  constructor() {
    this.persistedHighScore = readStoredHighScore();
    this.engine = new Game2048Engine({
      mode: 'classic',
      highScore: this.persistedHighScore,
    });

    this.gridEl = requireElement<HTMLElement>('#grid-2048');
    for (let i = 0; i < CELL_COUNT; i += 1) {
      this.cellEls.push(requireElement<HTMLElement>(`#grid-2048 [data-cell="${i}"]`));
    }

    this.statusBannerEl = requireElement<HTMLElement>('#status-banner');
    this.statusTextEl = requireElement<HTMLElement>('#status-text');
    this.modePillEl = requireElement<HTMLElement>('#mode-pill');

    this.gameOverlayEl = requireElement<HTMLElement>('#game-overlay');
    this.overlayKickerEl = requireElement<HTMLElement>('#overlay-kicker');
    this.overlayTitleEl = requireElement<HTMLElement>('#overlay-title');
    this.overlaySubtitleEl = requireElement<HTMLElement>('#overlay-subtitle');
    this.overlayContinueBtn = requireElement<HTMLButtonElement>('#overlay-continue-btn');
    this.overlayResetBtn = requireElement<HTMLButtonElement>('#overlay-reset-btn');

    this.startBtn = requireElement<HTMLButtonElement>('#start-btn');
    this.resetBtn = requireElement<HTMLButtonElement>('#reset-btn');
    this.undoBtn = requireElement<HTMLButtonElement>('#undo-btn');
    this.hintBtn = requireElement<HTMLButtonElement>('#hint-btn');
    this.continueBtn = requireElement<HTMLButtonElement>('#continue-btn');
    this.modeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#mode-control [data-mode]'),
    );

    this.dpadButtons = {
      up: requireElement<HTMLButtonElement>('#btn-up'),
      down: requireElement<HTMLButtonElement>('#btn-down'),
      left: requireElement<HTMLButtonElement>('#btn-left'),
      right: requireElement<HTMLButtonElement>('#btn-right'),
    };
    this.hintBadgeEl = requireElement<HTMLElement>('#hint-direction-badge');

    this.scoreValueEl = requireElement<HTMLElement>('#score-value');
    this.highScoreValueEl = requireElement<HTMLElement>('#high-score-value');
    this.bestTileValueEl = requireElement<HTMLElement>('#best-tile-value');
    this.movesValueEl = requireElement<HTMLElement>('#moves-value');
    this.mergeStreakValueEl = requireElement<HTMLElement>('#merge-streak-value');

    this.forecastPercentEl = requireElement<HTMLElement>('#forecast-percent');
    this.forecastFillEl = requireElement<HTMLElement>('#forecast-fill');
    this.forecastBarEl = this.forecastFillEl.parentElement;
    this.forecastLabelEl = requireElement<HTMLElement>('#forecast-label');
    this.forecastDetailEl = requireElement<HTMLElement>('#forecast-detail');

    this.bindEvents();
    this.syncUI(this.engine.getSnapshot(), true);
  }

  private bindEvents(): void {
    this.startBtn.addEventListener('click', () => {
      this.startBtn.blur();
      this.handleStart();
    });

    this.resetBtn.addEventListener('click', () => {
      this.resetBtn.blur();
      this.handleReset();
    });

    this.undoBtn.addEventListener('click', () => {
      this.undoBtn.blur();
      this.handleUndo();
    });

    this.hintBtn.addEventListener('click', () => {
      this.hintBtn.blur();
      this.handleHint();
    });

    this.continueBtn.addEventListener('click', () => {
      this.continueBtn.blur();
      this.handleContinueEndless();
    });

    this.overlayContinueBtn.addEventListener('click', () => {
      this.overlayContinueBtn.blur();
      this.handleContinueEndless();
    });

    this.overlayResetBtn.addEventListener('click', () => {
      this.overlayResetBtn.blur();
      this.handleReset();
    });

    for (const modeBtn of this.modeButtons) {
      modeBtn.addEventListener('click', () => {
        modeBtn.blur();
        const mode = modeBtn.dataset.mode;
        if (mode === 'classic' || mode === 'endless') {
          this.handleModeSelect(mode);
        }
      });
    }

    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const btn = this.dpadButtons[dir];
      btn.addEventListener('click', () => {
        btn.blur();
        this.performMove(dir);
      });
    }

    this.gridEl.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.gridEl.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.gridEl.addEventListener('pointercancel', () => {
      this.pointerSwipeStart = null;
    });

    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') {
      return;
    }
    this.pointerSwipeStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.pointerSwipeStart || this.pointerSwipeStart.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - this.pointerSwipeStart.x;
    const dy = event.clientY - this.pointerSwipeStart.y;
    this.pointerSwipeStart = null;

    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) {
      return;
    }

    const direction: Direction =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? 'right'
          : 'left'
        : dy > 0
          ? 'down'
          : 'up';

    this.performMove(direction);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (target instanceof HTMLElement && target.closest('a, [data-mute-toggle]')) {
      return;
    }

    const key = event.key;
    const lowerKey = key.toLowerCase();
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;

    if (key === 'Enter') {
      if (target instanceof HTMLButtonElement && target !== this.startBtn) {
        return;
      }
      if (!event.repeat) {
        event.preventDefault();
        this.handleStart();
      }
      return;
    }

    if (hasModifier) {
      return;
    }

    if (lowerKey === 'r') {
      if (!event.repeat) {
        event.preventDefault();
        this.handleReset();
      }
      return;
    }

    if (lowerKey === 'h') {
      if (!event.repeat) {
        event.preventDefault();
        this.handleHint();
      }
      return;
    }

    if (lowerKey === 'u' || lowerKey === 'z') {
      if (!event.repeat) {
        event.preventDefault();
        this.handleUndo();
      }
      return;
    }

    let direction: Direction | null = null;
    if (key === 'ArrowUp' || lowerKey === 'w') {
      direction = 'up';
    } else if (key === 'ArrowDown' || lowerKey === 's') {
      direction = 'down';
    } else if (key === 'ArrowLeft' || lowerKey === 'a') {
      direction = 'left';
    } else if (key === 'ArrowRight' || lowerKey === 'd') {
      direction = 'right';
    }

    if (direction) {
      event.preventDefault();
      if (!event.repeat) {
        this.performMove(direction);
      }
    }
  }

  private handleStart(): void {
    this.clearHint();
    this.statusOverride = 'New Hyper 2048 grid initialized — slide to merge tiles!';
    this.engine.start();
    ArcadeAudio.playClick();
    this.gridEl.focus({ preventScroll: true });
    this.syncUI(this.engine.getSnapshot(), true);
  }

  private handleReset(): void {
    this.clearHint();
    this.statusOverride = 'Matrix reset — merge plasma tiles to forge 2048!';
    this.engine.reset();
    ArcadeAudio.playClick();
    this.gridEl.focus({ preventScroll: true });
    this.syncUI(this.engine.getSnapshot(), true);
  }

  private handleUndo(): void {
    if (!this.engine.canUndo()) {
      ArcadeAudio.playError();
      return;
    }
    this.clearHint();
    const restored = this.engine.undo();
    if (restored) {
      this.statusOverride = 'Reverted to previous grid state.';
      ArcadeAudio.playClick();
      this.syncUI(this.engine.getSnapshot(), true);
    } else {
      ArcadeAudio.playError();
    }
  }

  private handleHint(): void {
    if (this.engine.getStatus() !== 'playing') {
      ArcadeAudio.playError();
      return;
    }
    const hint = this.engine.getBestMoveHint();
    if (!hint) {
      this.clearHint();
      ArcadeAudio.playError();
      return;
    }

    this.applyHintVisual(hint.direction);
    this.statusOverride = `Expectimax suggests ${DIRECTION_ARROWS[hint.direction]} — ${hint.reason}`;
    ArcadeAudio.playClick();
    this.syncStatusAndControls(this.engine.getSnapshot());
  }

  private handleContinueEndless(): void {
    this.clearHint();
    if (this.engine.continueEndless()) {
      this.statusOverride = 'Endless Overdrive engaged — climb to 4096, 8192, and beyond!';
      ArcadeAudio.playClick();
      this.gridEl.focus({ preventScroll: true });
      this.syncUI(this.engine.getSnapshot(), false);
    }
  }

  private handleModeSelect(mode: GameMode): void {
    const prevStatus = this.engine.getStatus();
    this.engine.setMode(mode);
    this.clearHint();
    this.statusOverride =
      mode === 'endless'
        ? prevStatus === 'won'
          ? 'Endless mode active — keep climbing past 2048!'
          : 'Endless mode armed — play continues past 2048.'
        : 'Classic mode active — forge a 2048 tile to claim Victory!';
    ArcadeAudio.playClick();
    this.syncUI(this.engine.getSnapshot(), false);
  }

  private performMove(direction: Direction): void {
    if (this.engine.getStatus() !== 'playing') {
      return;
    }

    const result: MoveResult = this.engine.move(direction);
    if (!result.moved) {
      ArcadeAudio.playError();
      return;
    }

    this.clearHint();
    this.statusOverride = this.describeMoveOutcome(result);

    if (result.reached2048) {
      ArcadeAudio.playWin();
    } else if (result.status === 'gameover') {
      ArcadeAudio.playLose();
    } else if (result.merges >= 2 || result.scoreDelta >= 128) {
      ArcadeAudio.playScore();
    } else if (result.merges > 0) {
      ArcadeAudio.playMatch();
    } else {
      ArcadeAudio.playMove();
    }

    this.syncUI(this.engine.getSnapshot(), true);
  }

  private describeMoveOutcome(result: MoveResult): string | null {
    const snapshot = this.engine.getSnapshot();
    if (result.reached2048 && result.status === 'won') {
      return `2048 FORGED in ${snapshot.moves} moves! Continue Endless or start a New Game.`;
    }
    if (result.reached2048 && snapshot.mode === 'endless') {
      return `2048 Milestone forged in Endless Mode (+${result.scoreDelta.toLocaleString()} pts)!`;
    }
    if (result.status === 'gameover') {
      return `Grid locked at ${snapshot.score.toLocaleString()} pts (Best tile: ${snapshot.bestTile}).`;
    }
    if (result.merges >= 2) {
      return `${result.merges}x Chain Merge (+${result.scoreDelta.toLocaleString()} pts) · Streak ${snapshot.mergeStreak}x!`;
    }
    if (result.merges === 1) {
      return `Merged +${result.scoreDelta.toLocaleString()} pts · Streak ${snapshot.mergeStreak}x`;
    }
    return null;
  }

  private applyHintVisual(direction: Direction): void {
    this.clearHint();
    this.activeHintDir = direction;
    this.dpadButtons[direction].classList.add('is-hinted');
    this.hintBadgeEl.textContent = `HINT: ${DIRECTION_ARROWS[direction]}`;
    this.hintBadgeEl.hidden = false;
  }

  private clearHint(): void {
    if (this.activeHintDir) {
      this.dpadButtons[this.activeHintDir].classList.remove('is-hinted');
      this.activeHintDir = null;
    }
    this.hintBadgeEl.hidden = true;
  }

  private syncUI(snapshot: Game2048Snapshot, animateTiles: boolean): void {
    if (snapshot.highScore > this.persistedHighScore) {
      this.persistedHighScore = snapshot.highScore;
      writeStoredHighScore(this.persistedHighScore);
    }

    this.renderBoard(snapshot, animateTiles);
    this.renderTelemetry(snapshot);
    this.syncStatusAndControls(snapshot);
  }

  private renderBoard(snapshot: Game2048Snapshot, animateTiles: boolean): void {
    const mergedSet = new Set<number>(snapshot.lastMergedIndices);
    const transitionByTarget = new Map<number, number[]>();
    for (const tr of snapshot.lastTransitions) {
      transitionByTarget.set(tr.toIndex, tr.fromIndices);
    }

    const firstCellRect = this.cellEls[0].getBoundingClientRect();
    const secondCellRect = this.cellEls[1].getBoundingClientRect();
    const stepX =
      secondCellRect.left > firstCellRect.left ? secondCellRect.left - firstCellRect.left : 104;
    const fourthCellRect = this.cellEls[4].getBoundingClientRect();
    const stepY =
      fourthCellRect.top > firstCellRect.top ? fourthCellRect.top - firstCellRect.top : stepX;

    for (let i = 0; i < CELL_COUNT; i += 1) {
      const cellEl = this.cellEls[i];
      const value = snapshot.grid[i];
      const row = Math.floor(i / 4) + 1;
      const col = (i % 4) + 1;

      cellEl.dataset.value = String(value);

      if (value === 0) {
        if (cellEl.childElementCount > 0) {
          cellEl.replaceChildren();
        }
        cellEl.setAttribute('aria-label', `Row ${row} Column ${col}: empty`);
        continue;
      }

      const tileEl = document.createElement('div');
      tileEl.className = 'tile-2048';
      tileEl.dataset.tile = String(value);
      if (value >= 4096) {
        tileEl.dataset.tier = 'super';
      }

      const digits = String(value).length;
      if (digits === 3) {
        tileEl.classList.add('digits-3');
      } else if (digits === 4) {
        tileEl.classList.add('digits-4');
      } else if (digits >= 5) {
        tileEl.classList.add('digits-5');
      }

      tileEl.textContent = String(value);

      if (animateTiles) {
        if (snapshot.lastSpawnIndex === i) {
          tileEl.classList.add('is-spawned');
        } else if (mergedSet.has(i)) {
          tileEl.classList.add('is-merged');
        } else {
          const fromList = transitionByTarget.get(i);
          if (fromList && fromList.length === 1 && fromList[0] !== i) {
            const fromIdx = fromList[0];
            const fromCol = fromIdx % 4;
            const fromRow = Math.floor(fromIdx / 4);
            const toCol = i % 4;
            const toRow = Math.floor(i / 4);
            const dx = (fromCol - toCol) * stepX;
            const dy = (fromRow - toRow) * stepY;
            if (dx !== 0 || dy !== 0) {
              tileEl.style.setProperty('--slide-x', `${dx.toFixed(1)}px`);
              tileEl.style.setProperty('--slide-y', `${dy.toFixed(1)}px`);
              tileEl.classList.add('is-slid');
            }
          }
        }
      }

      cellEl.replaceChildren(tileEl);
      cellEl.setAttribute('aria-label', `Row ${row} Column ${col}: ${value}`);
    }
  }

  private renderTelemetry(snapshot: Game2048Snapshot): void {
    this.scoreValueEl.textContent = snapshot.score.toLocaleString();
    this.highScoreValueEl.textContent = snapshot.highScore.toLocaleString();
    this.bestTileValueEl.textContent = String(snapshot.bestTile);
    this.movesValueEl.textContent = String(snapshot.moves);
    this.mergeStreakValueEl.textContent = `${snapshot.mergeStreak}x`;

    const forecast = snapshot.forecast;
    this.forecastPercentEl.textContent = `${forecast.percent}%`;
    this.forecastFillEl.style.width = `${forecast.percent}%`;
    this.forecastFillEl.className = `predictor-fill ${forecastFillClass(forecast.label)}`;
    this.forecastLabelEl.textContent = forecast.label;
    this.forecastDetailEl.textContent = forecast.detail;
    if (this.forecastBarEl) {
      this.forecastBarEl.setAttribute('aria-valuenow', String(forecast.percent));
    }
  }

  private syncStatusAndControls(snapshot: Game2048Snapshot): void {
    this.undoBtn.disabled = !snapshot.canUndo;
    this.hintBtn.disabled = snapshot.status !== 'playing';

    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      this.dpadButtons[dir].disabled = snapshot.status !== 'playing';
    }

    for (const modeBtn of this.modeButtons) {
      const isSelected = modeBtn.dataset.mode === snapshot.mode;
      modeBtn.classList.toggle('is-active', isSelected);
      modeBtn.setAttribute('aria-pressed', String(isSelected));
    }

    if (snapshot.status === 'won') {
      this.continueBtn.hidden = false;
      this.continueBtn.disabled = false;

      this.gameOverlayEl.hidden = false;
      this.overlayKickerEl.textContent = 'VICTORY MILESTONE';
      this.overlayTitleEl.textContent = '2048 FORGED!';
      this.overlaySubtitleEl.textContent = `Score: ${snapshot.score.toLocaleString()} pts in ${snapshot.moves} moves. Keep climbing in Endless mode or launch a fresh grid.`;
      this.overlayContinueBtn.hidden = false;
      this.overlayResetBtn.textContent = 'New Game';

      this.statusBannerEl.className = 'status-banner is-victory';
      this.modePillEl.textContent = '2048 WON';
      this.statusTextEl.textContent =
        this.statusOverride ??
        `2048 Forged in ${snapshot.moves} moves! Continue Endless or reset for a new run.`;
      return;
    }

    this.continueBtn.hidden = true;

    if (snapshot.status === 'gameover') {
      this.gameOverlayEl.hidden = false;
      this.overlayKickerEl.textContent = 'NO MOVES REMAINING';
      this.overlayTitleEl.textContent = 'GAME OVER';
      this.overlaySubtitleEl.textContent = `Final Score: ${snapshot.score.toLocaleString()} pts · Best Tile: ${snapshot.bestTile} · ${snapshot.moves} moves`;
      this.overlayContinueBtn.hidden = true;
      this.overlayResetBtn.textContent = 'Try Again';

      this.statusBannerEl.className = 'status-banner is-defeat';
      this.modePillEl.textContent = 'LOCKED';
      this.statusTextEl.textContent =
        this.statusOverride ??
        `Grid locked at ${snapshot.score.toLocaleString()} pts — Undo or Reset to play again.`;
      return;
    }

    this.gameOverlayEl.hidden = true;
    this.modePillEl.textContent =
      snapshot.mode === 'endless'
        ? snapshot.hasWon2048
          ? 'ENDLESS 2048+'
          : 'ENDLESS'
        : 'CLASSIC';

    if (snapshot.hasWon2048) {
      this.statusBannerEl.className = 'status-banner is-victory';
    } else if (snapshot.forecast.label === 'CRITICAL') {
      this.statusBannerEl.className = 'status-banner is-warning';
    } else {
      this.statusBannerEl.className = 'status-banner is-active';
    }

    this.statusTextEl.textContent =
      this.statusOverride ??
      'Merge matching plasma tiles to forge 2048 — swipe or use arrow keys.';
  }
}

function bootGame2048(): void {
  initArcadeHeader();
  new Game2048Controller();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame2048, { once: true });
} else {
  bootGame2048();
}
