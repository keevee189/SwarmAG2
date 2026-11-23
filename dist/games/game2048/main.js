/**
 * Browser UI controller for Hyper 2048 ("Merge Matrix").
 * Wires 4x4 neon glassmorphic tiles, directional/swipe/keyboard controls,
 * 2-ply expectimax hints, Win Forecast telemetry, localStorage best score, and Web Audio SFX.
 */
import { ArcadeAudio, initArcadeHeader } from '../../shared/arcade.js';
import { CELL_COUNT, Game2048Engine, } from './engine.js';
const HIGH_SCORE_STORAGE_KEY = 'nexus-arcade:game2048-highscore';
const SWIPE_THRESHOLD_PX = 24;
const DIRECTION_ARROWS = {
    up: '↑ UP',
    down: '↓ DOWN',
    left: '← LEFT',
    right: '→ RIGHT',
};
function readStoredHighScore() {
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
    }
    catch {
        return 0;
    }
}
function writeStoredHighScore(score) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(Math.floor(score)));
        }
    }
    catch {
        // Ignore storage quota or private-mode restrictions.
    }
}
function forecastFillClass(label) {
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
function requireElement(selector) {
    const el = document.querySelector(selector);
    if (!el) {
        throw new Error(`Missing required Hyper 2048 element: ${selector}`);
    }
    return el;
}
class Game2048Controller {
    engine;
    gridEl;
    cellEls = [];
    statusBannerEl;
    statusTextEl;
    modePillEl;
    gameOverlayEl;
    overlayKickerEl;
    overlayTitleEl;
    overlaySubtitleEl;
    overlayContinueBtn;
    overlayResetBtn;
    startBtn;
    resetBtn;
    undoBtn;
    hintBtn;
    continueBtn;
    modeButtons;
    dpadButtons;
    hintBadgeEl;
    scoreValueEl;
    highScoreValueEl;
    bestTileValueEl;
    movesValueEl;
    mergeStreakValueEl;
    forecastPercentEl;
    forecastFillEl;
    forecastBarEl;
    forecastLabelEl;
    forecastDetailEl;
    persistedHighScore;
    activeHintDir = null;
    pointerSwipeStart = null;
    statusOverride = null;
    constructor() {
        this.persistedHighScore = readStoredHighScore();
        this.engine = new Game2048Engine({
            mode: 'classic',
            highScore: this.persistedHighScore,
        });
        this.gridEl = requireElement('#grid-2048');
        for (let i = 0; i < CELL_COUNT; i += 1) {
            this.cellEls.push(requireElement(`#grid-2048 [data-cell="${i}"]`));
        }
        this.statusBannerEl = requireElement('#status-banner');
        this.statusTextEl = requireElement('#status-text');
        this.modePillEl = requireElement('#mode-pill');
        this.gameOverlayEl = requireElement('#game-overlay');
        this.overlayKickerEl = requireElement('#overlay-kicker');
        this.overlayTitleEl = requireElement('#overlay-title');
        this.overlaySubtitleEl = requireElement('#overlay-subtitle');
        this.overlayContinueBtn = requireElement('#overlay-continue-btn');
        this.overlayResetBtn = requireElement('#overlay-reset-btn');
        this.startBtn = requireElement('#start-btn');
        this.resetBtn = requireElement('#reset-btn');
        this.undoBtn = requireElement('#undo-btn');
        this.hintBtn = requireElement('#hint-btn');
        this.continueBtn = requireElement('#continue-btn');
        this.modeButtons = Array.from(document.querySelectorAll('#mode-control [data-mode]'));
        this.dpadButtons = {
            up: requireElement('#btn-up'),
            down: requireElement('#btn-down'),
            left: requireElement('#btn-left'),
            right: requireElement('#btn-right'),
        };
        this.hintBadgeEl = requireElement('#hint-direction-badge');
        this.scoreValueEl = requireElement('#score-value');
        this.highScoreValueEl = requireElement('#high-score-value');
        this.bestTileValueEl = requireElement('#best-tile-value');
        this.movesValueEl = requireElement('#moves-value');
        this.mergeStreakValueEl = requireElement('#merge-streak-value');
        this.forecastPercentEl = requireElement('#forecast-percent');
        this.forecastFillEl = requireElement('#forecast-fill');
        this.forecastBarEl = this.forecastFillEl.parentElement;
        this.forecastLabelEl = requireElement('#forecast-label');
        this.forecastDetailEl = requireElement('#forecast-detail');
        this.bindEvents();
        this.syncUI(this.engine.getSnapshot(), true);
    }
    bindEvents() {
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
        for (const dir of ['up', 'down', 'left', 'right']) {
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
    handlePointerDown(event) {
        if (event.button !== 0 && event.pointerType === 'mouse') {
            return;
        }
        this.pointerSwipeStart = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        };
    }
    handlePointerUp(event) {
        if (!this.pointerSwipeStart || this.pointerSwipeStart.id !== event.pointerId) {
            return;
        }
        const dx = event.clientX - this.pointerSwipeStart.x;
        const dy = event.clientY - this.pointerSwipeStart.y;
        this.pointerSwipeStart = null;
        if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) {
            return;
        }
        const direction = Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
                ? 'right'
                : 'left'
            : dy > 0
                ? 'down'
                : 'up';
        this.performMove(direction);
    }
    handleKeyDown(event) {
        const target = event.target;
        if (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement) {
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
        let direction = null;
        if (key === 'ArrowUp' || lowerKey === 'w') {
            direction = 'up';
        }
        else if (key === 'ArrowDown' || lowerKey === 's') {
            direction = 'down';
        }
        else if (key === 'ArrowLeft' || lowerKey === 'a') {
            direction = 'left';
        }
        else if (key === 'ArrowRight' || lowerKey === 'd') {
            direction = 'right';
        }
        if (direction) {
            event.preventDefault();
            if (!event.repeat) {
                this.performMove(direction);
            }
        }
    }
    handleStart() {
        this.clearHint();
        this.statusOverride = 'New Hyper 2048 grid initialized — slide to merge tiles!';
        this.engine.start();
        ArcadeAudio.playClick();
        this.gridEl.focus({ preventScroll: true });
        this.syncUI(this.engine.getSnapshot(), true);
    }
    handleReset() {
        this.clearHint();
        this.statusOverride = 'Matrix reset — merge plasma tiles to forge 2048!';
        this.engine.reset();
        ArcadeAudio.playClick();
        this.gridEl.focus({ preventScroll: true });
        this.syncUI(this.engine.getSnapshot(), true);
    }
    handleUndo() {
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
        }
        else {
            ArcadeAudio.playError();
        }
    }
    handleHint() {
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
    handleContinueEndless() {
        this.clearHint();
        if (this.engine.continueEndless()) {
            this.statusOverride = 'Endless Overdrive engaged — climb to 4096, 8192, and beyond!';
            ArcadeAudio.playClick();
            this.gridEl.focus({ preventScroll: true });
            this.syncUI(this.engine.getSnapshot(), false);
        }
    }
    handleModeSelect(mode) {
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
    performMove(direction) {
        if (this.engine.getStatus() !== 'playing') {
            return;
        }
        const result = this.engine.move(direction);
        if (!result.moved) {
            ArcadeAudio.playError();
            return;
        }
        this.clearHint();
        this.statusOverride = this.describeMoveOutcome(result);
        if (result.reached2048) {
            ArcadeAudio.playWin();
        }
        else if (result.status === 'gameover') {
            ArcadeAudio.playLose();
        }
        else if (result.merges >= 2 || result.scoreDelta >= 128) {
            ArcadeAudio.playScore();
        }
        else if (result.merges > 0) {
            ArcadeAudio.playMatch();
        }
        else {
            ArcadeAudio.playMove();
        }
        this.syncUI(this.engine.getSnapshot(), true);
    }
    describeMoveOutcome(result) {
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
    applyHintVisual(direction) {
        this.clearHint();
        this.activeHintDir = direction;
        this.dpadButtons[direction].classList.add('is-hinted');
        this.hintBadgeEl.textContent = `HINT: ${DIRECTION_ARROWS[direction]}`;
        this.hintBadgeEl.hidden = false;
    }
    clearHint() {
        if (this.activeHintDir) {
            this.dpadButtons[this.activeHintDir].classList.remove('is-hinted');
            this.activeHintDir = null;
        }
        this.hintBadgeEl.hidden = true;
    }
    syncUI(snapshot, animateTiles) {
        if (snapshot.highScore > this.persistedHighScore) {
            this.persistedHighScore = snapshot.highScore;
            writeStoredHighScore(this.persistedHighScore);
        }
        this.renderBoard(snapshot, animateTiles);
        this.renderTelemetry(snapshot);
        this.syncStatusAndControls(snapshot);
    }
    renderBoard(snapshot, animateTiles) {
        const mergedSet = new Set(snapshot.lastMergedIndices);
        const transitionByTarget = new Map();
        for (const tr of snapshot.lastTransitions) {
            transitionByTarget.set(tr.toIndex, tr.fromIndices);
        }
        const firstCellRect = this.cellEls[0].getBoundingClientRect();
        const secondCellRect = this.cellEls[1].getBoundingClientRect();
        const stepX = secondCellRect.left > firstCellRect.left ? secondCellRect.left - firstCellRect.left : 104;
        const fourthCellRect = this.cellEls[4].getBoundingClientRect();
        const stepY = fourthCellRect.top > firstCellRect.top ? fourthCellRect.top - firstCellRect.top : stepX;
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
            }
            else if (digits === 4) {
                tileEl.classList.add('digits-4');
            }
            else if (digits >= 5) {
                tileEl.classList.add('digits-5');
            }
            tileEl.textContent = String(value);
            if (animateTiles) {
                if (snapshot.lastSpawnIndex === i) {
                    tileEl.classList.add('is-spawned');
                }
                else if (mergedSet.has(i)) {
                    tileEl.classList.add('is-merged');
                }
                else {
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
    renderTelemetry(snapshot) {
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
    syncStatusAndControls(snapshot) {
        this.undoBtn.disabled = !snapshot.canUndo;
        this.hintBtn.disabled = snapshot.status !== 'playing';
        for (const dir of ['up', 'down', 'left', 'right']) {
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
        }
        else if (snapshot.forecast.label === 'CRITICAL') {
            this.statusBannerEl.className = 'status-banner is-warning';
        }
        else {
            this.statusBannerEl.className = 'status-banner is-active';
        }
        this.statusTextEl.textContent =
            this.statusOverride ??
                'Merge matching plasma tiles to forge 2048 — swipe or use arrow keys.';
    }
}
function bootGame2048() {
    initArcadeHeader();
    new Game2048Controller();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootGame2048, { once: true });
}
else {
    bootGame2048();
}
//# sourceMappingURL=main.js.map