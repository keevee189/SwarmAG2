import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  ALL_DIRECTIONS,
  CELL_COUNT,
  Direction,
  ForecastLabel,
  GRID_SIZE,
  Game2048Engine,
  GameMode,
  GameStatus,
  WIN_TILE_VALUE,
  createSeededRng,
  evaluateGridHeuristic,
  getBestTile,
  getEmptyIndices,
  hasAdjacentMerge,
  hasAnyLegalMove,
  slideGrid,
} from '../ts/games/game2048/engine.js';
import { createAppServer, resolveDefaultRootDir } from '../ts/server.js';
import { withBrowserPage } from './helpers/cdp.js';

const VALID_FORECAST_LABELS: readonly ForecastLabel[] = [
  'LOCKED IN',
  'STRONG FLOW',
  'BALANCED',
  'TIGHT GRID',
  'CRITICAL',
  '2048 REACHED',
  'GRID LOCKED',
];

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

/**
 * Independent reference oracle for 4x4 2048 line sliding & merging.
 * Written from scratch without sharing code with `engine.ts`.
 */
function referenceSlideLine(line: readonly number[]): {
  result: [number, number, number, number];
  scoreDelta: number;
  merges: number;
  moved: boolean;
} {
  const nonZero = line.filter((v) => v > 0);
  const out: number[] = [];
  let scoreDelta = 0;
  let merges = 0;

  let i = 0;
  while (i < nonZero.length) {
    if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
      const merged = nonZero[i] * 2;
      out.push(merged);
      scoreDelta += merged;
      merges += 1;
      i += 2;
    } else {
      out.push(nonZero[i]);
      i += 1;
    }
  }
  while (out.length < GRID_SIZE) {
    out.push(0);
  }

  const result: [number, number, number, number] = [out[0], out[1], out[2], out[3]];
  const moved = result.some((v, idx) => v !== line[idx]);
  return { result, scoreDelta, merges, moved };
}

function referenceSlideGrid(
  grid: readonly number[],
  direction: Direction,
): { grid: number[]; scoreDelta: number; merges: number; moved: boolean } {
  const next = new Array<number>(CELL_COUNT).fill(0);
  let scoreDelta = 0;
  let merges = 0;
  let moved = false;

  for (let i = 0; i < GRID_SIZE; i += 1) {
    let coords: [number, number, number, number];
    if (direction === 'left') {
      const base = i * GRID_SIZE;
      coords = [base, base + 1, base + 2, base + 3];
    } else if (direction === 'right') {
      const base = i * GRID_SIZE;
      coords = [base + 3, base + 2, base + 1, base];
    } else if (direction === 'up') {
      coords = [i, i + 4, i + 8, i + 12];
    } else {
      coords = [i + 12, i + 8, i + 4, i];
    }

    const line = coords.map((idx) => grid[idx]);
    const res = referenceSlideLine(line);
    for (let p = 0; p < GRID_SIZE; p += 1) {
      next[coords[p]] = res.result[p];
    }
    scoreDelta += res.scoreDelta;
    merges += res.merges;
    if (res.moved) {
      moved = true;
    }
  }

  return { grid: next, scoreDelta, merges, moved };
}

function writeRowIntoGrid(row: readonly [number, number, number, number], rowIdx = 0): number[] {
  const g = new Array<number>(CELL_COUNT).fill(0);
  for (let c = 0; c < GRID_SIZE; c += 1) {
    g[rowIdx * GRID_SIZE + c] = row[c];
  }
  return g;
}

function writeColIntoGrid(col: readonly [number, number, number, number], colIdx = 0): number[] {
  const g = new Array<number>(CELL_COUNT).fill(0);
  for (let r = 0; r < GRID_SIZE; r += 1) {
    g[r * GRID_SIZE + colIdx] = col[r];
  }
  return g;
}

