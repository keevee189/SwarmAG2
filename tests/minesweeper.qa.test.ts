import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MinesweeperEngine,
  createSeededRng,
} from '../ts/games/minesweeper/engine.js';
import { createAppServer, resolveDefaultRootDir } from '../ts/server.js';
import { withBrowserPage, type BrowserPage } from './helpers/cdp.js';

async function startEphemeralServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = createAppServer(resolveDefaultRootDir());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function stopServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

describe('Quantum Minesweeper — Adversarial & Logic Edge Cases', () => {
  it('guarantees 0 mines in the 3x3 first-click zone and exact mine totals across 50 randomized trials per difficulty', () => {
    const pickRng = createSeededRng(20261122);

    for (const diff of DIFFICULTY_ORDER) {
      const cfg = DIFFICULTIES[diff];

      for (let trial = 0; trial < 50; trial += 1) {
        const engine = new MinesweeperEngine({
          difficulty: diff,
          rng: createSeededRng(10_000 + trial * 131 + cfg.mines * 17),
        });

        assert.equal(engine.isMinesPlaced(), false);
        assert.equal(engine.getStatus(), 'idle');

        // Mix corners, edges, center, and arbitrary interior points
        let clickR: number;
        let clickC: number;
        if (trial === 0) {
          clickR = 0;
          clickC = 0;
        } else if (trial === 1) {
          clickR = 0;
          clickC = cfg.cols - 1;
        } else if (trial === 2) {
          clickR = cfg.rows - 1;
          clickC = 0;
        } else if (trial === 3) {
          clickR = cfg.rows - 1;
          clickC = cfg.cols - 1;
        } else if (trial === 4) {
          clickR = Math.floor(cfg.rows / 2);
          clickC = Math.floor(cfg.cols / 2);
        } else {
          clickR = Math.floor(pickRng() * cfg.rows);
          clickC = Math.floor(pickRng() * cfg.cols);
        }

        const res = engine.reveal(clickR, clickC);
        assert.equal(res.ok, true, `${diff} trial ${trial} reveal(${clickR},${clickC}) should succeed`);
        assert.equal(res.detonated, false);
        assert.equal(engine.isMinesPlaced(), true);
        assert.equal(engine.getStatus(), 'playing');

        const snap = engine.getSnapshot();
        const mineCount = snap.board.filter((c) => c.hasMine).length;
        assert.equal(
          mineCount,
          cfg.mines,
          `${diff} trial ${trial}: expected ${cfg.mines} mines, found ${mineCount}`,
        );

        // Verify 3x3 exclusion zone has 0 mines and all in-bounds cells were revealed
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const rr = clickR + dr;
            const cc = clickC + dc;
            if (rr >= 0 && rr < cfg.rows && cc >= 0 && cc < cfg.cols) {
              const zoneCell = engine.getCell(rr, cc);
              assert.ok(zoneCell);
              assert.equal(
                zoneCell.hasMine,
                false,
                `${diff} trial ${trial}: mine found in 3x3 exclusion zone at (${rr},${cc}) around (${clickR},${clickC})`,
              );
              assert.equal(zoneCell.revealed, true);
            }
          }
        }

        // Verify adjacentMines invariants across the entire board
        for (const cell of snap.board) {
          if (cell.hasMine) {
            assert.equal(cell.adjacentMines, 0);
            continue;
          }
          let expectedAdj = 0;
          for (let dr = -1; dr <= 1; dr += 1) {
            for (let dc = -1; dc <= 1; dc += 1) {
              if (dr === 0 && dc === 0) continue;
              const n = engine.getCell(cell.row + dr, cell.col + dc);
              if (n?.hasMine) {
                expectedAdj += 1;
              }
            }
          }
          assert.equal(
            cell.adjacentMines,
            expectedAdj,
            `${diff} trial ${trial}: adjacentMines mismatch at (${cell.row},${cell.col})`,
          );
        }

        assert.equal(snap.safeLeft, snap.totalSafeCells - snap.revealedSafeCount);
      }
    }
  });

  it('solves forced pairwise subset and overlapping deductions deterministically and falls back to lowest-risk probability', () => {
    // 1. Strict subset deduction (A subset of B with equal count => B \ A is 100% safe)
    // 3x5 board, mines at (0,0), (0,3), (2,4). Revealing (2,0)=0 opens rows 1 & 2 up to col 3.
    // (1,0)=1 => {(0,0),(0,1)}:1 ; (1,1)=1 => {(0,0),(0,1),(0,2)}:1 => (0,2) is 100% SAFE.
    // Remaining cells stay ambiguous => only (0,2) is provable.
    const subsetEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    subsetEngine.loadCustomMineLayout(
      [
        [0, 0],
        [0, 3],
        [2, 4],
      ],
      { rows: 3, cols: 5 },
    );
    const cascade = subsetEngine.reveal(2, 0);
    assert.equal(cascade.ok, true);
    assert.equal(subsetEngine.getCell(0, 2)?.revealed, false);

    const subsetHint = subsetEngine.getHint();
    assert.ok(subsetHint);
    assert.equal(subsetHint.kind, 'safe');
    assert.equal(subsetHint.action, 'reveal');
    assert.equal(subsetHint.certainty, 1);
    assert.equal(subsetHint.mineProbability, 0);
    assert.equal(subsetHint.row, 0);
    assert.equal(subsetHint.col, 2);

    // 2. Non-subset overlapping difference deduction (neither set is a subset of the other)
    // 4x4 board, mines at (0,2),(0,3),(1,0),(1,3),(2,0),(2,1),(2,2),(2,3).
    // Flag (1,0),(1,3),(2,0..3), then reveal (1,1) and (1,2):
    // (1,1) => {(0,0),(0,1),(0,2)}: 1 ; (1,2) => {(0,1),(0,2),(0,3)}: 2
    // Overlapping difference proves (0,0) SAFE and (0,3) MINE, while (0,1)/(0,2) remain uncertain!
    const overlapEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    overlapEngine.loadCustomMineLayout(
      [
        [0, 2],
        [0, 3],
        [1, 0],
        [1, 3],
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
      ],
      { rows: 4, cols: 4 },
    );
    overlapEngine.toggleFlag(1, 0);
    overlapEngine.toggleFlag(1, 3);
    overlapEngine.toggleFlag(2, 0);
    overlapEngine.toggleFlag(2, 1);
    overlapEngine.toggleFlag(2, 2);
    overlapEngine.toggleFlag(2, 3);
    overlapEngine.reveal(1, 1);
    overlapEngine.reveal(1, 2);

    const safeOverlapHint = overlapEngine.getHint();
    assert.ok(safeOverlapHint);
    assert.equal(safeOverlapHint.kind, 'safe');
    assert.equal(safeOverlapHint.action, 'reveal');
    assert.equal(safeOverlapHint.certainty, 1);
    assert.equal(safeOverlapHint.row, 0);
    assert.equal(safeOverlapHint.col, 0);

    // After revealing (0,0), (0,1) becomes directly deduced safe; reveal (0,1) too, then verify
    // a dedicated strict-subset board where ONLY provable mines exist (zero provable safe cells).
    const revealSafe = overlapEngine.reveal(0, 0);
    assert.equal(revealSafe.ok, true);
    assert.equal(revealSafe.detonated, false);

    const mineSubsetEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    mineSubsetEngine.loadCustomMineLayout(
      [
        [0, 0],
        [0, 2],
        [0, 3],
        [1, 3],
        [2, 3],
        [3, 0],
        [3, 2],
        [3, 3],
      ],
      { rows: 4, cols: 4 },
    );
    mineSubsetEngine.reveal(1, 0);
    mineSubsetEngine.reveal(1, 1);
    mineSubsetEngine.reveal(1, 2);
    mineSubsetEngine.reveal(2, 0);
    mineSubsetEngine.reveal(2, 1);
    mineSubsetEngine.reveal(2, 2);

    const mineSubsetHint = mineSubsetEngine.getHint();
    assert.ok(mineSubsetHint);
    assert.equal(mineSubsetHint.kind, 'mine');
    assert.equal(mineSubsetHint.action, 'flag');
    assert.equal(mineSubsetHint.certainty, 1);
    assert.equal(mineSubsetHint.mineProbability, 1);
    assert.ok(
      (mineSubsetHint.row === 0 && mineSubsetHint.col === 2) ||
        (mineSubsetHint.row === 3 && mineSubsetHint.col === 2),
    );

    // 3. Probability fallback when no deterministic deduction exists
    // 2x5 board, 4 mines at (0,1),(0,2),(1,3),(1,4). Reveal (0,0)=1.
    // Frontier {(0,1),(1,0),(1,1)} has ~33.3% risk; non-frontier 6 cells with 3 left mines have 50% risk.
    const guessEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    guessEngine.loadCustomMineLayout(
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [1, 4],
      ],
      { rows: 2, cols: 5 },
    );
    guessEngine.reveal(0, 0);

    const guessHint = guessEngine.getHint();
    assert.ok(guessHint);
    assert.equal(guessHint.kind, 'guess');
    assert.equal(guessHint.action, 'reveal');
    assert.ok(
      guessHint.mineProbability > 0.3 && guessHint.mineProbability < 0.36,
      `Expected ~0.333 mineProbability, got ${guessHint.mineProbability}`,
    );
    assert.ok(
      (guessHint.row === 0 && guessHint.col === 1) ||
        (guessHint.row === 1 && guessHint.col === 0) ||
        (guessHint.row === 1 && guessHint.col === 1),
    );
  });

  it('handles all chording edge cases: insufficient/excess flags, no-op saturated, cascade reveal, and mis-flagged detonation', () => {
    const engine = new MinesweeperEngine({ difficulty: 'beginner' });
    engine.loadCustomMineLayout(
      [
        [0, 0],
        [0, 1],
      ],
      { rows: 5, cols: 5 },
    );

    // Cannot chord while unrevealed or out of bounds
    assert.equal(engine.chord(-1, 0).reason, 'out-of-bounds');
    assert.equal(engine.chord(1, 1).reason, 'not-revealed');

    // Reveal (1,1)=2 and (4,4)=0? Wait: revealing (1,1) reveals just (1,1)=2.
    engine.reveal(1, 1);
    assert.equal(engine.getCell(1, 1)?.adjacentMines, 2);

    // Insufficient flags (0/2 and 1/2) -> no-op
    const zeroFlagsChord = engine.chord(1, 1);
    assert.equal(zeroFlagsChord.ok, false);
    assert.equal(zeroFlagsChord.reason, 'flag-count-mismatch');

    engine.toggleFlag(0, 0);
    const oneFlagChord = engine.chord(1, 1);
    assert.equal(oneFlagChord.ok, false);
    assert.equal(oneFlagChord.reason, 'flag-count-mismatch');
    assert.equal(engine.getSnapshot().revealedSafeCount, 1);

    // Excess flags (3/2) -> no-op
    engine.toggleFlag(0, 1);
    engine.toggleFlag(0, 2);
    const excessFlagChord = engine.chord(1, 1);
    assert.equal(excessFlagChord.ok, false);
    assert.equal(excessFlagChord.reason, 'flag-count-mismatch');
    assert.equal(engine.getStatus(), 'playing');

    // Unflag extra (0,2), now exact 2/2 flags -> chord triggers BFS cascade & wins 5x5 board
    engine.toggleFlag(0, 2);
    const safeChord = engine.chord(1, 1);
    assert.equal(safeChord.ok, true);
    assert.equal(safeChord.detonated, false);
    assert.equal(safeChord.status, 'won');
    assert.ok(safeChord.newlyRevealed.length >= 22);
    assert.ok(safeChord.pointsAwarded > 0);

    // Test zero-cell and no-unrevealed-neighbors chord rejections on active board
    const partialEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    partialEngine.loadCustomMineLayout([[0, 0], [3, 4], [4, 3]], { rows: 5, cols: 5 });
    partialEngine.reveal(2, 2); // 0-cell cascade leaves (4,4) isolated unrevealed so status stays 'playing'
    assert.equal(partialEngine.getStatus(), 'playing');
    assert.equal(partialEngine.chord(2, 2).reason, 'zero-cell');
    partialEngine.toggleFlag(0, 0);
    assert.equal(partialEngine.chord(1, 1).reason, 'no-unrevealed-neighbors');

    // Mis-flagged neighbor detonation (flag (0,1) instead of mine (0,0), then chord (1,1)=1)
    const misFlagEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    misFlagEngine.loadCustomMineLayout(
      [
        [0, 0],
        [4, 4],
      ],
      { rows: 5, cols: 5 },
    );
    misFlagEngine.reveal(1, 1);
    misFlagEngine.toggleFlag(0, 1);
    const badChord = misFlagEngine.chord(1, 1);
    assert.equal(badChord.ok, true);
    assert.equal(badChord.detonated, true);
    assert.equal(badChord.status, 'lost');
    assert.equal(badChord.pointsAwarded, 0);
    assert.equal(misFlagEngine.getCell(0, 0)?.detonated, true);
    assert.equal(misFlagEngine.getCell(4, 4)?.revealed, true);
    assert.equal(misFlagEngine.getCell(0, 1)?.wrongFlag, true);
  });

  it('enforces post-terminal input lock after victory and detonation', () => {
    // Win lock
    const winEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    winEngine.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
    const winRes = winEngine.reveal(2, 2);
    assert.equal(winRes.status, 'won');
    const winScore = winEngine.getScore();

    assert.deepEqual(winEngine.reveal(0, 0).reason, 'game-over');
    assert.deepEqual(winEngine.reveal(1, 1).reason, 'game-over');
    assert.deepEqual(winEngine.toggleFlag(0, 0).reason, 'game-over');
    assert.deepEqual(winEngine.chord(1, 1).reason, 'not-playing');
    assert.equal(winEngine.getHint(), null);
    assert.equal(winEngine.requestHint(), null);
    winEngine.tick(10_000);
    assert.equal(winEngine.getElapsedMs(), 0);
    assert.equal(winEngine.getScore(), winScore);

    // Detonation lock
    const loseEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    loseEngine.loadCustomMineLayout([[0, 0], [2, 2]], { rows: 3, cols: 3 });
    loseEngine.reveal(1, 1);
    const loseScore = loseEngine.getScore();
    const boom = loseEngine.reveal(0, 0);
    assert.equal(boom.status, 'lost');

    assert.equal(loseEngine.reveal(1, 0).reason, 'game-over');
    assert.equal(loseEngine.toggleFlag(1, 0).reason, 'game-over');
    assert.equal(loseEngine.chord(1, 1).reason, 'not-playing');
    assert.equal(loseEngine.getHint(), null);
    assert.equal(loseEngine.requestHint(), null);
    loseEngine.tick(10_000);
    assert.equal(loseEngine.getElapsedMs(), 0);
    assert.equal(loseEngine.getScore(), loseScore);
  });

  it('handles rapid start/reset/difficulty switches while preserving per-difficulty high scores', () => {
    const engine = new MinesweeperEngine({
      difficulty: 'beginner',
      rng: createSeededRng(4242),
    });

    engine.start();
    engine.tick(3200);
    engine.reveal(4, 4);
    const begScore = engine.getScore();
    assert.ok(begScore > 0);
    assert.equal(engine.getHighScore('beginner'), begScore);

    // Rapid switch to intermediate -> start -> reset -> switch to expert
    engine.setDifficulty('intermediate');
    assert.equal(engine.getStatus(), 'idle');
    assert.equal(engine.getRows(), 12);
    assert.equal(engine.getCols(), 12);
    assert.equal(engine.getTotalMines(), 22);
    assert.equal(engine.getMinesLeft(), 22);
    assert.equal(engine.getSafeLeft(), 122);
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getElapsedMs(), 0);
    assert.equal(engine.isMinesPlaced(), false);

    engine.start();
    assert.equal(engine.getStatus(), 'playing');
    engine.reveal(5, 5);
    const intScore = engine.getScore();
    assert.ok(intScore > 0);
    engine.requestHint();
    assert.equal(engine.getHintsUsed(), 1);

    engine.reset();
    assert.equal(engine.getStatus(), 'idle');
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getHintsUsed(), 0);
    assert.equal(engine.getActiveHint(), null);
    assert.equal(engine.getHighScore('intermediate'), intScore);
    assert.equal(engine.getHighScore('beginner'), begScore);

    engine.setDifficulty('expert');
    assert.equal(engine.getRows(), 16);
    assert.equal(engine.getCols(), 16);
    assert.equal(engine.getTotalMines(), 40);
    assert.equal(engine.getMinesLeft(), 40);
    assert.equal(engine.getSafeLeft(), 216);

    engine.start();
    engine.start(); // rapid re-start
    assert.equal(engine.getStatus(), 'playing');
    assert.equal(engine.isMinesPlaced(), false);

    engine.setDifficulty('beginner');
    assert.equal(engine.getRows(), 9);
    assert.equal(engine.getMinesLeft(), 10);
    assert.equal(engine.getHighScore('beginner'), begScore);
  });

  it('transitions getWinForecast() cleanly across CERTAIN WIN, DEDUCTIBLE, FAVORABLE, RISKY, VICTORY, and DETONATED', () => {
    // 1. Idle FAVORABLE (85%)
    const idleEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    const fIdle = idleEngine.getWinForecast();
    assert.equal(fIdle.label, 'FAVORABLE');
    assert.equal(fIdle.percent, 85);

    // 2. Active mid-game FAVORABLE (low risk <= 25%, no deterministic deduction)
    // 4x4 board, 1 mine at (0,0) -> wait: if totalMines=1 and (1,1)=1, solver deduces outside cells are 0%!
    // So use 2 mines: (0,0) and (3,3). Reveal (2,2)=1 (neighbors 8? No, reveal (1,1)=1 -> 3 mines? Let's place 2 mines: (0,0) and (3,3),
    // reveal (1,1)=1 (neighbors (0,0),(0,1),(0,2),(1,0),(1,2),(2,0),(2,1),(2,2) -> 1/8 = 12.5%!)
    // Remaining 7 non-frontier cells have 1 left mine -> 1/7 = 14.3%! Both <= 25%, NO 100% deductions!
    const favEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    favEngine.loadCustomMineLayout(
      [
        [0, 0],
        [3, 3],
      ],
      { rows: 4, cols: 4 },
    );
    favEngine.reveal(1, 1);
    const fActiveFav = favEngine.getWinForecast();
    assert.equal(fActiveFav.label, 'FAVORABLE');
    assert.ok(fActiveFav.percent >= 52 && fActiveFav.percent <= 73);

    // 3. DEDUCTIBLE
    const dedEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    dedEngine.loadCustomMineLayout(
      [
        [0, 0],
        [0, 3],
        [2, 4],
      ],
      { rows: 3, cols: 5 },
    );
    dedEngine.reveal(2, 0);
    const fDed = dedEngine.getWinForecast();
    assert.equal(fDed.label, 'DEDUCTIBLE');
    assert.ok(fDed.percent >= 74 && fDed.percent <= 93);

    // 4. CERTAIN WIN -> VICTORY
    const certainEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    certainEngine.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
    certainEngine.reveal(1, 1);
    certainEngine.toggleFlag(0, 0);
    const fCertain = certainEngine.getWinForecast();
    assert.equal(fCertain.label, 'CERTAIN WIN');
    assert.ok(fCertain.percent >= 94 && fCertain.percent <= 99);

    certainEngine.chord(1, 1);
    const fWin = certainEngine.getWinForecast();
    assert.equal(fWin.label, 'VICTORY');
    assert.equal(fWin.percent, 100);

    // 5. RISKY (high-risk frontier) -> DETONATED
    const riskyEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    riskyEngine.loadCustomMineLayout(
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [1, 4],
      ],
      { rows: 2, cols: 5 },
    );
    riskyEngine.reveal(0, 0);
    const fRisky = riskyEngine.getWinForecast();
    assert.equal(fRisky.label, 'RISKY');
    assert.ok(fRisky.percent < 55);

    riskyEngine.reveal(0, 1);
    const fDet = riskyEngine.getWinForecast();
    assert.equal(fDet.label, 'DETONATED');
    assert.equal(fDet.percent, 0);

    // 6. RISKY via flag contradiction
    const conflictEngine = new MinesweeperEngine({ difficulty: 'beginner' });
    conflictEngine.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
    conflictEngine.reveal(1, 1); // adjacentMines = 1
    conflictEngine.toggleFlag(0, 1);
    conflictEngine.toggleFlag(0, 2); // 2 flags adjacent to a '1' -> contradiction
    const fConflict = conflictEngine.getWinForecast();
    assert.equal(fConflict.label, 'RISKY');
    assert.match(fConflict.detail, /conflict/i);
  });

  it('clamps hint penalty at 0, deduplicates repeated hint calls, and clears activeHint on flag/reveal', () => {
    const engine = new MinesweeperEngine({ difficulty: 'beginner' });
    engine.loadCustomMineLayout([[0, 0], [3, 3]], { rows: 4, cols: 4 });

    // Score is 0 -> hint penalty does not produce negative score
    const h0 = engine.requestHint();
    assert.ok(h0);
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getHintsUsed(), 1);

    // Flagging a different cell leaves activeHint, flagging hinted cell clears activeHint
    engine.toggleFlag(0, 1);
    assert.ok(engine.getActiveHint() !== null);
    engine.toggleFlag(h0.row, h0.col);
    assert.equal(engine.getActiveHint(), null);

    // Unflag (0,1) and reveal safe cell (1,1)
    engine.toggleFlag(0, 1);
    engine.toggleFlag(h0.row, h0.col);
    engine.reveal(1, 1);
    assert.equal(engine.getScore(), 10);

    const h1 = engine.requestHint();
    assert.ok(h1);
    assert.equal(engine.getScore(), 0); // 10 - 25 clamped to 0
    assert.equal(engine.getHintsUsed(), 2);

    // Repeat identical hint does not increment hintsUsed
    engine.requestHint();
    assert.equal(engine.getHintsUsed(), 2);

    // High score guard ignores invalid / lower values
    engine.setHighScore('expert', Number.NaN);
    assert.equal(engine.getHighScore('expert'), 0);
    engine.setHighScore('expert', 500);
    engine.setHighScore('expert', 200);
    assert.equal(engine.getHighScore('expert'), 500);
  });
});

