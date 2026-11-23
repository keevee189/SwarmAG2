/**
 * Pure TypeScript 2048 ("Hyper 2048") game engine, undo history,
 * 2-ply expectimax hint solver, and board health/win forecast analyzer.
 *
 * Zero DOM dependencies — safe to run in browsers and Node.js unit tests.
 */

import { clamp } from '../../shared/arcade.js';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type GameMode = 'classic' | 'endless';
export type GameStatus = 'playing' | 'won' | 'gameover';
export type ForecastLabel =
  | 'LOCKED IN'
  | 'STRONG FLOW'
  | 'BALANCED'
  | 'TIGHT GRID'
  | 'CRITICAL'
  | '2048 REACHED'
  | 'GRID LOCKED';

export const GRID_SIZE = 4;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;
export const WIN_TILE_VALUE = 2048;

export const ALL_DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

const CORNER_INDICES: readonly number[] = [0, 3, 12, 15];
const CENTER_INDICES: readonly number[] = [5, 6, 9, 10];

// 8 serpentine snake orders anchored at each of the 4 corners (row-first & col-first).
const SNAKE_PATHS: ReadonlyArray<readonly number[]> = [
  [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12],
  [0, 4, 8, 12, 13, 9, 5, 1, 2, 6, 10, 14, 15, 11, 7, 3],
  [3, 2, 1, 0, 4, 5, 6, 7, 11, 10, 9, 8, 12, 13, 14, 15],
  [3, 7, 11, 15, 14, 10, 6, 2, 1, 5, 9, 13, 12, 8, 4, 0],
  [12, 13, 14, 15, 11, 10, 9, 8, 4, 5, 6, 7, 3, 2, 1, 0],
  [12, 8, 4, 0, 1, 5, 9, 13, 14, 10, 6, 2, 3, 7, 11, 15],
  [15, 14, 13, 12, 8, 9, 10, 11, 7, 6, 5, 4, 0, 1, 2, 3],
  [15, 11, 7, 3, 2, 6, 10, 14, 13, 9, 5, 1, 0, 4, 8, 12],
];

const SNAKE_WEIGHTS: readonly number[] = Array.from({ length: CELL_COUNT }, (_, step) =>
  Number((20 * Math.pow(0.76, step)).toFixed(4)),
);

export interface Game2048Options {
  mode?: GameMode;
  seed?: number;
  rng?: () => number;
  highScore?: number;
  initialGrid?: readonly number[] | readonly (readonly number[])[];
}

export interface LoadGridOptions {
  score?: number;
  moves?: number;
  mergeStreak?: number;
  mode?: GameMode;
  hasWon2048?: boolean;
  status?: GameStatus;
  highScore?: number;
  clearUndo?: boolean;
}

export interface TileTransition {
  toIndex: number;
  fromIndices: number[];
  value: number;
  merged: boolean;
}

export interface SlideOutcome {
  grid: number[];
  moved: boolean;
  scoreDelta: number;
  merges: number;
  mergedIndices: number[];
  transitions: TileTransition[];
}

export interface MoveResult {
  moved: boolean;
  direction: Direction;
  scoreDelta: number;
  merges: number;
  spawnedIndex: number | null;
  spawnedValue: 2 | 4 | null;
  mergedIndices: number[];
  transitions: TileTransition[];
  reached2048: boolean;
  status: GameStatus;
}

export interface MoveHint {
  direction: Direction;
  score: number;
  reason: string;
}

export interface WinForecast {
  label: ForecastLabel;
  percent: number;
  detail: string;
}

export interface Game2048Snapshot {
  grid: number[];
  score: number;
  highScore: number;
  bestTile: number;
  moves: number;
  mergeStreak: number;
  mode: GameMode;
  status: GameStatus;
  hasWon2048: boolean;
  canUndo: boolean;
  undoCount: number;
  emptyCount: number;
  lastSpawnIndex: number | null;
  lastMergedIndices: number[];
  lastTransitions: TileTransition[];
  forecast: WinForecast;
}

interface UndoEntry {
  grid: number[];
  score: number;
  moves: number;
  mergeStreak: number;
  status: GameStatus;
  hasWon2048: boolean;
  mode: GameMode;
  lastSpawnIndex: number | null;
  lastMergedIndices: number[];
}

