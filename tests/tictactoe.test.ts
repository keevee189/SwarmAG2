import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseAIMove, findImmediateWinningMoves, predictWinner } from '../ts/games/tictactoe/ai.js';
import {
  AI_SYMBOL,
  CellValue,
  HUMAN_SYMBOL,
  PlayerSymbol,
  TicTacToeEngine,
  WINNING_LINES,
  checkWinner,
  cloneBoard,
  createEmptyBoard,
  getAvailableMoves,
} from '../ts/games/tictactoe/engine.js';

function playMovesSequence(
  engine: TicTacToeEngine,
  xMoves: number[],
  oMoves: number[],
  firstMover: PlayerSymbol = HUMAN_SYMBOL
): void {
  engine.start(firstMover);
  let xi = 0;
  let oi = 0;
  while (engine.getStatus() === 'playing') {
    const turn = engine.getCurrentTurn();
    const cell = turn === 'X' ? xMoves[xi++] : oMoves[oi++];
    assert.notEqual(cell, undefined, `Missing move for ${turn}`);
    const res = engine.playMove(cell, turn);
    assert.equal(res.ok, true, `Expected legal move at cell ${cell} for ${turn}: ${res.reason}`);
  }
}

test('all 8 winning lines are detected for both X and O', () => {
  const allCells = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  for (let lineIdx = 0; lineIdx < WINNING_LINES.length; lineIdx += 1) {
    const line = WINNING_LINES[lineIdx];
    const lineSet = new Set<number>(line);
    const nonLine = allCells.filter((idx) => !lineSet.has(idx));

    // Pick 2 non-collinear filler cells for the opponent so the opponent doesn't accidentally win first.
    let fillerPair: [number, number] | null = null;
    for (let a = 0; a < nonLine.length && !fillerPair; a += 1) {
      for (let b = a + 1; b < nonLine.length; b += 1) {
        const probe = createEmptyBoard();
        probe[nonLine[a]] = 'O';
        probe[nonLine[b]] = 'O';
        const remaining = nonLine.filter((i) => i !== nonLine[a] && i !== nonLine[b]);
        // Pick a third dummy for earlier checks? Only 2 moves needed for O when X moves first!
        assert.equal(remaining.length >= 1, true);
        fillerPair = [nonLine[a], nonLine[b]];
        break;
      }
    }
    assert.ok(fillerPair);

    // Test X winning on lineIdx (X goes first: 3 X moves, 2 O moves)
    const engineX = new TicTacToeEngine('X');
    playMovesSequence(engineX, [...line], fillerPair, 'X');
    assert.equal(engineX.getStatus(), 'won');
    assert.equal(engineX.getWinner(), 'X');
    assert.deepEqual(engineX.getWinningLine(), line);
    assert.equal(engineX.getWinningLineIndex(), lineIdx);
    assert.equal(engineX.getScores().playerWins, 1);
    assert.equal(engineX.getScores().streak, 1);

    // Test O winning on lineIdx (O goes first: 3 O moves, 2 X moves)
    const engineO = new TicTacToeEngine('O');
    playMovesSequence(engineO, fillerPair, [...line], 'O');
    assert.equal(engineO.getStatus(), 'won');
    assert.equal(engineO.getWinner(), 'O');
    assert.deepEqual(engineO.getWinningLine(), line);
    assert.equal(engineO.getWinningLineIndex(), lineIdx);
    assert.equal(engineO.getScores().aiWins, 1);
    assert.equal(engineO.getScores().streak, 0);
  }
});

test('draw detection triggers when all 9 cells are filled with no winner', () => {
  const engine = new TicTacToeEngine('X');
  // Board:
  // X O X
  // X O O
  // O X X
  // Move order: X0, O1, X2, O4, X3, O5, X7, O6, X8
  engine.start('X');
  const seq: Array<[number, PlayerSymbol]> = [
    [0, 'X'],
    [1, 'O'],
    [2, 'X'],
    [4, 'O'],
    [3, 'X'],
    [5, 'O'],
    [7, 'X'],
    [6, 'O'],
    [8, 'X'],
  ];

  for (const [cell, player] of seq) {
    const res = engine.playMove(cell, player);
    assert.equal(res.ok, true);
  }

  assert.equal(engine.getStatus(), 'draw');
  assert.equal(engine.getWinner(), null);
  assert.equal(engine.getWinningLine(), null);
  assert.equal(engine.getScores().draws, 1);
  assert.equal(engine.getScores().streak, 0);
});

