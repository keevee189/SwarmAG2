/**
 * Interactive UI & Game Controller for Nexus Arcade Chess ("Grandmaster Protocol").
 * Renders crisp custom inline SVG Staunton chess pieces, legal move indicators,
 * evaluation & predicted winner telemetry, algebraic move history, promotion modal,
 * Web Audio SFX, and full keyboard/mouse controls.
 */

import { ArcadeAudio, initArcadeHeader } from '../../shared/arcade.js';
import { chooseBestMove, predictWinner } from './ai.js';
import {
  algebraicToSq,
  ChessEngine,
  findKingSquare,
  rowColToSq,
  sqToAlgebraic,
  sqToRowCol,
} from './engine.js';
import type {
  Color,
  Difficulty,
  Move,
  PieceType,
  PromotionPieceType,
} from './types.js';

type MatchPhase = 'ready' | 'active' | 'ended';

interface SessionStats {
  wins: number;
  draws: number;
  losses: number;
}

const STATS_STORAGE_KEY = 'nexus-arcade:chess:stats';

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

const CAPTURED_SORT_ORDER: Record<PieceType, number> = {
  q: 0,
  r: 1,
  b: 2,
  n: 3,
  p: 4,
  k: 5,
};

/**
 * Generates crisp high-contrast vector SVG markup for a chess piece (viewBox 0 0 45 45).
 * Never uses Unicode chess characters.
 */