/**
 * Deterministic 32-bit PRNG (Mulberry32) for reproducible deals and unit tests.
 */
export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function normalizeGridInput(
  input: readonly number[] | readonly (readonly number[])[],
): number[] {
  let flat: number[];
  if (input.length === GRID_SIZE && Array.isArray(input[0])) {
    const matrix = input as readonly (readonly number[])[];
    flat = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
      const row = matrix[r];
      if (!Array.isArray(row) || row.length !== GRID_SIZE) {
        throw new Error(`Expected 4x4 grid row ${r} to have length 4.`);
      }
      for (let c = 0; c < GRID_SIZE; c += 1) {
        flat.push(row[c]);
      }
    }
  } else if (input.length === CELL_COUNT) {
    flat = [...(input as readonly number[])];
  } else {
    throw new Error(`Expected grid of length 16 or 4x4 matrix, got length ${input.length}.`);
  }

  for (let i = 0; i < CELL_COUNT; i += 1) {
    const v = flat[i];
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`Invalid tile value at cell ${i}: ${String(v)}`);
    }
  }
  return flat;
}

function getLineIndices(direction: Direction, lineIdx: number): [number, number, number, number] {
  switch (direction) {
    case 'left': {
      const base = lineIdx * GRID_SIZE;
      return [base, base + 1, base + 2, base + 3];
    }
    case 'right': {
      const base = lineIdx * GRID_SIZE;
      return [base + 3, base + 2, base + 1, base];
    }
    case 'up':
      return [lineIdx, lineIdx + 4, lineIdx + 8, lineIdx + 12];
    case 'down':
      return [lineIdx + 12, lineIdx + 8, lineIdx + 4, lineIdx];
  }
}

/**
 * Pure 4x4 slide & merge operation in any direction.
 * Enforces the single-merge-per-turn invariant: `[2,2,2,2] -> [4,4,0,0]`, `[2,2,4,0] -> [4,4,0,0]`.
 */
export function slideGrid(grid: readonly number[], direction: Direction): SlideOutcome {
  const nextGrid = new Array<number>(CELL_COUNT).fill(0);
  const mergedIndices: number[] = [];
  const transitions: TileTransition[] = [];
  let scoreDelta = 0;
  let merges = 0;
  let moved = false;

  for (let lineIdx = 0; lineIdx < GRID_SIZE; lineIdx += 1) {
    const indices = getLineIndices(direction, lineIdx);
    const compressed: Array<{ value: number; index: number }> = [];

    for (let pos = 0; pos < GRID_SIZE; pos += 1) {
      const cellIdx = indices[pos];
      const val = grid[cellIdx];
      if (val > 0) {
        compressed.push({ value: val, index: cellIdx });
      }
    }

    let writePos = 0;
    let k = 0;
    while (k < compressed.length) {
      const targetIdx = indices[writePos];
      const current = compressed[k];

      if (k + 1 < compressed.length && compressed[k + 1].value === current.value) {
        const mergedValue = current.value * 2;
        const partner = compressed[k + 1];
        nextGrid[targetIdx] = mergedValue;
        scoreDelta += mergedValue;
        merges += 1;
        mergedIndices.push(targetIdx);
        transitions.push({
          toIndex: targetIdx,
          fromIndices: [current.index, partner.index],
          value: mergedValue,
          merged: true,
        });
        moved = true;
        k += 2;
      } else {
        nextGrid[targetIdx] = current.value;
        if (current.index !== targetIdx) {
          moved = true;
        }
        transitions.push({
          toIndex: targetIdx,
          fromIndices: [current.index],
          value: current.value,
          merged: false,
        });
        k += 1;
      }
      writePos += 1;
    }
  }

  return {
    grid: nextGrid,
    moved,
    scoreDelta,
    merges,
    mergedIndices,
    transitions,
  };
}

/**
 * Returns all empty cell indices (0..15).
 */
export function getEmptyIndices(grid: readonly number[]): number[] {
  const empty: number[] = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (grid[i] === 0) {
      empty.push(i);
    }
  }
  return empty;
}

/**
 * Returns the maximum tile value on the grid (0 if empty).
 */
export function getBestTile(grid: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (grid[i] > best) {
      best = grid[i];
    }
  }
  return best;
}

/**
 * Returns true if any orthogonal pair of non-zero adjacent tiles have equal values.
 */