test('rejects illegal moves: before start, occupied cell, out-of-bounds, wrong turn, and after game over', () => {
  const engine = new TicTacToeEngine('X');

  // Before start
  const beforeStart = engine.playMove(4, 'X');
  assert.equal(beforeStart.ok, false);
  assert.equal(engine.getBoard()[4], null);

  engine.start('X');

  // Out of bounds
  assert.equal(engine.playMove(-1, 'X').ok, false);
  assert.equal(engine.playMove(9, 'X').ok, false);
  assert.equal(engine.playMove(2.5, 'X').ok, false);
  assert.equal(engine.playMove(Number.NaN, 'X').ok, false);

  // Wrong expected turn
  assert.equal(engine.playMove(0, 'O').ok, false);

  // Valid move then occupied cell
  assert.equal(engine.playMove(4, 'X').ok, true);
  assert.equal(engine.playMove(4, 'O').ok, false);

  // Play to X win: O plays 1, X plays 0, O plays 2, X plays 8 (diagonal 0-4-8)
  assert.equal(engine.playMove(1, 'O').ok, true);
  assert.equal(engine.playMove(0, 'X').ok, true);
  assert.equal(engine.playMove(2, 'O').ok, true);
  const winMove = engine.playMove(8, 'X');
  assert.equal(winMove.ok, true);
  assert.equal(winMove.status, 'won');

  // After game over (won)
  assert.equal(engine.playMove(3).ok, false);
  assert.equal(engine.playMove(5).ok, false);

  // After game over (draw)
  const drawEngine = new TicTacToeEngine('X');
  playMovesSequence(drawEngine, [0, 2, 3, 7, 8], [1, 4, 5, 6], 'X');
  assert.equal(drawEngine.getStatus(), 'draw');
  assert.equal(drawEngine.playMove(0).ok, false);
});

test('Unbeatable AI NEVER loses across ALL possible human lines (both X-first and O-first)', () => {
  let terminalGamesXFirst = 0;
  let terminalGamesOFirst = 0;

  function exploreHumanLines(
    board: CellValue[],
    turn: PlayerSymbol,
    mode: 'x-first' | 'o-first'
  ): void {
    const win = checkWinner(board);
    if (win) {
      assert.notEqual(
        win.winner,
        HUMAN_SYMBOL,
        `Human (X) defeated Unbeatable AI (${mode}) on board: ${board.join(',')}`
      );
      if (mode === 'x-first') {
        terminalGamesXFirst += 1;
      } else {
        terminalGamesOFirst += 1;
      }
      return;
    }

    const available = getAvailableMoves(board);
    if (available.length === 0) {
      if (mode === 'x-first') {
        terminalGamesXFirst += 1;
      } else {
        terminalGamesOFirst += 1;
      }
      return;
    }

    if (turn === AI_SYMBOL) {
      const aiCell = chooseAIMove(board, 'unbeatable', AI_SYMBOL);
      assert.equal(board[aiCell], null, `AI picked occupied cell ${aiCell}`);
      const next = cloneBoard(board);
      next[aiCell] = AI_SYMBOL;
      exploreHumanLines(next, HUMAN_SYMBOL, mode);
    } else {
      for (const cell of available) {
        const next = cloneBoard(board);
        next[cell] = HUMAN_SYMBOL;
        exploreHumanLines(next, AI_SYMBOL, mode);
      }
    }
  }

  exploreHumanLines(createEmptyBoard(), HUMAN_SYMBOL, 'x-first');
  exploreHumanLines(createEmptyBoard(), AI_SYMBOL, 'o-first');

  assert.ok(terminalGamesXFirst > 100, `Expected many X-first paths, saw ${terminalGamesXFirst}`);
  assert.ok(terminalGamesOFirst > 20, `Expected many O-first paths, saw ${terminalGamesOFirst}`);
});