describe('Hyper 2048 QA — Adversarial & Heuristic Stress Suite', () => {
  it('verifies exhaustive merge-line edge cases in all 4 directions and cross-checks 200 random grids against reference oracle', () => {
    const cases: Array<{
      name: string;
      line: [number, number, number, number];
      forwardExpected: [number, number, number, number]; // left or up
      forwardScore: number;
      forwardMerges: number;
      forwardMoved: boolean;
      backwardExpected: [number, number, number, number]; // right or down (in forward index order)
      backwardScore: number;
      backwardMerges: number;
      backwardMoved: boolean;
    }> = [
      {
        name: '[2,2,2,2] double-pair merge',
        line: [2, 2, 2, 2],
        forwardExpected: [4, 4, 0, 0],
        forwardScore: 8,
        forwardMerges: 2,
        forwardMoved: true,
        backwardExpected: [0, 0, 4, 4],
        backwardScore: 8,
        backwardMerges: 2,
        backwardMoved: true,
      },
      {
        name: '[2,2,4,0] single-merge-per-turn guard',
        line: [2, 2, 4, 0],
        forwardExpected: [4, 4, 0, 0],
        forwardScore: 4,
        forwardMerges: 1,
        forwardMoved: true,
        backwardExpected: [0, 0, 4, 4],
        backwardScore: 4,
        backwardMerges: 1,
        backwardMoved: true,
      },
      {
        name: '[4,2,2,0] trailing pair merge',
        line: [4, 2, 2, 0],
        forwardExpected: [4, 4, 0, 0],
        forwardScore: 4,
        forwardMerges: 1,
        forwardMoved: true,
        backwardExpected: [0, 0, 4, 4],
        backwardScore: 4,
        backwardMerges: 1,
        backwardMoved: true,
      },
      {
        name: '[2,4,2,4] alternating no-op line',
        line: [2, 4, 2, 4],
        forwardExpected: [2, 4, 2, 4],
        forwardScore: 0,
        forwardMerges: 0,
        forwardMoved: false,
        backwardExpected: [2, 4, 2, 4],
        backwardScore: 0,
        backwardMerges: 0,
        backwardMoved: false,
      },
      {
        name: '[2,0,2,0] gap-bridging merge',
        line: [2, 0, 2, 0],
        forwardExpected: [4, 0, 0, 0],
        forwardScore: 4,
        forwardMerges: 1,
        forwardMoved: true,
        backwardExpected: [0, 0, 0, 4],
        backwardScore: 4,
        backwardMerges: 1,
        backwardMoved: true,
      },
      {
        name: '[2,0,0,2] full-span gap merge',
        line: [2, 0, 0, 2],
        forwardExpected: [4, 0, 0, 0],
        forwardScore: 4,
        forwardMerges: 1,
        forwardMoved: true,
        backwardExpected: [0, 0, 0, 4],
        backwardScore: 4,
        backwardMerges: 1,
        backwardMoved: true,
      },
      {
        name: '[4,4,4,0] directional priority merge',
        line: [4, 4, 4, 0],
        forwardExpected: [8, 4, 0, 0],
        forwardScore: 8,
        forwardMerges: 1,
        forwardMoved: true,
        backwardExpected: [0, 0, 4, 8],
        backwardScore: 8,
        backwardMerges: 1,
        backwardMoved: true,
      },
      {
        name: '[8,0,0,0] already-anchored single tile',
        line: [8, 0, 0, 0],
        forwardExpected: [8, 0, 0, 0],
        forwardScore: 0,
        forwardMerges: 0,
        forwardMoved: false,
        backwardExpected: [0, 0, 0, 8],
        backwardScore: 0,
        backwardMerges: 0,
        backwardMoved: true,
      },
    ];

    for (const tc of cases) {
      // Horizontal rows (left & right) across all 4 row indices
      for (let r = 0; r < GRID_SIZE; r += 1) {
        const input = writeRowIntoGrid(tc.line, r);
        const snapshotBefore = [...input];

        const leftRes = slideGrid(input, 'left');
        assert.deepEqual(input, snapshotBefore, 'slideGrid must not mutate input');
        assert.deepEqual(leftRes.grid.slice(r * 4, r * 4 + 4), tc.forwardExpected, `${tc.name} left r=${r}`);
        assert.equal(leftRes.scoreDelta, tc.forwardScore);
        assert.equal(leftRes.merges, tc.forwardMerges);
        assert.equal(leftRes.moved, tc.forwardMoved);
        assert.equal(leftRes.mergedIndices.length, tc.forwardMerges);

        const rightRes = slideGrid(input, 'right');
        assert.deepEqual(rightRes.grid.slice(r * 4, r * 4 + 4), tc.backwardExpected, `${tc.name} right r=${r}`);
        assert.equal(rightRes.scoreDelta, tc.backwardScore);
        assert.equal(rightRes.merges, tc.backwardMerges);
        assert.equal(rightRes.moved, tc.backwardMoved);
        assert.equal(rightRes.mergedIndices.length, tc.backwardMerges);
      }

      // Vertical columns (up & down) across all 4 column indices
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const input = writeColIntoGrid(tc.line, c);
        const upRes = slideGrid(input, 'up');
        assert.deepEqual(
          [upRes.grid[c], upRes.grid[c + 4], upRes.grid[c + 8], upRes.grid[c + 12]],
          tc.forwardExpected,
          `${tc.name} up c=${c}`,
        );
        assert.equal(upRes.scoreDelta, tc.forwardScore);
        assert.equal(upRes.merges, tc.forwardMerges);
        assert.equal(upRes.moved, tc.forwardMoved);

        const downRes = slideGrid(input, 'down');
        assert.deepEqual(
          [downRes.grid[c], downRes.grid[c + 4], downRes.grid[c + 8], downRes.grid[c + 12]],
          tc.backwardExpected,
          `${tc.name} down c=${c}`,
        );
        assert.equal(downRes.scoreDelta, tc.backwardScore);
        assert.equal(downRes.merges, tc.backwardMerges);
        assert.equal(downRes.moved, tc.backwardMoved);
      }
    }

    // Verify engine does NOT spawn tiles or touch counters/undo on [2,4,2,4] no-op boards in all 4 directions
    const engine = new Game2048Engine({ seed: 9001 });
    const rowNoopGrid = [
      2, 4, 2, 4,
      4, 2, 4, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    engine.loadGrid(rowNoopGrid, { score: 88, moves: 7, mergeStreak: 3 });
    for (const dir of ['left', 'right'] as const) {
      const res = engine.move(dir);
      assert.equal(res.moved, false);
      assert.equal(res.spawnedIndex, null);
      assert.equal(res.spawnedValue, null);
      assert.equal(res.scoreDelta, 0);
      assert.equal(res.merges, 0);
      assert.deepEqual(engine.getGrid(), rowNoopGrid);
      assert.equal(engine.getScore(), 88);
      assert.equal(engine.getMoves(), 7);
      assert.equal(engine.getMergeStreak(), 3);
      assert.equal(engine.canUndo(), false);
    }

    const colNoopGrid = [
      2, 4, 0, 0,
      4, 2, 0, 0,
      2, 4, 0, 0,
      4, 2, 0, 0,
    ];
    engine.loadGrid(colNoopGrid, { score: 64, moves: 4, mergeStreak: 1 });
    for (const dir of ['up', 'down'] as const) {
      const res = engine.move(dir);
      assert.equal(res.moved, false);
      assert.equal(res.spawnedIndex, null);
      assert.deepEqual(engine.getGrid(), colNoopGrid);
      assert.equal(engine.getMoves(), 4);
      assert.equal(engine.getMergeStreak(), 1);
      assert.equal(engine.canUndo(), false);
    }

    // Cross-check 200 random boards across all 4 directions against independent oracle
    const rng = createSeededRng(2048999);
    const tilePool = [0, 0, 0, 2, 2, 4, 8, 16, 32, 64];
    for (let sample = 0; sample < 200; sample += 1) {
      const grid = Array.from({ length: CELL_COUNT }, () => tilePool[Math.floor(rng() * tilePool.length)]);
      for (const dir of ALL_DIRECTIONS) {
        const expected = referenceSlideGrid(grid, dir);
        const actual = slideGrid(grid, dir);
        assert.deepEqual(actual.grid, expected.grid, `Oracle mismatch on sample ${sample} dir=${dir}`);
        assert.equal(actual.scoreDelta, expected.scoreDelta);
        assert.equal(actual.merges, expected.merges);
        assert.equal(actual.moved, expected.moved);
        assert.equal(actual.mergedIndices.length, expected.merges);
      }
    }
  });

  it('survives a 200-move seeded stress playthrough maintaining invariants, legal hints, and full 200-step undo chain', () => {
    const engine = new Game2048Engine({ mode: 'endless', seed: 20482026 });

    interface RecordedStep {
      grid: number[];
      score: number;
      highScore: number;
      moves: number;
      mergeStreak: number;
      status: GameStatus;
      hasWon2048: boolean;
      mode: GameMode;
      undoCount: number;
    }

    const capture = (): RecordedStep => {
      const snap = engine.getSnapshot();
      return {
        grid: [...snap.grid],
        score: snap.score,
        highScore: snap.highScore,
        moves: snap.moves,
        mergeStreak: snap.mergeStreak,
        status: snap.status,
        hasWon2048: snap.hasWon2048,
        mode: snap.mode,
        undoCount: snap.undoCount,
      };
    };

    const history: RecordedStep[] = [capture()];
    assert.equal(history[0].moves, 0);
    assert.equal(history[0].score, 0);
    assert.equal(getEmptyIndices(history[0].grid).length, CELL_COUNT - 2);

    const TARGET_MOVES = 200;
    for (let step = 1; step <= TARGET_MOVES; step += 1) {
      const before = engine.getGrid();
      assert.equal(hasAnyLegalMove(before), true, `Expected legal moves at step ${step}`);

      const preScore = engine.getScore();
      const preStreak = engine.getMergeStreak();

      const hint = engine.getBestMoveHint();
      assert.ok(hint !== null, `getBestMoveHint() returned null at step ${step} while moves exist`);
      assert.equal(
        slideGrid(before, hint.direction).moved,
        true,
        `getBestMoveHint() suggested no-op direction ${hint.direction} at step ${step}`,
      );
      assert.equal(Number.isFinite(hint.score), true);
      assert.ok(hint.reason.length > 0);
      assert.equal(Number.isFinite(evaluateGridHeuristic(before)), true);

      // Verify hint probe did not mutate the engine
      assert.deepEqual(engine.getGrid(), before);
      assert.equal(engine.getMoves(), step - 1);

      const postSlide = slideGrid(before, hint.direction);
      const res = engine.move(hint.direction);
      assert.equal(res.moved, true);
      assert.equal(res.scoreDelta, postSlide.scoreDelta);
      assert.equal(res.merges, postSlide.merges);

      // Verify spawn invariants
      assert.notEqual(res.spawnedIndex, null);
      assert.ok(res.spawnedValue === 2 || res.spawnedValue === 4);
      const spawnedIdx = res.spawnedIndex!;
      assert.equal(postSlide.grid[spawnedIdx], 0, 'Spawned into non-empty post-slide slot');

      const afterGrid = engine.getGrid();
      assert.equal(afterGrid[spawnedIdx], res.spawnedValue);
      for (let i = 0; i < CELL_COUNT; i += 1) {
        if (i !== spawnedIdx) {
          assert.equal(afterGrid[i], postSlide.grid[i]);
        }
        if (afterGrid[i] !== 0) {
          assert.equal(isPowerOfTwo(afterGrid[i]), true, `Non-power-of-2 tile ${afterGrid[i]} at cell ${i}`);
        }
      }

      // Verify monotonic moves, score, high score, streak, and forecast invariants
      assert.equal(engine.getMoves(), step);
      assert.equal(engine.getScore(), preScore + res.scoreDelta);
      assert.ok(engine.getHighScore() >= engine.getScore());
      assert.equal(engine.getBestTile(), getBestTile(afterGrid));
      assert.equal(engine.getMergeStreak(), res.merges > 0 ? preStreak + 1 : 0);
      assert.equal(engine.getUndoCount(), step);

      const forecast = engine.getWinForecast();
      assert.ok(VALID_FORECAST_LABELS.includes(forecast.label));
      assert.ok(forecast.percent >= 0 && forecast.percent <= 100);

      history.push(capture());
    }

    assert.equal(engine.getMoves(), TARGET_MOVES);
    assert.ok(engine.getScore() > 0);
    assert.ok(engine.getBestTile() >= 128, `Expected >=128 tile after 200 expectimax moves, got ${engine.getBestTile()}`);

    // Unwind ALL 200 moves step-by-step and verify exact state restoration back to move 0
    for (let step = TARGET_MOVES - 1; step >= 0; step -= 1) {
      assert.equal(engine.canUndo(), true);
      assert.equal(engine.undo(), true);

      const expected = history[step];
      const snap = engine.getSnapshot();
      assert.deepEqual(snap.grid, expected.grid, `Undo grid mismatch at step ${step}`);
      assert.equal(snap.score, expected.score, `Undo score mismatch at step ${step}`);
      assert.equal(snap.moves, expected.moves, `Undo moves mismatch at step ${step}`);
      assert.equal(snap.mergeStreak, expected.mergeStreak, `Undo streak mismatch at step ${step}`);
      assert.equal(snap.status, expected.status, `Undo status mismatch at step ${step}`);
      assert.equal(snap.hasWon2048, expected.hasWon2048, `Undo hasWon2048 mismatch at step ${step}`);
      assert.equal(snap.mode, expected.mode, `Undo mode mismatch at step ${step}`);
      assert.equal(snap.undoCount, expected.undoCount);
    }

    assert.equal(engine.canUndo(), false);
    assert.equal(engine.undo(), false);
  });

  it('pauses Classic mode on 2048, climbs to 4096 in Endless mode, and accurately separates near-full alive grids from GAME OVER', () => {
    // 1. Classic win pauses until continueEndless(), and handles locked-on-win boards safely
    const classicEngine = new Game2048Engine({
      mode: 'classic',
      rng: () => 0.1, // always pick first empty slot and spawn 2
    });
    classicEngine.loadGrid([
      1024, 1024, 8, 16,
      16, 8, 16, 8,
      8, 16, 8, 16,
      16, 8, 16, 8,
    ], { score: 10000, moves: 150, mergeStreak: 0 });

    const winMove = classicEngine.move('left');
    assert.equal(winMove.moved, true);
    assert.equal(winMove.reached2048, true);
    assert.equal(winMove.status, 'won');
    assert.equal(classicEngine.getStatus(), 'won');
    assert.equal(classicEngine.getBestTile(), WIN_TILE_VALUE);
    assert.equal(classicEngine.getScore(), 12048);
    assert.equal(classicEngine.getWinForecast().label, '2048 REACHED');
    assert.equal(classicEngine.getWinForecast().percent, 100);

    // Classic win blocks all directions without mutating state
    for (const dir of ALL_DIRECTIONS) {
      const blocked = classicEngine.move(dir);
      assert.equal(blocked.moved, false);
      assert.equal(blocked.status, 'won');
    }
    assert.equal(classicEngine.getMoves(), 151);

    // Continue Endless transitions cleanly to playing (since board still has moves)
    assert.equal(classicEngine.continueEndless(), true);
    assert.equal(classicEngine.getMode(), 'endless');
    assert.equal(classicEngine.getStatus(), 'playing');

    // 2. Climb to 4096 in Endless mode without interruption
    const endlessEngine = new Game2048Engine({ mode: 'endless', seed: 4096 });
    endlessEngine.loadGrid([
      2048, 2048, 0, 0,
      1024, 512, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], { score: 40000, moves: 300, mode: 'endless', hasWon2048: true });

    const superMerge = endlessEngine.move('left');
    assert.equal(superMerge.moved, true);
    assert.equal(superMerge.scoreDelta, 4096);
    assert.equal(superMerge.status, 'playing');
    assert.equal(endlessEngine.getBestTile(), 4096);
    assert.equal(endlessEngine.getScore(), 44096);
    const superForecast = endlessEngine.getWinForecast();
    assert.equal(superForecast.label, '2048 REACHED');
    assert.equal(superForecast.percent, 100);
    assert.match(superForecast.detail, /4096/);

    // 3. Full grid with ONLY 1 horizontal adjacent match must NOT be flagged as Game Over
    const fullHorizontalPair = [
      2, 4, 8, 16,
      16, 8, 4, 2,
      2, 4, 8, 16,
      16, 8, 32, 32,
    ];
    assert.equal(getEmptyIndices(fullHorizontalPair).length, 0);
    assert.equal(hasAdjacentMerge(fullHorizontalPair), true);
    assert.equal(hasAnyLegalMove(fullHorizontalPair), true);

    const aliveH = new Game2048Engine({ seed: 101 });
    aliveH.loadGrid(fullHorizontalPair);
    assert.equal(aliveH.getStatus(), 'playing');
    const aliveHForecast = aliveH.getWinForecast();
    assert.notEqual(aliveHForecast.label, 'GRID LOCKED');
    assert.ok(aliveHForecast.percent > 0 && aliveHForecast.percent <= 22);

    const hintH = aliveH.getBestMoveHint();
    assert.ok(hintH !== null);
    assert.ok(hintH.direction === 'left' || hintH.direction === 'right');

    // Vertical slides on this grid are no-op and must NOT trigger gameover
    assert.equal(aliveH.move('up').moved, false);
    assert.equal(aliveH.getStatus(), 'playing');
    assert.equal(aliveH.move('down').moved, false);
    assert.equal(aliveH.getStatus(), 'playing');

    // 4. Move that spawns into last open cell and produces a completely locked grid -> GAME OVER
    const exactLockTrap = [
      2, 4, 8, 16,
      16, 8, 4, 2,
      2, 4, 8, 16,
      0, 16, 32, 64,
    ];
    const lockRngValues = [0.0, 0.95]; // pick only empty slot (idx 15), spawn 4
    let lockIdx = 0;
    const lockEngine = new Game2048Engine({
      initialGrid: exactLockTrap,
      rng: () => lockRngValues[lockIdx++] ?? 0.0,
    });
    assert.equal(lockEngine.getStatus(), 'playing');

    const fatalMove = lockEngine.move('left');
    assert.equal(fatalMove.moved, true);
    assert.equal(fatalMove.spawnedIndex, 15);
    assert.equal(fatalMove.spawnedValue, 4);
    assert.equal(fatalMove.status, 'gameover');
    assert.equal(lockEngine.getStatus(), 'gameover');
    assert.equal(lockEngine.getBestMoveHint(), null);
    assert.equal(lockEngine.getWinForecast().label, 'GRID LOCKED');
    assert.equal(lockEngine.getWinForecast().percent, 0);
    assert.equal(lockEngine.continueEndless(), false);
    assert.equal(lockEngine.move('left').moved, false);

    // Undo from GAME OVER restores playing state cleanly
    assert.equal(lockEngine.undo(), true);
    assert.equal(lockEngine.getStatus(), 'playing');
    assert.deepEqual(lockEngine.getGrid(), exactLockTrap);
  });
});