export function hasAdjacentMerge(grid: readonly number[]): boolean {
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      const idx = r * GRID_SIZE + c;
      const val = grid[idx];
      if (val === 0) {
        continue;
      }
      if (c + 1 < GRID_SIZE && grid[idx + 1] === val) {
        return true;
      }
      if (r + 1 < GRID_SIZE && grid[idx + GRID_SIZE] === val) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if at least one of the 4 slide directions alters the board.
 */
export function hasAnyLegalMove(grid: readonly number[]): boolean {
  for (const dir of ALL_DIRECTIONS) {
    if (slideGrid(grid, dir).moved) {
      return true;
    }
  }
  return false;
}

function tileRank(value: number): number {
  return value > 0 ? Math.log2(value) : 0;
}

interface BoardMetrics {
  emptyCount: number;
  bestTile: number;
  maxRank: number;
  bestCornerAnchored: boolean;
  bestInCenter: boolean;
  snakeRatio: number;
  monotonicityRatio: number;
  adjacentMatches: number;
  smoothnessPenalty: number;
  legalMoves: number;
}

function analyzeBoardMetrics(grid: readonly number[]): BoardMetrics {
  let emptyCount = 0;
  let bestTile = 0;
  const ranks = new Array<number>(CELL_COUNT).fill(0);

  for (let i = 0; i < CELL_COUNT; i += 1) {
    const val = grid[i];
    if (val === 0) {
      emptyCount += 1;
    } else {
      if (val > bestTile) {
        bestTile = val;
      }
      ranks[i] = tileRank(val);
    }
  }

  const maxRank = tileRank(bestTile);
  const bestCornerAnchored =
    bestTile > 0 && CORNER_INDICES.some((idx) => grid[idx] === bestTile);
  const bestInCenter =
    bestTile > 0 &&
    !bestCornerAnchored &&
    CENTER_INDICES.some((idx) => grid[idx] === bestTile);

  // Snake alignment: compare best observed snake score against ideal sorted placement.
  const sortedEnergies = ranks
    .filter((r) => r > 0)
    .map((r) => Math.pow(r, 1.8))
    .sort((a, b) => b - a);

  let idealSnake = 0;
  for (let s = 0; s < sortedEnergies.length; s += 1) {
    idealSnake += sortedEnergies[s] * SNAKE_WEIGHTS[s];
  }

  let bestSnake = 0;
  for (const path of SNAKE_PATHS) {
    let score = 0;
    for (let s = 0; s < CELL_COUNT; s += 1) {
      const r = ranks[path[s]];
      if (r > 0) {
        score += Math.pow(r, 1.8) * SNAKE_WEIGHTS[s];
      }
    }
    if (score > bestSnake) {
      bestSnake = score;
    }
  }

  const snakeRatio = idealSnake > 0 ? clamp(bestSnake / idealSnake, 0, 1) : 1;

  // Monotonicity across rows and columns.
  let monoTotalPenalty = 0;
  let monoMaxPossible = 0;

  for (let r = 0; r < GRID_SIZE; r += 1) {
    let inc = 0;
    let dec = 0;
    for (let c = 0; c < GRID_SIZE - 1; c += 1) {
      const a = ranks[r * GRID_SIZE + c];
      const b = ranks[r * GRID_SIZE + c + 1];
      if (a > b) {
        dec += a - b;
      } else {
        inc += b - a;
      }
      monoMaxPossible += Math.max(a, b);
    }
    monoTotalPenalty += Math.min(inc, dec);
  }

  for (let c = 0; c < GRID_SIZE; c += 1) {
    let inc = 0;
    let dec = 0;
    for (let r = 0; r < GRID_SIZE - 1; r += 1) {
      const a = ranks[r * GRID_SIZE + c];
      const b = ranks[(r + 1) * GRID_SIZE + c];
      if (a > b) {
        dec += a - b;
      } else {
        inc += b - a;
      }
      monoMaxPossible += Math.max(a, b);
    }
    monoTotalPenalty += Math.min(inc, dec);
  }

  const monotonicityRatio =
    monoMaxPossible > 0
      ? clamp(1 - monoTotalPenalty / Math.max(1, monoMaxPossible * 0.6), 0, 1)
      : 1;

  // Smoothness and immediate adjacent merges.
  let adjacentMatches = 0;
  let smoothnessPenalty = 0;

  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      const idx = r * GRID_SIZE + c;
      const rankA = ranks[idx];
      if (rankA === 0) {
        continue;
      }
      if (c + 1 < GRID_SIZE && ranks[idx + 1] > 0) {
        if (ranks[idx + 1] === rankA) {
          adjacentMatches += 1;
        } else {
          smoothnessPenalty += Math.abs(rankA - ranks[idx + 1]);
        }
      }
      if (r + 1 < GRID_SIZE && ranks[idx + GRID_SIZE] > 0) {
        if (ranks[idx + GRID_SIZE] === rankA) {
          adjacentMatches += 1;
        } else {
          smoothnessPenalty += Math.abs(rankA - ranks[idx + GRID_SIZE]);
        }
      }
    }
  }

  let legalMoves = 0;
  for (const dir of ALL_DIRECTIONS) {
    if (slideGrid(grid, dir).moved) {
      legalMoves += 1;
    }
  }

  return {
    emptyCount,
    bestTile,
    maxRank,
    bestCornerAnchored,
    bestInCenter,
    snakeRatio,
    monotonicityRatio,
    adjacentMatches,
    smoothnessPenalty,
    legalMoves,
  };
}