test('AI prefers immediate win over blocking opponent threat, and blocks when no immediate win exists', () => {
  // O has 3 & 4 (wins at 5); X has 0 & 1 (threatens 2).
  // Both Unbeatable and Tactical MUST play 5 (immediate win) instead of blocking 2!
  const winOverBlockBoard: CellValue[] = ['X', 'X', null, 'O', 'O', null, null, null, null];
  assert.equal(chooseAIMove(winOverBlockBoard, 'unbeatable', 'O'), 5);
  assert.equal(chooseAIMove(winOverBlockBoard, 'tactical', 'O', () => 0.99), 5);

  // O has only 4; X has 0 & 1 (threatens 2). Both Unbeatable and Tactical MUST block at 2.
  const mustBlockBoard: CellValue[] = ['X', 'X', null, null, 'O', null, null, null, null];
  assert.equal(chooseAIMove(mustBlockBoard, 'unbeatable', 'O'), 2);
  assert.equal(chooseAIMove(mustBlockBoard, 'tactical', 'O', () => 0.99), 2);
  assert.deepEqual(findImmediateWinningMoves(mustBlockBoard, 'X'), [2]);

  // Casual mode returns valid open moves and supports friendly openings.
  const empty = createEmptyBoard();
  const casualOpening = chooseAIMove(empty, 'casual', 'O', () => 0.0);
  assert.equal(empty[casualOpening], null);
  assert.notEqual(casualOpening, 4);
});

test('predictWinner() accurately solves empty, forced-win, and terminal boards', () => {
  // 1. Empty board (X to move)
  const emptyX = predictWinner(createEmptyBoard(), 'X');
  assert.equal(emptyX.winner, 'DRAW');
  assert.equal(emptyX.label, 'Draw (Optimal Play)');
  assert.equal(emptyX.forcedPlies, null);
  assert.equal(emptyX.playerWinPct + emptyX.drawPct + emptyX.aiWinPct, 100);
  assert.ok(emptyX.playerWinPct > emptyX.aiWinPct);

  // Empty board (O to move)
  const emptyO = predictWinner(createEmptyBoard(), 'O');
  assert.equal(emptyO.winner, 'DRAW');
  assert.equal(emptyO.label, 'Draw (Optimal Play)');
  assert.equal(emptyO.forcedPlies, null);
  assert.equal(emptyO.playerWinPct + emptyO.drawPct + emptyO.aiWinPct, 100);
  assert.ok(emptyO.aiWinPct > emptyO.playerWinPct);

  // 2. Forced win in 1 for Player (X)
  const winIn1X: CellValue[] = ['X', 'X', null, 'O', 'O', null, null, null, null];
  const predWin1 = predictWinner(winIn1X, 'X');
  assert.equal(predWin1.winner, 'X');
  assert.equal(predWin1.forcedPlies, 1);
  assert.equal(predWin1.label, 'Player (X) — Forced Win in 1');
  assert.ok(predWin1.playerWinPct > predWin1.aiWinPct);
  assert.ok(predWin1.barPercent >= 90);

  // 3. Forced win in 3 for Player (X): X creates double threat at cell 4 (fork 2 & 8)
  // Board:
  // X O .
  // O . .
  // X . .
  const winIn3X: CellValue[] = ['X', 'O', null, 'O', null, null, 'X', null, null];
  const predWin3 = predictWinner(winIn3X, 'X');
  assert.equal(predWin3.winner, 'X');
  assert.equal(predWin3.forcedPlies, 3);
  assert.equal(predWin3.label, 'Player (X) — Forced Win in 3');
  assert.ok(predWin3.playerWinPct > predWin3.aiWinPct);

  // 4. Forced win in 2 for AI (O) with X to move: O holds double threat at 1 and 8
  // Board:
  // O . O
  // X O .
  // X . .
  const winIn2O: CellValue[] = ['O', null, 'O', 'X', 'O', null, 'X', null, null];
  const predWin2O = predictWinner(winIn2O, 'X');
  assert.equal(predWin2O.winner, 'O');
  assert.equal(predWin2O.forcedPlies, 2);
  assert.equal(predWin2O.label, 'AI (O) — Forced Win in 2');
  assert.ok(predWin2O.aiWinPct > predWin2O.playerWinPct);
  assert.ok(predWin2O.barPercent <= 10);

  // 5. Terminal Player (X) Win
  const termX: CellValue[] = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  const predTermX = predictWinner(termX, 'O');
  assert.equal(predTermX.winner, 'X');
  assert.equal(predTermX.label, 'Player (X) Wins!');
  assert.equal(predTermX.playerWinPct, 100);
  assert.equal(predTermX.drawPct, 0);
  assert.equal(predTermX.aiWinPct, 0);
  assert.equal(predTermX.barPercent, 100);

  // 6. Terminal AI (O) Win
  const termO: CellValue[] = ['O', 'X', 'X', 'O', 'X', null, 'O', null, null];
  const predTermO = predictWinner(termO, 'X');
  assert.equal(predTermO.winner, 'O');
  assert.equal(predTermO.label, 'AI (O) Wins!');
  assert.equal(predTermO.playerWinPct, 0);
  assert.equal(predTermO.drawPct, 0);
  assert.equal(predTermO.aiWinPct, 100);
  assert.equal(predTermO.barPercent, 0);

  // 7. Terminal Draw
  const termDraw: CellValue[] = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  const predDraw = predictWinner(termDraw, 'O');
  assert.equal(predDraw.winner, 'DRAW');
  assert.equal(predDraw.label, 'Match Drawn');
  assert.equal(predDraw.forcedPlies, null);
  assert.equal(predDraw.playerWinPct, 0);
  assert.equal(predDraw.drawPct, 100);
  assert.equal(predDraw.aiWinPct, 0);
  assert.equal(predDraw.barPercent, 50);
});

