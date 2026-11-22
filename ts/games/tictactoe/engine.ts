/**
 * Pure TypeScript Tic-Tac-Toe game engine ("Neural Grid Duel").
 * Zero DOM dependencies so it executes cleanly in both Browser ESM and Node tests.
 */

export type PlayerSymbol = 'X' | 'O';
export type CellValue = PlayerSymbol | null;
export type GameStatus = 'idle' | 'playing' | 'won' | 'draw';

export const HUMAN_SYMBOL: PlayerSymbol = 'X';
export const AI_SYMBOL: PlayerSymbol = 'O';

/**
 * All 8 winning 3-in-a-row lines across the 3x3 board (indices 0..8).
 */
export const WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], // Top row
  [3, 4, 5], // Middle row
  [6, 7, 8], // Bottom row
  [0, 3, 6], // Left column
  [1, 4, 7], // Middle column
  [2, 5, 8], // Right column
  [0, 4, 8], // Main diagonal
  [2, 4, 6], // Anti-diagonal
] as const;

export interface WinCheckResult {
  winner: PlayerSymbol;
  line: readonly [number, number, number];
  lineIndex: number;
}

export interface ScoreBoard {
  playerWins: number;
  draws: number;
  aiWins: number;
  streak: number;
  bestStreak: number;
}

export interface MoveResult {
  ok: boolean;
  reason?: string;
  status: GameStatus;
  winner: PlayerSymbol | null;
  winningLine: readonly [number, number, number] | null;
  winningLineIndex: number | null;
  moveCount: number;
  nextTurn: PlayerSymbol;
}

export interface ResetOptions {
  resetScores?: boolean;
  firstMover?: PlayerSymbol;
}

export interface GameSnapshot {
  board: CellValue[];
  status: GameStatus;
  currentTurn: PlayerSymbol;
  firstMover: PlayerSymbol;
  winner: PlayerSymbol | null;
  winningLine: readonly [number, number, number] | null;
  winningLineIndex: number | null;
  moveCount: number;
  moveHistory: number[];
  matchGeneration: number;
  scores: ScoreBoard;
}

/**
 * Creates a fresh 9-cell empty board.
 */
export function createEmptyBoard(): CellValue[] {
  return Array<CellValue>(9).fill(null);
}

/**
 * Returns a shallow copy of a board array.
 */
export function cloneBoard(board: readonly CellValue[]): CellValue[] {
  return board.slice(0, 9);
}

/**
 * Returns the opposing player symbol.
 */
export function getOpponent(player: PlayerSymbol): PlayerSymbol {
  return player === 'X' ? 'O' : 'X';
}

/**
 * Checks all 8 winning lines and returns the first matched line, or null.
 */
export function checkWinner(board: readonly CellValue[]): WinCheckResult | null {
  for (let i = 0; i < WINNING_LINES.length; i += 1) {
    const line = WINNING_LINES[i];
    const [a, b, c] = line;
    const cellA = board[a];
    if (cellA !== null && cellA === board[b] && cellA === board[c]) {
      return {
        winner: cellA,
        line,
        lineIndex: i,
      };
    }
  }
  return null;
}

/**
 * Returns indices (0..8) of all currently empty cells.
 */
export function getAvailableMoves(board: readonly CellValue[]): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    if (board[i] === null) {
      moves.push(i);
    }
  }
  return moves;
}

/**
 * Returns true if all 9 cells are occupied.
 */
export function isBoardFull(board: readonly CellValue[]): boolean {
  for (let i = 0; i < 9; i += 1) {
    if (board[i] === null) {
      return false;
    }
  }
  return true;
}

/**
 * Stateful Tic-Tac-Toe match controller with generation tracking for safe async AI cancellation.
 */
export class TicTacToeEngine {
  private board: CellValue[] = createEmptyBoard();
  private status: GameStatus = 'idle';
  private firstMover: PlayerSymbol = HUMAN_SYMBOL;
  private currentTurn: PlayerSymbol = HUMAN_SYMBOL;
  private winner: PlayerSymbol | null = null;
  private winningLine: readonly [number, number, number] | null = null;
  private winningLineIndex: number | null = null;
  private moveHistory: number[] = [];
  private matchGeneration = 0;
  private scores: ScoreBoard = {
    playerWins: 0,
    draws: 0,
    aiWins: 0,
    streak: 0,
    bestStreak: 0,
  };

  constructor(firstMover: PlayerSymbol = HUMAN_SYMBOL) {
    this.firstMover = firstMover;
    this.currentTurn = firstMover;
  }

  /**
   * Starts a fresh active match, incrementing `matchGeneration` to invalidate stale AI callbacks.
   */
  public start(firstMover?: PlayerSymbol): GameSnapshot {
    this.matchGeneration += 1;
    if (firstMover !== undefined) {
      this.firstMover = firstMover;
    }
    this.board = createEmptyBoard();
    this.status = 'playing';
    this.currentTurn = this.firstMover;
    this.winner = null;
    this.winningLine = null;
    this.winningLineIndex = null;
    this.moveHistory = [];
    return this.getSnapshot();
  }

  /**
   * Resets the board back to `idle` ready state and increments `matchGeneration`.
   */
  public reset(options?: ResetOptions): GameSnapshot {
    this.matchGeneration += 1;
    if (options?.firstMover !== undefined) {
      this.firstMover = options.firstMover;
    }
    this.board = createEmptyBoard();
    this.status = 'idle';
    this.currentTurn = this.firstMover;
    this.winner = null;
    this.winningLine = null;
    this.winningLineIndex = null;
    this.moveHistory = [];
    if (options?.resetScores) {
      this.scores = {
        playerWins: 0,
        draws: 0,
        aiWins: 0,
        streak: 0,
        bestStreak: 0,
      };
    }
    return this.getSnapshot();
  }