describe('Hyper 2048 QA — Real Headless Chrome E2E Suite', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    server = createAppServer(resolveDefaultRootDir());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        baseUrl = `http://127.0.0.1:${addr.port}`;
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

  it('loads /games/game2048.html cleanly at 1440x900 with zero errors, valid Back link, mute toggle, and zero overflow', async () => {
    await withBrowserPage(
      `${baseUrl}/games/game2048.html`,
      async (page) => {
        await page.waitFor("document.querySelectorAll('#grid-2048 .tile-2048').length === 2");

        const snapshot = await page.evaluate<{
          backHref: string | null;
          innerWidth: number;
          innerHeight: number;
          scrollWidth: number;
          scrollHeight: number;
          cellCount: number;
          tileCount: number;
          score: string;
          highScore: string;
          moves: string;
          bestTile: string;
          streak: string;
          modePill: string;
          classicPressed: string | null;
          endlessPressed: string | null;
          undoDisabled: boolean;
          continueHidden: boolean;
          overlayHidden: boolean;
          hintBadgeHidden: boolean;
          forecastLabel: string;
          forecastPercent: string;
          forecastWidth: string;
          bounds: Array<{ sel: string; left: number; top: number; right: number; bottom: number; width: number; height: number }>;
        }>(`(() => {
          const back = document.querySelector('.arcade-back-link');
          const selectors = [
            '.arcade-topbar',
            '.game2048-stage',
            '#status-banner',
            '.board2048-frame',
            '#grid-2048',
            '.dpad-panel',
            '#btn-up',
            '#btn-left',
            '#btn-down',
            '#btn-right',
            '.game2048-sidebar',
            '#start-btn',
            '#reset-btn',
            '#undo-btn',
            '#hint-btn',
            '#mode-control',
            '.predictor-card'
          ];
          const bounds = selectors.map((sel) => {
            const el = document.querySelector(sel);
            const r = el ? el.getBoundingClientRect() : { left: -1, top: -1, right: -1, bottom: -1, width: 0, height: 0 };
            return { sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          });
          return {
            backHref: back ? back.getAttribute('href') : null,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            cellCount: document.querySelectorAll('#grid-2048 .cell-2048').length,
            tileCount: document.querySelectorAll('#grid-2048 .tile-2048').length,
            score: document.getElementById('score-value')?.textContent?.trim() ?? '',
            highScore: document.getElementById('high-score-value')?.textContent?.trim() ?? '',
            moves: document.getElementById('moves-value')?.textContent?.trim() ?? '',
            bestTile: document.getElementById('best-tile-value')?.textContent?.trim() ?? '',
            streak: document.getElementById('merge-streak-value')?.textContent?.trim() ?? '',
            modePill: document.getElementById('mode-pill')?.textContent?.trim() ?? '',
            classicPressed: document.querySelector('#mode-control [data-mode="classic"]')?.getAttribute('aria-pressed') ?? null,
            endlessPressed: document.querySelector('#mode-control [data-mode="endless"]')?.getAttribute('aria-pressed') ?? null,
            undoDisabled: Boolean(document.getElementById('undo-btn')?.hasAttribute('disabled')),
            continueHidden: Boolean(document.getElementById('continue-btn')?.hidden),
            overlayHidden: Boolean(document.getElementById('game-overlay')?.hidden),
            hintBadgeHidden: Boolean(document.getElementById('hint-direction-badge')?.hidden),
            forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
            forecastPercent: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
            forecastWidth: document.getElementById('forecast-fill')?.style.width ?? '',
            bounds,
          };
        })()`);

        assert.equal(snapshot.backHref, '../index.html');
        const indexRes = await fetch(`${baseUrl}/index.html`);
        assert.equal(indexRes.status, 200);

        assert.equal(snapshot.cellCount, 16);
        assert.equal(snapshot.tileCount, 2);
        assert.equal(snapshot.score, '0');
        assert.equal(snapshot.highScore, '0');
        assert.equal(snapshot.moves, '0');
        assert.ok(snapshot.bestTile === '2' || snapshot.bestTile === '4');
        assert.equal(snapshot.streak, '0x');
        assert.equal(snapshot.modePill, 'CLASSIC');
        assert.equal(snapshot.classicPressed, 'true');
        assert.equal(snapshot.endlessPressed, 'false');
        assert.equal(snapshot.undoDisabled, true);
        assert.equal(snapshot.continueHidden, true);
        assert.equal(snapshot.overlayHidden, true);
        assert.equal(snapshot.hintBadgeHidden, true);
        assert.ok(VALID_FORECAST_LABELS.includes(snapshot.forecastLabel as ForecastLabel));
        assert.equal(snapshot.forecastWidth, snapshot.forecastPercent);

        assert.ok(
          snapshot.scrollWidth <= snapshot.innerWidth,
          `Horizontal overflow at 1440x900: scrollWidth=${snapshot.scrollWidth} > innerWidth=${snapshot.innerWidth}`,
        );
        assert.ok(
          snapshot.scrollHeight <= snapshot.innerHeight,
          `Vertical overflow at 1440x900: scrollHeight=${snapshot.scrollHeight} > innerHeight=${snapshot.innerHeight}`,
        );

        for (const item of snapshot.bounds) {
          assert.ok(item.width > 0 && item.height > 0, `Element ${item.sel} has zero size`);
          assert.ok(
            item.left >= 0 && item.right <= snapshot.innerWidth,
            `Element ${item.sel} clipped horizontally: left=${item.left}, right=${item.right}`,
          );
          assert.ok(
            item.top >= 0 && item.bottom <= snapshot.innerHeight,
            `Element ${item.sel} overflows vertically: top=${item.top}, bottom=${item.bottom}`,
          );
        }

        // Verify sound mute toggle updates aria-pressed & localStorage
        await page.click('[data-mute-toggle]');
        await page.waitFor("document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') === 'true'");
        assert.equal(
          await page.evaluate<string | null>("localStorage.getItem('nexus-arcade:muted')"),
          '1',
        );
        await page.click('[data-mute-toggle]');
        await page.waitFor("document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') === 'false'");

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('plays full E2E session in Chrome: Start, Arrow/WASD keys, D-pad clicks, Hint, Undo, Mode switch, localStorage high score, and Reset', async () => {
    interface DomState {
      cells: number[];
      tileValues: number[];
      score: number;
      highScore: number;
      bestTile: number;
      moves: number;
      streak: string;
      undoDisabled: boolean;
      hintedDirs: string[];
      hintBadgeHidden: boolean;
      hintBadgeText: string;
      forecastLabel: string;
      forecastPercent: number;
      forecastWidth: string;
      modePill: string;
      statusText: string;
    }

    const readDomStateExpr = `(() => {
      const cells = Array.from({ length: 16 }, (_, i) =>
        Number(document.querySelector('#grid-2048 [data-cell="' + i + '"]')?.getAttribute('data-value') ?? '0')
      );
      const tileValues = Array.from(document.querySelectorAll('#grid-2048 .tile-2048'))
        .map((el) => Number(el.textContent?.trim() ?? '0'));
      const parseNum = (id) => Number((document.getElementById(id)?.textContent ?? '0').replace(/,/g, '').trim());
      const hintedDirs = Array.from(document.querySelectorAll('.dpad-btn.is-hinted'))
        .map((el) => el.getAttribute('data-dir') ?? '');
      const pctRaw = document.getElementById('forecast-percent')?.textContent?.replace('%', '').trim() ?? '0';
      return {
        cells,
        tileValues,
        score: parseNum('score-value'),
        highScore: parseNum('high-score-value'),
        bestTile: parseNum('best-tile-value'),
        moves: parseNum('moves-value'),
        streak: document.getElementById('merge-streak-value')?.textContent?.trim() ?? '',
        undoDisabled: Boolean(document.getElementById('undo-btn')?.hasAttribute('disabled')),
        hintedDirs,
        hintBadgeHidden: Boolean(document.getElementById('hint-direction-badge')?.hidden),
        hintBadgeText: document.getElementById('hint-direction-badge')?.textContent?.trim() ?? '',
        forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
        forecastPercent: Number(pctRaw),
        forecastWidth: document.getElementById('forecast-fill')?.style.width ?? '',
        modePill: document.getElementById('mode-pill')?.textContent?.trim() ?? '',
        statusText: document.getElementById('status-text')?.textContent?.trim() ?? '',
      };
    })()`;

    await withBrowserPage(
      `${baseUrl}/games/game2048.html`,
      async (page) => {
        await page.waitFor("document.querySelectorAll('#grid-2048 .tile-2048').length === 2");

        // 1. Click #start-btn and verify clean initial 2-tile state
        await page.click('#start-btn');
        await page.waitFor("document.querySelectorAll('#grid-2048 .tile-2048').length === 2");
        let state = await page.evaluate<DomState>(readDomStateExpr);
        assert.equal(state.tileValues.length, 2);
        assert.equal(state.moves, 0);
        assert.equal(state.score, 0);
        assert.equal(state.undoDisabled, true);

        // 2. Dispatch real Arrow keys, WASD keys, and D-pad clicks (#btn-left, #btn-down, #btn-right)
        await page.pressKey('ArrowLeft');
        await page.pressKey('ArrowDown');
        await page.pressKey('ArrowRight');
        await page.pressKey('ArrowUp');
        await page.pressKey('a');
        await page.pressKey('s');
        await page.pressKey('d');
        await page.pressKey('w');
        await page.click('#btn-left');
        await page.click('#btn-down');
        await page.click('#btn-right');

        state = await page.evaluate<DomState>(readDomStateExpr);
        assert.ok(state.moves >= 4, `Expected multiple moves from Arrow/WASD/D-pad inputs, got ${state.moves}`);
        assert.equal(state.undoDisabled, false);

        // Drive hinted moves if needed until at least one merge has raised score > 0 and bestTile >= 4
        for (let step = 0; step < 12 && (state.score === 0 || state.bestTile < 4); step += 1) {
          await page.click('#hint-btn');
          await page.waitFor("document.querySelectorAll('.dpad-btn.is-hinted').length === 1");
          const prevMoves = state.moves;
          await page.click('.dpad-btn.is-hinted');
          await page.waitFor(`Number(document.getElementById('moves-value')?.textContent ?? '0') === ${prevMoves + 1}`);
          state = await page.evaluate<DomState>(readDomStateExpr);
        }

        assert.ok(state.score > 0, `Expected score > 0 after merges, got ${state.score}`);
        assert.ok(state.bestTile >= 4, `Expected best tile >= 4 after merges, got ${state.bestTile}`);
        assert.equal(state.highScore, state.score);
        assert.ok(VALID_FORECAST_LABELS.includes(state.forecastLabel as ForecastLabel));
        assert.ok(state.forecastPercent > 0 && state.forecastPercent <= 100);
        assert.equal(state.forecastWidth, `${state.forecastPercent}%`);

        // 3. Click #hint-btn and verify .is-hinted + #hint-direction-badge
        await page.click('#hint-btn');
        await page.waitFor("document.querySelectorAll('.dpad-btn.is-hinted').length === 1");
        const hintedState = await page.evaluate<DomState>(readDomStateExpr);
        assert.equal(hintedState.hintedDirs.length, 1);
        assert.ok(['up', 'down', 'left', 'right'].includes(hintedState.hintedDirs[0]));
        assert.equal(hintedState.hintBadgeHidden, false);
        assert.match(hintedState.hintBadgeText, /^HINT:\s+(↑ UP|↓ DOWN|← LEFT|→ RIGHT)$/);
        assert.match(hintedState.statusText, /^Expectimax suggests /);

        // Capture exact pre-move snapshot, then execute the hinted D-pad button
        const preHintMove = hintedState;
        await page.click(`#btn-${preHintMove.hintedDirs[0]}`);
        await page.waitFor(
          `Number(document.getElementById('moves-value')?.textContent ?? '0') === ${preHintMove.moves + 1}`,
        );

        const postMove = await page.evaluate<DomState>(readDomStateExpr);
        assert.equal(postMove.moves, preHintMove.moves + 1);
        assert.equal(postMove.hintedDirs.length, 0);
        assert.equal(postMove.hintBadgeHidden, true);

        // 4. Click #undo-btn and verify exact previous board, moves, score, bestTile, and streak restored
        await page.click('#undo-btn');
        await page.waitFor(
          `Number(document.getElementById('moves-value')?.textContent ?? '0') === ${preHintMove.moves}`,
        );
        const afterUndo = await page.evaluate<DomState>(readDomStateExpr);
        assert.deepEqual(afterUndo.cells, preHintMove.cells);
        assert.equal(afterUndo.moves, preHintMove.moves);
        assert.equal(afterUndo.score, preHintMove.score);
        assert.equal(afterUndo.bestTile, preHintMove.bestTile);
        assert.equal(afterUndo.streak, preHintMove.streak);

        // Verify keyboard Undo ('u') works too
        await page.pressKey('u');
        await page.waitFor(
          `Number(document.getElementById('moves-value')?.textContent ?? '0') === ${preHintMove.moves - 1}`,
        );

        // 5. Verify Mode switcher (Endless <-> Classic) and localStorage high-score persistence
        await page.click('#mode-control [data-mode="endless"]');
        await page.waitFor("document.getElementById('mode-pill')?.textContent?.trim() === 'ENDLESS'");
        assert.equal(
          await page.evaluate<string | null>(
            "document.querySelector('#mode-control [data-mode=\"endless\"]')?.getAttribute('aria-pressed') ?? null",
          ),
          'true',
        );
        await page.click('#mode-control [data-mode="classic"]');
        await page.waitFor("document.getElementById('mode-pill')?.textContent?.trim() === 'CLASSIC'");

        const storedHighScore = await page.evaluate<string | null>(
          "localStorage.getItem('nexus-arcade:game2048-highscore')",
        );
        assert.equal(Number(storedHighScore), postMove.highScore);

        // 6. Click #reset-btn and verify clean restoration of score 0, moves 0, and fresh 2-tile board
        await page.click('#reset-btn');
        await page.waitFor("document.getElementById('moves-value')?.textContent?.trim() === '0'");
        const afterReset = await page.evaluate<DomState>(readDomStateExpr);
        assert.equal(afterReset.score, 0);
        assert.equal(afterReset.moves, 0);
        assert.equal(afterReset.streak, '0x');
        assert.equal(afterReset.tileValues.length, 2);
        assert.equal(afterReset.undoDisabled, true);
        assert.equal(afterReset.hintBadgeHidden, true);
        assert.equal(afterReset.highScore, postMove.highScore);

        // 7. Verify keyboard shortcuts H (hint), R (reset), and Enter (start)
        await page.pressKey('h');
        await page.waitFor("document.querySelectorAll('.dpad-btn.is-hinted').length === 1");
        const kbdHintDir = await page.evaluate<string>(
          "document.querySelector('.dpad-btn.is-hinted')?.getAttribute('data-dir') ?? ''",
        );
        const kbdArrow =
          kbdHintDir === 'up'
            ? 'ArrowUp'
            : kbdHintDir === 'down'
              ? 'ArrowDown'
              : kbdHintDir === 'left'
                ? 'ArrowLeft'
                : 'ArrowRight';
        await page.pressKey(kbdArrow);
        await page.waitFor("document.getElementById('moves-value')?.textContent?.trim() === '1'");

        await page.pressKey('r');
        await page.waitFor("document.getElementById('moves-value')?.textContent?.trim() === '0'");
        assert.equal(
          await page.evaluate<number>("document.querySelectorAll('#grid-2048 .tile-2048').length"),
          2,
        );

        await page.pressKey('Enter');
        await page.waitFor("document.getElementById('status-text')?.textContent?.includes('initialized') ?? false");
        assert.equal(
          await page.evaluate<number>("document.querySelectorAll('#grid-2048 .tile-2048').length"),
          2,
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('renders cleanly without horizontal overflow on mobile viewport (480x844)', async () => {
    await withBrowserPage(
      `${baseUrl}/games/game2048.html`,
      async (page) => {
        await page.waitFor("document.querySelectorAll('#grid-2048 .tile-2048').length === 2");
        const metrics = await page.evaluate<{
          scrollWidth: number;
          innerWidth: number;
          gridRect: { width: number; height: number; left: number; right: number };
        }>(`(() => {
          const r = document.getElementById('grid-2048').getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            gridRect: { width: r.width, height: r.height, left: r.left, right: r.right },
          };
        })()`);

        assert.ok(
          metrics.scrollWidth <= metrics.innerWidth,
          `Mobile horizontal overflow: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
        );
        assert.ok(Math.abs(metrics.gridRect.width - metrics.gridRect.height) <= 2);
        assert.ok(metrics.gridRect.left >= 0 && metrics.gridRect.right <= metrics.innerWidth);

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 480, height: 844 },
    );
  });
});
