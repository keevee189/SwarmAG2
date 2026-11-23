/**
 * Pure TypeScript AI & Exact Minimax Game-Theoretic Predictor for Tic-Tac-Toe.
 * Zero DOM dependencies so it executes cleanly in both Browser ESM and Node tests.
 */
import { clamp } from '../../shared/arcade.js';
import { AI_SYMBOL, checkWinner, cloneBoard, getAvailableMoves, getOpponent, isBoardFull, } from './engine.js';
/**
 * Deterministic cell preference order: center -> corners -> edges.
 */
const MOVE_PRIORITY = [4, 0, 2, 6, 8, 1, 3, 5, 7];
const predictionCache = new Map();
function boardToKey(board, nextTurn) {
    let key = '';
    for (let i = 0; i < 9; i += 1) {
        key += board[i] ?? '.';
    }
    return key + nextTurn;
}
function getOrderedAvailableMoves(board) {
    const ordered = [];
    for (const idx of MOVE_PRIORITY) {
        if (board[idx] === null) {
            ordered.push(idx);
        }
    }
    return ordered;
}
/**
 * Finds all empty cell indices that immediately win the game for `symbol`.
 */
export function findImmediateWinningMoves(board, symbol) {
    const winningMoves = [];
    for (const idx of MOVE_PRIORITY) {
        if (board[idx] !== null) {
            continue;
        }
        const probe = cloneBoard(board);
        probe[idx] = symbol;
        const win = checkWinner(probe);
        if (win && win.winner === symbol) {
            winningMoves.push(idx);
        }
    }
    return winningMoves;
}
/**
 * Alpha-beta pruned Minimax search with depth scoring (`100 - depth` for AI win,
 * `-100 + depth` for AI loss, `0` for draw). Guarantees fastest win & slowest loss.
 */
function minimaxAlphaBeta(board, depth, isMaximizing, aiSymbol, alpha, beta) {
    const win = checkWinner(board);
    if (win) {
        return win.winner === aiSymbol ? 100 - depth : -100 + depth;
    }
    if (isBoardFull(board)) {
        return 0;
    }
    const humanSymbol = getOpponent(aiSymbol);
    const moves = getOrderedAvailableMoves(board);
    if (isMaximizing) {
        let best = -Infinity;
        for (const idx of moves) {
            board[idx] = aiSymbol;
            const score = minimaxAlphaBeta(board, depth + 1, false, aiSymbol, alpha, beta);
            board[idx] = null;
            if (score > best) {
                best = score;
            }
            if (best > alpha) {
                alpha = best;
            }
            if (alpha >= beta) {
                break;
            }
        }
        return best;
    }
    let best = Infinity;
    for (const idx of moves) {
        board[idx] = humanSymbol;
        const score = minimaxAlphaBeta(board, depth + 1, true, aiSymbol, alpha, beta);
        board[idx] = null;
        if (score < best) {
            best = score;
        }
        if (best < beta) {
            beta = best;
        }
        if (alpha >= beta) {
            break;
        }
    }
    return best;
}
function chooseUnbeatableMove(board, aiSymbol) {
    const moves = getOrderedAvailableMoves(board);
    if (moves.length === 0) {
        throw new Error('No legal moves available on board.');
    }
    // Fast-path when opening on a completely empty board -> center (4).
    if (moves.length === 9) {
        return 4;
    }
    const work = cloneBoard(board);
    let bestMove = moves[0];
    let bestScore = -Infinity;
    for (const idx of moves) {
        work[idx] = aiSymbol;
        const score = minimaxAlphaBeta(work, 1, false, aiSymbol, bestScore, Infinity);
        work[idx] = null;
        if (score > bestScore) {
            bestScore = score;
            bestMove = idx;
        }
    }
    return bestMove;
}
function chooseTacticalMove(board, aiSymbol, rng) {
    const available = getAvailableMoves(board);
    if (available.length === 0) {
        throw new Error('No legal moves available on board.');
    }
    // 1. Always take an immediate win first.
    const immediateWins = findImmediateWinningMoves(board, aiSymbol);
    if (immediateWins.length > 0) {
        return immediateWins[0];
    }
    // 2. Always block an immediate opponent threat.
    const opponent = getOpponent(aiSymbol);
    const immediateBlocks = findImmediateWinningMoves(board, opponent);
    if (immediateBlocks.length > 0) {
        return immediateBlocks[0];
    }
    // 3. Otherwise mix minimax-smart moves with varied positional choices.
    if (rng() < 0.62) {
        return chooseUnbeatableMove(board, aiSymbol);
    }
    const strategicPool = getOrderedAvailableMoves(board).slice(0, Math.min(4, available.length));
    return strategicPool[Math.floor(rng() * strategicPool.length)] ?? available[0];
}
function chooseCasualMove(board, aiSymbol, rng) {
    const available = getAvailableMoves(board);
    if (available.length === 0) {
        throw new Error('No legal moves available on board.');
    }
    // Human-friendly openings on an empty or early board.
    if (available.length >= 8) {
        const friendlyPool = available.filter((idx) => idx !== 4);
        const pool = friendlyPool.length > 0 && rng() < 0.78 ? friendlyPool : available;
        return pool[Math.floor(rng() * pool.length)] ?? available[0];
    }
    // Occasional immediate win / threat block so gameplay stays lively but beatable.
    const immediateWins = findImmediateWinningMoves(board, aiSymbol);
    if (immediateWins.length > 0 && rng() < 0.65) {
        return immediateWins[0];
    }
    const opponent = getOpponent(aiSymbol);
    const immediateBlocks = findImmediateWinningMoves(board, opponent);
    if (immediateBlocks.length > 0 && rng() < 0.45) {
        return immediateBlocks[0];
    }
    return available[Math.floor(rng() * available.length)] ?? available[0];
}
/**
 * Selects an AI cell index (0..8) according to the active difficulty tier.
 */