  /**
   * Configures who moves first. While idle, also updates `currentTurn` immediately.
   */
  public setFirstMover(firstMover: PlayerSymbol): void {
    this.firstMover = firstMover;
    if (this.status === 'idle') {
      this.currentTurn = firstMover;
    }
  }

  /**
   * Attempts to place a mark at `cellIndex` (0..8) for the active turn.
   */
  public playMove(cellIndex: number, expectedPlayer?: PlayerSymbol): MoveResult {
    if (this.status !== 'playing') {
      return {
        ok: false,
        reason: this.status === 'idle' ? 'Match has not started yet.' : 'Match is already finished.',
        status: this.status,
        winner: this.winner,
        winningLine: this.winningLine,
        winningLineIndex: this.winningLineIndex,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) {
      return {
        ok: false,
        reason: 'Cell index must be an integer between 0 and 8.',
        status: this.status,
        winner: this.winner,
        winningLine: this.winningLine,
        winningLineIndex: this.winningLineIndex,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    if (expectedPlayer !== undefined && expectedPlayer !== this.currentTurn) {
      return {
        ok: false,
        reason: `Expected turn for ${this.currentTurn}, not ${expectedPlayer}.`,
        status: this.status,
        winner: this.winner,
        winningLine: this.winningLine,
        winningLineIndex: this.winningLineIndex,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    if (this.board[cellIndex] !== null) {
      return {
        ok: false,
        reason: `Cell ${cellIndex} is already occupied.`,
        status: this.status,
        winner: this.winner,
        winningLine: this.winningLine,
        winningLineIndex: this.winningLineIndex,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    const activePlayer = this.currentTurn;
    this.board[cellIndex] = activePlayer;
    this.moveHistory.push(cellIndex);

    const win = checkWinner(this.board);
    if (win) {
      this.status = 'won';
      this.winner = win.winner;
      this.winningLine = win.line;
      this.winningLineIndex = win.lineIndex;
      if (win.winner === HUMAN_SYMBOL) {
        this.scores.playerWins += 1;
        this.scores.streak += 1;
        this.scores.bestStreak = Math.max(this.scores.bestStreak, this.scores.streak);
      } else {
        this.scores.aiWins += 1;
        this.scores.streak = 0;
      }
      return {
        ok: true,
        status: this.status,
        winner: this.winner,
        winningLine: this.winningLine,
        winningLineIndex: this.winningLineIndex,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    if (isBoardFull(this.board)) {
      this.status = 'draw';
      this.scores.draws += 1;
      this.scores.streak = 0;
      return {
        ok: true,
        status: this.status,
        winner: null,
        winningLine: null,
        winningLineIndex: null,
        moveCount: this.moveHistory.length,
        nextTurn: this.currentTurn,
      };
    }

    this.currentTurn = getOpponent(activePlayer);
    return {
      ok: true,
      status: this.status,
      winner: null,
      winningLine: null,
      winningLineIndex: null,
      moveCount: this.moveHistory.length,
      nextTurn: this.currentTurn,
    };
  }

  public getBoard(): CellValue[] {
    return cloneBoard(this.board);
  }

  public getStatus(): GameStatus {
    return this.status;
  }

  public getCurrentTurn(): PlayerSymbol {
    return this.currentTurn;
  }

  public getFirstMover(): PlayerSymbol {
    return this.firstMover;
  }

  public getWinner(): PlayerSymbol | null {
    return this.winner;
  }

  public getWinningLine(): readonly [number, number, number] | null {
    return this.winningLine;
  }

  public getWinningLineIndex(): number | null {
    return this.winningLineIndex;
  }

  public getMoveCount(): number {
    return this.moveHistory.length;
  }

  public getMoveHistory(): number[] {
    return this.moveHistory.slice();
  }

  public getMatchGeneration(): number {
    return this.matchGeneration;
  }

  public getScores(): ScoreBoard {
    return { ...this.scores };
  }

  public setScores(next: Partial<ScoreBoard>): void {
    this.scores = {
      playerWins: typeof next.playerWins === 'number' && next.playerWins >= 0 ? Math.floor(next.playerWins) : this.scores.playerWins,
      draws: typeof next.draws === 'number' && next.draws >= 0 ? Math.floor(next.draws) : this.scores.draws,
      aiWins: typeof next.aiWins === 'number' && next.aiWins >= 0 ? Math.floor(next.aiWins) : this.scores.aiWins,
      streak: typeof next.streak === 'number' && next.streak >= 0 ? Math.floor(next.streak) : this.scores.streak,
      bestStreak: typeof next.bestStreak === 'number' && next.bestStreak >= 0 ? Math.floor(next.bestStreak) : this.scores.bestStreak,
    };
  }

  public getSnapshot(): GameSnapshot {
    return {
      board: this.getBoard(),
      status: this.status,
      currentTurn: this.currentTurn,
      firstMover: this.firstMover,
      winner: this.winner,
      winningLine: this.winningLine,
      winningLineIndex: this.winningLineIndex,
      moveCount: this.moveHistory.length,
      moveHistory: this.moveHistory.slice(),
      matchGeneration: this.matchGeneration,
      scores: this.getScores(),
    };
  }
}
