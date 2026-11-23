/**
 * Browser UI controller for Tic-Tac-Toe ("Neural Grid Duel").
 * Connects DOM interactions, neon SVG animations, keyboard navigation,
 * Web Audio SFX, and stale-AI cancellation via `matchGeneration`.
 */
import { ArcadeAudio, initArcadeHeader } from '../../shared/arcade.js';
import { chooseAIMove, predictWinner } from './ai.js';
import { AI_SYMBOL, HUMAN_SYMBOL, TicTacToeEngine, } from './engine.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const AI_MOVE_DELAY_MS = 240;
const DIFFICULTIES = ['unbeatable', 'tactical', 'casual'];
function isDifficulty(value) {
    return value !== undefined && DIFFICULTIES.includes(value);
}
function createMarkSvg(symbol, options) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    const classes = ['ttt-svg', symbol === 'X' ? 'ttt-svg-x' : 'ttt-svg-o'];
    if (options.animated) {
        classes.push('is-animated');
    }
    if (options.ghost) {
        classes.push('ttt-svg-ghost');
    }
    svg.setAttribute('class', classes.join(' '));
    if (symbol === 'X') {
        const stroke1 = document.createElementNS(SVG_NS, 'path');
        stroke1.setAttribute('d', 'M 24 24 L 76 76');
        stroke1.setAttribute('class', 'x-stroke x-stroke-1');
        const stroke2 = document.createElementNS(SVG_NS, 'path');
        stroke2.setAttribute('d', 'M 76 24 L 24 76');
        stroke2.setAttribute('class', 'x-stroke x-stroke-2');
        svg.append(stroke1, stroke2);
    }
    else {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '50');
        circle.setAttribute('cy', '50');
        circle.setAttribute('r', '28');
        circle.setAttribute('class', 'o-stroke');
        svg.appendChild(circle);
    }
    return svg;
}
function formatCellAriaLabel(index, value) {
    const row = Math.floor(index / 3) + 1;
    const col = (index % 3) + 1;
    const state = value === null ? 'empty' : value;
    return `Cell ${index + 1}, row ${row} column ${col}: ${state}`;
}
function requireElement(selector) {
    const el = document.querySelector(selector);
    if (!el) {
        throw new Error(`Missing required Tic-Tac-Toe element: ${selector}`);
    }
    return el;
}
function initTicTacToe() {
    initArcadeHeader();
    const statusBanner = requireElement('#status-banner');
    const statusMessage = requireElement('#status-message');
    const turnPill = requireElement('#turn-pill');
    const gridStage = requireElement('#ttt-grid-stage');
    const laserOverlay = requireElement('#win-laser-overlay');
    const laserGlow = requireElement('#win-laser-glow');
    const laserLine = requireElement('#win-laser-line');
    const startBtn = requireElement('#start-btn');
    const resetBtn = requireElement('#reset-btn');
    const difficultyButtons = Array.from(document.querySelectorAll('#difficulty-control [data-difficulty]'));
    const firstMoverButtons = Array.from(document.querySelectorAll('#first-mover-control [data-first-mover]'));
    const playerScoreEl = requireElement('#player-score');
    const drawScoreEl = requireElement('#draw-score');
    const aiScoreEl = requireElement('#ai-score');
    const streakValueEl = requireElement('#streak-value');
    const predictorFillEl = requireElement('#predictor-fill');
    const predictedLabelEl = requireElement('#predicted-winner-label');
    const predictedDetailEl = requireElement('#predicted-winner-detail');
    const playerProbEl = requireElement('#player-prob');
    const drawProbEl = requireElement('#draw-prob');
    const aiProbEl = requireElement('#ai-prob');
    const cells = [];
    for (let i = 0; i < 9; i += 1) {
        const cell = requireElement(`[data-cell="${i}"]`);
        const ghostSlot = cell.querySelector('.cell-ghost');
        if (ghostSlot && ghostSlot.childElementCount === 0) {
            ghostSlot.appendChild(createMarkSvg(HUMAN_SYMBOL, { animated: false, ghost: true }));
        }
        cells.push(cell);
    }
    const engine = new TicTacToeEngine(HUMAN_SYMBOL);
    let difficulty = 'unbeatable';
    let firstMover = HUMAN_SYMBOL;
    let focusedCell = 4;
    let pendingAiTimer = null;
    let aiThinking = false;
    let lastLaserKey = null;
    const renderedMarks = Array(9).fill(null);
    function clearPendingAiTimer() {
        if (pendingAiTimer !== null) {
            window.clearTimeout(pendingAiTimer);
            pendingAiTimer = null;
        }
        aiThinking = false;
    }
    function updateControlButtons() {
        for (const btn of difficultyButtons) {
            const active = btn.dataset.difficulty === difficulty;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        }
        for (const btn of firstMoverButtons) {
            const active = btn.dataset.firstMover === firstMover;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        }
        const status = engine.getStatus();
        if (status === 'idle') {
            startBtn.textContent = 'Start';
        }
        else if (status === 'playing') {
            startBtn.textContent = 'Restart';
        }
        else {
            startBtn.textContent = 'Play Again';
        }
    }
    function updateWinningLaser(winningLine, winner, generation) {
        if (!winningLine || !winner) {
            lastLaserKey = null;
            laserOverlay.classList.remove('is-visible', 'is-player-win', 'is-ai-win');
            return;
        }
        const startCell = cells[winningLine[0]];
        const endCell = cells[winningLine[2]];
        const stageRect = gridStage.getBoundingClientRect();
        let x1;
        let y1;
        let x2;
        let y2;
        if (stageRect.width > 0 && stageRect.height > 0) {
            const r1 = startCell.getBoundingClientRect();
            const r2 = endCell.getBoundingClientRect();
            x1 = ((r1.left + r1.width / 2 - stageRect.left) / stageRect.width) * 300;
            y1 = ((r1.top + r1.height / 2 - stageRect.top) / stageRect.height) * 300;
            x2 = ((r2.left + r2.width / 2 - stageRect.left) / stageRect.width) * 300;
            y2 = ((r2.top + r2.height / 2 - stageRect.top) / stageRect.height) * 300;
        }
        else {
            const coords = [48, 150, 252];
            x1 = coords[winningLine[0] % 3];
            y1 = coords[Math.floor(winningLine[0] / 3)];
            x2 = coords[winningLine[2] % 3];
            y2 = coords[Math.floor(winningLine[2] / 3)];
        }
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = (dx / len) * 20;
        const uy = (dy / len) * 20;
        const lx1 = (x1 - ux).toFixed(1);
        const ly1 = (y1 - uy).toFixed(1);
        const lx2 = (x2 + ux).toFixed(1);
        const ly2 = (y2 + uy).toFixed(1);
        for (const line of [laserGlow, laserLine]) {
            line.setAttribute('x1', lx1);
            line.setAttribute('y1', ly1);
            line.setAttribute('x2', lx2);
            line.setAttribute('y2', ly2);
        }
        laserOverlay.classList.remove('is-player-win', 'is-ai-win');
        laserOverlay.classList.add(winner === HUMAN_SYMBOL ? 'is-player-win' : 'is-ai-win');
        const laserKey = `${generation}:${winner}:${winningLine.join('-')}`;
        if (lastLaserKey !== laserKey) {
            lastLaserKey = laserKey;
            laserOverlay.classList.remove('is-visible');
            void laserOverlay.getBoundingClientRect();
            laserOverlay.classList.add('is-visible');
        }
        else {
            laserOverlay.classList.add('is-visible');
        }
    }
    function render() {
        const snapshot = engine.getSnapshot();
        gridStage.setAttribute('data-status', snapshot.status);
        const canHumanClick = snapshot.status === 'playing' &&
            !aiThinking &&
            snapshot.currentTurn === HUMAN_SYMBOL;
        const winSet = snapshot.winningLine ? new Set(snapshot.winningLine) : null;
        for (let i = 0; i < 9; i += 1) {
            const cell = cells[i];
            const value = snapshot.board[i];
            const markEl = cell.querySelector('.cell-mark');
            if (markEl) {
                if (value === null && renderedMarks[i] !== null) {
                    markEl.replaceChildren();
                    renderedMarks[i] = null;
                }
                else if (value !== null && renderedMarks[i] !== value) {
                    markEl.replaceChildren(createMarkSvg(value, { animated: true, ghost: false }));
                    renderedMarks[i] = value;
                }
            }
            const playable = canHumanClick && value === null;
            cell.setAttribute('data-playable', String(playable));
            cell.setAttribute('data-mark', value ?? '');
            cell.setAttribute('aria-label', formatCellAriaLabel(i, value));
            cell.classList.toggle('is-occupied-x', value === HUMAN_SYMBOL);
            cell.classList.toggle('is-occupied-o', value === AI_SYMBOL);
            const isWinCell = Boolean(winSet && winSet.has(i));
            cell.classList.toggle('is-winning-x', isWinCell && snapshot.winner === HUMAN_SYMBOL);
            cell.classList.toggle('is-winning-o', isWinCell && snapshot.winner === AI_SYMBOL);
        }
        updateWinningLaser(snapshot.winningLine, snapshot.winner, snapshot.matchGeneration);
        // Update Status Banner
        statusBanner.classList.remove('is-info', 'is-active', 'is-victory', 'is-defeat', 'is-draw');
        if (snapshot.status === 'idle') {
            statusBanner.classList.add('is-info');
            statusMessage.textContent =
                firstMover === HUMAN_SYMBOL
                    ? 'Ready to duel. Press Start or Enter to begin (Player X first).'
                    : 'Ready to duel. Press Start or Enter to begin (AI O opens first).';
            turnPill.textContent = 'IDLE';
        }
        else if (snapshot.status === 'playing') {
            if (snapshot.currentTurn === HUMAN_SYMBOL) {
                statusBanner.classList.add('is-active');
                statusMessage.textContent = 'Your turn (X) — Click a cell or press keys 1–9.';
                turnPill.textContent = 'TURN: X';
            }
            else {
                statusBanner.classList.add('is-info');
                statusMessage.textContent = `Neural AI (${difficulty.toUpperCase()}) calculating move...`;
                turnPill.textContent = 'TURN: O';
            }
        }
        else if (snapshot.status === 'won') {
            if (snapshot.winner === HUMAN_SYMBOL) {
                statusBanner.classList.add('is-victory');
                statusMessage.textContent = 'Victory! Player (X) locked the winning laser line.';
                turnPill.textContent = 'X WINS';
            }
            else {
                statusBanner.classList.add('is-defeat');
                statusMessage.textContent = 'Defeat! Neural AI (O) completed a winning line.';
                turnPill.textContent = 'O WINS';
            }
        }
        else {
            statusBanner.classList.add('is-draw');
            statusMessage.textContent = 'Match Drawn — Grid locked with no winning alignment.';
            turnPill.textContent = 'DRAW';
        }
        // Update Scoreboard HUD
        playerScoreEl.textContent = String(snapshot.scores.playerWins);
        drawScoreEl.textContent = String(snapshot.scores.draws);
        aiScoreEl.textContent = String(snapshot.scores.aiWins);
        streakValueEl.textContent = String(snapshot.scores.streak);
        // Update Predicted Winner Panel
        const prediction = predictWinner(snapshot.board, snapshot.currentTurn);
        predictedLabelEl.textContent = prediction.label;
        predictedLabelEl.classList.remove('is-player', 'is-ai', 'is-draw');
        predictedLabelEl.classList.add(prediction.winner === HUMAN_SYMBOL
            ? 'is-player'
            : prediction.winner === AI_SYMBOL
                ? 'is-ai'
                : 'is-draw');
        predictedDetailEl.textContent = prediction.detail;
        predictorFillEl.style.width = `${prediction.barPercent}%`;
        predictorFillEl.classList.remove('is-player', 'is-ai', 'is-gold');
        predictorFillEl.classList.add(prediction.winner === HUMAN_SYMBOL
            ? 'is-player'
            : prediction.winner === AI_SYMBOL
                ? 'is-ai'
                : 'is-gold');
        playerProbEl.textContent = `X: ${prediction.playerWinPct}%`;
        drawProbEl.textContent = `Draw: ${prediction.drawPct}%`;
        aiProbEl.textContent = `O: ${prediction.aiWinPct}%`;
        updateControlButtons();
    }
    function scheduleAiMove() {
        clearPendingAiTimer();
        if (engine.getStatus() !== 'playing' || engine.getCurrentTurn() !== AI_SYMBOL) {
            return;
        }
        const generation = engine.getMatchGeneration();
        aiThinking = true;
        render();
        pendingAiTimer = window.setTimeout(() => {
            pendingAiTimer = null;
            aiThinking = false;
            // Guard against stale async callbacks after Reset or Restart.
            if (generation !== engine.getMatchGeneration() ||
                engine.getStatus() !== 'playing' ||
                engine.getCurrentTurn() !== AI_SYMBOL) {
                return;
            }
            const moveIdx = chooseAIMove(engine.getBoard(), difficulty, AI_SYMBOL);
            const result = engine.playMove(moveIdx, AI_SYMBOL);
            if (!result.ok) {
                return;
            }
            ArcadeAudio.playMove();
            if (result.status === 'won') {
                ArcadeAudio.playLose();
            }
            else if (result.status === 'draw') {
                ArcadeAudio.playScore();
            }
            render();
        }, AI_MOVE_DELAY_MS);
    }
    function handleStart() {
        clearPendingAiTimer();
        engine.start(firstMover);
        ArcadeAudio.playClick();
        render();
        if (firstMover === AI_SYMBOL) {
            scheduleAiMove();
        }
    }
    function handleReset() {
        clearPendingAiTimer();
        engine.reset({ firstMover });
        ArcadeAudio.playClick();
        render();
    }
    function attemptHumanMove(cellIndex) {
        if (engine.getStatus() !== 'playing') {
            ArcadeAudio.playError();
            statusBanner.classList.remove('is-info', 'is-active', 'is-victory', 'is-defeat', 'is-draw');
            statusBanner.classList.add('is-info');
            statusMessage.textContent = 'Press Start (or Enter) before claiming a cell.';
            return;
        }
        if (aiThinking || engine.getCurrentTurn() !== HUMAN_SYMBOL) {
            ArcadeAudio.playError();
            return;
        }
        const result = engine.playMove(cellIndex, HUMAN_SYMBOL);
        if (!result.ok) {
            ArcadeAudio.playError();
            return;
        }
        focusedCell = cellIndex;
        ArcadeAudio.playMove();
        if (result.status === 'won') {
            ArcadeAudio.playWin();
            render();
            return;
        }
        if (result.status === 'draw') {
            ArcadeAudio.playScore();
            render();
            return;
        }
        render();
        scheduleAiMove();
    }
    // Event listeners
    startBtn.addEventListener('click', handleStart);
    resetBtn.addEventListener('click', handleReset);
    for (const btn of difficultyButtons) {
        btn.addEventListener('click', () => {
            const nextDiff = btn.dataset.difficulty;
            if (!isDifficulty(nextDiff) || nextDiff === difficulty) {
                return;
            }
            difficulty = nextDiff;
            ArcadeAudio.playClick();
            render();
        });
    }
    for (const btn of firstMoverButtons) {
        btn.addEventListener('click', () => {
            const nextFirst = btn.dataset.firstMover;
            if ((nextFirst !== 'X' && nextFirst !== 'O') || nextFirst === firstMover) {
                return;
            }
            firstMover = nextFirst;
            ArcadeAudio.playClick();
            if (engine.getStatus() === 'idle') {
                engine.setFirstMover(firstMover);
                render();
            }
            else {
                clearPendingAiTimer();
                engine.reset({ firstMover });
                render();
            }
        });
    }
    cells.forEach((cell, idx) => {
        cell.addEventListener('click', () => {
            focusedCell = idx;
            attemptHumanMove(idx);
        });
        cell.addEventListener('focus', () => {
            focusedCell = idx;
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        // Keys 1-9 place mark directly in cell 0-8
        if (e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const idx = Number(e.key) - 1;
            focusedCell = idx;
            cells[idx]?.focus();
            attemptHumanMove(idx);
            return;
        }
        // R resets board & cancels pending AI timeout
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            handleReset();
            return;
        }
        // Arrow keys navigate 3x3 grid cursor
        if (e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight') {
            e.preventDefault();
            let row = Math.floor(focusedCell / 3);
            let col = focusedCell % 3;
            if (e.key === 'ArrowUp') {
                row = (row + 2) % 3;
            }
            else if (e.key === 'ArrowDown') {
                row = (row + 1) % 3;
            }
            else if (e.key === 'ArrowLeft') {
                col = (col + 2) % 3;
            }
            else if (e.key === 'ArrowRight') {
                col = (col + 1) % 3;
            }
            focusedCell = row * 3 + col;
            cells[focusedCell]?.focus();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            const activeEl = document.activeElement;
            const isNonCellInteractive = activeEl instanceof HTMLElement &&
                !activeEl.classList.contains('ttt-cell') &&
                (activeEl.tagName === 'BUTTON' ||
                    activeEl.tagName === 'A' ||
                    activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'SELECT');
            if (isNonCellInteractive) {
                return;
            }
            if (engine.getStatus() === 'idle' && e.key === 'Enter') {
                e.preventDefault();
                handleStart();
                return;
            }
            if (activeEl instanceof HTMLElement && activeEl.dataset.cell !== undefined) {
                e.preventDefault();
                const idx = Number(activeEl.dataset.cell);
                if (Number.isInteger(idx) && idx >= 0 && idx <= 8) {
                    focusedCell = idx;
                    attemptHumanMove(idx);
                }
                return;
            }
            if (engine.getStatus() === 'playing') {
                e.preventDefault();
                attemptHumanMove(focusedCell);
            }
        }
    });
    // Keep winning laser geometry synced if viewport resizes after a win.
    window.addEventListener('resize', () => {
        if (engine.getStatus() === 'won') {
            updateWinningLaser(engine.getWinningLine(), engine.getWinner(), engine.getMatchGeneration());
        }
    });
    render();
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTicTacToe);
    }
    else {
        initTicTacToe();
    }
}
//# sourceMappingURL=main.js.map