export function chooseAIMove(board, difficulty = 'unbeatable', aiSymbol = AI_SYMBOL, rng = Math.random) {
    if (difficulty === 'unbeatable') {
        return chooseUnbeatableMove(board, aiSymbol);
    }
    if (difficulty === 'tactical') {
        return chooseTacticalMove(board, aiSymbol, rng);
    }
    return chooseCasualMove(board, aiSymbol, rng);
}
function solveSubtree(board, turn) {
    const key = boardToKey(board, turn);
    const cached = predictionCache.get(key);
    if (cached) {
        return cached;
    }
    const win = checkWinner(board);
    if (win) {
        const node = win.winner === 'X'
            ? { winner: 'X', forcedPlies: 0, pX: 1, pDraw: 0, pO: 0 }
            : { winner: 'O', forcedPlies: 0, pX: 0, pDraw: 0, pO: 1 };
        predictionCache.set(key, node);
        return node;
    }
    if (isBoardFull(board)) {
        const node = { winner: 'DRAW', forcedPlies: null, pX: 0, pDraw: 1, pO: 0 };
        predictionCache.set(key, node);
        return node;
    }
    const opponent = getOpponent(turn);
    const moves = getAvailableMoves(board);
    const children = [];
    for (const idx of moves) {
        board[idx] = turn;
        children.push(solveSubtree(board, opponent));
        board[idx] = null;
    }
    let winner;
    let forcedPlies;
    let optimalChildren;
    const myWins = children.filter((child) => child.winner === turn);
    const draws = children.filter((child) => child.winner === 'DRAW');
    if (myWins.length > 0) {
        const minChildPlies = Math.min(...myWins.map((child) => child.forcedPlies ?? 0));
        winner = turn;
        forcedPlies = 1 + minChildPlies;
        optimalChildren = myWins.filter((child) => (child.forcedPlies ?? 0) === minChildPlies);
    }
    else if (draws.length > 0) {
        winner = 'DRAW';
        forcedPlies = null;
        optimalChildren = draws;
    }
    else {
        const maxChildPlies = Math.max(...children.map((child) => child.forcedPlies ?? 0));
        winner = opponent;
        forcedPlies = 1 + maxChildPlies;
        optimalChildren = children.filter((child) => (child.forcedPlies ?? 0) === maxChildPlies);
    }
    // Subtree outcome distribution weighted toward optimal minimax continuations (85% optimal, 15% non-optimal)
    // so forced wins & critical drawing defenses align naturally with the game-theoretic verdict.
    const suboptimalChildren = children.filter((child) => !optimalChildren.includes(child));
    let pX = 0;
    let pDraw = 0;
    let pO = 0;
    if (suboptimalChildren.length === 0) {
        const w = 1 / optimalChildren.length;
        for (const child of optimalChildren) {
            pX += child.pX * w;
            pDraw += child.pDraw * w;
            pO += child.pO * w;
        }
    }
    else {
        const optWeight = 0.85 / optimalChildren.length;
        const subWeight = 0.15 / suboptimalChildren.length;
        for (const child of optimalChildren) {
            pX += child.pX * optWeight;
            pDraw += child.pDraw * optWeight;
            pO += child.pO * optWeight;
        }
        for (const child of suboptimalChildren) {
            pX += child.pX * subWeight;
            pDraw += child.pDraw * subWeight;
            pO += child.pO * subWeight;
        }
    }
    const node = { winner, forcedPlies, pX, pDraw, pO };
    predictionCache.set(key, node);
    return node;
}
/**
 * Rounds 3 probabilities summing to 1.0 into non-negative integers that sum exactly to 100.
 */
