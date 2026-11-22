import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  Difficulty,
  PredictedOutcome,
  chooseAIMove,
  findImmediateWinningMoves,
  predictWinner,
} from '../ts/games/tictactoe/ai.js';
import {
  CellValue,
  PlayerSymbol,
  TicTacToeEngine,
  WINNING_LINES,
  checkWinner,
  cloneBoard,
  createEmptyBoard,
  getAvailableMoves,
  getOpponent,
  isBoardFull,
} from '../ts/games/tictactoe/engine.js';
import { createAppServer, resolveDefaultRootDir } from '../ts/server.js';
import { withBrowserPage } from './helpers/cdp.js';

function resolveRepoRoot(): string {
  const defaultRoot = resolveDefaultRootDir();
  if (fs.existsSync(path.join(defaultRoot, 'games', 'tictactoe.html'))) {
    return defaultRoot;
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'games', 'tictactoe.html'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return defaultRoot;
}

interface OracleSolution {
  outcome: PredictedOutcome;
  forcedPlies: number | null;
}

/**
 * Independent, from-scratch minimax reference oracle (no shared code with ai.ts)
 * used to verify `predictWinner()` across forks, traps, and reachable states.
 */
function createReferenceOracle(): (board: readonly CellValue[], turn: PlayerSymbol) => OracleSolution {
  const memo = new Map<string, OracleSolution>();

  function solve(board: CellValue[], turn: PlayerSymbol): OracleSolution {
    const key = board.map((c) => c ?? '.').join('') + turn;
    const hit = memo.get(key);
    if (hit) {
      return hit;
    }

    const win = checkWinner(board);
    if (win) {
      const res: OracleSolution = { outcome: win.winner, forcedPlies: 0 };
      memo.set(key, res);
      return res;
    }
    if (isBoardFull(board)) {
      const res: OracleSolution = { outcome: 'DRAW', forcedPlies: null };
      memo.set(key, res);
      return res;
    }

    const opp = getOpponent(turn);
    const available = getAvailableMoves(board);
    const children: OracleSolution[] = [];

    for (const idx of available) {
      board[idx] = turn;
      children.push(solve(board, opp));
      board[idx] = null;
    }

    const winningChildren = children.filter((c) => c.outcome === turn);
    let res: OracleSolution;
    if (winningChildren.length > 0) {
      const fastest = Math.min(...winningChildren.map((c) => c.forcedPlies ?? 0));
      res = { outcome: turn, forcedPlies: 1 + fastest };
    } else if (children.some((c) => c.outcome === 'DRAW')) {
      res = { outcome: 'DRAW', forcedPlies: null };
    } else {
      const longestSurvival = Math.max(...children.map((c) => c.forcedPlies ?? 0));
      res = { outcome: opp, forcedPlies: 1 + longestSurvival };
    }

    memo.set(key, res);
    return res;
  }

  return (board: readonly CellValue[], turn: PlayerSymbol): OracleSolution =>
    solve(cloneBoard(board), turn);
}

function collectReachableStates(maxStatesPerDepth: number): Array<{ board: CellValue[]; turn: PlayerSymbol }> {
  const seen = new Set<string>();
  const collected: Array<{ board: CellValue[]; turn: PlayerSymbol }> = [];

  for (const openingTurn of ['X', 'O'] as const) {
    let frontier: Array<{ board: CellValue[]; turn: PlayerSymbol }> = [
      { board: createEmptyBoard(), turn: openingTurn },
    ];

    for (let ply = 0; ply <= 7; ply += 1) {
      const nextFrontier: Array<{ board: CellValue[]; turn: PlayerSymbol }> = [];
      let addedAtDepth = 0;

      for (const state of frontier) {
        const key = state.board.map((c) => c ?? '.').join('') + state.turn;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        collected.push(state);
        addedAtDepth += 1;

        if (checkWinner(state.board) || isBoardFull(state.board)) {
          continue;
        }

        const moves = getAvailableMoves(state.board);
        const opp = getOpponent(state.turn);
        for (const idx of moves) {
          if (nextFrontier.length >= maxStatesPerDepth * 3) {
            break;
          }
          const nextBoard = cloneBoard(state.board);
          nextBoard[idx] = state.turn;
          nextFrontier.push({ board: nextBoard, turn: opp });
        }

        if (addedAtDepth >= maxStatesPerDepth) {
          break;
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) {
        break;
      }
    }
  }

  return collected;
}

function assertPredictionIntegrity(
  board: readonly CellValue[],
  turn: PlayerSymbol,
  oracle: (b: readonly CellValue[], t: PlayerSymbol) => OracleSolution,
): void {
  const before = cloneBoard(board);
  const pred = predictWinner(board, turn);
  assert.deepEqual(board, before, 'predictWinner must not mutate input board');

  const expected = oracle(board, turn);
  assert.equal(pred.winner, expected.outcome, `Winner mismatch on [${board.join(',')}] turn=${turn}`);
  assert.equal(
    pred.forcedPlies,
    expected.forcedPlies,
    `forcedPlies mismatch on [${board.join(',')}] turn=${turn}`,
  );

  assert.equal(Number.isInteger(pred.playerWinPct), true);
  assert.equal(Number.isInteger(pred.drawPct), true);
  assert.equal(Number.isInteger(pred.aiWinPct), true);
  assert.ok(pred.playerWinPct >= 0 && pred.playerWinPct <= 100);
  assert.ok(pred.drawPct >= 0 && pred.drawPct <= 100);
  assert.ok(pred.aiWinPct >= 0 && pred.aiWinPct <= 100);
  assert.equal(pred.playerWinPct + pred.drawPct + pred.aiWinPct, 100);
  assert.ok(pred.barPercent >= 0 && pred.barPercent <= 100);
  assert.ok(pred.label.length > 0);
  assert.ok(pred.detail.length > 0);

  const terminalWin = checkWinner(board);
  if (terminalWin) {
    assert.equal(pred.forcedPlies, 0);
    assert.equal(pred.barPercent, terminalWin.winner === 'X' ? 100 : 0);
  } else if (isBoardFull(board)) {
    assert.equal(pred.forcedPlies, null);
    assert.equal(pred.barPercent, 50);
  } else if (pred.winner === 'X') {
    assert.ok(pred.barPercent >= 75 && pred.barPercent <= 98);
  } else if (pred.winner === 'O') {
    assert.ok(pred.barPercent >= 2 && pred.barPercent <= 25);
  } else {
    assert.ok(pred.barPercent >= 28 && pred.barPercent <= 72);
  }
}

describe('Tic-Tac-Toe QA: Minimax Oracle, Forks & AI Stress Tests', () => {
  it('predictWinner() matches independent minimax oracle across tricky forks, traps, forced N-ply wins, and terminal boards', () => {
    const oracle = createReferenceOracle();

    const trickyCases: Array<{
      desc: string;
      board: CellValue[];
      turn: PlayerSymbol;
      expectedWinner: PredictedOutcome;
      expectedPlies: number | null;
    }> = [
      {
        desc: 'empty board X to move',
        board: createEmptyBoard(),
        turn: 'X',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
      {
        desc: 'empty board O to move',
        board: createEmptyBoard(),
        turn: 'O',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
      {
        desc: 'X opened corner 0, O to move (only center draws)',
        board: ['X', null, null, null, null, null, null, null, null],
        turn: 'O',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
      {
        desc: 'X opened corner 0, O blundered edge 1 -> X forces fork win',
        board: ['X', 'O', null, null, null, null, null, null, null],
        turn: 'X',
        expectedWinner: 'X',
        expectedPlies: 5,
      },
      {
        desc: 'X opposite corners (0 & 8) with O center 4 -> O defends to draw',
        board: ['X', null, null, null, 'O', null, null, null, 'X'],
        turn: 'O',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
      {
        desc: 'X opposite corners (0 & 8), O blundered corner 2 -> X plays 6 for forced win in 3',
        board: ['X', null, 'O', null, 'O', null, null, null, 'X'],
        turn: 'X',
        expectedWinner: 'X',
        expectedPlies: 3,
      },
      {
        desc: 'O corner fork threat: O at 0 & 8, X at 4 & 2 -> X must play corner 6? No, X blunder at 1 loses in 2',
        board: ['O', 'X', null, null, 'X', null, null, null, 'O'],
        turn: 'O',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
      {
        desc: 'O double-threat fork on 1 & 8 with X to move -> O wins in 2 plies',
        board: ['O', null, 'O', 'X', 'O', null, 'X', null, null],
        turn: 'X',
        expectedWinner: 'O',
        expectedPlies: 2,
      },
      {
        desc: 'X forced win in 1 ply (diagonal)',
        board: ['X', 'O', null, 'O', 'X', null, null, null, null],
        turn: 'X',
        expectedWinner: 'X',
        expectedPlies: 1,
      },
      {
        desc: 'O forced win in 1 ply (right column)',
        board: ['X', 'X', 'O', null, 'X', 'O', null, null, null],
        turn: 'O',
        expectedWinner: 'O',
        expectedPlies: 1,
      },
      {
        desc: 'X forced win in 2 plies (O defending fork)',
        board: ['X', null, 'X', 'O', 'X', null, 'O', null, null],
        turn: 'O',
        expectedWinner: 'X',
        expectedPlies: 2,
      },
      {
        desc: 'Immediate terminal X win regardless of turn arg',
        board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
        turn: 'O',
        expectedWinner: 'X',
        expectedPlies: 0,
      },
      {
        desc: 'Immediate terminal O win regardless of turn arg',
        board: ['X', 'O', null, 'X', 'O', null, null, 'O', 'X'],
        turn: 'X',
        expectedWinner: 'O',
        expectedPlies: 0,
      },
      {
        desc: 'Immediate terminal draw',
        board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'],
        turn: 'X',
        expectedWinner: 'DRAW',
        expectedPlies: null,
      },
    ];

    for (const tc of trickyCases) {
      assertPredictionIntegrity(tc.board, tc.turn, oracle);
      const pred = predictWinner(tc.board, tc.turn);
      assert.equal(pred.winner, tc.expectedWinner, `${tc.desc}: wrong winner`);
      assert.equal(pred.forcedPlies, tc.expectedPlies, `${tc.desc}: wrong forcedPlies`);
    }

    // Systematic sweep across 250+ reachable states from ply 0 through ply 7
    const reachable = collectReachableStates(40);
    assert.ok(reachable.length >= 150, `Expected >= 150 reachable states, got ${reachable.length}`);
    for (const state of reachable) {
      assertPredictionIntegrity(state.board, state.turn, oracle);
    }
  });

  it('Unbeatable AI is mathematically unbeatable as BOTH O and X (1st and 2nd player)', () => {
    function verifyUnbeatable(aiSymbol: PlayerSymbol, firstTurn: PlayerSymbol): number {
      const oppSymbol = getOpponent(aiSymbol);
      let leaves = 0;

      function dfs(board: CellValue[], turn: PlayerSymbol): void {
        const win = checkWinner(board);
        if (win) {
          assert.notEqual(
            win.winner,
            oppSymbol,
            `Unbeatable AI (${aiSymbol}, first=${firstTurn}) lost on board [${board.join(',')}]`,
          );
          leaves += 1;
          return;
        }
        const open = getAvailableMoves(board);
        if (open.length === 0) {
          leaves += 1;
          return;
        }

        if (turn === aiSymbol) {
          const move = chooseAIMove(board, 'unbeatable', aiSymbol);
          assert.equal(Number.isInteger(move) && move >= 0 && move <= 8, true);
          assert.equal(board[move], null, `AI chose occupied cell ${move}`);
          const next = cloneBoard(board);
          next[move] = aiSymbol;
          dfs(next, oppSymbol);
        } else {
          for (const idx of open) {
            const next = cloneBoard(board);
            next[idx] = oppSymbol;
            dfs(next, aiSymbol);
          }
        }
      }

      dfs(createEmptyBoard(), firstTurn);
      return leaves;
    }

    const leavesO2nd = verifyUnbeatable('O', 'X');
    const leavesO1st = verifyUnbeatable('O', 'O');
    const leavesX1st = verifyUnbeatable('X', 'X');
    const leavesX2nd = verifyUnbeatable('X', 'O');

    assert.ok(leavesO2nd > 100);
    assert.ok(leavesO1st > 20);
    assert.ok(leavesX1st > 20);
    assert.ok(leavesX2nd > 100);
  });

  it('Unbeatable & Tactical take mate-in-1 over blocking, block when needed, and Tactical/Casual always return legal cells', () => {
    // Disjoint column win (6) vs opponent column threat (8):
    // X at 2 & 5 (threatens 8), O at 0 & 3 (wins at 6).
    const colWinOverBlock: CellValue[] = ['O', null, 'X', 'O', null, 'X', null, null, null];
    assert.equal(chooseAIMove(colWinOverBlock, 'unbeatable', 'O'), 6);
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      assert.equal(chooseAIMove(colWinOverBlock, 'tactical', 'O', () => r), 6);
    }

    // Also test AI as 'X' taking win at 8 over blocking O at 6
    const xWinOverBlock: CellValue[] = ['O', null, 'X', 'O', null, 'X', null, null, null];
    assert.equal(chooseAIMove(xWinOverBlock, 'unbeatable', 'X'), 8);
    assert.equal(chooseAIMove(xWinOverBlock, 'tactical', 'X', () => 0.95), 8);

    // Must block when opponent threatens bottom row at 7:
    const mustBlockBottom: CellValue[] = [null, null, null, null, 'O', null, 'X', null, 'X'];
    assert.equal(chooseAIMove(mustBlockBottom, 'unbeatable', 'O'), 7);
    assert.equal(chooseAIMove(mustBlockBottom, 'tactical', 'O', () => 0.99), 7);
    assert.deepEqual(findImmediateWinningMoves(mustBlockBottom, 'X'), [7]);

    // Stress Tactical & Casual across diverse non-terminal states and RNG thresholds
    const states = collectReachableStates(30).filter(
      (s) => !checkWinner(s.board) && !isBoardFull(s.board),
    );
    const rngValues = [0, 0.1, 0.44, 0.619, 0.62, 0.779, 0.78, 0.9999];
    const difficulties: Difficulty[] = ['tactical', 'casual'];

    for (const state of states) {
      for (const diff of difficulties) {
        for (const r of rngValues) {
          const move = chooseAIMove(state.board, diff, state.turn, () => r);
          assert.equal(Number.isInteger(move) && move >= 0 && move <= 8, true);
          assert.equal(
            state.board[move],
            null,
            `${diff} returned occupied cell ${move} for rng=${r}`,
          );
        }
      }
    }

    // Casual mode with rng=0.99 skips blocks & opens casually, proving it is beatable
    const casualEngine = new TicTacToeEngine('X');
    casualEngine.start('X');
    assert.equal(casualEngine.playMove(0, 'X').ok, true);
    const o1 = chooseAIMove(casualEngine.getBoard(), 'casual', 'O', () => 0.99);
    assert.equal(casualEngine.playMove(o1, 'O').ok, true);
    // Pick an empty row/col/diag line for X that O hasn't blocked
    const board1 = casualEngine.getBoard();
    const xLine = WINNING_LINES.find((line) => line.every((c) => board1[c] !== 'O'));
    assert.ok(xLine, 'Expected at least one unblocked line for X');
    const remainingX = xLine.filter((c) => board1[c] === null);
    for (let i = 0; i < remainingX.length; i += 1) {
      assert.equal(casualEngine.playMove(remainingX[i], 'X').ok, true);
      if (casualEngine.getStatus() === 'playing') {
        const oMove = chooseAIMove(casualEngine.getBoard(), 'casual', 'O', () => 0.99);
        assert.notEqual(oMove, remainingX[i + 1], 'rng=0.99 casual move should pick last open cell');
        assert.equal(casualEngine.playMove(oMove, 'O').ok, true);
      }
    }
    assert.equal(casualEngine.getStatus(), 'won');
    assert.equal(casualEngine.getWinner(), 'X');

    // Full board must throw
    const fullBoard: CellValue[] = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    assert.throws(() => chooseAIMove(fullBoard, 'unbeatable', 'O'));
    assert.throws(() => chooseAIMove(fullBoard, 'tactical', 'O'));
    assert.throws(() => chooseAIMove(fullBoard, 'casual', 'O'));
  });

  it('engine enforces matchGeneration cancellation, illegal move guards, and streak/bestStreak tracking', () => {
    const engine = new TicTacToeEngine('X');

    // Illegal before start
    assert.equal(engine.playMove(0).ok, false);
    assert.equal(engine.getMoveCount(), 0);

    // setFirstMover while idle updates currentTurn
    engine.setFirstMover('O');
    assert.equal(engine.getCurrentTurn(), 'O');

    engine.start('X');
    const gen1 = engine.getMatchGeneration();
    assert.equal(engine.getCurrentTurn(), 'X');

    // setFirstMover while playing does NOT corrupt currentTurn mid-match
    engine.setFirstMover('O');
    assert.equal(engine.getCurrentTurn(), 'X');

    // Illegal moves during playing
    assert.equal(engine.playMove(Infinity, 'X').ok, false);
    assert.equal(engine.playMove(-1, 'X').ok, false);
    assert.equal(engine.playMove(9, 'X').ok, false);
    assert.equal(engine.playMove(4, 'O').ok, false);

    // First X win -> streak 1, bestStreak 1
    assert.equal(engine.playMove(0, 'X').ok, true);
    assert.equal(engine.playMove(3, 'O').ok, true);
    assert.equal(engine.playMove(1, 'X').ok, true);
    assert.equal(engine.playMove(4, 'O').ok, true);
    assert.equal(engine.playMove(2, 'X').ok, true);
    assert.equal(engine.getStatus(), 'won');
    assert.equal(engine.getScores().streak, 1);
    assert.equal(engine.getScores().bestStreak, 1);
    assert.equal(engine.playMove(5).ok, false);

    // Second X win -> streak 2, bestStreak 2
    engine.start('X');
    const gen2 = engine.getMatchGeneration();
    assert.ok(gen2 > gen1);
    assert.equal(engine.playMove(0, 'X').ok, true);
    assert.equal(engine.playMove(3, 'O').ok, true);
    assert.equal(engine.playMove(4, 'X').ok, true);
    assert.equal(engine.playMove(5, 'O').ok, true);
    assert.equal(engine.playMove(8, 'X').ok, true);
    assert.equal(engine.getScores().playerWins, 2);
    assert.equal(engine.getScores().streak, 2);
    assert.equal(engine.getScores().bestStreak, 2);

    // Draw resets streak to 0 while preserving bestStreak = 2
    engine.start('X');
    const drawSeq: Array<[number, PlayerSymbol]> = [
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
    for (const [c, p] of drawSeq) {
      assert.equal(engine.playMove(c, p).ok, true);
    }
    assert.equal(engine.getStatus(), 'draw');
    assert.equal(engine.getScores().draws, 1);
    assert.equal(engine.getScores().streak, 0);
    assert.equal(engine.getScores().bestStreak, 2);

    // Simulate captured matchGeneration before reset mid-AI-turn
    engine.start('X');
    assert.equal(engine.playMove(4, 'X').ok, true);
    const staleGen = engine.getMatchGeneration();
    const afterReset = engine.reset({ firstMover: 'O' });
    assert.ok(afterReset.matchGeneration > staleGen);
    assert.equal(afterReset.status, 'idle');
    assert.equal(afterReset.firstMover, 'O');
    assert.equal(afterReset.currentTurn, 'O');
    assert.equal(engine.playMove(0, 'O').ok, false);

    // resetScores clears everything including bestStreak
    const hardReset = engine.reset({ resetScores: true, firstMover: 'X' });
    assert.deepEqual(hardReset.scores, {
      playerWins: 0,
      draws: 0,
      aiWins: 0,
      streak: 0,
      bestStreak: 0,
    });
  });
});

describe('Tic-Tac-Toe QA: Real Headless Chrome E2E (/games/tictactoe.html)', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    server = createAppServer(resolveRepoRoot());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        baseUrl = `http://127.0.0.1:${addr.port}/games/tictactoe.html`;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('loads cleanly at 1440x900 with Back to Arcade link, controls, viewport fit, pre-start guard, and mute toggle', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const snapshot = await page.evaluate<{
          backHref: string | null;
          startText: string | null;
          resetText: string | null;
          statusAttr: string | null;
          cellCount: number;
          markCount: number;
          scrollWidth: number;
          innerWidth: number;
          innerHeight: number;
          stageRect: { right: number; bottom: number; width: number; height: number };
          defaultDiff: string | null;
          defaultFirst: string | null;
          scores: string[];
          predLabel: string | null;
          probs: string[];
          laserVisible: boolean;
        }>(`(() => {
          const back = document.querySelector('.arcade-back-link');
          const stage = document.getElementById('ttt-grid-stage');
          const r = stage ? stage.getBoundingClientRect() : { right: 0, bottom: 0, width: 0, height: 0 };
          return {
            backHref: back ? back.getAttribute('href') : null,
            startText: document.getElementById('start-btn')?.textContent?.trim() ?? null,
            resetText: document.getElementById('reset-btn')?.textContent?.trim() ?? null,
            statusAttr: stage?.getAttribute('data-status') ?? null,
            cellCount: document.querySelectorAll('.ttt-cell').length,
            markCount: document.querySelectorAll('.cell-mark .ttt-svg').length,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            stageRect: { right: r.right, bottom: r.bottom, width: r.width, height: r.height },
            defaultDiff: document.querySelector('#difficulty-control .is-active')?.getAttribute('data-difficulty') ?? null,
            defaultFirst: document.querySelector('#first-mover-control .is-active')?.getAttribute('data-first-mover') ?? null,
            scores: ['player-score', 'draw-score', 'ai-score', 'streak-value'].map(
              id => document.getElementById(id)?.textContent?.trim() ?? ''
            ),
            predLabel: document.getElementById('predicted-winner-label')?.textContent?.trim() ?? null,
            probs: ['player-prob', 'draw-prob', 'ai-prob'].map(
              id => document.getElementById(id)?.textContent?.trim() ?? ''
            ),
            laserVisible: document.getElementById('win-laser-overlay')?.classList.contains('is-visible') ?? false,
          };
        })()`);

        assert.equal(snapshot.backHref, '../index.html');
        assert.equal(snapshot.startText, 'Start');
        assert.equal(snapshot.resetText, 'Reset');
        assert.equal(snapshot.statusAttr, 'idle');
        assert.equal(snapshot.cellCount, 9);
        assert.equal(snapshot.markCount, 0);
        assert.ok(snapshot.scrollWidth <= snapshot.innerWidth, `Horizontal overflow: ${snapshot.scrollWidth} > ${snapshot.innerWidth}`);
        assert.ok(snapshot.stageRect.width > 200 && snapshot.stageRect.height > 200);
        assert.ok(snapshot.stageRect.right <= snapshot.innerWidth);
        assert.ok(snapshot.stageRect.bottom <= snapshot.innerHeight);
        assert.equal(snapshot.defaultDiff, 'unbeatable');
        assert.equal(snapshot.defaultFirst, 'X');
        assert.deepEqual(snapshot.scores, ['0', '0', '0', '0']);
        assert.equal(snapshot.predLabel, 'Draw (Optimal Play)');
        assert.equal(snapshot.laserVisible, false);

        const probSum = snapshot.probs.reduce((acc, s) => {
          const m = /(\d+)%/.exec(s);
          return acc + (m ? Number(m[1]) : -1000);
        }, 0);
        assert.equal(probSum, 100);

        // Clicking a cell before Start must be rejected cleanly
        await page.click('[data-cell="4"]');
        const afterPreClick = await page.evaluate<{ statusAttr: string | null; marks: number; msg: string | null }>(`({
          statusAttr: document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null,
          marks: document.querySelectorAll('.cell-mark .ttt-svg').length,
          msg: document.getElementById('status-message')?.textContent?.trim() ?? null,
        })`);
        assert.equal(afterPreClick.statusAttr, 'idle');
        assert.equal(afterPreClick.marks, 0);
        assert.match(afterPreClick.msg ?? '', /Press Start/i);

        // Mute toggle works cleanly
        const muteBefore = await page.evaluate<string | null>(
          `document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') ?? null`,
        );
        await page.click('[data-mute-toggle]');
        const muteAfter = await page.evaluate<string | null>(
          `document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') ?? null`,
        );
        assert.notEqual(muteBefore, muteAfter);
        await page.click('[data-mute-toggle]');

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('plays a complete Player-first Unbeatable match to terminal Draw, updating predictor, SVG marks, and scoreboard', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        await page.click('#start-btn');
        await page.waitFor(`document.getElementById('ttt-grid-stage')?.getAttribute('data-status') === 'playing'`);

        // X clicks center (4)
        await page.click('[data-cell="4"]');
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-x').length === 1`);
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-o').length === 1`);

        const midMatch = await page.evaluate<{
          cell4Svg: boolean;
          xPaths: number;
          oCircles: number;
          turnPill: string | null;
          predLabel: string | null;
          probsText: string[];
          fillWidth: string;
        }>(`(() => ({
          cell4Svg: Boolean(document.querySelector('[data-cell="4"] .cell-mark .ttt-svg-x')),
          xPaths: document.querySelectorAll('[data-cell="4"] .cell-mark .x-stroke').length,
          oCircles: document.querySelectorAll('.cell-mark .ttt-svg-o .o-stroke').length,
          turnPill: document.getElementById('turn-pill')?.textContent?.trim() ?? null,
          predLabel: document.getElementById('predicted-winner-label')?.textContent?.trim() ?? null,
          probsText: ['player-prob', 'draw-prob', 'ai-prob'].map(id => document.getElementById(id)?.textContent?.trim() ?? ''),
          fillWidth: document.getElementById('predictor-fill')?.style.width ?? '',
        }))()`);

        assert.equal(midMatch.cell4Svg, true);
        assert.equal(midMatch.xPaths, 2);
        assert.equal(midMatch.oCircles, 1);
        assert.equal(midMatch.turnPill, 'TURN: X');
        assert.ok((midMatch.predLabel ?? '').length > 0);
        assert.match(midMatch.fillWidth, /^\d+(\.\d+)?%$/);

        const midProbSum = midMatch.probsText.reduce((acc, s) => {
          const m = /(\d+)%/.exec(s);
          return acc + (m ? Number(m[1]) : -1000);
        }, 0);
        assert.equal(midProbSum, 100);

        // Play through to terminal state (Unbeatable mode: X cannot win)
        for (let step = 0; step < 6; step += 1) {
          const state = await page.evaluate<{ status: string | null; nextCell: string | null }>(`(() => {
            const st = document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null;
            const playable = Array.from(document.querySelectorAll('.ttt-cell[data-playable="true"]'));
            // Prefer blocking/center-adjacent safe cells first to test optimal Draw path, or any playable
            const first = playable[0]?.getAttribute('data-cell') ?? null;
            return { status: st, nextCell: first };
          })()`);

          if (state.status === 'won' || state.status === 'draw') {
            break;
          }
          assert.notEqual(state.nextCell, null, 'Expected a playable cell while match is active');
          const prevXCount = await page.evaluate<number>(
            `document.querySelectorAll('.cell-mark .ttt-svg-x').length`,
          );
          await page.click(`[data-cell="${state.nextCell}"]`);
          await page.waitFor(
            `document.querySelectorAll('.cell-mark .ttt-svg-x').length === ${prevXCount + 1}`,
          );
          await page.waitFor(`(() => {
            const st = document.getElementById('ttt-grid-stage')?.getAttribute('data-status');
            if (st === 'won' || st === 'draw') return true;
            return document.getElementById('turn-pill')?.textContent?.trim() === 'TURN: X';
          })()`);
        }

        const terminal = await page.evaluate<{
          status: string | null;
          playerScore: number;
          drawScore: number;
          aiScore: number;
          startBtnText: string | null;
          predLabel: string | null;
          drawProb: string | null;
        }>(`({
          status: document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null,
          playerScore: Number(document.getElementById('player-score')?.textContent ?? '0'),
          drawScore: Number(document.getElementById('draw-score')?.textContent ?? '0'),
          aiScore: Number(document.getElementById('ai-score')?.textContent ?? '0'),
          startBtnText: document.getElementById('start-btn')?.textContent?.trim() ?? null,
          predLabel: document.getElementById('predicted-winner-label')?.textContent?.trim() ?? null,
          drawProb: document.getElementById('draw-prob')?.textContent?.trim() ?? null,
        })`);

        assert.ok(terminal.status === 'draw' || terminal.status === 'won');
        assert.equal(terminal.playerScore, 0, 'Unbeatable AI must never lose to player');
        assert.ok(terminal.drawScore + terminal.aiScore >= 1, 'Scoreboard must record terminal result');
        assert.equal(terminal.startBtnText, 'Play Again');
        if (terminal.status === 'draw') {
          assert.equal(terminal.predLabel, 'Match Drawn');
          assert.equal(terminal.drawProb, 'Draw: 100%');
        }

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('plays an AI-first Unbeatable match to AI win, verifying winning laser overlay, winning cell glow, and AI scoreboard', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        await page.click('#first-mover-control [data-first-mover="O"]');
        await page.click('#start-btn');

        // Wait for AI (O) to place opening move at center (4)
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-o').length === 1`);
        await page.waitFor(`document.getElementById('turn-pill')?.textContent?.trim() === 'TURN: X'`);

        // X plays edge 1 -> Unbeatable O plays corner 0 -> X plays 2 -> Unbeatable O plays 8 and wins [0,4,8]
        await page.click('[data-cell="1"]');
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-o').length === 2`);
        await page.waitFor(`document.getElementById('turn-pill')?.textContent?.trim() === 'TURN: X'`);

        // Click an open non-blocking cell (cell 2 if playable, else first playable) to let O win
        const nextCell = await page.evaluate<string | null>(`(() => {
          const c2 = document.querySelector('[data-cell="2"][data-playable="true"]');
          if (c2) return '2';
          return document.querySelector('.ttt-cell[data-playable="true"]')?.getAttribute('data-cell') ?? null;
        })()`);
        assert.notEqual(nextCell, null);
        await page.click(`[data-cell="${nextCell}"]`);

        // Wait up to 3 more turns just in case AI took a different optimal winning corner order
        for (let extra = 0; extra < 3; extra += 1) {
          const done = await page.evaluate<boolean>(
            `document.getElementById('ttt-grid-stage')?.getAttribute('data-status') === 'won'`,
          );
          if (done) break;
          await page.waitFor(`(() => {
            const st = document.getElementById('ttt-grid-stage')?.getAttribute('data-status');
            return st === 'won' || st === 'draw' || document.getElementById('turn-pill')?.textContent?.trim() === 'TURN: X';
          })()`);
          const stNow = await page.evaluate<string | null>(
            `document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null`,
          );
          if (stNow === 'won' || stNow === 'draw') break;
          const openCell = await page.evaluate<string | null>(
            `document.querySelector('.ttt-cell[data-playable="true"]')?.getAttribute('data-cell') ?? null`,
          );
          if (openCell !== null) {
            await page.click(`[data-cell="${openCell}"]`);
          }
        }

        await page.waitFor(`document.getElementById('ttt-grid-stage')?.getAttribute('data-status') === 'won'`);

        const winState = await page.evaluate<{
          turnPill: string | null;
          aiScore: string | null;
          bannerDefeat: boolean;
          laserVisible: boolean;
          laserAiWin: boolean;
          winningOCells: number;
          lineAttrs: { x1: string | null; y1: string | null; x2: string | null; y2: string | null };
          predLabel: string | null;
          aiProb: string | null;
        }>(`(() => {
          const laser = document.getElementById('win-laser-overlay');
          const line = document.getElementById('win-laser-line');
          return {
            turnPill: document.getElementById('turn-pill')?.textContent?.trim() ?? null,
            aiScore: document.getElementById('ai-score')?.textContent?.trim() ?? null,
            bannerDefeat: document.getElementById('status-banner')?.classList.contains('is-defeat') ?? false,
            laserVisible: laser?.classList.contains('is-visible') ?? false,
            laserAiWin: laser?.classList.contains('is-ai-win') ?? false,
            winningOCells: document.querySelectorAll('.ttt-cell.is-winning-o').length,
            lineAttrs: {
              x1: line?.getAttribute('x1') ?? null,
              y1: line?.getAttribute('y1') ?? null,
              x2: line?.getAttribute('x2') ?? null,
              y2: line?.getAttribute('y2') ?? null,
            },
            predLabel: document.getElementById('predicted-winner-label')?.textContent?.trim() ?? null,
            aiProb: document.getElementById('ai-prob')?.textContent?.trim() ?? null,
          };
        })()`);

        assert.equal(winState.turnPill, 'O WINS');
        assert.equal(winState.aiScore, '1');
        assert.equal(winState.bannerDefeat, true);
        assert.equal(winState.laserVisible, true);
        assert.equal(winState.laserAiWin, true);
        assert.equal(winState.winningOCells, 3);
        assert.notEqual(`${winState.lineAttrs.x1},${winState.lineAttrs.y1}`, `${winState.lineAttrs.x2},${winState.lineAttrs.y2}`);
        assert.equal(winState.predLabel, 'AI (O) Wins!');
        assert.equal(winState.aiProb, 'O: 100%');

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('cancels stale AI timeouts on Reset & First-Mover switch mid-AI-turn and supports keyboard shortcuts (1-9, Arrows+Space, R, Enter)', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        // 1. Reset mid-AI-turn cancels pending AI timeout cleanly
        await page.click('#start-btn');
        await page.click('[data-cell="4"]');
        await page.click('#reset-btn');

        // Wait well beyond AI_MOVE_DELAY_MS (240ms) to confirm no stale AI mark appears
        await new Promise((r) => setTimeout(r, 420));

        const afterMidReset = await page.evaluate<{
          status: string | null;
          markCount: number;
          dataMarks: string[];
          laserVisible: boolean;
        }>(`({
          status: document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null,
          markCount: document.querySelectorAll('.cell-mark .ttt-svg').length,
          dataMarks: Array.from(document.querySelectorAll('.ttt-cell')).map(el => el.getAttribute('data-mark') ?? ''),
          laserVisible: document.getElementById('win-laser-overlay')?.classList.contains('is-visible') ?? false,
        })`);

        assert.equal(afterMidReset.status, 'idle');
        assert.equal(afterMidReset.markCount, 0);
        assert.deepEqual(afterMidReset.dataMarks, Array<string>(9).fill(''));
        assert.equal(afterMidReset.laserVisible, false);

        // 2. Switching first-mover mid-AI-turn also resets and cancels pending AI move
        await page.click('#start-btn');
        await page.click('[data-cell="0"]');
        await page.click('#first-mover-control [data-first-mover="O"]');
        await new Promise((r) => setTimeout(r, 420));

        const afterMoverSwitch = await page.evaluate<{
          status: string | null;
          markCount: number;
          activeFirst: string | null;
        }>(`({
          status: document.getElementById('ttt-grid-stage')?.getAttribute('data-status') ?? null,
          markCount: document.querySelectorAll('.cell-mark .ttt-svg').length,
          activeFirst: document.querySelector('#first-mover-control .is-active')?.getAttribute('data-first-mover') ?? null,
        })`);
        assert.equal(afterMoverSwitch.status, 'idle');
        assert.equal(afterMoverSwitch.markCount, 0);
        assert.equal(afterMoverSwitch.activeFirst, 'O');

        // 3. Switch back to Player (X) First and test Difficulty switching + Keyboard shortcuts
        await page.click('#first-mover-control [data-first-mover="X"]');
        await page.click('#difficulty-control [data-difficulty="tactical"]');
        const diffActive = await page.evaluate<string | null>(
          `document.querySelector('#difficulty-control [data-difficulty="tactical"]')?.getAttribute('aria-pressed') ?? null`,
        );
        assert.equal(diffActive, 'true');

        // Blur button so Enter triggers Start when idle
        await page.evaluate(`(document.activeElement instanceof HTMLElement) && document.activeElement.blur()`);
        await page.pressKey('Enter');
        await page.waitFor(`document.getElementById('ttt-grid-stage')?.getAttribute('data-status') === 'playing'`);

        // Key '5' claims center cell (index 4)
        await page.pressKey('5');
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-x').length === 1`);
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-o').length === 1`);

        const afterKey5 = await page.evaluate<{ cell4Mark: string | null; focused: string | null }>(`({
          cell4Mark: document.querySelector('[data-cell="4"]')?.getAttribute('data-mark') ?? null,
          focused: document.activeElement?.getAttribute('data-cell') ?? null,
        })`);
        assert.equal(afterKey5.cell4Mark, 'X');
        assert.equal(afterKey5.focused, '4');

        // Arrow navigation to an empty cell + Space to place second X mark
        for (let i = 0; i < 8; i += 1) {
          await page.pressKey('ArrowRight');
          const playable = await page.evaluate<boolean>(
            `document.activeElement?.getAttribute('data-playable') === 'true'`,
          );
          if (playable) {
            break;
          }
        }
        await page.pressKey(' ');
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-x').length === 2`);
        await page.waitFor(`document.querySelectorAll('.cell-mark .ttt-svg-o').length === 2`);

        // Key 'r' resets board cleanly & cancels any pending state
        await page.pressKey('r');
        await page.waitFor(`document.getElementById('ttt-grid-stage')?.getAttribute('data-status') === 'idle'`);
        const afterKeyR = await page.evaluate<number>(
          `document.querySelectorAll('.cell-mark .ttt-svg').length`,
        );
        assert.equal(afterKeyR, 0);

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
