/**
 * Pure TypeScript Tic-Tac-Toe game engine ("Neural Grid Duel").
 * Zero DOM dependencies so it executes cleanly in both Browser ESM and Node tests.
 */
export const HUMAN_SYMBOL = 'X';
export const AI_SYMBOL = 'O';
/**
 * All 8 winning 3-in-a-row lines across the 3x3 board (indices 0..8).
 */
export const WINNING_LINES = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Main diagonal
    [2, 4, 6], // Anti-diagonal
];
/**
 * Creates a fresh 9-cell empty board.
 */
export function createEmptyBoard() {
    return Array(9).fill(null);
}
/**
 * Returns a shallow copy of a board array.
 */
export function cloneBoard(board) {
    return board.slice(0, 9);
}
/**
 * Returns the opposing player symbol.
 */
export function getOpponent(player) {
    return player === 'X' ? 'O' : 'X';
}
/**
 * Checks all 8 winning lines and returns the first matched line, or null.
 */
export function checkWinner(board) {
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
export function getAvailableMoves(board) {
    const moves = [];
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
export function isBoardFull(board) {
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
    board = createEmptyBoard();
    status = 'idle';
    firstMover = HUMAN_SYMBOL;
    currentTurn = HUMAN_SYMBOL;
    winner = null;
    winningLine = null;
    winningLineIndex = null;
    moveHistory = [];
    matchGeneration = 0;
    scores = {
        playerWins: 0,
        draws: 0,
        aiWins: 0,
        streak: 0,
        bestStreak: 0,
    };
    constructor(firstMover = HUMAN_SYMBOL) {
        this.firstMover = firstMover;
        this.currentTurn = firstMover;
    }
    /**
     * Starts a fresh active match, incrementing `matchGeneration` to invalidate stale AI callbacks.
     */
    start(firstMover) {
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
    reset(options) {
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
    setFirstMover(firstMover) {
        this.firstMover = firstMover;
        if (this.status === 'idle') {
            this.currentTurn = firstMover;
        }
    }
    /**
     * Attempts to place a mark at `cellIndex` (0..8) for the active turn.
     */
    playMove(cellIndex, expectedPlayer) {
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
            }
            else {
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
    getBoard() {
        return cloneBoard(this.board);
    }
    getStatus() {
        return this.status;
    }
    getCurrentTurn() {
        return this.currentTurn;
    }
    getFirstMover() {
        return this.firstMover;
    }
    getWinner() {
        return this.winner;
    }
    getWinningLine() {
        return this.winningLine;
    }
    getWinningLineIndex() {
        return this.winningLineIndex;
    }
    getMoveCount() {
        return this.moveHistory.length;
    }
    getMoveHistory() {
        return this.moveHistory.slice();
    }
    getMatchGeneration() {
        return this.matchGeneration;
    }
    getScores() {
        return { ...this.scores };
    }
    setScores(next) {
        this.scores = {
            playerWins: typeof next.playerWins === 'number' && next.playerWins >= 0 ? Math.floor(next.playerWins) : this.scores.playerWins,
            draws: typeof next.draws === 'number' && next.draws >= 0 ? Math.floor(next.draws) : this.scores.draws,
            aiWins: typeof next.aiWins === 'number' && next.aiWins >= 0 ? Math.floor(next.aiWins) : this.scores.aiWins,
            streak: typeof next.streak === 'number' && next.streak >= 0 ? Math.floor(next.streak) : this.scores.streak,
            bestStreak: typeof next.bestStreak === 'number' && next.bestStreak >= 0 ? Math.floor(next.bestStreak) : this.scores.bestStreak,
        };
    }
    getSnapshot() {
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
//# sourceMappingURL=engine.js.map