function roundPercentages(pX, pDraw, pO) {
    const raws = [pX * 100, pDraw * 100, pO * 100];
    const floors = raws.map((v) => Math.floor(v));
    let remainder = 100 - (floors[0] + floors[1] + floors[2]);
    const order = [0, 1, 2].sort((a, b) => raws[b] - floors[b] - (raws[a] - floors[a]));
    let cursor = 0;
    while (remainder > 0) {
        floors[order[cursor % 3]] += 1;
        remainder -= 1;
        cursor += 1;
    }
    return [floors[0], floors[1], floors[2]];
}
/**
 * Exact Minimax game-theoretic solver + subtree outcome distribution predictor.
 */
export function predictWinner(board, nextTurn) {
    const terminalWin = checkWinner(board);
    if (terminalWin) {
        if (terminalWin.winner === 'X') {
            return {
                winner: 'X',
                label: 'Player (X) Wins!',
                detail: 'Player (X) completed a winning 3-in-a-row line.',
                playerWinPct: 100,
                drawPct: 0,
                aiWinPct: 0,
                barPercent: 100,
                forcedPlies: 0,
            };
        }
        return {
            winner: 'O',
            label: 'AI (O) Wins!',
            detail: 'AI (O) completed a winning 3-in-a-row line.',
            playerWinPct: 0,
            drawPct: 0,
            aiWinPct: 100,
            barPercent: 0,
            forcedPlies: 0,
        };
    }
    if (isBoardFull(board)) {
        return {
            winner: 'DRAW',
            label: 'Match Drawn',
            detail: 'All 9 grid nodes occupied with no winning alignment.',
            playerWinPct: 0,
            drawPct: 100,
            aiWinPct: 0,
            barPercent: 50,
            forcedPlies: null,
        };
    }
    const work = cloneBoard(board);
    const solved = solveSubtree(work, nextTurn);
    const [playerWinPct, drawPct, aiWinPct] = roundPercentages(solved.pX, solved.pDraw, solved.pO);
    if (solved.winner === 'X') {
        const plies = solved.forcedPlies ?? 1;
        return {
            winner: 'X',
            label: `Player (X) — Forced Win in ${plies}`,
            detail: plies === 1
                ? 'Player (X) can lock in victory on the very next move.'
                : `Optimal play guarantees Player (X) wins in ${plies} plies.`,
            playerWinPct,
            drawPct,
            aiWinPct,
            barPercent: clamp(Math.round(98 - (plies - 1) * 3), 75, 98),
            forcedPlies: plies,
        };
    }
    if (solved.winner === 'O') {
        const plies = solved.forcedPlies ?? 1;
        return {
            winner: 'O',
            label: `AI (O) — Forced Win in ${plies}`,
            detail: plies === 1
                ? 'AI (O) holds an immediate winning threat on the next turn.'
                : `Optimal play guarantees AI (O) wins in ${plies} plies.`,
            playerWinPct,
            drawPct,
            aiWinPct,
            barPercent: clamp(Math.round(2 + (plies - 1) * 3), 2, 25),
            forcedPlies: plies,
        };
    }
    const barPercent = clamp(Math.round(playerWinPct + drawPct * 0.5), 28, 72);
    return {
        winner: 'DRAW',
        label: 'Draw (Optimal Play)',
        detail: nextTurn === 'X'
            ? 'Perfect play from both sides ends in a draw; Player (X) holds opening initiative.'
            : 'Perfect play from both sides ends in a draw; AI (O) holds next-move initiative.',
        playerWinPct,
        drawPct,
        aiWinPct,
        barPercent,
        forcedPlies: null,
    };
}
//# sourceMappingURL=ai.js.map