/**
 * Evaluates a 2048 board combining empty cells, snake monotonicity,
 * corner anchoring, and merge smoothness.
 */
export function evaluateGridHeuristic(grid: readonly number[]): number {
  let emptyCount = 0;
  let bestTile = 0;
  const ranks = new Array<number>(CELL_COUNT).fill(0);

  for (let i = 0; i < CELL_COUNT; i += 1) {
    const val = grid[i];
    if (val === 0) {
      emptyCount += 1;
    } else {
      if (val > bestTile) {
        bestTile = val;
      }
      ranks[i] = tileRank(val);
    }
  }

  const maxRank = tileRank(bestTile);

  // 1. Empty cell availability (vital survival cushion).
  let emptyScore = emptyCount * 145;
  if (emptyCount === 0) {
    emptyScore -= 420;
  } else if (emptyCount <= 2) {
    emptyScore -= (3 - emptyCount) * 110;
  }

  // 2. Best corner-anchored snake gradient.
  let bestSnakeScore = 0;
  for (const path of SNAKE_PATHS) {
    let sScore = 0;
    for (let s = 0; s < CELL_COUNT; s += 1) {
      const r = ranks[path[s]];
      if (r > 0) {
        sScore += Math.pow(r, 1.8) * SNAKE_WEIGHTS[s];
      }
    }
    if (sScore > bestSnakeScore) {
      bestSnakeScore = sScore;
    }
  }

  // 3. Monotonicity across all rows & columns.
  let monoPenalty = 0;
  for (let r = 0; r < GRID_SIZE; r += 1) {
    let inc = 0;
    let dec = 0;
    for (let c = 0; c < GRID_SIZE - 1; c += 1) {
      const a = ranks[r * GRID_SIZE + c];
      const b = ranks[r * GRID_SIZE + c + 1];
      if (a > b) {
        dec += a - b;
      } else {
        inc += b - a;
      }
    }
    monoPenalty += Math.min(inc, dec);
  }
  for (let c = 0; c < GRID_SIZE; c += 1) {
    let inc = 0;
    let dec = 0;
    for (let r = 0; r < GRID_SIZE - 1; r += 1) {
      const a = ranks[r * GRID_SIZE + c];
      const b = ranks[(r + 1) * GRID_SIZE + c];
      if (a > b) {
        dec += a - b;
      } else {
        inc += b - a;
      }
    }
    monoPenalty += Math.min(inc, dec);
  }
  const monoScore = -monoPenalty * 42;

  // 4. Corner anchoring & center penalty.
  let cornerScore = 0;
  if (bestTile > 0) {
    if (CORNER_INDICES.some((idx) => grid[idx] === bestTile)) {
      cornerScore += maxRank * 38;
    } else if (CENTER_INDICES.some((idx) => grid[idx] === bestTile)) {
      cornerScore -= maxRank * 48;
    }
  }

  // 5. Merge smoothness & immediate equal neighbors.
  let smoothnessScore = 0;
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      const idx = r * GRID_SIZE + c;
      const rankA = ranks[idx];
      if (rankA === 0) {
        continue;
      }
      if (c + 1 < GRID_SIZE && ranks[idx + 1] > 0) {
        const rankB = ranks[idx + 1];
        if (rankA === rankB) {
          smoothnessScore += rankA * 20;
        } else {
          smoothnessScore -= Math.abs(rankA - rankB) * 14;
        }
      }
      if (r + 1 < GRID_SIZE && ranks[idx + GRID_SIZE] > 0) {
        const rankB = ranks[idx + GRID_SIZE];
        if (rankA === rankB) {
          smoothnessScore += rankA * 20;
        } else {
          smoothnessScore -= Math.abs(rankA - rankB) * 14;
        }
      }
    }
  }

  return emptyScore + bestSnakeScore + monoScore + cornerScore + smoothnessScore;
}