describe('Quantum Minesweeper — Real Headless Chrome E2E (CDP)', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const started = await startEphemeralServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  after(async () => {
    await stopServer(server);
  });

  async function assertCleanViewportFit(page: BrowserPage, contextLabel: string): Promise<void> {
    const metrics = await page.evaluate<{
      scrollWidth: number;
      innerWidth: number;
      scrollHeight: number;
      innerHeight: number;
      frameInsideViewport: boolean;
      frameRect: { left: number; top: number; right: number; bottom: number };
    }>(`(() => {
      const doc = document.documentElement;
      const frame = document.getElementById('mine-board-frame');
      const r = frame.getBoundingClientRect();
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        scrollHeight: doc.scrollHeight,
        innerHeight: window.innerHeight,
        frameInsideViewport:
          r.left >= -1 &&
          r.top >= -1 &&
          r.right <= window.innerWidth + 1 &&
          r.bottom <= window.innerHeight + 1,
        frameRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      };
    })()`);

    assert.ok(
      metrics.scrollWidth <= metrics.innerWidth,
      `${contextLabel}: horizontal overflow (${metrics.scrollWidth} > ${metrics.innerWidth})`,
    );
    assert.ok(
      metrics.scrollHeight <= metrics.innerHeight,
      `${contextLabel}: vertical overflow (${metrics.scrollHeight} > ${metrics.innerHeight})`,
    );
    assert.equal(
      metrics.frameInsideViewport,
      true,
      `${contextLabel}: #mine-board-frame exceeded viewport (${JSON.stringify(metrics.frameRect)})`,
    );
  }

  it('loads cleanly at 1440x900 with zero overflow across Beginner, Intermediate, and Expert difficulties', async () => {
    await withBrowserPage(
      `${baseUrl}/games/minesweeper.html`,
      async (page) => {
        // Back to Arcade link check
        const backHref = await page.evaluate<string | null>(
          `document.querySelector('.arcade-back-link')?.getAttribute('href') ?? null`,
        );
        assert.equal(backHref, '../index.html');

        // Beginner default (9x9, 10 mines)
        const beg = await page.evaluate<{
          cells: number;
          difficulty: string | null;
          minesLeft: string | null;
          safeLeft: string | null;
          gridMeta: string | null;
          forecastLabel: string | null;
        }>(`({
          cells: document.querySelectorAll('.mine-cell').length,
          difficulty: document.getElementById('mine-board-frame')?.getAttribute('data-difficulty') ?? null,
          minesLeft: document.getElementById('mines-left-value')?.textContent?.trim() ?? null,
          safeLeft: document.getElementById('safe-left-value')?.textContent?.trim() ?? null,
          gridMeta: document.getElementById('forecast-grid-meta')?.textContent?.trim() ?? null,
          forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? null,
        })`);

        assert.equal(beg.cells, 81);
        assert.equal(beg.difficulty, 'beginner');
        assert.equal(beg.minesLeft, '10');
        assert.equal(beg.safeLeft, '71');
        assert.equal(beg.gridMeta, '9×9 // 10 MINES');
        assert.equal(beg.forecastLabel, 'FAVORABLE');
        await assertCleanViewportFit(page, 'Beginner 9x9 at 1440x900');

        // Switch to Intermediate (12x12, 22 mines)
        await page.click('#difficulty-control [data-difficulty="intermediate"]');
        await page.waitFor("document.querySelectorAll('.mine-cell').length === 144");
        const inter = await page.evaluate<{
          difficulty: string | null;
          minesLeft: string | null;
          safeLeft: string | null;
          gridMeta: string | null;
        }>(`({
          difficulty: document.getElementById('mine-board-frame')?.getAttribute('data-difficulty') ?? null,
          minesLeft: document.getElementById('mines-left-value')?.textContent?.trim() ?? null,
          safeLeft: document.getElementById('safe-left-value')?.textContent?.trim() ?? null,
          gridMeta: document.getElementById('forecast-grid-meta')?.textContent?.trim() ?? null,
        })`);
        assert.equal(inter.difficulty, 'intermediate');
        assert.equal(inter.minesLeft, '22');
        assert.equal(inter.safeLeft, '122');
        assert.equal(inter.gridMeta, '12×12 // 22 MINES');
        await assertCleanViewportFit(page, 'Intermediate 12x12 at 1440x900');

        // Switch to Expert (16x16, 40 mines)
        await page.click('#difficulty-control [data-difficulty="expert"]');
        await page.waitFor("document.querySelectorAll('.mine-cell').length === 256");
        const expert = await page.evaluate<{
          difficulty: string | null;
          minesLeft: string | null;
          safeLeft: string | null;
          gridMeta: string | null;
        }>(`({
          difficulty: document.getElementById('mine-board-frame')?.getAttribute('data-difficulty') ?? null,
          minesLeft: document.getElementById('mines-left-value')?.textContent?.trim() ?? null,
          safeLeft: document.getElementById('safe-left-value')?.textContent?.trim() ?? null,
          gridMeta: document.getElementById('forecast-grid-meta')?.textContent?.trim() ?? null,
        })`);
        assert.equal(expert.difficulty, 'expert');
        assert.equal(expert.minesLeft, '40');
        assert.equal(expert.safeLeft, '216');
        assert.equal(expert.gridMeta, '16×16 // 40 MINES');
        await assertCleanViewportFit(page, 'Expert 16x16 at 1440x900');

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('exercises Start, first-click cascade, Flag Mode, Hint, keyboard shortcuts, timer teardown, and Reset', async () => {
    await withBrowserPage(
      `${baseUrl}/games/minesweeper.html`,
      async (page) => {
        // 1. Click Start -> active status
        await page.click('#start-btn');
        await page.waitFor(
          "document.getElementById('mine-board-frame')?.getAttribute('data-status') === 'playing'",
        );
        const startText = await page.evaluate<string | null>(
          `document.getElementById('start-btn')?.textContent?.trim() ?? null`,
        );
        assert.equal(startText, 'Restart');

        // 2. Click center cell (4,4) -> guaranteed safe 3x3 cascade
        await page.click('.mine-cell[data-row="4"][data-col="4"]');
        await page.waitFor(
          "document.querySelector('.mine-cell[data-row=\"4\"][data-col=\"4\"]')?.getAttribute('data-revealed') === 'true'",
        );

        const afterFirstClick = await page.evaluate<{
          revealedCount: number;
          safeLeft: number;
          score: number;
          highScore: number;
          forecastLabel: string;
          forecastPct: string;
          zoneAllRevealed: boolean;
        }>(`(() => {
          let zoneAllRevealed = true;
          for (let dr = -1; dr <= 1; dr += 1) {
            for (let dc = -1; dc <= 1; dc += 1) {
              const c = document.querySelector(\`.mine-cell[data-row="\${4 + dr}"][data-col="\${4 + dc}"]\`);
              if (!c || c.getAttribute('data-revealed') !== 'true') {
                zoneAllRevealed = false;
              }
            }
          }
          return {
            revealedCount: document.querySelectorAll('.mine-cell.is-revealed').length,
            safeLeft: Number(document.getElementById('safe-left-value')?.textContent ?? '-1'),
            score: Number(document.getElementById('score-value')?.textContent ?? '0'),
            highScore: Number(document.getElementById('high-score-value')?.textContent ?? '0'),
            forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
            forecastPct: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
            zoneAllRevealed,
          };
        })()`);

        assert.equal(afterFirstClick.zoneAllRevealed, true);
        assert.ok(afterFirstClick.revealedCount >= 9);
        assert.equal(afterFirstClick.safeLeft, 71 - afterFirstClick.revealedCount);
        assert.ok(afterFirstClick.score > 0);
        assert.equal(afterFirstClick.highScore, afterFirstClick.score);
        assert.ok(
          ['CERTAIN WIN', 'DEDUCTIBLE', 'FAVORABLE', 'RISKY'].includes(
            afterFirstClick.forecastLabel,
          ),
        );
        assert.match(afterFirstClick.forecastPct, /^\d+%$/);

        // 3. Toggle Flag Mode ON -> click an unrevealed cell -> verifies flag + mines-left decrement
        await page.click('#flag-mode-btn');
        await page.waitFor(
          "document.getElementById('mine-board-frame')?.getAttribute('data-flag-mode') === 'true'",
        );
        const flagBtnState = await page.evaluate<{
          pressed: string | null;
          label: string | null;
          modePill: string | null;
        }>(`({
          pressed: document.getElementById('flag-mode-btn')?.getAttribute('aria-pressed') ?? null,
          label: document.getElementById('flag-mode-label')?.textContent?.trim() ?? null,
          modePill: document.getElementById('mode-pill')?.textContent?.trim() ?? null,
        })`);
        assert.equal(flagBtnState.pressed, 'true');
        assert.equal(flagBtnState.label, 'Flag Mode: ON');
        assert.equal(flagBtnState.modePill, 'FLAG MODE');

        const unrevealedIndex = await page.evaluate<number>(`(() => {
          const el = document.querySelector('.mine-cell:not(.is-revealed):not(.is-flagged)');
          return el ? Number(el.getAttribute('data-index')) : -1;
        })()`);
        assert.ok(unrevealedIndex >= 0);

        await page.click(`.mine-cell[data-index="${unrevealedIndex}"]`);
        await page.waitFor(
          `document.querySelector('.mine-cell[data-index="${unrevealedIndex}"]')?.classList.contains('is-flagged') === true`,
        );
        const minesLeftAfterFlag = await page.evaluate<string | null>(
          `document.getElementById('mines-left-value')?.textContent?.trim() ?? null`,
        );
        assert.equal(minesLeftAfterFlag, '9');

        // Turn Flag Mode back OFF and verify flag guard prevents revealing flagged cell
        await page.click('#flag-mode-btn');
        await page.waitFor(
          "document.getElementById('mine-board-frame')?.getAttribute('data-flag-mode') === 'false'",
        );
        await page.click(`.mine-cell[data-index="${unrevealedIndex}"]`);
        const stillFlagged = await page.evaluate<boolean>(
          `document.querySelector('.mine-cell[data-index="${unrevealedIndex}"]')?.classList.contains('is-flagged') === true`,
        );
        assert.equal(stillFlagged, true);

        // 4. Click #hint-btn -> verifies [data-hint] highlight on board
        await page.click('#hint-btn');
        await page.waitFor("document.querySelectorAll('.mine-cell[data-hint]').length === 1");
        const hintAttr = await page.evaluate<string | null>(
          `document.querySelector('.mine-cell[data-hint]')?.getAttribute('data-hint') ?? null`,
        );
        assert.ok(hintAttr === 'safe' || hintAttr === 'mine' || hintAttr === 'guess');

        // Verify elapsed timer actually ticked (> 00:00) while playing before reset
        await page.waitFor("document.getElementById('timer-value')?.textContent?.trim() !== '00:00'");

        // 5. Click #reset-btn -> cleanly restores initial telemetry & stops timer
        await page.click('#reset-btn');
        await page.waitFor(
          "document.getElementById('mine-board-frame')?.getAttribute('data-status') === 'idle'",
        );
        const resetState = await page.evaluate<{
          score: string | null;
          minesLeft: string | null;
          safeLeft: string | null;
          timer: string | null;
          revealed: number;
          flagged: number;
          hints: number;
        }>(`({
          score: document.getElementById('score-value')?.textContent?.trim() ?? null,
          minesLeft: document.getElementById('mines-left-value')?.textContent?.trim() ?? null,
          safeLeft: document.getElementById('safe-left-value')?.textContent?.trim() ?? null,
          timer: document.getElementById('timer-value')?.textContent?.trim() ?? null,
          revealed: document.querySelectorAll('.mine-cell.is-revealed').length,
          flagged: document.querySelectorAll('.mine-cell.is-flagged').length,
          hints: document.querySelectorAll('.mine-cell[data-hint]').length,
        })`);
        assert.equal(resetState.score, '0');
        assert.equal(resetState.minesLeft, '10');
        assert.equal(resetState.safeLeft, '71');
        assert.equal(resetState.timer, '00:00');
        assert.equal(resetState.revealed, 0);
        assert.equal(resetState.flagged, 0);
        assert.equal(resetState.hints, 0);

        // Verify timer interval does NOT keep advancing after reset
        await new Promise((r) => setTimeout(r, 450));
        const timerAfterWait = await page.evaluate<string | null>(
          `document.getElementById('timer-value')?.textContent?.trim() ?? null`,
        );
        assert.equal(timerAfterWait, '00:00');

        // 6. Keyboard shortcuts: ArrowRight, F, Enter, H, R
        // After reset, cursor is at center (4,4) and no mines are placed yet.
        await page.pressKey('ArrowRight');
        await page.waitFor(
          "document.querySelector('.mine-cell[data-row=\"4\"][data-col=\"5\"]')?.classList.contains('is-cursor') === true",
        );

        // F flags (4,5) -> minesLeft becomes 9; F again unflags -> minesLeft returns to 10
        await page.pressKey('f');
        await page.waitFor(
          "document.querySelector('.mine-cell[data-row=\"4\"][data-col=\"5\"]')?.classList.contains('is-flagged') === true",
        );
        assert.equal(
          await page.evaluate<string | null>(
            `document.getElementById('mines-left-value')?.textContent?.trim() ?? null`,
          ),
          '9',
        );

        await page.pressKey('f');
        await page.waitFor(
          "document.querySelector('.mine-cell[data-row=\"4\"][data-col=\"5\"]')?.classList.contains('is-flagged') === false",
        );
        assert.equal(
          await page.evaluate<string | null>(
            `document.getElementById('mines-left-value')?.textContent?.trim() ?? null`,
          ),
          '10',
        );

        // Enter reveals (4,5) safely (guaranteed 3x3 opening cascade)
        await page.pressKey('Enter');
        await page.waitFor(
          "document.querySelector('.mine-cell[data-row=\"4\"][data-col=\"5\"]')?.getAttribute('data-revealed') === 'true'",
        );
        const kbScore = await page.evaluate<number>(
          `Number(document.getElementById('score-value')?.textContent ?? '0')`,
        );
        assert.ok(kbScore > 0);

        // H requests deduction hint
        await page.pressKey('h');
        await page.waitFor("document.querySelectorAll('.mine-cell[data-hint]').length === 1");

        // R resets board cleanly
        await page.pressKey('r');
        await page.waitFor(
          "document.getElementById('mine-board-frame')?.getAttribute('data-status') === 'idle'",
        );
        const afterKeyReset = await page.evaluate<{
          score: string | null;
          minesLeft: string | null;
          safeLeft: string | null;
          timer: string | null;
          revealed: number;
          hints: number;
        }>(`({
          score: document.getElementById('score-value')?.textContent?.trim() ?? null,
          minesLeft: document.getElementById('mines-left-value')?.textContent?.trim() ?? null,
          safeLeft: document.getElementById('safe-left-value')?.textContent?.trim() ?? null,
          timer: document.getElementById('timer-value')?.textContent?.trim() ?? null,
          revealed: document.querySelectorAll('.mine-cell.is-revealed').length,
          hints: document.querySelectorAll('.mine-cell[data-hint]').length,
        })`);
        assert.equal(afterKeyReset.score, '0');
        assert.equal(afterKeyReset.minesLeft, '10');
        assert.equal(afterKeyReset.safeLeft, '71');
        assert.equal(afterKeyReset.timer, '00:00');
        assert.equal(afterKeyReset.revealed, 0);
        assert.equal(afterKeyReset.hints, 0);

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