test('reset() clears board, returns to idle, and increments matchGeneration to invalidate stale async AI callbacks', () => {
  const engine = new TicTacToeEngine('X');
  const gen0 = engine.getMatchGeneration();

  engine.start('X');
  const genAfterStart = engine.getMatchGeneration();
  assert.ok(genAfterStart > gen0);

  assert.equal(engine.playMove(4, 'X').ok, true);
  // Simulate pending AI move capturing generation token before reset
  const capturedAiGeneration = engine.getMatchGeneration();

  // Win streak test before reset
  assert.equal(engine.playMove(1, 'O').ok, true);
  assert.equal(engine.playMove(0, 'X').ok, true);
  assert.equal(engine.playMove(2, 'O').ok, true);
  assert.equal(engine.playMove(8, 'X').ok, true);
  assert.equal(engine.getScores().playerWins, 1);

  // Reset clears board, bumps matchGeneration, preserves scores by default
  const snap = engine.reset();
  assert.equal(snap.status, 'idle');
  assert.deepEqual(snap.board, createEmptyBoard());
  assert.equal(snap.winner, null);
  assert.equal(snap.winningLine, null);
  assert.equal(snap.moveCount, 0);
  assert.ok(snap.matchGeneration > capturedAiGeneration);
  assert.notEqual(engine.getMatchGeneration(), capturedAiGeneration);
  assert.equal(snap.scores.playerWins, 1);

  // Stale move after reset is rejected
  assert.equal(engine.playMove(2, 'O').ok, false);

  // Optional score reset
  const fullReset = engine.reset({ resetScores: true, firstMover: 'O' });
  assert.equal(fullReset.firstMover, 'O');
  assert.equal(fullReset.currentTurn, 'O');
  assert.equal(fullReset.scores.playerWins, 0);
  assert.equal(fullReset.scores.draws, 0);
  assert.equal(fullReset.scores.aiWins, 0);
  assert.equal(fullReset.scores.streak, 0);
});

test('engine snapshot returns defensive copies and supports setFirstMover cleanly', () => {
  const engine = new TicTacToeEngine('X');
  engine.setFirstMover('O');
  assert.equal(engine.getFirstMover(), 'O');
  assert.equal(engine.getCurrentTurn(), 'O');

  engine.start();
  assert.equal(engine.playMove(4, 'O').ok, true);

  const snap = engine.getSnapshot();
  snap.board[0] = 'X';
  snap.scores.playerWins = 99;
  snap.moveHistory.push(8);

  assert.equal(engine.getBoard()[0], null);
  assert.equal(engine.getScores().playerWins, 0);
  assert.deepEqual(engine.getMoveHistory(), [4]);
});

test('predictWinner identifies critical drawing defense and Tactical/Casual always pick legal moves', () => {
  // X threatens immediate win at 2; O must block at 2 to hold a draw.
  const criticalDefense: CellValue[] = ['X', 'X', null, null, 'O', null, null, null, null];
  const pred = predictWinner(criticalDefense, 'O');
  assert.equal(pred.winner, 'DRAW');
  assert.equal(pred.label, 'Draw (Optimal Play)');
  assert.equal(pred.forcedPlies, null);
  assert.equal(pred.playerWinPct + pred.drawPct + pred.aiWinPct, 100);
  assert.ok(pred.drawPct > pred.playerWinPct);

  const rngSamples = [0.0, 0.25, 0.5, 0.75, 0.99];
  for (const r of rngSamples) {
    const tac = chooseAIMove(criticalDefense, 'tactical', 'O', () => r);
    assert.equal(tac, 2);
    const cas = chooseAIMove(criticalDefense, 'casual', 'O', () => r);
    assert.equal(criticalDefense[cas], null);
  }
});