function evaluateSecondPlyBest(grid: number[]): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const dir of ALL_DIRECTIONS) {
    const res = slideGrid(grid, dir);
    if (!res.moved) {
      continue;
    }
    const score = evaluateGridHeuristic(res.grid) + res.scoreDelta * 0.4;
    if (score > best) {
      best = score;
    }
  }
  if (best === Number.NEGATIVE_INFINITY) {
    return -50000;
  }
  return best;
}

function buildHintReason(
  beforeGrid: readonly number[],
  outcome: SlideOutcome,
): string {
  const beforeBest = getBestTile(beforeGrid);
  const afterBest = getBestTile(outcome.grid);
  const afterEmpty = getEmptyIndices(outcome.grid).length;
  const cornerAnchored =
    afterBest > 0 && CORNER_INDICES.some((idx) => outcome.grid[idx] === afterBest);

  if (beforeBest < WIN_TILE_VALUE && afterBest >= WIN_TILE_VALUE) {
    return `Forges the ${WIN_TILE_VALUE} victory tile (+${outcome.scoreDelta.toLocaleString()} pts)!`;
  }
  if (outcome.merges >= 2) {
    return `Chains ${outcome.merges} merges (+${outcome.scoreDelta} pts) and frees ${afterEmpty} cells.`;
  }
  if (outcome.merges === 1) {
    return cornerAnchored
      ? `Merges +${outcome.scoreDelta} pts while anchoring ${afterBest} in a corner.`
      : `Combines tiles (+${outcome.scoreDelta} pts) with ${afterEmpty} open cells.`;
  }
  if (cornerAnchored) {
    return `Keeps ${afterBest} locked in corner and improves snake alignment.`;
  }
  return `Preserves mobility with ${afterEmpty} open cell${afterEmpty === 1 ? '' : 's'}.`;
}

/**
 * Stateful 2048 game engine with deterministic seedable RNG, multi-step undo stack,
 * classic/endless modes, 2-ply expectimax move hints, and board health forecasting.
 */
export class Game2048Engine {
  private grid: number[] = new Array<number>(CELL_COUNT).fill(0);
  private score = 0;
  private highScore = 0;
  private moves = 0;
  private mergeStreak = 0;
  private mode: GameMode = 'classic';
  private status: GameStatus = 'playing';
  private hasWon2048 = false;
  private undoStack: UndoEntry[] = [];
  private lastSpawnIndex: number | null = null;
  private lastMergedIndices: number[] = [];
  private lastTransitions: TileTransition[] = [];
  private rng: () => number;

  constructor(options: Game2048Options = {}) {
    if (options.rng) {
      this.rng = options.rng;
    } else if (options.seed !== undefined) {
      this.rng = createSeededRng(options.seed);
    } else {
      this.rng = Math.random;
    }

    this.mode = options.mode ?? 'classic';
    this.highScore =
      typeof options.highScore === 'number' && options.highScore > 0
        ? Math.floor(options.highScore)
        : 0;

    if (options.initialGrid) {
      this.loadGrid(options.initialGrid, {
        mode: this.mode,
        highScore: this.highScore,
      });
    } else {
      this.start(this.mode);
    }
  }

  /**
   * Starts a fresh 2048 game with 2 spawned tiles.
   */
  public start(mode?: GameMode): void {
    if (mode !== undefined) {
      this.mode = mode;
    }
    this.grid = new Array<number>(CELL_COUNT).fill(0);
    this.score = 0;
    this.moves = 0;
    this.mergeStreak = 0;
    this.status = 'playing';
    this.hasWon2048 = false;
    this.undoStack = [];
    this.lastMergedIndices = [];
    this.lastTransitions = [];

    const first = this.spawnRandomTile();
    const second = this.spawnRandomTile();
    this.lastSpawnIndex = second?.index ?? first?.index ?? null;
  }

