/**
 * Pure TypeScript Minesweeper Engine ("Quantum Minesweeper").
 * Zero DOM dependencies — runs identically in browser ESM and Node.js unit tests.
 */

import { clamp } from '../../shared/arcade.js';

export type Difficulty = 'beginner' | 'intermediate' | 'expert';
export type GameStatus = 'idle' | 'playing' | 'won' | 'lost';
export type ForecastLabel =
  | 'CERTAIN WIN'
  | 'DEDUCTIBLE'
  | 'FAVORABLE'
  | 'RISKY'
  | 'VICTORY'
  | 'DETONATED';

export type HintKind = 'safe' | 'mine' | 'guess' | 'opening';

export interface DifficultyConfig {
  readonly id: Difficulty;
  readonly label: string;
  readonly rows: number;
  readonly cols: number;
  readonly mines: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  beginner: { id: 'beginner', label: 'Beginner', rows: 9, cols: 9, mines: 10 },
  intermediate: { id: 'intermediate', label: 'Intermediate', rows: 12, cols: 12, mines: 22 },
  expert: { id: 'expert', label: 'Expert', rows: 16, cols: 16, mines: 40 },
};

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['beginner', 'intermediate', 'expert'];

const DIFFICULTY_SCORE_MULTIPLIER: Record<Difficulty, number> = {
  beginner: 1,
  intermediate: 1.5,
  expert: 2,
};

const DIFFICULTY_CLEAR_BONUS: Record<Difficulty, number> = {
  beginner: 250,
  intermediate: 600,
  expert: 1200,
};

const DIFFICULTY_PAR_SECONDS: Record<Difficulty, number> = {
  beginner: 90,
  intermediate: 210,
  expert: 420,
};

const BASE_SAFE_POINTS = 10;
const CASCADE_STEP_BONUS = 5;
const CHORD_PRECISION_BONUS = 15;
const HINT_PENALTY = 25;

const NEIGHBOR_DELTAS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export interface CellCoord {
  readonly row: number;
  readonly col: number;
}

export interface CellView {
  readonly row: number;
  readonly col: number;
  readonly index: number;
  readonly hasMine: boolean;
  readonly revealed: boolean;
  readonly flagged: boolean;
  readonly adjacentMines: number;
  readonly detonated: boolean;
  readonly wrongFlag: boolean;
}

export interface HintResult {
  readonly row: number;
  readonly col: number;
  readonly index: number;
  readonly kind: HintKind;
  readonly action: 'reveal' | 'flag';
  readonly certainty: number;
  readonly mineProbability: number;
  readonly reason: string;
}

export interface WinForecast {
  readonly label: ForecastLabel;
  readonly percent: number;
  readonly detail: string;
}

export interface RevealResult {
  readonly ok: boolean;
  readonly reason?: 'out-of-bounds' | 'game-over' | 'already-revealed' | 'flagged';
  readonly status: GameStatus;
  readonly newlyRevealed: readonly CellCoord[];
  readonly detonated: boolean;
  readonly pointsAwarded: number;
}

export interface FlagResult {
  readonly ok: boolean;
  readonly reason?: 'out-of-bounds' | 'game-over' | 'already-revealed';
  readonly flagged: boolean;
  readonly minesLeft: number;
}

export interface ChordResult {
  readonly ok: boolean;
  readonly reason?:
    | 'not-playing'
    | 'out-of-bounds'
    | 'not-revealed'
    | 'zero-cell'
    | 'flag-count-mismatch'
    | 'no-unrevealed-neighbors';
  readonly status: GameStatus;
  readonly newlyRevealed: readonly CellCoord[];
  readonly detonated: boolean;
  readonly pointsAwarded: number;
}

export interface MinesweeperSnapshot {
  readonly difficulty: Difficulty;
  readonly rows: number;
  readonly cols: number;
  readonly totalMines: number;
  readonly status: GameStatus;
  readonly minesPlaced: boolean;
  readonly score: number;
  readonly highScore: number;
  readonly minesLeft: number;
  readonly safeLeft: number;
  readonly flagsCount: number;
  readonly revealedSafeCount: number;
  readonly totalSafeCells: number;
  readonly elapsedMs: number;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly activeHint: HintResult | null;
  readonly board: readonly CellView[];
}

export interface MinesweeperEngineOptions {
  readonly difficulty?: Difficulty;
  readonly rng?: () => number;
  readonly highScores?: Partial<Record<Difficulty, number>>;
}

interface InternalCell {
  readonly row: number;
  readonly col: number;
  readonly index: number;
  hasMine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacentMines: number;
  detonated: boolean;
  wrongFlag: boolean;
}

interface Constraint {
  vars: Set<number>;
  count: number;
}

interface FrontierAnalysis {
  readonly knownSafe: Set<number>;
  readonly knownMines: Set<number>;
  readonly probabilities: Map<number, number>;
  readonly nonFrontierProbability: number;
  readonly hasContradiction: boolean;
  readonly unknownUnflaggedCount: number;
  readonly remainingMines: number;
  readonly fullyDeductible: boolean;
}