function createPieceSvg(color: Color, type: PieceType, className = 'piece-svg'): string {
  const isWhite = color === 'w';
  const fill = isWhite ? '#f8fafc' : '#0b1022';
  const stroke = isWhite ? '#090d1c' : '#e2e8f0';
  const trim = isWhite ? '#0284c7' : '#f472b6';
  const crownAccent = isWhite ? '#38bdf8' : '#c084fc';

  let paths = '';

  switch (type) {
    case 'p':
      paths = `
        <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
          fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M16.5 34.5h12" stroke="${trim}" stroke-width="1.5" stroke-linecap="round" />
      `;
      break;

    case 'r':
      paths = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 39h27v-3H9v3z" />
          <path d="M12 36v-4h21v4H12z" />
          <path d="M11 14V9h4v2h5V9h5v2h5V9h4v5" />
          <path d="M34 14l-3 3H14l-3-3" />
          <path d="M31 17v12.5H14V17" />
          <path d="M31 29.5l1.5 2.5h-20l1.5-2.5" />
          <path d="M11 14h23" />
        </g>
        <path d="M15 21.5h15M15 26.5h15" stroke="${trim}" stroke-width="1.35" stroke-linecap="round" />
      `;
      break;

    case 'n':
      paths = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
          <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
          <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0z" fill="${trim}" stroke="${trim}" />
          <path d="M15 15.5a.5 1.5 0 1 1-1 0 .5 1.5 0 1 1 1 0z" transform="matrix(.866 .5 -.5 .866 9.693 -5.173)" fill="${trim}" stroke="${trim}" />
        </g>
        <path d="M26 14.5c4.5 3.5 6.8 9.2 6.8 19.5" fill="none" stroke="${crownAccent}" stroke-width="1.4" stroke-linecap="round" />
      `;
      break;

    case 'b':
      paths = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z" />
          <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
          <circle cx="22.5" cy="8" r="2.5" />
        </g>
        <path d="M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5" stroke="${trim}" stroke-width="1.5" stroke-linecap="round" />
      `;
      break;

    case 'q':
      paths = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z" />
          <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
          <circle cx="6" cy="12" r="2.2" fill="${crownAccent}" />
          <circle cx="14" cy="9" r="2.2" fill="${crownAccent}" />
          <circle cx="22.5" cy="8" r="2.2" fill="${crownAccent}" />
          <circle cx="31" cy="9" r="2.2" fill="${crownAccent}" />
          <circle cx="39" cy="12" r="2.2" fill="${crownAccent}" />
        </g>
        <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="${trim}" stroke-width="1.4" stroke-linecap="round" />
      `;
      break;

    case 'k':
      paths = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22.5 11.63V6M20 8h5" />
          <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
          <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" />
        </g>
        <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" fill="none" stroke="${trim}" stroke-width="1.4" stroke-linecap="round" />
      `;
      break;
  }

  return `<svg class="${className}" viewBox="0 0 45 45" aria-hidden="true">${paths}</svg>`;
}

function loadSessionStats(): SessionStats {
  try {
    if (typeof localStorage === 'undefined') {
      return { wins: 0, draws: 0, losses: 0 };
    }
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) {
      return { wins: 0, draws: 0, losses: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<SessionStats>;
    return {
      wins: Number.isFinite(parsed.wins) && (parsed.wins ?? 0) >= 0 ? Number(parsed.wins) : 0,
      draws: Number.isFinite(parsed.draws) && (parsed.draws ?? 0) >= 0 ? Number(parsed.draws) : 0,
      losses: Number.isFinite(parsed.losses) && (parsed.losses ?? 0) >= 0 ? Number(parsed.losses) : 0,
    };
  } catch {
    return { wins: 0, draws: 0, losses: 0 };
  }
}

function saveSessionStats(stats: SessionStats): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
    }
  } catch {
    // Ignore storage quota or sandbox restrictions.
  }
}

class ChessController {
  private readonly engine = new ChessEngine();
  private phase: MatchPhase = 'ready';
  private difficulty: Difficulty = 'club';
  private selectedSq: number | null = null;
  private cursorSq: number | null = null;
  private hintMove: Move | null = null;
  private pendingPromotion: { from: number; to: number } | null = null;
  private aiThinking = false;
  private aiTimerId: number | null = null;
  private matchGeneration = 0;
  private resultRecordedForMatch = false;
  private stats: SessionStats = loadSessionStats();

  private readonly squareButtons: HTMLButtonElement[] = [];

  // DOM References
  private readonly boardEl: HTMLElement;
  private readonly statusBannerEl: HTMLElement;
  private readonly statusTextEl: HTMLElement;
  private readonly turnBadgeEl: HTMLElement;
  private readonly whiteStripEl: HTMLElement;
  private readonly blackStripEl: HTMLElement;
  private readonly aiTierBadgeEl: HTMLElement;
  private readonly whiteMaterialEl: HTMLElement;
  private readonly blackMaterialEl: HTMLElement;
  private readonly materialDiffEl: HTMLElement;
  private readonly whiteCapturedEl: HTMLElement;
  private readonly blackCapturedEl: HTMLElement;
  private readonly sessionWinsEl: HTMLElement;
  private readonly sessionDrawsEl: HTMLElement;
  private readonly sessionLossesEl: HTMLElement;
  private readonly moveListEl: HTMLElement;
  private readonly moveCountLabelEl: HTMLElement;
  private readonly evalBarFillEl: HTMLElement;
  private readonly evalProgressBarEl: HTMLElement;
  private readonly evalScoreLabelEl: HTMLElement;
  private readonly whiteWinPctEl: HTMLElement;
  private readonly blackWinPctEl: HTMLElement;
  private readonly predictedWinnerLabelEl: HTMLElement;
  private readonly predictedDetailEl: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly hintBtn: HTMLButtonElement;
  private readonly difficultyButtons: HTMLButtonElement[];
  private readonly promoModalEl: HTMLElement;
  private readonly promoButtons: HTMLButtonElement[];
  private readonly promoCancelBtn: HTMLButtonElement;

  constructor() {
    this.boardEl = this.mustQuery('#chess-board');
    this.statusBannerEl = this.mustQuery('#status-banner');
    this.statusTextEl = this.mustQuery('#status-text');
    this.turnBadgeEl = this.mustQuery('#turn-badge');
    this.whiteStripEl = this.mustQuery('.player-strip.is-white');
    this.blackStripEl = this.mustQuery('.player-strip.is-black');
    this.aiTierBadgeEl = this.mustQuery('#ai-tier-badge');
    this.whiteMaterialEl = this.mustQuery('#white-material');
    this.blackMaterialEl = this.mustQuery('#black-material');
    this.materialDiffEl = this.mustQuery('#material-diff');
    this.whiteCapturedEl = this.mustQuery('#white-captured');
    this.blackCapturedEl = this.mustQuery('#black-captured');
    this.sessionWinsEl = this.mustQuery('#session-wins');
    this.sessionDrawsEl = this.mustQuery('#session-draws');
    this.sessionLossesEl = this.mustQuery('#session-losses');
    this.moveListEl = this.mustQuery('#move-list');
    this.moveCountLabelEl = this.mustQuery('#move-count-label');
    this.evalBarFillEl = this.mustQuery('#eval-bar-fill');
    this.evalProgressBarEl = this.mustQuery('.eval-meter-bar');
    this.evalScoreLabelEl = this.mustQuery('#eval-score-label');
    this.whiteWinPctEl = this.mustQuery('#white-win-pct');
    this.blackWinPctEl = this.mustQuery('#black-win-pct');
    this.predictedWinnerLabelEl = this.mustQuery('#predicted-winner-label');
    this.predictedDetailEl = this.mustQuery('#predicted-detail');
    this.startBtn = this.mustQuery('#start-btn') as HTMLButtonElement;
    this.resetBtn = this.mustQuery('#reset-btn') as HTMLButtonElement;
    this.undoBtn = this.mustQuery('#undo-btn') as HTMLButtonElement;
    this.hintBtn = this.mustQuery('#hint-btn') as HTMLButtonElement;
    this.difficultyButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#difficulty-selector [data-difficulty]'),
    );
    this.promoModalEl = this.mustQuery('#promotion-modal');
    this.promoButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#promotion-choices [data-promo]'),
    );
    this.promoCancelBtn = this.mustQuery('#promo-cancel-btn') as HTMLButtonElement;

    this.buildBoardDom();
    this.buildPromotionButtons();
    this.bindEvents();
    this.renderAll();
  }

  private mustQuery(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
      throw new Error(`Missing required Chess DOM element: ${selector}`);
    }
    return el;
  }

  private buildBoardDom(): void {
    this.boardEl.innerHTML = '';
    for (let sq = 0; sq < 64; sq += 1) {
      const { row, col } = sqToRowCol(sq);
      const isLight = ((row + col) & 1) === 0;
      const coord = sqToAlgebraic(sq);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chess-square ${isLight ? 'is-light' : 'is-dark'}`;
      btn.dataset.square = coord;
      btn.dataset.sq = String(sq);
      btn.dataset.row = String(row);
      btn.dataset.col = String(col);
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', coord);
      btn.addEventListener('click', () => {
        this.cursorSq = sq;
        this.handleSquareClick(sq);
      });
      this.squareButtons.push(btn);
      this.boardEl.appendChild(btn);
    }
  }

  private buildPromotionButtons(): void {
    for (const btn of this.promoButtons) {
      const promoType = btn.dataset.promo as PromotionPieceType | undefined;
      if (!promoType) continue;
      btn.innerHTML = createPieceSvg('w', promoType, 'promo-piece-svg');
      btn.addEventListener('click', () => {
        this.completePromotion(promoType);
      });
    }
  }

  private bindEvents(): void {
    this.startBtn.addEventListener('click', () => {
      this.startMatch();
    });

    this.resetBtn.addEventListener('click', () => {
      this.resetMatch();
    });

    this.undoBtn.addEventListener('click', () => {
      this.handleUndo();
    });

    this.hintBtn.addEventListener('click', () => {
      this.handleHint();
    });

    this.promoCancelBtn.addEventListener('click', () => {
      this.cancelPromotion();
    });

    for (const btn of this.difficultyButtons) {
      btn.addEventListener('click', () => {
        const nextDiff = btn.dataset.difficulty as Difficulty | undefined;
        if (!nextDiff) return;
        this.setDifficulty(nextDiff);
      });
    }

    document.addEventListener('keydown', (event) => {
      this.handleKeyDown(event);
    });
  }

  private cancelPendingAi(): void {
    this.matchGeneration += 1;
    if (this.aiTimerId !== null) {
      window.clearTimeout(this.aiTimerId);
      this.aiTimerId = null;
    }
    this.aiThinking = false;
  }

  private setDifficulty(nextDiff: Difficulty): void {
    this.difficulty = nextDiff;
    for (const btn of this.difficultyButtons) {
      const active = btn.dataset.difficulty === nextDiff;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    this.aiTierBadgeEl.textContent = nextDiff.toUpperCase();
    ArcadeAudio.playClick();
  }

  public startMatch(): void {
    this.cancelPendingAi();
    if (this.phase === 'ended' || this.engine.getHistory().length > 0) {
      this.engine.reset();
    }
    this.phase = 'active';
    this.selectedSq = null;
    this.hintMove = null;
    this.pendingPromotion = null;
    this.resultRecordedForMatch = false;
    this.cursorSq = algebraicToSq('e2');
    this.promoModalEl.hidden = true;
    ArcadeAudio.playClick();
    this.renderAll();
    this.setStatus('WHITE TO MOVE — SELECT A PIECE', 'is-active', 'WHITE TURN');
  }

  public resetMatch(): void {
    this.cancelPendingAi();
    this.engine.reset();
    this.phase = 'ready';
    this.selectedSq = null;
    this.cursorSq = null;
    this.hintMove = null;
    this.pendingPromotion = null;
    this.resultRecordedForMatch = false;
    this.promoModalEl.hidden = true;
    ArcadeAudio.playClick();
    this.renderAll();
    this.setStatus('READY — PRESS START TO ENGAGE', 'is-info', 'WHITE READY');
  }

  private handleSquareClick(sq: number): void {
    if (this.pendingPromotion) {
      return;
    }
    if (this.phase === 'ready') {
      ArcadeAudio.playClick();
      this.setStatus('PRESS START (S) TO ENGAGE MATCH', 'is-warning', 'PRESS START');
      this.startBtn.focus({ preventScroll: true });
      return;
    }
    if (this.phase !== 'active' || this.aiThinking || this.engine.isGameOver()) {
      return;
    }
    if (this.engine.getTurn() !== 'w') {
      return;
    }

    const clickedPiece = this.engine.getPieceAt(sq);

    if (this.selectedSq === null) {
      if (clickedPiece && clickedPiece.color === 'w') {
        this.selectedSq = sq;
        this.hintMove = null;
        ArcadeAudio.playClick();
        this.renderBoard();
      }
      return;
    }

    if (sq === this.selectedSq) {
      this.selectedSq = null;
      this.renderBoard();
      return;
    }

    const legalFromSelected = this.engine.getLegalMovesFrom(this.selectedSq);
    const matchingMoves = legalFromSelected.filter((m) => m.to === sq);

    if (matchingMoves.length > 0) {
      if (matchingMoves[0].promotion !== undefined) {
        this.pendingPromotion = { from: this.selectedSq, to: sq };
        this.promoModalEl.hidden = false;
        this.promoButtons[0]?.focus({ preventScroll: true });
        ArcadeAudio.playClick();
        return;
      }
      this.executeHumanMove(matchingMoves[0]);
      return;
    }

    if (clickedPiece && clickedPiece.color === 'w') {
      this.selectedSq = sq;
      this.hintMove = null;
      ArcadeAudio.playClick();
      this.renderBoard();
      return;
    }

    this.selectedSq = null;
    ArcadeAudio.playError();
    this.renderBoard();
  }

  private completePromotion(promoType: PromotionPieceType): void {
    if (!this.pendingPromotion) {
      return;
    }
    const { from, to } = this.pendingPromotion;
    const match = this.engine
      .getLegalMovesFrom(from)
      .find((m) => m.to === to && m.promotion === promoType);
    this.pendingPromotion = null;
    this.promoModalEl.hidden = true;
    if (match) {
      this.executeHumanMove(match);
    }
  }

  private cancelPromotion(): void {
    if (!this.pendingPromotion) {
      return;
    }
    this.pendingPromotion = null;
    this.promoModalEl.hidden = true;
    this.selectedSq = null;
    ArcadeAudio.playClick();
    this.renderBoard();
  }

  private executeHumanMove(move: Move): void {
    this.selectedSq = null;
    this.hintMove = null;
    const recorded = this.engine.makeMove(move);
    if (!recorded) {
      ArcadeAudio.playError();
      this.renderAll();
      return;
    }

    this.renderAll();

    if (this.engine.isGameOver()) {
      this.finalizeGameOver();
      return;
    }

    if (move.captured || this.engine.isInCheck()) {
      ArcadeAudio.playScore();
    } else {
      ArcadeAudio.playMove();
    }

    this.scheduleAiTurn();
  }

  private scheduleAiTurn(): void {
    const gen = this.matchGeneration;
    this.aiThinking = true;
    this.updateControlsAndStrips();
    this.setStatus(
      `BLACK THINKING (${this.difficulty.toUpperCase()})...`,
      'is-active',
      'AI THINKING',
    );

    this.aiTimerId = window.setTimeout(() => {
      this.aiTimerId = null;
      if (
        gen !== this.matchGeneration ||
        this.phase !== 'active' ||
        this.engine.isGameOver() ||
        this.engine.getTurn() !== 'b'
      ) {
        this.aiThinking = false;
        return;
      }

      const aiMove = chooseBestMove(this.engine.getState(), this.difficulty);
      this.aiThinking = false;

      if (!aiMove) {
        this.renderAll();
        if (this.engine.isGameOver()) {
          this.finalizeGameOver();
        }
        return;
      }

      this.engine.makeMove(aiMove);
      this.renderAll();

      if (this.engine.isGameOver()) {
        this.finalizeGameOver();
        return;
      }

      if (aiMove.captured || this.engine.isInCheck()) {
        ArcadeAudio.playScore();
      } else {
        ArcadeAudio.playMove();
      }

      if (this.engine.isInCheck()) {
        this.setStatus('CHECK! — DEFEND YOUR KING', 'is-warning', 'WHITE IN CHECK');
      } else {
        this.setStatus('WHITE TO MOVE — YOUR TURN', 'is-active', 'WHITE TURN');
      }
    }, 140);
  }

  private finalizeGameOver(): void {
    this.phase = 'ended';
    this.aiThinking = false;
    const status = this.engine.getStatus();
    const winner = this.engine.getWinner();

    if (!this.resultRecordedForMatch) {
      this.resultRecordedForMatch = true;
      if (winner === 'w') {
        this.stats.wins += 1;
      } else if (winner === 'b') {
        this.stats.losses += 1;
      } else if (winner === 'draw') {
        this.stats.draws += 1;
      }
      saveSessionStats(this.stats);
    }

    this.renderScoreboard();
    this.updateControlsAndStrips();

    if (status === 'checkmate') {
      if (winner === 'w') {
        ArcadeAudio.playWin();
        this.setStatus('CHECKMATE — WHITE WINS!', 'is-victory', 'WHITE WINS');
      } else {
        ArcadeAudio.playLose();
        this.setStatus('CHECKMATE — BLACK AI WINS!', 'is-defeat', 'BLACK WINS');
      }
      return;
    }

    ArcadeAudio.playMatch();
    const drawText =
      status === 'stalemate'
        ? 'STALEMATE — DRAW'
        : status === 'draw-insufficient'
          ? 'DRAW — INSUFFICIENT MATERIAL'
          : status === 'draw-repetition'
            ? 'DRAW — THREEFOLD REPETITION'
            : 'DRAW — 50-MOVE RULE';
    this.setStatus(drawText, 'is-draw', 'DRAW');
  }

  public handleUndo(): void {
    if (this.phase === 'ready' || this.engine.getHistory().length === 0) {
      return;
    }
    this.cancelPendingAi();
    this.pendingPromotion = null;
    this.promoModalEl.hidden = true;
    this.selectedSq = null;
    this.hintMove = null;

    // If Black AI already replied (so it's White's turn again), undo both plies back to White
    if (this.engine.getTurn() === 'w' && this.engine.getHistory().length >= 2) {
      this.engine.undo();
      this.engine.undo();
    } else {
      this.engine.undo();
    }

    this.phase = 'active';
    ArcadeAudio.playClick();
    this.renderAll();

    if (this.engine.isInCheck()) {
      this.setStatus('MOVE UNDONE — WHITE IN CHECK', 'is-warning', 'WHITE IN CHECK');
    } else {
      this.setStatus('MOVE UNDONE — WHITE TO MOVE', 'is-active', 'WHITE TURN');
    }
  }

  public handleHint(): void {
    if (
      this.phase !== 'active' ||
      this.aiThinking ||
      this.engine.isGameOver() ||
      this.engine.getTurn() !== 'w' ||
      this.pendingPromotion
    ) {
      return;
    }

    const best = chooseBestMove(this.engine.getState(), 'master');
    if (!best) {
      return;
    }

    this.hintMove = best;
    this.selectedSq = best.from;
    this.cursorSq = best.from;
    ArcadeAudio.playMatch();
    this.renderBoard();

    const promoSuffix = best.promotion ? `=${best.promotion.toUpperCase()}` : '';
    this.setStatus(
      `HINT: ${sqToAlgebraic(best.from).toUpperCase()} → ${sqToAlgebraic(best.to).toUpperCase()}${promoSuffix}`,
      'is-active',
      'HINT ACTIVE',
    );
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const key = event.key;
    const lower = key.toLowerCase();

    // Promotion modal shortcuts
    if (!this.promoModalEl.hidden) {
      if (key === 'Escape') {
        event.preventDefault();
        this.cancelPromotion();
        return;
      }
      if (lower === 'q' || lower === 'r' || lower === 'b' || lower === 'n') {
        event.preventDefault();
        this.completePromotion(lower as PromotionPieceType);
      }
      return;
    }

    if (lower === 's') {
      event.preventDefault();
      this.startMatch();
      return;
    }
    if (lower === 'r') {
      event.preventDefault();
      this.resetMatch();
      return;
    }
    if (lower === 'u') {
      event.preventDefault();
      this.handleUndo();
      return;
    }
    if (lower === 'h') {
      event.preventDefault();
      this.handleHint();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      if (this.selectedSq !== null || this.hintMove !== null) {
        this.selectedSq = null;
        this.hintMove = null;
        this.renderBoard();
      }
      return;
    }

    // Arrow key board cursor navigation
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const baseSq = this.cursorSq ?? this.selectedSq ?? algebraicToSq('e2');
      let { row, col } = sqToRowCol(baseSq);
      if (key === 'ArrowUp') row = Math.max(0, row - 1);
      else if (key === 'ArrowDown') row = Math.min(7, row + 1);
      else if (key === 'ArrowLeft') col = Math.max(0, col - 1);
      else if (key === 'ArrowRight') col = Math.min(7, col + 1);

      this.cursorSq = rowColToSq(row, col);
      this.renderBoard();
      this.squareButtons[this.cursorSq]?.focus({ preventScroll: true });
      return;
    }

    // Enter / Space on non-button document focus activates cursor square
    if ((key === 'Enter' || key === ' ') && target && !target.closest('button, a')) {
      event.preventDefault();
      const targetSq = this.cursorSq ?? algebraicToSq('e2');
      this.cursorSq = targetSq;
      this.handleSquareClick(targetSq);
    }
  }

  private setStatus(text: string, bannerClass: string, pillText: string): void {
    this.statusTextEl.textContent = text;
    this.turnBadgeEl.textContent = pillText;
    this.statusBannerEl.className = `status-banner ${bannerClass}`;
  }

  private renderAll(): void {
    this.renderBoard();
    this.renderScoreboard();
    this.renderCapturedPieces();
    this.renderMoveHistory();
    this.renderPredictor();
    this.updateControlsAndStrips();
  }

  private renderBoard(): void {
    const state = this.engine.getState();
    const history = state.history;
    const lastMove = history.length > 0 ? history[history.length - 1].move : null;
    const checkedKingSq = state.inCheck ? findKingSquare(state.board, state.turn) : -1;

    const legalTargets = new Map<number, Move>();
    if (
      this.phase === 'active' &&
      !this.aiThinking &&
      !this.engine.isGameOver() &&
      this.selectedSq !== null
    ) {
      for (const m of this.engine.getLegalMovesFrom(this.selectedSq)) {
        if (!legalTargets.has(m.to)) {
          legalTargets.set(m.to, m);
        }
      }
    }

    for (let sq = 0; sq < 64; sq += 1) {
      const btn = this.squareButtons[sq];
      const piece = state.board[sq];
      const coord = sqToAlgebraic(sq);
      const legalMove = legalTargets.get(sq);

      btn.classList.toggle('is-selected', this.selectedSq === sq);
      btn.classList.toggle('is-last-from', lastMove !== null && lastMove.from === sq);
      btn.classList.toggle('is-last-to', lastMove !== null && lastMove.to === sq);
      btn.classList.toggle('is-check', checkedKingSq === sq);
      btn.classList.toggle('is-hint-from', this.hintMove !== null && this.hintMove.from === sq);
      btn.classList.toggle('is-hint-to', this.hintMove !== null && this.hintMove.to === sq);
      btn.classList.toggle('is-cursor', this.cursorSq === sq);
      btn.classList.toggle('is-legal', legalMove !== undefined && !legalMove.captured);
      btn.classList.toggle('is-capture', legalMove !== undefined && Boolean(legalMove.captured));

      const pieceLabel = piece
        ? `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[piece.type]}`
        : 'empty';
      btn.setAttribute('aria-label', `${coord} ${pieceLabel}`);
      if (piece) {
        btn.dataset.piece = `${piece.color}${piece.type}`;
      } else {
        delete btn.dataset.piece;
      }

      let html = '';
      if (legalMove) {
        html += legalMove.captured
          ? '<span class="capture-ring" aria-hidden="true"></span>'
          : '<span class="legal-dot" aria-hidden="true"></span>';
      }
      if (piece) {
        html += createPieceSvg(piece.color, piece.type);
      }
      btn.innerHTML = html;
    }
  }

  private renderScoreboard(): void {
    const mat = this.engine.getMaterialSummary();
    this.whiteMaterialEl.textContent = String(mat.white);
    this.blackMaterialEl.textContent = String(mat.black);
    this.materialDiffEl.textContent =
      mat.diff > 0 ? `+${mat.diff}` : String(mat.diff);

    this.sessionWinsEl.textContent = String(this.stats.wins);
    this.sessionDrawsEl.textContent = String(this.stats.draws);
    this.sessionLossesEl.textContent = String(this.stats.losses);
  }

  private renderCapturedPieces(): void {
    const state = this.engine.getState();

    const renderTray = (tray: HTMLElement, capturedTypes: PieceType[], victimColor: Color): void => {
      const sorted = [...capturedTypes].sort(
        (a, b) => CAPTURED_SORT_ORDER[a] - CAPTURED_SORT_ORDER[b],
      );
      if (sorted.length === 0) {
        tray.innerHTML = '';
        return;
      }
      tray.innerHTML = sorted
        .map(
          (type) =>
            `<span class="captured-piece-icon" title="${PIECE_NAMES[type]}">${createPieceSvg(victimColor, type, '')}</span>`,
        )
        .join('');
    };

    renderTray(this.whiteCapturedEl, state.capturedByWhite, 'b');
    renderTray(this.blackCapturedEl, state.capturedByBlack, 'w');
  }

  private renderMoveHistory(): void {
    const history = this.engine.getHistory();
    this.moveCountLabelEl.textContent = `${history.length} ${history.length === 1 ? 'ply' : 'plies'}`;

    if (history.length === 0) {
      this.moveListEl.innerHTML = '<li class="move-list-empty">No moves recorded</li>';
      return;
    }

    const rows: string[] = [];
    for (let i = 0; i < history.length; i += 2) {
      const whiteMove = history[i];
      const blackMove = history[i + 1];
      const whiteLatest = i === history.length - 1 ? ' is-latest' : '';
      const blackLatest = i + 1 === history.length - 1 ? ' is-latest' : '';
      rows.push(`
        <li class="move-row">
          <span class="move-num">${whiteMove.moveNumber}.</span>
          <span class="move-ply${whiteLatest}">${whiteMove.san}</span>
          <span class="move-ply${blackLatest}">${blackMove ? blackMove.san : ''}</span>
        </li>
      `);
    }

    this.moveListEl.innerHTML = rows.join('');
    this.moveListEl.scrollTop = this.moveListEl.scrollHeight;
  }

  private renderPredictor(): void {
    const pred = predictWinner(this.engine.getState());
    this.evalBarFillEl.style.width = `${pred.whiteWinPct}%`;
    this.evalProgressBarEl.setAttribute('aria-valuenow', String(pred.whiteWinPct));
    this.evalScoreLabelEl.textContent = pred.evalLabel;
    this.whiteWinPctEl.textContent = `White ${pred.whiteWinPct}%`;
    this.blackWinPctEl.textContent = `Black ${pred.blackWinPct}%`;
    this.predictedWinnerLabelEl.textContent = pred.predictedWinner;
    this.predictedDetailEl.textContent = pred.detail;

    this.evalBarFillEl.classList.remove('is-player', 'is-ai', 'is-emerald', 'is-gold', 'is-crimson');
    if (pred.whiteWinPct >= 62) {
      this.evalBarFillEl.classList.add('is-player');
    } else if (pred.whiteWinPct <= 38) {
      this.evalBarFillEl.classList.add('is-ai');
    } else {
      this.evalBarFillEl.classList.add('is-gold');
    }
  }

  private updateControlsAndStrips(): void {
    const historyLen = this.engine.getHistory().length;
    this.undoBtn.disabled = this.phase === 'ready' || historyLen === 0;
    this.hintBtn.disabled =
      this.phase !== 'active' ||
      this.aiThinking ||
      this.engine.isGameOver() ||
      this.engine.getTurn() !== 'w';

    this.startBtn.textContent = this.phase === 'ended' ? 'New Match' : 'Start';

    const turn = this.engine.getTurn();
    this.whiteStripEl.classList.toggle('is-active-turn', this.phase === 'active' && turn === 'w');
    this.blackStripEl.classList.toggle('is-active-turn', this.phase === 'active' && turn === 'b');
  }
}

initArcadeHeader();
new ChessController();