  /**
   * Full game reset: clears board, score, moves, merge streak, undo stack, and spawns 2 initial tiles.
   */
  public reset(mode?: GameMode): void {
    this.start(mode);
  }

  /**
   * Updates active mode (`classic` or `endless`).
   * Switching from `classic` to `endless` while on the 2048 win state resumes play automatically.
   */
  public setMode(mode: GameMode): void {
    this.mode = mode;
    if (mode === 'endless' && this.status === 'won') {
      this.status = hasAnyLegalMove(this.grid) ? 'playing' : 'gameover';
    }
  }

  /**
   * Transitions out of the Classic 2048 victory screen into Endless mode.
   */
  public continueEndless(): boolean {
    if (this.status === 'gameover') {
      return false;
    }
    this.mode = 'endless';
    if (this.status === 'won') {
      this.status = hasAnyLegalMove(this.grid) ? 'playing' : 'gameover';
      return true;
    }
    return true;
  }

  /**
   * Loads an arbitrary 16-cell or 4x4 grid (useful for tests, diagnostics, and puzzles).
   */
  public loadGrid(grid: readonly number[] | readonly (readonly number[])[], opts: LoadGridOptions = {}): void {
    const normalized = normalizeGridInput(grid);
    this.grid = normalized;

    if (opts.score !== undefined) {
      this.score = Math.max(0, Math.floor(opts.score));
    } else {
      this.score = 0;
    }
    if (opts.highScore !== undefined) {
      this.highScore = Math.max(this.highScore, Math.floor(opts.highScore));
    }
    this.highScore = Math.max(this.highScore, this.score);

    this.moves = opts.moves !== undefined ? Math.max(0, Math.floor(opts.moves)) : 0;
    this.mergeStreak =
      opts.mergeStreak !== undefined ? Math.max(0, Math.floor(opts.mergeStreak)) : 0;
    if (opts.mode !== undefined) {
      this.mode = opts.mode;
    }

    const bestTile = getBestTile(this.grid);
    this.hasWon2048 = opts.hasWon2048 ?? bestTile >= WIN_TILE_VALUE;

    if (opts.status !== undefined) {
      this.status = opts.status;
    } else if (!hasAnyLegalMove(this.grid)) {
      this.status = 'gameover';
    } else if (this.mode === 'classic' && this.hasWon2048) {
      this.status = 'won';
    } else {
      this.status = 'playing';
    }

    if (opts.clearUndo !== false) {
      this.undoStack = [];
    }
    this.lastSpawnIndex = null;
    this.lastMergedIndices = [];
    this.lastTransitions = [];
  }

  /**
   * Executes a slide/merge in `direction`.
   * No-op moves leave state, moves, undo stack, and tile spawns untouched.
   */
  public move(direction: Direction): MoveResult {
    if (this.status !== 'playing') {
      return {
        moved: false,
        direction,
        scoreDelta: 0,
        merges: 0,
        spawnedIndex: null,
        spawnedValue: null,
        mergedIndices: [],
        transitions: [],
        reached2048: false,
        status: this.status,
      };
    }

    const outcome = slideGrid(this.grid, direction);
    if (!outcome.moved) {
      return {
        moved: false,
        direction,
        scoreDelta: 0,
        merges: 0,
        spawnedIndex: null,
        spawnedValue: null,
        mergedIndices: [],
        transitions: [],
        reached2048: false,
        status: this.status,
      };
    }

    // Push snapshot prior to mutating state so undo restores exact previous turn.
    this.undoStack.push({
      grid: [...this.grid],
      score: this.score,
      moves: this.moves,
      mergeStreak: this.mergeStreak,
      status: this.status,
      hasWon2048: this.hasWon2048,
      mode: this.mode,
      lastSpawnIndex: this.lastSpawnIndex,
      lastMergedIndices: [...this.lastMergedIndices],
    });

    this.grid = outcome.grid;
    this.score += outcome.scoreDelta;
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    this.moves += 1;
    this.mergeStreak = outcome.merges > 0 ? this.mergeStreak + 1 : 0;
    this.lastMergedIndices = [...outcome.mergedIndices];
    this.lastTransitions = outcome.transitions;

    const spawned = this.spawnRandomTile();
    this.lastSpawnIndex = spawned?.index ?? null;

    const bestTile = getBestTile(this.grid);
    let reached2048 = false;
    if (!this.hasWon2048 && bestTile >= WIN_TILE_VALUE) {
      this.hasWon2048 = true;
      reached2048 = true;
    }

    if (reached2048 && this.mode === 'classic') {
      this.status = 'won';
    } else if (!hasAnyLegalMove(this.grid)) {
      this.status = 'gameover';
    } else {
      this.status = 'playing';
    }

    return {
      moved: true,
      direction,
      scoreDelta: outcome.scoreDelta,
      merges: outcome.merges,
      spawnedIndex: spawned?.index ?? null,
      spawnedValue: spawned?.value ?? null,
      mergedIndices: [...outcome.mergedIndices],
      transitions: outcome.transitions,
      reached2048,
      status: this.status,
    };
  }

