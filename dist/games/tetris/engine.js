/**
 * Pure TypeScript Tetris ("Tetromino Overdrive") game engine.
 * Zero DOM or Canvas dependencies so Node unit tests run cleanly.
 */
export const BOARD_COLS = 10;
export const BOARD_ROWS = 20;
export const BUFFER_ROWS = 4;
export const TOTAL_ROWS = BOARD_ROWS + BUFFER_ROWS;
export const VICTORY_SCORE_TARGET = 10_000;
export const LINES_PER_LEVEL = 10;
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;
export const ALL_TETROMINO_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const PIECE_COLORS = {
    I: '#00f5ff',
    O: '#fbbf24',
    T: '#c084fc',
    S: '#10b981',
    Z: '#fb7185',
    J: '#3b82f6',
    L: '#fb923c',
};
const SHAPES = {
    I: [
        [
            [0, 0, 0, 0],
            [1, 1, 1, 1],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        [
            [0, 0, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 0],
        ],
        [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [1, 1, 1, 1],
            [0, 0, 0, 0],
        ],
        [
            [0, 1, 0, 0],
            [0, 1, 0, 0],
            [0, 1, 0, 0],
            [0, 1, 0, 0],
        ],
    ],
    O: [
        [
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        [
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        [
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        [
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
    ],
    T: [
        [
            [0, 1, 0],
            [1, 1, 1],
            [0, 0, 0],
        ],
        [
            [0, 1, 0],
            [0, 1, 1],
            [0, 1, 0],
        ],
        [
            [0, 0, 0],
            [1, 1, 1],
            [0, 1, 0],
        ],
        [
            [0, 1, 0],
            [1, 1, 0],
            [0, 1, 0],
        ],
    ],
    S: [
        [
            [0, 1, 1],
            [1, 1, 0],
            [0, 0, 0],
        ],
        [
            [0, 1, 0],
            [0, 1, 1],
            [0, 0, 1],
        ],
        [
            [0, 0, 0],
            [0, 1, 1],
            [1, 1, 0],
        ],
        [
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0],
        ],
    ],
    Z: [
        [
            [1, 1, 0],
            [0, 1, 1],
            [0, 0, 0],
        ],
        [
            [0, 0, 1],
            [0, 1, 1],
            [0, 1, 0],
        ],
        [
            [0, 0, 0],
            [1, 1, 0],
            [0, 1, 1],
        ],
        [
            [0, 1, 0],
            [1, 1, 0],
            [1, 0, 0],
        ],
    ],
    J: [
        [
            [1, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
        ],
        [
            [0, 1, 1],
            [0, 1, 0],
            [0, 1, 0],
        ],
        [
            [0, 0, 0],
            [1, 1, 1],
            [0, 0, 1],
        ],
        [
            [0, 1, 0],
            [0, 1, 0],
            [1, 1, 0],
        ],
    ],
    L: [
        [
            [0, 0, 1],
            [1, 1, 1],
            [0, 0, 0],
        ],
        [
            [0, 1, 0],
            [0, 1, 0],
            [0, 1, 1],
        ],
        [
            [0, 0, 0],
            [1, 1, 1],
            [1, 0, 0],
        ],
        [
            [1, 1, 0],
            [0, 1, 0],
            [0, 1, 0],
        ],
    ],
};
// SRS wall kick offsets in screen coordinates (+x right, +y down).
const JLSTZ_KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const I_KICKS = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};
function createEmptyGrid() {
    return Array.from({ length: TOTAL_ROWS }, () => Array(BOARD_COLS).fill(null));
}
/**
 * Returns the local matrix for a tetromino type and rotation state.
 */
export function getPieceMatrix(type, rotation) {
    return SHAPES[type][rotation];
}
/**
 * Returns absolute board coordinates occupied by the given piece.
 */
export function getPieceCells(piece) {
    const matrix = SHAPES[piece.type][piece.rotation];
    const coords = [];
    for (let r = 0; r < matrix.length; r += 1) {
        const row = matrix[r];
        for (let c = 0; c < row.length; c += 1) {
            if (row[c] === 1) {
                coords.push({ x: piece.x + c, y: piece.y + r });
            }
        }
    }
    return coords;
}
/**
 * Computes gravity drop interval in milliseconds for a given level.
 */
export function getGravityIntervalMs(level) {
    const safeLevel = Math.max(1, Math.floor(level));
    return Math.max(65, Math.round(1000 * Math.pow(0.84, safeLevel - 1)));
}
function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function createEmptyLockResult() {
    return {
        locked: false,
        linesCleared: 0,
        clearedVisibleRows: [],
        scoreDelta: 0,
        tSpin: 'none',
        backToBackApplied: false,
        combo: -1,
        leveledUp: false,
        newLevel: 1,
        victoryUnlocked: false,
        gameOver: false,
        label: '',
    };
}
/**
 * Core Tetris ("Tetromino Overdrive") simulation engine.
 */
export class TetrisEngine {
    rng;
    victoryScore;
    grid = createEmptyGrid();
    status = 'idle';
    score = 0;
    highScore = 0;
    level = 1;
    lines = 0;
    combo = -1;
    backToBack = false;
    victoryReached = false;
    elapsedMs = 0;
    activePiece = null;
    holdPiece = null;
    canHold = true;
    bagQueue = [];
    gravityTimerMs = 0;
    lockTimerMs = 0;
    lockResets = 0;
    lastActionWasRotation = false;
    lastKickIndex = 0;
    clearSequenceId = 0;
    lastClear = null;
    constructor(options = {}) {
        this.rng = options.rng ?? Math.random;
        this.victoryScore = options.victoryScore ?? VICTORY_SCORE_TARGET;
        this.highScore = Math.max(0, Math.floor(options.highScore ?? 0));
        this.ensureQueueFilled(7);
    }
    getStatus() {
        return this.status;
    }
    getScore() {
        return this.score;
    }
    getHighScore() {
        return this.highScore;
    }
    setHighScore(nextHighScore) {
        if (Number.isFinite(nextHighScore) && nextHighScore > this.highScore) {
            this.highScore = Math.floor(nextHighScore);
        }
    }
    getLevel() {
        return this.level;
    }
    getLines() {
        return this.lines;
    }
    getNextQueue(count = 3) {
        this.ensureQueueFilled(Math.max(count, 3));
        return this.bagQueue.slice(0, count);
    }
    getHoldPiece() {
        return this.holdPiece;
    }
    canUseHold() {
        return this.canHold && this.status === 'playing' && this.activePiece !== null;
    }
    getActivePiece() {
        return this.activePiece ? { ...this.activePiece } : null;
    }
    /**
     * Returns a deep copy of the 20x10 visible playfield (row 0 = top, row 19 = bottom).
     */
    getVisibleGrid() {
        return this.grid
            .slice(BUFFER_ROWS, TOTAL_ROWS)
            .map((row) => row.slice());
    }
    /**
     * Starts a game from idle, restarts after gameover, or resumes when paused.
     */
    start() {
        if (this.status === 'playing') {
            return;
        }
        if (this.status === 'paused') {
            this.status = 'playing';
            return;
        }
        if (this.status === 'gameover') {
            this.reset();
        }
        this.status = 'playing';
        if (!this.activePiece) {
            this.spawnNextPiece();
        }
    }
    /**
     * Resets the playfield and scores back to clean idle state while preserving high score.
     */
    reset() {
        this.grid = createEmptyGrid();
        this.status = 'idle';
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.combo = -1;
        this.backToBack = false;
        this.victoryReached = false;
        this.elapsedMs = 0;
        this.activePiece = null;
        this.holdPiece = null;
        this.canHold = true;
        this.bagQueue = [];
        this.gravityTimerMs = 0;
        this.lockTimerMs = 0;
        this.lockResets = 0;
        this.lastActionWasRotation = false;
        this.lastKickIndex = 0;
        this.lastClear = null;
        this.ensureQueueFilled(7);
    }
    /**
     * Toggles between playing and paused states.
     */
    togglePause() {
        if (this.status === 'playing') {
            this.status = 'paused';
        }
        else if (this.status === 'paused') {
            this.status = 'playing';
        }
        return this.status;
    }
    moveLeft() {
        return this.tryMove(-1, 0);
    }
    moveRight() {
        return this.tryMove(1, 0);
    }
    softDrop() {
        if (this.status !== 'playing' || !this.activePiece) {
            return false;
        }
        const moved = this.tryMove(0, 1);
        if (moved) {
            this.addScore(1);
            this.gravityTimerMs = 0;
            this.lastActionWasRotation = false;
        }
        return moved;
    }
    hardDrop() {
        if (this.status !== 'playing' || !this.activePiece) {
            return { ...createEmptyLockResult(), droppedCells: 0 };
        }
        let droppedCells = 0;
        while (this.canPlace(this.activePiece, 0, 1)) {
            this.activePiece.y += 1;
            droppedCells += 1;
        }
        if (droppedCells > 0) {
            this.addScore(droppedCells * 2);
            this.lastActionWasRotation = false;
        }
        const lockResult = this.lockActivePiece();
        return {
            ...lockResult,
            droppedCells,
        };
    }
    rotateCW() {
        return this.tryRotate(1);
    }
    rotateCCW() {
        return this.tryRotate(-1);
    }
    /**
     * Swaps the active piece with the hold slot (once per piece drop).
     */
    hold() {
        if (this.status !== 'playing' || !this.activePiece || !this.canHold) {
            return false;
        }
        const currentType = this.activePiece.type;
        if (this.holdPiece === null) {
            this.holdPiece = currentType;
            this.spawnNextPiece();
        }
        else {
            const nextType = this.holdPiece;
            this.holdPiece = currentType;
            this.spawnPieceType(nextType);
        }
        this.canHold = false;
        this.lastActionWasRotation = false;
        return true;
    }
    /**
     * Advances one discrete gravity step: moves down 1 row or locks immediately if grounded.
     */
    stepGravity() {
        if (this.status !== 'playing' || !this.activePiece) {
            return { movedDown: false, locked: false, clearResult: null };
        }
        if (this.canPlace(this.activePiece, 0, 1)) {
            this.activePiece.y += 1;
            this.lastActionWasRotation = false;
            this.lockTimerMs = 0;
            return { movedDown: true, locked: false, clearResult: null };
        }
        const clearResult = this.lockActivePiece();
        return { movedDown: false, locked: true, clearResult };
    }
    /**
     * Advances simulation timers by `dtMs` milliseconds (60fps frame loop compatible).
     */
    tick(dtMs) {
        if (this.status !== 'playing' || !this.activePiece || !Number.isFinite(dtMs) || dtMs <= 0) {
            return { movedDown: false, locked: false, clearResult: null };
        }
        let remaining = dtMs;
        this.elapsedMs += dtMs;
        let movedDown = false;
        let locked = false;
        let clearResult = null;
        while (remaining > 0 && this.status === 'playing' && this.activePiece) {
            const step = Math.min(remaining, 16);
            remaining -= step;
            if (this.canPlace(this.activePiece, 0, 1)) {
                this.lockTimerMs = 0;
                this.gravityTimerMs += step;
                const interval = getGravityIntervalMs(this.level);
                while (this.gravityTimerMs >= interval &&
                    this.activePiece &&
                    this.canPlace(this.activePiece, 0, 1)) {
                    this.gravityTimerMs -= interval;
                    this.activePiece.y += 1;
                    this.lastActionWasRotation = false;
                    movedDown = true;
                }
            }
            else {
                this.gravityTimerMs = 0;
                this.lockTimerMs += step;
                if (this.lockTimerMs >= LOCK_DELAY_MS) {
                    clearResult = this.lockActivePiece();
                    locked = true;
                    break;
                }
            }
        }
        return { movedDown, locked, clearResult };
    }
    /**
     * Returns projected ghost piece at the lowest non-colliding row.
     */
    getGhostPiece() {
        if (!this.activePiece) {
            return null;
        }
        const ghost = { ...this.activePiece };
        while (this.canPlace(ghost, 0, 1)) {
            ghost.y += 1;
        }
        return ghost;
    }
    /**
     * Computes structural metrics on the visible 10x20 locked stack.
     */
    getBoardStats() {
        const columnHeights = Array(BOARD_COLS).fill(0);
        let holes = 0;
        for (let col = 0; col < BOARD_COLS; col += 1) {
            let topRow = -1;
            for (let row = 0; row < BOARD_ROWS; row += 1) {
                if (this.grid[row + BUFFER_ROWS][col] !== null) {
                    if (topRow === -1) {
                        topRow = row;
                    }
                }
                else if (topRow !== -1) {
                    holes += 1;
                }
            }
            columnHeights[col] = topRow === -1 ? 0 : BOARD_ROWS - topRow;
        }
        let maxHeight = 0;
        let aggregateHeight = 0;
        let bumpiness = 0;
        for (let col = 0; col < BOARD_COLS; col += 1) {
            const h = columnHeights[col];
            aggregateHeight += h;
            if (h > maxHeight) {
                maxHeight = h;
            }
            if (col < BOARD_COLS - 1) {
                bumpiness += Math.abs(h - columnHeights[col + 1]);
            }
        }
        return {
            maxHeight,
            aggregateHeight,
            holes,
            bumpiness,
            columnHeights,
        };
    }
    /**
     * Evaluates survival outlook and progress toward the 10,000-pt Victory Rank.
     */
    getSurvivalForecast() {
        const metrics = this.getBoardStats();
        if (this.status === 'gameover') {
            return {
                label: 'GAME OVER',
                percent: 0,
                detail: this.victoryReached
                    ? `Run ended after Victory Rank (${this.score.toLocaleString()} pts).`
                    : `Topped out at ${this.score.toLocaleString()} pts — reset to play again.`,
                metrics,
            };
        }
        if (this.victoryReached || this.score >= this.victoryScore) {
            return {
                label: 'VICTORY',
                percent: 100,
                detail: `Victory Rank unlocked (${this.score.toLocaleString()} pts)! Endless high-score chase active.`,
                metrics,
            };
        }
        const avgHeight = metrics.aggregateHeight / BOARD_COLS;
        const heightPenalty = Math.max(0, metrics.maxHeight - 4) * 2.4 + Math.max(0, metrics.maxHeight - 11) * 3.2;
        const avgHeightPenalty = Math.max(0, avgHeight - 3) * 1.4;
        const holePenalty = metrics.holes * 4.5;
        const bumpinessPenalty = Math.max(0, metrics.bumpiness - 4) * 0.8;
        const totalPenalty = heightPenalty + avgHeightPenalty + holePenalty + bumpinessPenalty;
        const healthFactor = clampNumber(1 - totalPenalty / 80, 0, 1);
        const scoreProgress = clampNumber(this.score / this.victoryScore, 0, 1);
        const scoreBonus = 18 * scoreProgress * healthFactor;
        const rawPercent = 80 - totalPenalty + scoreBonus;
        const percent = Math.round(clampNumber(rawPercent, 4, 99));
        let label;
        let detail;
        if (percent >= 85) {
            label = 'DOMINATING';
            detail = `Clean stack (${metrics.holes} holes, max ${metrics.maxHeight} rows) — surging toward ${this.victoryScore.toLocaleString()} pts.`;
        }
        else if (percent >= 60) {
            label = 'ON TRACK';
            detail = `Balanced grid (height ${metrics.maxHeight}, ${metrics.holes} holes) — ${Math.round(scoreProgress * 100)}% to Victory Rank.`;
        }
        else if (percent >= 35) {
            label = 'PRESSURE';
            detail = `Stack rising (height ${metrics.maxHeight}, ${metrics.holes} holes) — prioritize clearing lines.`;
        }
        else {
            label = 'CRITICAL';
            detail = `Danger zone! Height ${metrics.maxHeight}, ${metrics.holes} buried holes — clear rows immediately.`;
        }
        return {
            label,
            percent,
            detail,
            metrics,
        };
    }
    /**
     * Returns a full read-only snapshot for the renderer and HUD.
     */
    getSnapshot() {
        return {
            status: this.status,
            score: this.score,
            highScore: this.highScore,
            level: this.level,
            lines: this.lines,
            combo: this.combo,
            backToBack: this.backToBack,
            victoryReached: this.victoryReached,
            elapsedMs: this.elapsedMs,
            grid: this.getVisibleGrid(),
            activePiece: this.getActivePiece(),
            ghostPiece: this.getGhostPiece(),
            holdPiece: this.holdPiece,
            canHold: this.canUseHold(),
            nextQueue: this.getNextQueue(3),
            forecast: this.getSurvivalForecast(),
            lastClear: this.lastClear ? { ...this.lastClear, clearedVisibleRows: [...this.lastClear.clearedVisibleRows] } : null,
        };
    }
    /**
     * Loads a 20x10 visible grid state (primarily for deterministic unit testing).
     */
    loadVisibleGrid(visibleRows) {
        if (visibleRows.length !== BOARD_ROWS) {
            throw new Error(`Expected ${BOARD_ROWS} rows, received ${visibleRows.length}`);
        }
        this.grid = createEmptyGrid();
        for (let r = 0; r < BOARD_ROWS; r += 1) {
            const row = visibleRows[r];
            if (row.length !== BOARD_COLS) {
                throw new Error(`Expected ${BOARD_COLS} columns in row ${r}, received ${row.length}`);
            }
            this.grid[r + BUFFER_ROWS] = row.slice();
        }
    }
    /**
     * Places a specific active piece (primarily for deterministic unit testing).
     */
    setActivePiece(piece) {
        if (!this.canPlace(piece, 0, 0)) {
            return false;
        }
        this.activePiece = { ...piece };
        this.gravityTimerMs = 0;
        this.lockTimerMs = 0;
        this.lockResets = 0;
        this.lastActionWasRotation = false;
        return true;
    }
    /**
     * Replaces upcoming pieces in the lookahead queue (primarily for deterministic unit testing).
     */
    setNextQueueForTest(types) {
        this.bagQueue = types.slice();
        this.ensureQueueFilled(7);
    }
    tryMove(dx, dy) {
        if (this.status !== 'playing' || !this.activePiece) {
            return false;
        }
        if (!this.canPlace(this.activePiece, dx, dy)) {
            return false;
        }
        this.activePiece.x += dx;
        this.activePiece.y += dy;
        this.lastActionWasRotation = false;
        if (dx !== 0) {
            this.refreshLockDelay();
        }
        return true;
    }
    tryRotate(dir) {
        if (this.status !== 'playing' || !this.activePiece) {
            return false;
        }
        const piece = this.activePiece;
        const fromRot = piece.rotation;
        const toRot = (((fromRot + dir) % 4 + 4) % 4);
        if (piece.type === 'O') {
            piece.rotation = toRot;
            this.lastActionWasRotation = true;
            this.lastKickIndex = 0;
            this.refreshLockDelay();
            return true;
        }
        const key = `${fromRot}>${toRot}`;
        const kicks = piece.type === 'I' ? I_KICKS[key] : JLSTZ_KICKS[key];
        const candidate = {
            type: piece.type,
            x: piece.x,
            y: piece.y,
            rotation: toRot,
        };
        for (let i = 0; i < kicks.length; i += 1) {
            const [kx, ky] = kicks[i];
            if (this.canPlace(candidate, kx, ky)) {
                piece.x += kx;
                piece.y += ky;
                piece.rotation = toRot;
                this.lastActionWasRotation = true;
                this.lastKickIndex = i;
                this.refreshLockDelay();
                return true;
            }
        }
        return false;
    }
    refreshLockDelay() {
        if (this.activePiece && !this.canPlace(this.activePiece, 0, 1) && this.lockResets < MAX_LOCK_RESETS) {
            this.lockTimerMs = 0;
            this.lockResets += 1;
        }
    }
    canPlace(piece, dx, dy) {
        const matrix = SHAPES[piece.type][piece.rotation];
        for (let r = 0; r < matrix.length; r += 1) {
            const row = matrix[r];
            for (let c = 0; c < row.length; c += 1) {
                if (row[c] !== 1) {
                    continue;
                }
                const nx = piece.x + c + dx;
                const ny = piece.y + r + dy;
                if (nx < 0 || nx >= BOARD_COLS || ny >= BOARD_ROWS || ny < -BUFFER_ROWS) {
                    return false;
                }
                if (this.grid[ny + BUFFER_ROWS][nx] !== null) {
                    return false;
                }
            }
        }
        return true;
    }
    detectTSpin(piece) {
        if (piece.type !== 'T' || !this.lastActionWasRotation) {
            return 'none';
        }
        const corners = [
            [piece.x, piece.y],
            [piece.x + 2, piece.y],
            [piece.x, piece.y + 2],
            [piece.x + 2, piece.y + 2],
        ];
        let filledCorners = 0;
        const cornerOccupied = [];
        for (const [cx, cy] of corners) {
            const occupied = cx < 0 ||
                cx >= BOARD_COLS ||
                cy >= BOARD_ROWS ||
                cy < -BUFFER_ROWS ||
                this.grid[cy + BUFFER_ROWS][cx] !== null;
            cornerOccupied.push(occupied);
            if (occupied) {
                filledCorners += 1;
            }
        }
        if (filledCorners < 3) {
            return 'none';
        }
        // Front two corners depend on T rotation state.
        let frontA = false;
        let frontB = false;
        if (piece.rotation === 0) {
            frontA = cornerOccupied[0];
            frontB = cornerOccupied[1];
        }
        else if (piece.rotation === 1) {
            frontA = cornerOccupied[1];
            frontB = cornerOccupied[3];
        }
        else if (piece.rotation === 2) {
            frontA = cornerOccupied[2];
            frontB = cornerOccupied[3];
        }
        else {
            frontA = cornerOccupied[0];
            frontB = cornerOccupied[2];
        }
        if ((frontA && frontB) || this.lastKickIndex === 4) {
            return 'full';
        }
        return 'mini';
    }
    lockActivePiece() {
        if (!this.activePiece) {
            return createEmptyLockResult();
        }
        const piece = this.activePiece;
        const tSpin = this.detectTSpin(piece);
        const cells = getPieceCells(piece);
        let allAboveVisible = true;
        for (const cell of cells) {
            if (cell.y >= 0) {
                allAboveVisible = false;
            }
            if (cell.y >= -BUFFER_ROWS && cell.y < BOARD_ROWS && cell.x >= 0 && cell.x < BOARD_COLS) {
                this.grid[cell.y + BUFFER_ROWS][cell.x] = piece.type;
            }
        }
        this.activePiece = null;
        this.gravityTimerMs = 0;
        this.lockTimerMs = 0;
        this.lockResets = 0;
        this.lastActionWasRotation = false;
        if (allAboveVisible) {
            this.status = 'gameover';
            return {
                ...createEmptyLockResult(),
                locked: true,
                tSpin,
                newLevel: this.level,
                gameOver: true,
                label: 'LOCK OUT',
            };
        }
        const clearedVisibleRows = [];
        const remainingRows = [];
        for (let r = 0; r < TOTAL_ROWS; r += 1) {
            const row = this.grid[r];
            const isFull = row.every((cell) => cell !== null);
            if (isFull) {
                const visibleRow = r - BUFFER_ROWS;
                if (visibleRow >= 0) {
                    clearedVisibleRows.push(visibleRow);
                }
            }
            else {
                remainingRows.push(row);
            }
        }
        const linesCleared = TOTAL_ROWS - remainingRows.length;
        while (remainingRows.length < TOTAL_ROWS) {
            remainingRows.unshift(Array(BOARD_COLS).fill(null));
        }
        this.grid = remainingRows;
        const currentLevel = this.level;
        let basePoints = 0;
        let isDifficult = false;
        let clearTitle = '';
        if (tSpin === 'full') {
            if (linesCleared === 0) {
                basePoints = 400 * currentLevel;
                clearTitle = 'T-SPIN';
            }
            else if (linesCleared === 1) {
                basePoints = 800 * currentLevel;
                isDifficult = true;
                clearTitle = 'T-SPIN SINGLE';
            }
            else if (linesCleared === 2) {
                basePoints = 1200 * currentLevel;
                isDifficult = true;
                clearTitle = 'T-SPIN DOUBLE';
            }
            else {
                basePoints = 1600 * currentLevel;
                isDifficult = true;
                clearTitle = 'T-SPIN TRIPLE';
            }
        }
        else if (tSpin === 'mini') {
            if (linesCleared === 0) {
                basePoints = 100 * currentLevel;
                clearTitle = 'T-SPIN MINI';
            }
            else if (linesCleared === 1) {
                basePoints = 200 * currentLevel;
                isDifficult = true;
                clearTitle = 'T-SPIN MINI SINGLE';
            }
            else {
                basePoints = 400 * currentLevel;
                isDifficult = true;
                clearTitle = 'T-SPIN MINI DOUBLE';
            }
        }
        else if (linesCleared === 1) {
            basePoints = 100 * currentLevel;
            clearTitle = 'SINGLE';
        }
        else if (linesCleared === 2) {
            basePoints = 300 * currentLevel;
            clearTitle = 'DOUBLE';
        }
        else if (linesCleared === 3) {
            basePoints = 500 * currentLevel;
            clearTitle = 'TRIPLE';
        }
        else if (linesCleared >= 4) {
            basePoints = 800 * currentLevel;
            isDifficult = true;
            clearTitle = 'TETRIS!';
        }
        let backToBackApplied = false;
        if (linesCleared > 0) {
            if (isDifficult && this.backToBack) {
                basePoints = Math.floor(basePoints * 1.5);
                backToBackApplied = true;
            }
            this.backToBack = isDifficult;
            this.combo += 1;
        }
        else {
            this.combo = -1;
        }
        const comboBonus = this.combo > 0 ? 50 * this.combo * currentLevel : 0;
        const scoreDelta = basePoints + comboBonus;
        const prevVictory = this.victoryReached;
        if (scoreDelta > 0) {
            this.addScore(scoreDelta);
        }
        this.lines += linesCleared;
        const nextLevel = 1 + Math.floor(this.lines / LINES_PER_LEVEL);
        const leveledUp = nextLevel > this.level;
        this.level = nextLevel;
        const victoryUnlocked = !prevVictory && this.victoryReached;
        if (linesCleared > 0 || tSpin !== 'none') {
            const parts = [];
            if (backToBackApplied) {
                parts.push('B2B');
            }
            if (clearTitle) {
                parts.push(clearTitle);
            }
            if (this.combo > 0) {
                parts.push(`COMBO x${this.combo}`);
            }
            const label = parts.join(' · ');
            this.clearSequenceId += 1;
            this.lastClear = {
                id: this.clearSequenceId,
                linesCleared,
                clearedVisibleRows,
                scoreDelta,
                tSpin,
                backToBackApplied,
                combo: this.combo,
                label,
            };
        }
        this.canHold = true;
        const spawned = this.spawnNextPiece();
        return {
            locked: true,
            linesCleared,
            clearedVisibleRows,
            scoreDelta,
            tSpin,
            backToBackApplied,
            combo: this.combo,
            leveledUp,
            newLevel: this.level,
            victoryUnlocked,
            gameOver: !spawned,
            label: this.lastClear && linesCleared > 0 ? this.lastClear.label : clearTitle,
        };
    }
    addScore(points) {
        this.score += points;
        if (this.score > this.highScore) {
            this.highScore = this.score;
        }
        if (this.score >= this.victoryScore) {
            this.victoryReached = true;
        }
    }
    spawnNextPiece() {
        this.ensureQueueFilled(7);
        const nextType = this.bagQueue.shift();
        this.ensureQueueFilled(7);
        return this.spawnPieceType(nextType);
    }
    spawnPieceType(type) {
        const spawnY = type === 'I' ? -1 : 0;
        const piece = {
            type,
            x: 3,
            y: spawnY,
            rotation: 0,
        };
        if (!this.canPlace(piece, 0, 0)) {
            this.activePiece = null;
            this.status = 'gameover';
            return false;
        }
        this.activePiece = piece;
        this.gravityTimerMs = 0;
        this.lockTimerMs = 0;
        this.lockResets = 0;
        this.lastActionWasRotation = false;
        this.lastKickIndex = 0;
        return true;
    }
    ensureQueueFilled(minSize) {
        while (this.bagQueue.length < minSize) {
            const bag = ALL_TETROMINO_TYPES.slice();
            for (let i = bag.length - 1; i > 0; i -= 1) {
                const j = Math.floor(this.rng() * (i + 1));
                const tmp = bag[i];
                bag[i] = bag[j];
                bag[j] = tmp;
            }
            this.bagQueue.push(...bag);
        }
    }
}
//# sourceMappingURL=engine.js.map