/**
 * Deterministic PRNG (Mulberry32) for reproducible testing.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createEmptyGrid(rows: number, cols: number): InternalCell[] {
  const grid: InternalCell[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      grid.push({
        row: r,
        col: c,
        index: r * cols + c,
        hasMine: false,
        revealed: false,
        flagged: false,
        adjacentMines: 0,
        detonated: false,
        wrongFlag: false,
      });
    }
  }
  return grid;
}

function setsOverlap(a: Set<number>, b: Set<number>): boolean {
  for (const v of a) {
    if (b.has(v)) {
      return true;
    }
  }
  return false;
}

function constraintKey(vars: Set<number>, count: number): string {
  const sorted = Array.from(vars).sort((x, y) => x - y);
  return `${sorted.join(',')}:${count}`;
}

export class MinesweeperEngine {
  private difficulty: Difficulty;
  private rows: number;
  private cols: number;
  private totalMines: number;
  private rng: () => number;

  private grid: InternalCell[];
  private status: GameStatus = 'idle';
  private minesPlaced = false;
  private score = 0;
  private elapsedMs = 0;
  private hintsUsed = 0;
  private revealedSafeCount = 0;
  private flagsCount = 0;
  private activeHint: HintResult | null = null;

  private readonly highScores: Record<Difficulty, number>;

  constructor(options: MinesweeperEngineOptions = {}) {
    this.difficulty = options.difficulty ?? 'beginner';
    this.rng = options.rng ?? Math.random;
    const cfg = DIFFICULTIES[this.difficulty];
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.totalMines = cfg.mines;
    this.grid = createEmptyGrid(this.rows, this.cols);
    this.highScores = {
      beginner: Math.max(0, Math.floor(options.highScores?.beginner ?? 0)),
      intermediate: Math.max(0, Math.floor(options.highScores?.intermediate ?? 0)),
      expert: Math.max(0, Math.floor(options.highScores?.expert ?? 0)),
    };
  }

  public getDifficulty(): Difficulty {
    return this.difficulty;
  }

  public getConfig(): DifficultyConfig {
    return DIFFICULTIES[this.difficulty];
  }

  public getRows(): number {
    return this.rows;
  }

  public getCols(): number {
    return this.cols;
  }

  public getTotalMines(): number {
    return this.totalMines;
  }

  public getStatus(): GameStatus {
    return this.status;
  }

  public isMinesPlaced(): boolean {
    return this.minesPlaced;
  }

  public getScore(): number {
    return this.score;
  }

  public getHighScore(difficulty: Difficulty = this.difficulty): number {
    return this.highScores[difficulty];
  }

  public setHighScore(difficulty: Difficulty, value: number): void {
    const clean = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    if (clean > this.highScores[difficulty]) {
      this.highScores[difficulty] = clean;
    }
  }

  public getFlagsCount(): number {
    return this.flagsCount;
  }

  public getMinesLeft(): number {
    return this.totalMines - this.flagsCount;
  }

  public getTotalSafeCells(): number {
    return this.rows * this.cols - this.totalMines;
  }

  public getSafeLeft(): number {
    return Math.max(0, this.getTotalSafeCells() - this.revealedSafeCount);
  }

  public getElapsedMs(): number {
    return this.elapsedMs;
  }

  public getElapsedSeconds(): number {
    return Math.floor(this.elapsedMs / 1000);
  }

  public getHintsUsed(): number {
    return this.hintsUsed;
  }

  public getActiveHint(): HintResult | null {
    return this.activeHint;
  }

  public setDifficulty(nextDifficulty: Difficulty): void {
    this.difficulty = nextDifficulty;
    this.reset();
  }

  public start(): void {
    this.resetBoardState('playing');
  }

  public reset(): void {
    this.resetBoardState('idle');
  }

  /**
   * Loads an explicit deterministic mine layout for testing or custom scenarios.
   */
  public loadCustomMineLayout(
    mines: ReadonlyArray<readonly [number, number]>,
    options: { difficulty?: Difficulty; rows?: number; cols?: number; status?: GameStatus } = {},
  ): void {
    if (options.difficulty) {
      this.difficulty = options.difficulty;
    }
    const cfg = DIFFICULTIES[this.difficulty];
    this.rows = options.rows ?? cfg.rows;
    this.cols = options.cols ?? cfg.cols;

    const seen = new Set<number>();
    const validMines: Array<readonly [number, number]> = [];
    for (const [r, c] of mines) {
      if (!this.inBounds(r, c)) {
        throw new Error(`Mine coordinate (${r}, ${c}) is out of bounds for ${this.rows}x${this.cols}`);
      }
      const idx = r * this.cols + c;
      if (!seen.has(idx)) {
        seen.add(idx);
        validMines.push([r, c]);
      }
    }

    this.totalMines = validMines.length;
    this.grid = createEmptyGrid(this.rows, this.cols);
    for (const [r, c] of validMines) {
      this.grid[r * this.cols + c].hasMine = true;
    }
    this.computeAdjacentCounts();
    this.minesPlaced = true;
    this.status = options.status ?? 'playing';
    this.score = 0;
    this.elapsedMs = 0;
    this.hintsUsed = 0;
    this.revealedSafeCount = 0;
    this.flagsCount = 0;
    this.activeHint = null;
  }

  public tick(dtMs: number): void {
    if (this.status !== 'playing') {
      return;
    }
    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }
    this.elapsedMs += dtMs;
  }

  public getCell(row: number, col: number): CellView | null {
    if (!this.inBounds(row, col)) {
      return null;
    }
    return { ...this.grid[row * this.cols + col] };
  }

  public getSnapshot(): MinesweeperSnapshot {
    return {
      difficulty: this.difficulty,
      rows: this.rows,
      cols: this.cols,
      totalMines: this.totalMines,
      status: this.status,
      minesPlaced: this.minesPlaced,
      score: this.score,
      highScore: this.highScores[this.difficulty],
      minesLeft: this.getMinesLeft(),
      safeLeft: this.getSafeLeft(),
      flagsCount: this.flagsCount,
      revealedSafeCount: this.revealedSafeCount,
      totalSafeCells: this.getTotalSafeCells(),
      elapsedMs: this.elapsedMs,
      elapsedSeconds: this.getElapsedSeconds(),
      hintsUsed: this.hintsUsed,
      activeHint: this.activeHint,
      board: this.grid.map((cell) => ({ ...cell })),
    };
  }

  public toggleFlag(row: number, col: number): FlagResult {
    if (!this.inBounds(row, col)) {
      return {
        ok: false,
        reason: 'out-of-bounds',
        flagged: false,
        minesLeft: this.getMinesLeft(),
      };
    }
    if (this.status === 'won' || this.status === 'lost') {
      return {
        ok: false,
        reason: 'game-over',
        flagged: this.grid[row * this.cols + col].flagged,
        minesLeft: this.getMinesLeft(),
      };
    }

    const cell = this.grid[row * this.cols + col];
    if (cell.revealed) {
      return {
        ok: false,
        reason: 'already-revealed',
        flagged: false,
        minesLeft: this.getMinesLeft(),
      };
    }

    cell.flagged = !cell.flagged;
    this.flagsCount += cell.flagged ? 1 : -1;

    if (this.activeHint && this.activeHint.row === row && this.activeHint.col === col) {
      this.activeHint = null;
    }

    return {
      ok: true,
      flagged: cell.flagged,
      minesLeft: this.getMinesLeft(),
    };
  }

  public reveal(row: number, col: number): RevealResult {
    if (!this.inBounds(row, col)) {
      return {
        ok: false,
        reason: 'out-of-bounds',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }
    if (this.status === 'won' || this.status === 'lost') {
      return {
        ok: false,
        reason: 'game-over',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    const target = this.grid[row * this.cols + col];
    if (target.flagged) {
      return {
        ok: false,
        reason: 'flagged',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }
    if (target.revealed) {
      return {
        ok: false,
        reason: 'already-revealed',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    if (this.status === 'idle') {
      this.status = 'playing';
    }

    if (!this.minesPlaced) {
      this.placeMinesExcludingZone(row, col);
    }

    this.activeHint = null;

    if (target.hasMine) {
      target.revealed = true;
      target.detonated = true;
      this.triggerLoss();
      return {
        ok: true,
        status: this.status,
        newlyRevealed: [{ row, col }],
        detonated: true,
        pointsAwarded: 0,
      };
    }

    const newlyRevealed = this.bfsRevealFrom([target]);
    const pointsAwarded = this.awardRevealScore(newlyRevealed.length, false);
    this.checkVictory();

    return {
      ok: true,
      status: this.status,
      newlyRevealed,
      detonated: false,
      pointsAwarded,
    };
  }

  public chord(row: number, col: number): ChordResult {
    if (this.status !== 'playing') {
      return {
        ok: false,
        reason: 'not-playing',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }
    if (!this.inBounds(row, col)) {
      return {
        ok: false,
        reason: 'out-of-bounds',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    const center = this.grid[row * this.cols + col];
    if (!center.revealed) {
      return {
        ok: false,
        reason: 'not-revealed',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }
    if (center.adjacentMines === 0) {
      return {
        ok: false,
        reason: 'zero-cell',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    const neighbors = this.getNeighbors(row, col);
    let flaggedNeighbors = 0;
    const unflaggedUnrevealed: InternalCell[] = [];

    for (const n of neighbors) {
      if (n.flagged) {
        flaggedNeighbors += 1;
      } else if (!n.revealed) {
        unflaggedUnrevealed.push(n);
      }
    }

    if (flaggedNeighbors !== center.adjacentMines) {
      return {
        ok: false,
        reason: 'flag-count-mismatch',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    if (unflaggedUnrevealed.length === 0) {
      return {
        ok: false,
        reason: 'no-unrevealed-neighbors',
        status: this.status,
        newlyRevealed: [],
        detonated: false,
        pointsAwarded: 0,
      };
    }

    this.activeHint = null;

    const mineHit = unflaggedUnrevealed.filter((cell) => cell.hasMine);
    if (mineHit.length > 0) {
      const revealedCoords: CellCoord[] = [];
      for (const cell of unflaggedUnrevealed) {
        cell.revealed = true;
        if (cell.hasMine) {
          cell.detonated = true;
        } else {
          this.revealedSafeCount += 1;
        }
        revealedCoords.push({ row: cell.row, col: cell.col });
      }
      this.triggerLoss();
      return {
        ok: true,
        status: this.status,
        newlyRevealed: revealedCoords,
        detonated: true,
        pointsAwarded: 0,
      };
    }

    const newlyRevealed = this.bfsRevealFrom(unflaggedUnrevealed);
    const pointsAwarded =
      newlyRevealed.length > 0 ? this.awardRevealScore(newlyRevealed.length, true) : 0;
    this.checkVictory();

    return {
      ok: true,
      status: this.status,
      newlyRevealed,
      detonated: false,
      pointsAwarded,
    };
  }

  /**
   * Pure frontier deduction hint scan (does not mutate score or hintsUsed).
   */
  public getHint(): HintResult | null {
    if (this.status === 'won' || this.status === 'lost') {
      return null;
    }

    if (!this.minesPlaced || this.revealedSafeCount === 0) {
      const r = Math.floor(this.rows / 2);
      const c = Math.floor(this.cols / 2);
      const target = this.pickOpeningCell(r, c);
      if (!target) {
        return null;
      }
      return {
        row: target.row,
        col: target.col,
        index: target.index,
        kind: 'opening',
        action: 'reveal',
        certainty: 1,
        mineProbability: 0,
        reason: 'First click is shielded — guaranteed safe 3×3 opening cascade.',
      };
    }

    const analysis = this.analyzeFrontier();

    if (analysis.knownSafe.size > 0) {
      const idx = this.pickBestSafeIndex(analysis.knownSafe);
      const cell = this.grid[idx];
      return {
        row: cell.row,
        col: cell.col,
        index: cell.index,
        kind: 'safe',
        action: 'reveal',
        certainty: 1,
        mineProbability: 0,
        reason: `Frontier logic proves (${cell.row + 1}, ${cell.col + 1}) is 100% safe to reveal.`,
      };
    }

    if (analysis.knownMines.size > 0) {
      const idx = this.pickBestSafeIndex(analysis.knownMines);
      const cell = this.grid[idx];
      return {
        row: cell.row,
        col: cell.col,
        index: cell.index,
        kind: 'mine',
        action: 'flag',
        certainty: 1,
        mineProbability: 1,
        reason: `Frontier deduction proves (${cell.row + 1}, ${cell.col + 1}) contains a mine.`,
      };
    }

    // Fallback: pick the unrevealed, unflagged cell with lowest estimated mine probability.
    let bestCell: InternalCell | null = null;
    let bestProb = Infinity;
    let bestNearFrontier = false;

    for (const cell of this.grid) {
      if (cell.revealed || cell.flagged) {
        continue;
      }
      const prob = analysis.probabilities.get(cell.index) ?? analysis.nonFrontierProbability;
      const nearFrontier = analysis.probabilities.has(cell.index);

      if (
        prob < bestProb - 1e-6 ||
        (Math.abs(prob - bestProb) <= 1e-6 && nearFrontier && !bestNearFrontier)
      ) {
        bestProb = prob;
        bestCell = cell;
        bestNearFrontier = nearFrontier;
      }
    }

    if (!bestCell) {
      return null;
    }

    const safePct = Math.round((1 - clamp(bestProb, 0, 1)) * 100);
    return {
      row: bestCell.row,
      col: bestCell.col,
      index: bestCell.index,
      kind: 'guess',
      action: 'reveal',
      certainty: clamp(1 - bestProb, 0, 1),
      mineProbability: clamp(bestProb, 0, 1),
      reason: analysis.hasContradiction
        ? `Flag conflict detected — lowest estimated risk is (${bestCell.row + 1}, ${bestCell.col + 1}).`
        : `No pure deduction available — (${bestCell.row + 1}, ${bestCell.col + 1}) has highest survival odds (~${safePct}%).`,
    };
  }

  /**
   * Requests an interactive hint, highlights the cell, and applies a mild hint penalty.
   */
  public requestHint(): HintResult | null {
    if (this.status === 'won' || this.status === 'lost') {
      return null;
    }

    const hint = this.getHint();
    if (!hint) {
      return null;
    }

    const isRepeat =
      this.activeHint !== null &&
      this.activeHint.index === hint.index &&
      this.activeHint.kind === hint.kind;

    this.activeHint = hint;

    if (!isRepeat) {
      this.hintsUsed += 1;
      if (this.score > 0) {
        this.score = Math.max(0, this.score - HINT_PENALTY);
      }
    }

    return hint;
  }

  public getWinForecast(): WinForecast {
    if (this.status === 'won') {
      return {
        label: 'VICTORY',
        percent: 100,
        detail: `All ${this.getTotalSafeCells()} safe sectors cleared with zero detonations.`,
      };
    }

    if (this.status === 'lost') {
      const safeLeft = this.getSafeLeft();
      return {
        label: 'DETONATED',
        percent: 0,
        detail: `Quantum mine triggered with ${safeLeft} safe sector${safeLeft === 1 ? '' : 's'} left.`,
      };
    }

    if (!this.minesPlaced || this.revealedSafeCount === 0) {
      return {
        label: 'FAVORABLE',
        percent: 85,
        detail: 'First click is shielded — guaranteed 3×3 safe opening cascade.',
      };
    }

    const analysis = this.analyzeFrontier();
    const totalSafe = this.getTotalSafeCells();
    const progress = totalSafe > 0 ? this.revealedSafeCount / totalSafe : 0;

    if (analysis.hasContradiction) {
      return {
        label: 'RISKY',
        percent: clamp(Math.round(35 + progress * 20), 15, 55),
        detail: 'Constraint conflict around placed flags — verify adjacent numbers.',
      };
    }

    if (analysis.fullyDeductible) {
      const pct = clamp(Math.round(94 + progress * 5), 94, 99);
      return {
        label: 'CERTAIN WIN',
        percent: pct,
        detail: `Remaining frontier is 100% logically solved (${analysis.knownSafe.size} safe, ${analysis.knownMines.size} mine${analysis.knownMines.size === 1 ? '' : 's'}).`,
      };
    }

    const provableCount = analysis.knownSafe.size + analysis.knownMines.size;
    if (provableCount > 0) {
      const pct = clamp(Math.round(74 + progress * 18 + Math.min(6, provableCount)), 74, 93);
      return {
        label: 'DEDUCTIBLE',
        percent: pct,
        detail: `${analysis.knownSafe.size} guaranteed safe & ${analysis.knownMines.size} provable mine${analysis.knownMines.size === 1 ? '' : 's'} on frontier.`,
      };
    }

    // No 100% deductions — evaluate minimum guess risk
    let minMineProb = analysis.nonFrontierProbability;
    for (const cell of this.grid) {
      if (cell.revealed || cell.flagged) {
        continue;
      }
      const p = analysis.probabilities.get(cell.index) ?? analysis.nonFrontierProbability;
      if (p < minMineProb) {
        minMineProb = p;
      }
    }

    const survivalProb = clamp(1 - minMineProb, 0.05, 0.95);
    if (minMineProb <= 0.25) {
      const pct = clamp(Math.round(52 + survivalProb * 18 + progress * 6), 52, 73);
      return {
        label: 'FAVORABLE',
        percent: pct,
        detail: `No forced deduction on frontier — best guess carries ~${Math.round(minMineProb * 100)}% mine risk.`,
      };
    }

    const pct = clamp(Math.round(14 + survivalProb * 38), 12, 51);
    return {
      label: 'RISKY',
      percent: pct,
      detail: `Ambiguous frontier — lowest-risk cell has ~${Math.round(minMineProb * 100)}% mine probability.`,
    };
  }

  private resetBoardState(nextStatus: GameStatus): void {
    const cfg = DIFFICULTIES[this.difficulty];
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.totalMines = cfg.mines;
    this.grid = createEmptyGrid(this.rows, this.cols);
    this.status = nextStatus;
    this.minesPlaced = false;
    this.score = 0;
    this.elapsedMs = 0;
    this.hintsUsed = 0;
    this.revealedSafeCount = 0;
    this.flagsCount = 0;
    this.activeHint = null;
  }

  private inBounds(row: number, col: number): boolean {
    return (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      row < this.rows &&
      col >= 0 &&
      col < this.cols
    );
  }

  private getNeighbors(row: number, col: number): InternalCell[] {
    const out: InternalCell[] = [];
    for (const [dr, dc] of NEIGHBOR_DELTAS) {
      const nr = row + dr;
      const nc = col + dc;
      if (this.inBounds(nr, nc)) {
        out.push(this.grid[nr * this.cols + nc]);
      }
    }
    return out;
  }

  private placeMinesExcludingZone(safeRow: number, safeCol: number): void {
    const candidates: InternalCell[] = [];
    for (const cell of this.grid) {
      if (Math.abs(cell.row - safeRow) <= 1 && Math.abs(cell.col - safeCol) <= 1) {
        continue;
      }
      candidates.push(cell);
    }

    if (candidates.length < this.totalMines) {
      throw new Error('Not enough candidate cells outside 3x3 exclusion zone for mines');
    }

    // Fisher-Yates shuffle
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    for (let i = 0; i < this.totalMines; i += 1) {
      candidates[i].hasMine = true;
    }

    this.computeAdjacentCounts();
    this.minesPlaced = true;
  }

  private computeAdjacentCounts(): void {
    for (const cell of this.grid) {
      if (cell.hasMine) {
        cell.adjacentMines = 0;
        continue;
      }
      let count = 0;
      for (const n of this.getNeighbors(cell.row, cell.col)) {
        if (n.hasMine) {
          count += 1;
        }
      }
      cell.adjacentMines = count;
    }
  }

  private bfsRevealFrom(seeds: readonly InternalCell[]): CellCoord[] {
    const queue: InternalCell[] = [];
    let head = 0;
    const revealed: CellCoord[] = [];

    for (const seed of seeds) {
      if (!seed.revealed && !seed.flagged && !seed.hasMine) {
        seed.revealed = true;
        this.revealedSafeCount += 1;
        revealed.push({ row: seed.row, col: seed.col });
        if (seed.adjacentMines === 0) {
          queue.push(seed);
        }
      }
    }

    while (head < queue.length) {
      const current = queue[head];
      head += 1;

      for (const neighbor of this.getNeighbors(current.row, current.col)) {
        if (neighbor.revealed || neighbor.flagged || neighbor.hasMine) {
          continue;
        }
        neighbor.revealed = true;
        this.revealedSafeCount += 1;
        revealed.push({ row: neighbor.row, col: neighbor.col });
        if (neighbor.adjacentMines === 0) {
          queue.push(neighbor);
        }
      }
    }

    return revealed;
  }

  private awardRevealScore(newlyRevealedCount: number, isChord: boolean): number {
    if (newlyRevealedCount <= 0) {
      return 0;
    }
    const mult = DIFFICULTY_SCORE_MULTIPLIER[this.difficulty];
    const base = newlyRevealedCount * BASE_SAFE_POINTS * mult;
    const cascade =
      newlyRevealedCount >= 2 ? (newlyRevealedCount - 1) * CASCADE_STEP_BONUS * mult : 0;
    const chordBonus = isChord ? CHORD_PRECISION_BONUS * mult : 0;
    const points = Math.round(base + cascade + chordBonus);
    this.score += points;
    this.syncHighScore();
    return points;
  }

  private checkVictory(): void {
    if (this.revealedSafeCount < this.getTotalSafeCells()) {
      return;
    }

    this.status = 'won';
    for (const cell of this.grid) {
      if (cell.hasMine && !cell.flagged) {
        cell.flagged = true;
        this.flagsCount += 1;
      }
    }

    const mult = DIFFICULTY_SCORE_MULTIPLIER[this.difficulty];
    const clearBonus = DIFFICULTY_CLEAR_BONUS[this.difficulty];
    const par = DIFFICULTY_PAR_SECONDS[this.difficulty];
    const elapsedSec = this.getElapsedSeconds();
    const speedBonus = Math.max(0, Math.round((par - elapsedSec) * 2 * mult));
    const precisionBonus = Math.max(0, Math.round(100 * mult) - this.hintsUsed * HINT_PENALTY);

    this.score += clearBonus + speedBonus + precisionBonus;
    this.syncHighScore();
  }

  private triggerLoss(): void {
    this.status = 'lost';
    for (const cell of this.grid) {
      if (cell.hasMine && !cell.flagged) {
        cell.revealed = true;
      } else if (cell.flagged && !cell.hasMine) {
        cell.wrongFlag = true;
      }
    }
  }

  private syncHighScore(): void {
    if (this.score > this.highScores[this.difficulty]) {
      this.highScores[this.difficulty] = this.score;
    }
  }

  private pickOpeningCell(preferredRow: number, preferredCol: number): InternalCell | null {
    const preferred = this.grid[preferredRow * this.cols + preferredCol];
    if (preferred && !preferred.revealed && !preferred.flagged) {
      return preferred;
    }
    for (const cell of this.grid) {
      if (!cell.revealed && !cell.flagged) {
        return cell;
      }
    }
    return null;
  }

  private pickBestSafeIndex(indices: Set<number>): number {
    // Prefer frontier cells (adjacent to already-revealed numbers) for natural progression.
    let fallback = -1;
    for (const idx of indices) {
      if (fallback === -1 || idx < fallback) {
        fallback = idx;
      }
      const cell = this.grid[idx];
      for (const n of this.getNeighbors(cell.row, cell.col)) {
        if (n.revealed) {
          return idx;
        }
      }
    }
    return fallback;
  }

  private analyzeFrontier(): FrontierAnalysis {
    const knownSafe = new Set<number>();
    const knownMines = new Set<number>();
    let hasContradiction = false;

    const initialConstraints: Constraint[] = [];
    for (const cell of this.grid) {
      if (!cell.revealed || cell.adjacentMines === 0) {
        continue;
      }
      let flaggedNeighbors = 0;
      const vars = new Set<number>();
      for (const n of this.getNeighbors(cell.row, cell.col)) {
        if (n.flagged) {
          flaggedNeighbors += 1;
        } else if (!n.revealed) {
          vars.add(n.index);
        }
      }
      const count = cell.adjacentMines - flaggedNeighbors;
      if (count < 0 || count > vars.size) {
        hasContradiction = true;
      } else if (vars.size > 0) {
        initialConstraints.push({ vars, count });
      }
    }

    let constraints = this.deduplicateConstraints(initialConstraints);

    // Fixed-point propagation: direct count + pairwise subset/overlap reduction + global count
    for (let pass = 0; pass < 32 && !hasContradiction; pass += 1) {
      const prevSafeCount = knownSafe.size;
      const prevMineCount = knownMines.size;
      const prevConstraintCount = constraints.length;

      const simplified: Constraint[] = [];
      for (const c of constraints) {
        const nextVars = new Set<number>();
        let nextCount = c.count;
        for (const v of c.vars) {
          if (knownSafe.has(v)) {
            continue;
          }
          if (knownMines.has(v)) {
            nextCount -= 1;
            continue;
          }
          nextVars.add(v);
        }
        if (nextCount < 0 || nextCount > nextVars.size) {
          hasContradiction = true;
          break;
        }
        if (nextVars.size === 0) {
          continue;
        }
        if (nextCount === 0) {
          for (const v of nextVars) {
            knownSafe.add(v);
          }
          continue;
        }
        if (nextCount === nextVars.size) {
          for (const v of nextVars) {
            knownMines.add(v);
          }
          continue;
        }
        simplified.push({ vars: nextVars, count: nextCount });
      }

      if (hasContradiction) {
        break;
      }

      constraints = this.deduplicateConstraints(simplified);

      // Pairwise subset & overlap reduction
      const derived: Constraint[] = [];
      for (let i = 0; i < constraints.length; i += 1) {
        const a = constraints[i];
        for (let j = i + 1; j < constraints.length; j += 1) {
          const b = constraints[j];
          if (!setsOverlap(a.vars, b.vars)) {
            continue;
          }

          const onlyA: number[] = [];
          for (const v of a.vars) {
            if (!b.vars.has(v)) {
              onlyA.push(v);
            }
          }
          const onlyB: number[] = [];
          for (const v of b.vars) {
            if (!a.vars.has(v)) {
              onlyB.push(v);
            }
          }

          if (onlyA.length === 0 && onlyB.length === 0) {
            if (a.count !== b.count) {
              hasContradiction = true;
            }
            continue;
          }

          const diffAB = a.count - b.count;
          const diffBA = b.count - a.count;

          if (diffAB === onlyA.length) {
            for (const v of onlyA) knownMines.add(v);
            for (const v of onlyB) knownSafe.add(v);
          } else if (diffBA === onlyB.length) {
            for (const v of onlyB) knownMines.add(v);
            for (const v of onlyA) knownSafe.add(v);
          } else if (onlyA.length === 0 && diffBA > 0 && diffBA < onlyB.length) {
            derived.push({ vars: new Set(onlyB), count: diffBA });
          } else if (onlyB.length === 0 && diffAB > 0 && diffAB < onlyA.length) {
            derived.push({ vars: new Set(onlyA), count: diffAB });
          }
        }
      }

      if (derived.length > 0 && constraints.length < 300) {
        constraints = this.deduplicateConstraints([...constraints, ...derived]).slice(0, 350);
      }

      // Global remaining mines check
      const unknown = this.getUnknownUnflaggedIndices(knownSafe, knownMines);
      const remMines = this.totalMines - this.flagsCount - knownMines.size;
      if (remMines < 0 || remMines > unknown.length) {
        hasContradiction = true;
        break;
      }
      if (unknown.length > 0) {
        if (remMines === 0) {
          for (const v of unknown) knownSafe.add(v);
        } else if (remMines === unknown.length) {
          for (const v of unknown) knownMines.add(v);
        }
      }

      if (
        knownSafe.size === prevSafeCount &&
        knownMines.size === prevMineCount &&
        constraints.length === prevConstraintCount
      ) {
        break;
      }
    }

    const probabilities = new Map<number, number>();
    let expectedFrontierMines = 0;

    if (!hasContradiction && constraints.length > 0) {
      const components = this.groupConnectedComponents(constraints);
      for (const comp of components) {
        const compVars = this.collectComponentVars(comp);
        if (compVars.length <= 16) {
          const solved = this.solveExactComponent(compVars, comp);
          if (solved.contradiction) {
            hasContradiction = true;
            break;
          }
          if (solved.complete && solved.solutions > 0) {
            let expectedInComp = 0;
            for (let i = 0; i < compVars.length; i += 1) {
              const v = compVars[i];
              const p = solved.mineCounts[i] / solved.solutions;
              expectedInComp += p;
              if (solved.mineCounts[i] === 0) {
                knownSafe.add(v);
                probabilities.set(v, 0);
              } else if (solved.mineCounts[i] === solved.solutions) {
                knownMines.add(v);
                probabilities.set(v, 1);
              } else {
                probabilities.set(v, p);
              }
            }
            expectedFrontierMines += expectedInComp;
            continue;
          }
        }

        // Heuristic probability for large frontier components
        for (const v of compVars) {
          let sumRatio = 0;
          let hits = 0;
          for (const c of comp) {
            if (c.vars.has(v)) {
              sumRatio += c.count / c.vars.size;
              hits += 1;
            }
          }
          const avg = hits > 0 ? clamp(sumRatio / hits, 0.02, 0.98) : 0.5;
          probabilities.set(v, avg);
          expectedFrontierMines += avg;
        }
      }
    }

    if (!hasContradiction) {
      const remAfterComp = this.totalMines - this.flagsCount - knownMines.size;
      const unresolvedAfterComp = this.getUnknownUnflaggedIndices(knownSafe, knownMines);
      if (remAfterComp < 0 || remAfterComp > unresolvedAfterComp.length) {
        hasContradiction = true;
      } else if (unresolvedAfterComp.length > 0) {
        if (remAfterComp === 0) {
          for (const v of unresolvedAfterComp) {
            knownSafe.add(v);
            probabilities.set(v, 0);
          }
        } else if (remAfterComp === unresolvedAfterComp.length) {
          for (const v of unresolvedAfterComp) {
            knownMines.add(v);
            probabilities.set(v, 1);
          }
        }
      }
    }

    const allUnknownUnflagged = this.getUnknownUnflaggedIndices(new Set(), new Set());
    const remainingMines = Math.max(0, this.totalMines - this.flagsCount);

    let nonFrontierCount = 0;
    for (const v of allUnknownUnflagged) {
      if (!knownSafe.has(v) && !knownMines.has(v) && !probabilities.has(v)) {
        nonFrontierCount += 1;
      }
    }

    const minesAccountedFor = knownMines.size + expectedFrontierMines;
    const leftoverMines = clamp(remainingMines - minesAccountedFor, 0, nonFrontierCount);
    const nonFrontierProbability =
      nonFrontierCount > 0
        ? clamp(leftoverMines / nonFrontierCount, 0.01, 0.99)
        : clamp(
            allUnknownUnflagged.length > 0 ? remainingMines / allUnknownUnflagged.length : 0.5,
            0.01,
            0.99,
          );

    const unresolvedUnknown = this.getUnknownUnflaggedIndices(knownSafe, knownMines);
    const fullyDeductible =
      !hasContradiction &&
      allUnknownUnflagged.length > 0 &&
      (unresolvedUnknown.length === 0 || remainingMines - knownMines.size === 0);

    return {
      knownSafe,
      knownMines,
      probabilities,
      nonFrontierProbability,
      hasContradiction,
      unknownUnflaggedCount: allUnknownUnflagged.length,
      remainingMines,
      fullyDeductible,
    };
  }

  private deduplicateConstraints(list: readonly Constraint[]): Constraint[] {
    const map = new Map<string, Constraint>();
    for (const c of list) {
      if (c.vars.size === 0) {
        continue;
      }
      const key = constraintKey(c.vars, c.count);
      if (!map.has(key)) {
        map.set(key, c);
      }
    }
    return Array.from(map.values());
  }

  private getUnknownUnflaggedIndices(
    knownSafe: Set<number>,
    knownMines: Set<number>,
  ): number[] {
    const indices: number[] = [];
    for (const cell of this.grid) {
      if (
        !cell.revealed &&
        !cell.flagged &&
        !knownSafe.has(cell.index) &&
        !knownMines.has(cell.index)
      ) {
        indices.push(cell.index);
      }
    }
    return indices;
  }

  private groupConnectedComponents(constraints: readonly Constraint[]): Constraint[][] {
    const varToConstraints = new Map<number, number[]>();
    for (let i = 0; i < constraints.length; i += 1) {
      for (const v of constraints[i].vars) {
        const list = varToConstraints.get(v);
        if (list) {
          list.push(i);
        } else {
          varToConstraints.set(v, [i]);
        }
      }
    }

    const visited = new Uint8Array(constraints.length);
    const components: Constraint[][] = [];

    for (let i = 0; i < constraints.length; i += 1) {
      if (visited[i]) {
        continue;
      }
      const queue = [i];
      visited[i] = 1;
      const comp: Constraint[] = [];
      let head = 0;

      while (head < queue.length) {
        const ci = queue[head];
        head += 1;
        const c = constraints[ci];
        comp.push(c);

        for (const v of c.vars) {
          const linked = varToConstraints.get(v);
          if (!linked) continue;
          for (const nextCi of linked) {
            if (!visited[nextCi]) {
              visited[nextCi] = 1;
              queue.push(nextCi);
            }
          }
        }
      }

      components.push(comp);
    }

    return components;
  }

  private collectComponentVars(constraints: readonly Constraint[]): number[] {
    const set = new Set<number>();
    for (const c of constraints) {
      for (const v of c.vars) {
        set.add(v);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  private solveExactComponent(
    vars: readonly number[],
    constraints: readonly Constraint[],
  ): {
    complete: boolean;
    contradiction: boolean;
    solutions: number;
    mineCounts: number[];
  } {
    const varToPos = new Map<number, number>();
    for (let i = 0; i < vars.length; i += 1) {
      varToPos.set(vars[i], i);
    }

    const compiled = constraints.map((c) => ({
      positions: Array.from(c.vars).map((v) => varToPos.get(v)!),
      target: c.count,
    }));

    const assignment = new Int8Array(vars.length);
    assignment.fill(-1);
    const mineCounts = new Array<number>(vars.length).fill(0);
    let solutions = 0;
    let statesVisited = 0;
    let aborted = false;

    const checkPartial = (): boolean => {
      for (const c of compiled) {
        let mines = 0;
        let unassigned = 0;
        for (const pos of c.positions) {
          const val = assignment[pos];
          if (val === 1) {
            mines += 1;
          } else if (val === -1) {
            unassigned += 1;
          }
        }
        if (mines > c.target || mines + unassigned < c.target) {
          return false;
        }
      }
      return true;
    };

    const backtrack = (idx: number): void => {
      if (aborted) {
        return;
      }
      statesVisited += 1;
      if (statesVisited > 4096) {
        aborted = true;
        return;
      }

      if (idx === vars.length) {
        solutions += 1;
        for (let i = 0; i < vars.length; i += 1) {
          if (assignment[i] === 1) {
            mineCounts[i] += 1;
          }
        }
        return;
      }

      // Try safe (0) then mine (1)
      assignment[idx] = 0;
      if (checkPartial()) {
        backtrack(idx + 1);
      }

      assignment[idx] = 1;
      if (checkPartial()) {
        backtrack(idx + 1);
      }

      assignment[idx] = -1;
    };

    backtrack(0);

    return {
      complete: !aborted,
      contradiction: !aborted && solutions === 0,
      solutions,
      mineCounts,
    };
  }
}
