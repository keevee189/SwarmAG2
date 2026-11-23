/**
 * Browser entrypoint for Tetris ("Tetromino Overdrive").
 * Wires DOM HUD, keyboard/touch input, Web Audio SFX, and 60fps canvas loop.
 */
import { ArcadeAudio, clamp, formatTime, initArcadeHeader } from '../../shared/arcade.js';
import { LINES_PER_LEVEL, TetrisEngine, } from './engine.js';
import { TetrisRenderer } from './renderer.js';
const HIGH_SCORE_STORAGE_KEY = 'nexus-arcade:tetris-highscore';
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
        case 'VICTORY':
        case 'DOMINATING':
            return 'is-emerald';
        case 'ON TRACK':
            return 'is-cyan';
        case 'PRESSURE':
            return 'is-gold';
        case 'CRITICAL':
        case 'GAME OVER':
            return 'is-crimson';
    }
}
function requireElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing required Tetris DOM element: #${id}`);
    }
    return el;
}
class TetrisController {
    engine;
    renderer;
    boardCanvas;
    startBtn;
    pauseBtn;
    resetBtn;
    overlayActionBtn;
    statusBanner;
    statusText;
    statusTag;
    gameOverlay;
    overlayKicker;
    overlayTitle;
    overlaySubtitle;
    scoreValue;
    highScoreValue;
    levelValue;
    linesValue;
    timeValue;
    comboValue;
    b2bValue;
    nextLevelLines;
    forecastPercent;
    forecastFill;
    forecastBar;
    forecastLabel;
    forecastDetail;
    persistedHighScore;
    lastFrameMs = 0;
    lastSoftDropSoundMs = 0;
    rafId = 0;
    constructor() {
        this.persistedHighScore = readStoredHighScore();
        this.engine = new TetrisEngine({ highScore: this.persistedHighScore });
        this.boardCanvas = requireElement('tetris-canvas');
        const nextCanvas = document.getElementById('next-canvas');
        const holdCanvas = document.getElementById('hold-canvas');
        this.renderer = new TetrisRenderer({
            boardCanvas: this.boardCanvas,
            nextCanvas,
            holdCanvas,
        });
        this.startBtn = requireElement('start-btn');
        this.pauseBtn = requireElement('pause-btn');
        this.resetBtn = requireElement('reset-btn');
        this.overlayActionBtn = requireElement('overlay-action-btn');
        this.statusBanner = requireElement('status-banner');
        this.statusText = requireElement('status-text');
        this.statusTag = requireElement('status-tag');
        this.gameOverlay = requireElement('game-overlay');
        this.overlayKicker = requireElement('overlay-kicker');
        this.overlayTitle = requireElement('overlay-title');
        this.overlaySubtitle = requireElement('overlay-subtitle');
        this.scoreValue = requireElement('score-value');
        this.highScoreValue = requireElement('high-score-value');
        this.levelValue = requireElement('level-value');
        this.linesValue = requireElement('lines-value');
        this.timeValue = requireElement('time-value');
        this.comboValue = requireElement('combo-value');
        this.b2bValue = requireElement('b2b-value');
        this.nextLevelLines = requireElement('next-level-lines');
        this.forecastPercent = requireElement('forecast-percent');
        this.forecastFill = requireElement('forecast-fill');
        this.forecastBar = this.forecastFill.parentElement;
        this.forecastLabel = requireElement('forecast-label');
        this.forecastDetail = requireElement('forecast-detail');
        this.bindEvents();
        this.syncUI(this.engine.getSnapshot(), 0);
        this.startLoop();
    }
    bindEvents() {
        this.startBtn.addEventListener('click', () => {
            this.startBtn.blur();
            this.handleStart();
        });
        this.overlayActionBtn.addEventListener('click', () => {
            this.overlayActionBtn.blur();
            this.handleStart();
        });
        this.pauseBtn.addEventListener('click', () => {
            this.pauseBtn.blur();
            this.handleTogglePause();
        });
        this.resetBtn.addEventListener('click', () => {
            this.resetBtn.blur();
            this.handleReset();
        });
        const touchButtons = document.querySelectorAll('[data-action]');
        touchButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                btn.blur();
                const action = btn.dataset.action;
                this.handleAction(action ?? '');
            });
        });
        window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    }
    handleAction(action) {
        if (this.engine.getStatus() !== 'playing') {
            return;
        }
        switch (action) {
            case 'left':
                this.performMoveLeft();
                break;
            case 'right':
                this.performMoveRight();
                break;
            case 'down':
                this.performSoftDrop();
                break;
            case 'rotate-cw':
                this.performRotateCW();
                break;
            case 'rotate-ccw':
                this.performRotateCCW();
                break;
            case 'drop':
                this.performHardDrop();
                break;
            case 'hold':
                this.performHold();
                break;
        }
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
        const code = event.code;
        const key = event.key;
        const lowerKey = key.toLowerCase();
        const status = this.engine.getStatus();
        if (key === 'Enter') {
            if (!event.repeat && (status === 'idle' || status === 'gameover' || status === 'paused')) {
                event.preventDefault();
                this.handleStart();
            }
            return;
        }
        if (lowerKey === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            if (!event.repeat) {
                event.preventDefault();
                this.handleReset();
            }
            return;
        }
        if (lowerKey === 'p' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            if (!event.repeat) {
                event.preventDefault();
                this.handleTogglePause();
            }
            return;
        }
        const isNavigationKey = code === 'ArrowLeft' ||
            code === 'ArrowRight' ||
            code === 'ArrowDown' ||
            code === 'ArrowUp' ||
            code === 'Space' ||
            key === ' ';
        if (status !== 'playing') {
            if (status === 'paused' && isNavigationKey) {
                event.preventDefault();
            }
            return;
        }
        if (isNavigationKey) {
            event.preventDefault();
        }
        if (code === 'ArrowLeft' || lowerKey === 'a') {
            this.performMoveLeft();
        }
        else if (code === 'ArrowRight' || lowerKey === 'd') {
            this.performMoveRight();
        }
        else if (code === 'ArrowDown' || lowerKey === 's') {
            this.performSoftDrop();
        }
        else if (code === 'ArrowUp' || lowerKey === 'w' || lowerKey === 'x') {
            if (!event.repeat) {
                this.performRotateCW();
            }
        }
        else if (lowerKey === 'z') {
            if (!event.repeat) {
                this.performRotateCCW();
            }
        }
        else if (code === 'Space' || key === ' ') {
            if (!event.repeat) {
                this.performHardDrop();
            }
        }
        else if (lowerKey === 'c' || key === 'Shift') {
            if (!event.repeat) {
                this.performHold();
            }
        }
    }
    handleStart() {
        const prevStatus = this.engine.getStatus();
        if (prevStatus === 'gameover') {
            this.renderer.clearEffects();
        }
        this.engine.start();
        ArcadeAudio.playClick();
        this.boardCanvas.focus({ preventScroll: true });
        this.syncUI(this.engine.getSnapshot(), 0);
    }
    handleTogglePause() {
        const status = this.engine.getStatus();
        if (status !== 'playing' && status !== 'paused') {
            return;
        }
        this.engine.togglePause();
        ArcadeAudio.playClick();
        this.syncUI(this.engine.getSnapshot(), 0);
    }
    handleReset() {
        this.engine.reset();
        this.renderer.clearEffects();
        ArcadeAudio.playClick();
        this.syncUI(this.engine.getSnapshot(), 0);
    }
    performMoveLeft() {
        if (this.engine.moveLeft()) {
            ArcadeAudio.playMove();
            this.syncUI(this.engine.getSnapshot(), 0);
        }
    }
    performMoveRight() {
        if (this.engine.moveRight()) {
            ArcadeAudio.playMove();
            this.syncUI(this.engine.getSnapshot(), 0);
        }
    }
    performSoftDrop() {
        if (this.engine.softDrop()) {
            const now = performance.now();
            if (now - this.lastSoftDropSoundMs >= 65) {
                ArcadeAudio.playMove();
                this.lastSoftDropSoundMs = now;
            }
            this.syncUI(this.engine.getSnapshot(), 0);
        }
    }
    performRotateCW() {
        if (this.engine.rotateCW()) {
            ArcadeAudio.playMove();
            this.syncUI(this.engine.getSnapshot(), 0);
        }
    }
    performRotateCCW() {
        if (this.engine.rotateCCW()) {
            ArcadeAudio.playMove();
            this.syncUI(this.engine.getSnapshot(), 0);
        }
    }
    performHold() {
        if (this.engine.hold()) {
            ArcadeAudio.playMove();
            const snapshot = this.engine.getSnapshot();
            if (snapshot.status === 'gameover') {
                ArcadeAudio.playLose();
            }
            this.syncUI(snapshot, 0);
        }
        else {
            ArcadeAudio.playError();
        }
    }
    performHardDrop() {
        const result = this.engine.hardDrop();
        this.handleLockOutcome(result, true);
        this.syncUI(this.engine.getSnapshot(), 0);
    }
    handleLockOutcome(result, fromHardDrop) {
        if (!result || !result.locked) {
            return;
        }
        if (result.victoryUnlocked) {
            ArcadeAudio.playWin();
            return;
        }
        if (result.gameOver) {
            ArcadeAudio.playLose();
            return;
        }
        if (result.linesCleared >= 4 || (result.tSpin !== 'none' && result.linesCleared > 0) || result.leveledUp) {
            ArcadeAudio.playScore();
            return;
        }
        if (result.linesCleared > 0) {
            ArcadeAudio.playMatch();
            return;
        }
        if (fromHardDrop) {
            ArcadeAudio.playClick();
        }
    }
    startLoop() {
        const step = (nowMs) => {
            if (this.lastFrameMs === 0) {
                this.lastFrameMs = nowMs;
            }
            const dtMs = clamp(nowMs - this.lastFrameMs, 0, 100);
            this.lastFrameMs = nowMs;
            if (this.engine.getStatus() === 'playing') {
                const tickResult = this.engine.tick(dtMs);
                if (tickResult.locked) {
                    this.handleLockOutcome(tickResult.clearResult, false);
                }
                this.syncUI(this.engine.getSnapshot(), dtMs);
            }
            else {
                this.renderer.render(this.engine.getSnapshot(), dtMs);
            }
            this.rafId = window.requestAnimationFrame(step);
        };
        if (this.rafId !== 0) {
            window.cancelAnimationFrame(this.rafId);
        }
        this.rafId = window.requestAnimationFrame(step);
    }
    syncUI(snapshot, dtMs) {
        if (snapshot.highScore > this.persistedHighScore) {
            this.persistedHighScore = snapshot.highScore;
            writeStoredHighScore(this.persistedHighScore);
        }
        this.scoreValue.textContent = snapshot.score.toLocaleString();
        this.highScoreValue.textContent = snapshot.highScore.toLocaleString();
        this.levelValue.textContent = String(snapshot.level);
        this.linesValue.textContent = String(snapshot.lines);
        this.timeValue.textContent = formatTime(snapshot.elapsedMs / 1000);
        this.comboValue.textContent = `${Math.max(0, snapshot.combo)}x`;
        this.b2bValue.textContent = snapshot.backToBack ? 'ACTIVE' : 'OFF';
        const linesIntoLevel = snapshot.lines % LINES_PER_LEVEL;
        const linesRemaining = LINES_PER_LEVEL - linesIntoLevel;
        this.nextLevelLines.textContent = `${linesRemaining} ${linesRemaining === 1 ? 'LINE' : 'LINES'}`;
        const forecast = snapshot.forecast;
        this.forecastPercent.textContent = `${forecast.percent}%`;
        this.forecastFill.style.width = `${forecast.percent}%`;
        this.forecastFill.className = `predictor-fill ${forecastFillClass(forecast.label)}`;
        this.forecastLabel.textContent = forecast.label;
        this.forecastDetail.textContent = forecast.detail;
        if (this.forecastBar) {
            this.forecastBar.setAttribute('aria-valuenow', String(forecast.percent));
        }
        this.syncControlsAndOverlay(snapshot);
        this.renderer.render(snapshot, dtMs);
    }
    syncControlsAndOverlay(snapshot) {
        const status = snapshot.status;
        if (status === 'idle') {
            this.gameOverlay.hidden = false;
            this.overlayKicker.textContent = 'SYSTEM STANDBY';
            this.overlayTitle.textContent = 'TETROMINO OVERDRIVE';
            this.overlaySubtitle.textContent =
                'Reach 10,000 pts for Victory Rank, or chase a new Neon High Score.';
            this.overlayActionBtn.textContent = 'Start Game';
            this.startBtn.disabled = false;
            this.startBtn.textContent = 'Start';
            this.pauseBtn.disabled = true;
            this.pauseBtn.textContent = 'Pause';
            this.statusBanner.className = 'status-banner is-info';
            this.statusText.textContent = 'Ready to drop — press Start or Enter to begin.';
            this.statusTag.textContent = 'STANDBY';
            return;
        }
        if (status === 'paused') {
            this.gameOverlay.hidden = false;
            this.overlayKicker.textContent = 'SIMULATION PAUSED';
            this.overlayTitle.textContent = 'PAUSED';
            this.overlaySubtitle.textContent = 'Press P, Pause, or Resume to continue dropping.';
            this.overlayActionBtn.textContent = 'Resume';
            this.startBtn.disabled = false;
            this.startBtn.textContent = 'Resume';
            this.pauseBtn.disabled = false;
            this.pauseBtn.textContent = 'Resume';
            this.statusBanner.className = 'status-banner is-warning';
            this.statusText.textContent = 'Simulation paused — press P or Resume to continue.';
            this.statusTag.textContent = 'PAUSED';
            return;
        }
        if (status === 'gameover') {
            this.gameOverlay.hidden = false;
            this.overlayKicker.textContent = snapshot.victoryReached
                ? 'VICTORY RUN COMPLETE'
                : 'GRID TOPPED OUT';
            this.overlayTitle.textContent = snapshot.victoryReached ? 'VICTORY OVERDRIVE' : 'GAME OVER';
            this.overlaySubtitle.textContent = `Final Score: ${snapshot.score.toLocaleString()} pts · ${snapshot.lines} lines (Level ${snapshot.level})`;
            this.overlayActionBtn.textContent = 'Play Again';
            this.startBtn.disabled = false;
            this.startBtn.textContent = 'Play Again';
            this.pauseBtn.disabled = true;
            this.pauseBtn.textContent = 'Pause';
            this.statusBanner.className = snapshot.victoryReached
                ? 'status-banner is-victory'
                : 'status-banner is-defeat';
            this.statusText.textContent = snapshot.victoryReached
                ? `Victory Run Complete — Final Score ${snapshot.score.toLocaleString()} pts!`
                : `Topped out at ${snapshot.score.toLocaleString()} pts — press Start or Reset to try again.`;
            this.statusTag.textContent = snapshot.victoryReached ? 'VICTORY' : 'GAME OVER';
            return;
        }
        // Playing state
        this.gameOverlay.hidden = true;
        this.startBtn.disabled = true;
        this.startBtn.textContent = 'Running';
        this.pauseBtn.disabled = false;
        this.pauseBtn.textContent = 'Pause';
        if (snapshot.victoryReached) {
            this.statusBanner.className = 'status-banner is-victory';
            this.statusTag.textContent = 'VICTORY RANK';
            this.statusText.textContent = snapshot.lastClear
                ? `${snapshot.lastClear.label} (+${snapshot.lastClear.scoreDelta.toLocaleString()}) — Overdrive High-Score Chase!`
                : 'Victory Rank Unlocked (10,000+ pts) — Overdrive Chase Active!';
        }
        else if (snapshot.forecast.label === 'CRITICAL') {
            this.statusBanner.className = 'status-banner is-warning';
            this.statusTag.textContent = 'CRITICAL';
            this.statusText.textContent = 'Warning: stack approaching top — clear lines fast!';
        }
        else {
            this.statusBanner.className = 'status-banner is-active';
            this.statusTag.textContent = `LVL ${snapshot.level}`;
            this.statusText.textContent = snapshot.lastClear
                ? `${snapshot.lastClear.label} (+${snapshot.lastClear.scoreDelta.toLocaleString()} pts)`
                : 'Stack clean, build Tetrises, and reach 10,000 pts for Victory Rank.';
        }
    }
}
function bootTetris() {
    initArcadeHeader();
    new TetrisController();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTetris, { once: true });
}
else {
    bootTetris();
}
//# sourceMappingURL=main.js.map