  /**
   * Restores the previous turn's grid, score, moves, merge streak, and status.
   */
  public undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    this.grid = [...entry.grid];
    this.score = entry.score;
    this.moves = entry.moves;
    this.mergeStreak = entry.mergeStreak;
    this.status = entry.status;
    this.hasWon2048 = entry.hasWon2048;
    this.mode = entry.mode;
    this.lastSpawnIndex = entry.lastSpawnIndex;
    this.lastMergedIndices = [...entry.lastMergedIndices];
    this.lastTransitions = [];
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getGrid(): number[] {
    return [...this.grid];
  }

  public getMatrix(): number[][] {
    const matrix: number[][] = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
      matrix.push(this.grid.slice(r * GRID_SIZE, (r + 1) * GRID_SIZE));
    }
    return matrix;
  }

  public getScore(): number {
    return this.score;
  }

  public getHighScore(): number {
    return this.highScore;
  }

  public getBestTile(): number {
    return getBestTile(this.grid);
  }

  public getMoves(): number {
    return this.moves;
  }

  public getMergeStreak(): number {
    return this.mergeStreak;
  }

  public getMode(): GameMode {
    return this.mode;
  }

  public getStatus(): GameStatus {
    return this.status;
  }

  public hasReached2048(): boolean {
    return this.hasWon2048;
  }

  /**
   * Runs a 2-ply expectimax search over legal moves, returning the optimal move
   * and rationale, or `null` when the board is locked.
   */
  public getBestMoveHint(): MoveHint | null {
    const beforeBest = getBestTile(this.grid);
    let bestDir: Direction | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestOutcome: SlideOutcome | null = null;

    for (const dir of ALL_DIRECTIONS) {
      const outcome = slideGrid(this.grid, dir);
      if (!outcome.moved) {
        continue;
      }

      const afterBest = getBestTile(outcome.grid);
      const immediateWinBonus =
        beforeBest < WIN_TILE_VALUE && afterBest >= WIN_TILE_VALUE ? 1_000_000 : 0;

      const emptyIndices = getEmptyIndices(outcome.grid);
      let expectedValue: number;

      if (emptyIndices.length === 0) {
        expectedValue = evaluateSecondPlyBest(outcome.grid);
      } else {
        let weightedSum = 0;
        const probeGrid = [...outcome.grid];

        for (const cellIdx of emptyIndices) {
          probeGrid[cellIdx] = 2;
          const v2 = evaluateSecondPlyBest(probeGrid);
          probeGrid[cellIdx] = 4;
          const v4 = evaluateSecondPlyBest(probeGrid);
          probeGrid[cellIdx] = 0;

          weightedSum += 0.9 * v2 + 0.1 * v4;
        }
        expectedValue = weightedSum / emptyIndices.length;
      }

      const totalScore = expectedValue + outcome.scoreDelta * 0.55 + immediateWinBonus;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestDir = dir;
        bestOutcome = outcome;
      }
    }

    if (!bestDir || !bestOutcome) {
      return null;
    }

    return {
      direction: bestDir,
      score: Math.round(bestScore),
      reason: buildHintReason(this.grid, bestOutcome),
    };
  }

  /**
   * Computes 2048 Win Forecast & Board Health telemetry.
   */
  public getWinForecast(): WinForecast {
    const metrics = analyzeBoardMetrics(this.grid);

    if (metrics.legalMoves === 0 || this.status === 'gameover') {
      return {
        label: 'GRID LOCKED',
        percent: 0,
        detail: `No slides or merges remain — peak tile ${metrics.bestTile}.`,
      };
    }

    if (this.status === 'won' || metrics.bestTile >= WIN_TILE_VALUE) {
      return {
        label: '2048 REACHED',
        percent: 100,
        detail:
          metrics.bestTile > WIN_TILE_VALUE
            ? `Hyper tier ${metrics.bestTile} active — ${metrics.emptyCount} open cells for endless climb.`
            : `2048 milestone reached with ${metrics.emptyCount} open cell${metrics.emptyCount === 1 ? '' : 's'}!`,
      };
    }

    // Compute normalized health score (0..100) for boards below 2048.
    const emptyFactor = clamp(metrics.emptyCount / 8, 0, 1); // 8+ empty cells => full space score
    const progressFactor = clamp((metrics.maxRank - 1) / 10, 0, 1); // 2 (rank 1) .. 1024 (rank 10)
    const mobilityFactor = clamp(metrics.legalMoves / 4, 0, 1);
    const mergeBonus = clamp(metrics.adjacentMatches * 4.5, 0, 14);
    const smoothnessPenalty = clamp(metrics.smoothnessPenalty * 0.8, 0, 14);
    const cornerBonus = metrics.bestCornerAnchored ? 9 : metrics.bestInCenter ? -10 : 0;

    let raw =
      emptyFactor * 42 +
      metrics.snakeRatio * 22 +
      metrics.monotonicityRatio * 14 +
      progressFactor * (14 * (0.35 + 0.65 * emptyFactor)) +
      mobilityFactor * 8 +
      mergeBonus +
      cornerBonus -
      smoothnessPenalty;

    // Critical pressure caps when board is completely full or down to 1 tight slot.
    if (metrics.emptyCount === 0) {
      raw = Math.min(raw, 18 + Math.min(4, metrics.adjacentMatches * 2));
    } else if (metrics.emptyCount === 1 && metrics.adjacentMatches <= 1 && metrics.legalMoves <= 2) {
      raw = Math.min(raw, 21);
    }

    const percent = Math.round(clamp(raw, 4, 98));

    let label: ForecastLabel;
    if (percent >= 82) {
      label = 'LOCKED IN';
    } else if (percent >= 65) {
      label = 'STRONG FLOW';
    } else if (percent >= 42) {
      label = 'BALANCED';
    } else if (percent >= 23) {
      label = 'TIGHT GRID';
    } else {
      label = 'CRITICAL';
    }

    const cornerNote = metrics.bestCornerAnchored
      ? `${metrics.bestTile} corner-anchored`
      : `peak ${metrics.bestTile}`;
    const detail = `${metrics.emptyCount} open cell${metrics.emptyCount === 1 ? '' : 's'} · ${cornerNote} · ${metrics.adjacentMatches} ready merge${metrics.adjacentMatches === 1 ? '' : 's'}.`;

    return {
      label,
      percent,
      detail,
    };
  }

  public getSnapshot(): Game2048Snapshot {
    return {
      grid: [...this.grid],
      score: this.score,
      highScore: this.highScore,
      bestTile: getBestTile(this.grid),
      moves: this.moves,
      mergeStreak: this.mergeStreak,
      mode: this.mode,
      status: this.status,
      hasWon2048: this.hasWon2048,
      canUndo: this.undoStack.length > 0,
      undoCount: this.undoStack.length,
      emptyCount: getEmptyIndices(this.grid).length,
      lastSpawnIndex: this.lastSpawnIndex,
      lastMergedIndices: [...this.lastMergedIndices],
      lastTransitions: [...this.lastTransitions],
      forecast: this.getWinForecast(),
    };
  }

  private spawnRandomTile(): { index: number; value: 2 | 4 } | null {
    const empty = getEmptyIndices(this.grid);
    if (empty.length === 0) {
      return null;
    }

    const pickRoll = clamp(this.rng(), 0, 0.999999999);
    const chosenCell = empty[Math.floor(pickRoll * empty.length)];
    const valueRoll = this.rng();
    const value: 2 | 4 = valueRoll < 0.9 ? 2 : 4;

    this.grid[chosenCell] = value;
    return { index: chosenCell, value };
  }
}
