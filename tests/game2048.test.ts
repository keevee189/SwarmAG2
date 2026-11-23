import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_DIRECTIONS,
  CELL_COUNT,
  Direction,
  Game2048Engine,
  createSeededRng,
  getBestTile,
  getEmptyIndices,
  hasAdjacentMerge,
  hasAnyLegalMove,
  slideGrid,
} from '../ts/games/game2048/engine.js';

describe('Game2048Engine — Pure Slide & Merge Rules', () => {
  it('enforces exact single-merge-per-turn invariant ([2,2,2,2] -> [4,4,0,0], [2,2,4,0] -> [4,4,0,0])', () => {
    const rowAllTwos = [
      2, 2, 2, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const leftRes = slideGrid(rowAllTwos, 'left');
    assert.equal(leftRes.moved, true);
    assert.deepEqual(leftRes.grid.slice(0, 4), [4, 4, 0, 0]);
    assert.equal(leftRes.scoreDelta, 8);
    assert.equal(leftRes.merges, 2);

    const rightRes = slideGrid(rowAllTwos, 'right');
    assert.equal(rightRes.moved, true);
    assert.deepEqual(rightRes.grid.slice(0, 4), [0, 0, 4, 4]);
    assert.equal(rightRes.scoreDelta, 8);

    const doubleProtect = [
      2, 2, 4, 0,
      4, 2, 2, 0,
      0, 4, 2, 2,
      4, 2, 2, 4,
    ];
    const doubleLeft = slideGrid(doubleProtect, 'left');
    assert.deepEqual(doubleLeft.grid.slice(0, 4), [4, 4, 0, 0]);
    assert.deepEqual(doubleLeft.grid.slice(4, 8), [4, 4, 0, 0]);
    assert.deepEqual(doubleLeft.grid.slice(8, 12), [4, 4, 0, 0]);
    assert.deepEqual(doubleLeft.grid.slice(12, 16), [4, 4, 4, 0]);
    assert.equal(doubleLeft.scoreDelta, 16);
    assert.equal(doubleLeft.merges, 4);
  });

  it('executes exact slides and merges across all 4 directions (left, right, up, down)', () => {
    // Test UP & DOWN column rules on the exact same invariants
    const colGrid = [
      2, 0, 4, 2,
      2, 4, 2, 2,
      2, 4, 2, 4,
      2, 8, 4, 8,
    ];

    const up = slideGrid(colGrid, 'up');
    assert.equal(up.moved, true);
    // Col 0: [2,2,2,2] -> [4,4,0,0]
    assert.deepEqual([up.grid[0], up.grid[4], up.grid[8], up.grid[12]], [4, 4, 0, 0]);
    // Col 1: [0,4,4,8] -> [8,8,0,0]
    assert.deepEqual([up.grid[1], up.grid[5], up.grid[9], up.grid[13]], [8, 8, 0, 0]);
    // Col 2: [4,2,2,4] -> [4,4,4,0]
    assert.deepEqual([up.grid[2], up.grid[6], up.grid[10], up.grid[14]], [4, 4, 4, 0]);
    // Col 3: [2,2,4,8] -> [4,4,8,0]
    assert.deepEqual([up.grid[3], up.grid[7], up.grid[11], up.grid[15]], [4, 4, 8, 0]);
    assert.equal(up.scoreDelta, 4 + 4 + 8 + 4 + 4);

    const down = slideGrid(colGrid, 'down');
    assert.equal(down.moved, true);
    // Col 0: [2,2,2,2] down -> [0,0,4,4]
    assert.deepEqual([down.grid[0], down.grid[4], down.grid[8], down.grid[12]], [0, 0, 4, 4]);
    // Col 1: [0,4,4,8] down -> [0,0,8,8]
    assert.deepEqual([down.grid[1], down.grid[5], down.grid[9], down.grid[13]], [0, 0, 8, 8]);
    // Col 2: [4,2,2,4] down -> [0,4,4,4]
    assert.deepEqual([down.grid[2], down.grid[6], down.grid[10], down.grid[14]], [0, 4, 4, 4]);
    // Col 3: [2,2,4,8] down -> [0,4,4,8]
    assert.deepEqual([down.grid[3], down.grid[7], down.grid[11], down.grid[15]], [0, 4, 4, 8]);
    assert.equal(down.scoreDelta, 4 + 4 + 8 + 4 + 4);
  });

  it('guards against no-op slides: does not spawn a tile, increment moves, alter streak, or push undo', () => {
    const engine = new Game2048Engine({ seed: 42 });
    engine.loadGrid([
      2, 4, 0, 0,
      8, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], {
      score: 120,
      moves: 5,
      mergeStreak: 2,
    });

    const beforeGrid = engine.getGrid();

    // Left and Up cannot move anything on this top-left packed board
    const noopLeft = engine.move('left');
    assert.equal(noopLeft.moved, false);
    assert.equal(noopLeft.spawnedIndex, null);
    assert.equal(noopLeft.scoreDelta, 0);
    assert.deepEqual(engine.getGrid(), beforeGrid);
    assert.equal(engine.getMoves(), 5);
    assert.equal(engine.getScore(), 120);
    assert.equal(engine.getMergeStreak(), 2);
    assert.equal(engine.canUndo(), false);

    const noopUp = engine.move('up');
    assert.equal(noopUp.moved, false);
    assert.deepEqual(engine.getGrid(), beforeGrid);
    assert.equal(engine.getMoves(), 5);
    assert.equal(engine.getMergeStreak(), 2);
    assert.equal(engine.canUndo(), false);
  });
});

describe('Game2048Engine — Seeded Spawning, Ratio & Placement', () => {
  it('spawns 2 tiles on start strictly inside empty cells with ~90% 2 and ~10% 4 distribution', () => {
    let count2 = 0;
    let count4 = 0;
    const rng = createSeededRng(20482048);

    // Test exact threshold boundaries via deterministic sequence
    const boundarySeq = [0.0, 0.8999, 0.5, 0.9001];
    let bIdx = 0;
    const boundaryEngine = new Game2048Engine({
      rng: () => boundarySeq[bIdx++],
    });
    const bTiles = boundaryEngine.getGrid().filter((v) => v > 0).sort((a, b) => a - b);
    assert.deepEqual(bTiles, [2, 4]);

    // Statistical check across 1,000 fresh games (2,000 spawns)
    for (let i = 0; i < 1000; i += 1) {
      const engine = new Game2048Engine({ rng });
      const grid = engine.getGrid();
      const nonZero = grid.filter((v) => v > 0);
      assert.equal(nonZero.length, 2);
      assert.equal(getEmptyIndices(grid).length, CELL_COUNT - 2);
      for (const val of nonZero) {
        if (val === 2) {
          count2 += 1;
        } else if (val === 4) {
          count4 += 1;
        } else {
          assert.fail(`Unexpected spawned tile value: ${val}`);
        }
      }
    }

    const total = count2 + count4;
    const ratio2 = count2 / total;
    assert.equal(total, 2000);
    assert.ok(ratio2 > 0.87 && ratio2 < 0.93, `Expected ~90% 2s, got ${(ratio2 * 100).toFixed(2)}%`);

    // Verify move spawns strictly into an empty slot from post-slide board
    const moveEngine = new Game2048Engine({ seed: 777 });
    moveEngine.loadGrid([
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const res = moveEngine.move('left');
    assert.equal(res.moved, true);
    assert.notEqual(res.spawnedIndex, null);
    assert.notEqual(res.spawnedIndex, 0); // cell 0 holds the merged 4
    assert.ok(res.spawnedValue === 2 || res.spawnedValue === 4);
    assert.equal(moveEngine.getGrid()[res.spawnedIndex!], res.spawnedValue);
  });
});

describe('Game2048Engine — Multi-Step Undo, Win Milestone & Endless Mode', () => {
  it('restores exact grid, score, moves, merge streak, and status across multi-step undo', () => {
    const engine = new Game2048Engine({ seed: 1337 });
    const g0 = [
      2, 2, 4, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    engine.loadGrid(g0);

    // Move 1: left merges 2+2->4 (+4 pts, streak=1)
    const m1 = engine.move('left');
    assert.equal(m1.moved, true);
    assert.equal(engine.getScore(), 4);
    assert.equal(engine.getMoves(), 1);
    assert.equal(engine.getMergeStreak(), 1);
    const g1 = engine.getGrid();

    // Move 2: down slides without merge (streak resets to 0)
    const m2 = engine.move('down');
    assert.equal(m2.moved, true);
    assert.equal(engine.getMoves(), 2);
    assert.equal(engine.getMergeStreak(), 0);
    const g2 = engine.getGrid();

    // Move 3: right merges or slides
    const m3 = engine.move('right');
    assert.equal(m3.moved, true);
    assert.equal(engine.getMoves(), 3);
    assert.equal(engine.getUndoCount(), 3);

    // Undo back to Move 2
    assert.equal(engine.undo(), true);
    assert.deepEqual(engine.getGrid(), g2);
    assert.equal(engine.getMoves(), 2);
    assert.equal(engine.getMergeStreak(), 0);
    assert.equal(engine.getStatus(), 'playing');

    // Undo back to Move 1
    assert.equal(engine.undo(), true);
    assert.deepEqual(engine.getGrid(), g1);
    assert.equal(engine.getScore(), 4);
    assert.equal(engine.getMoves(), 1);
    assert.equal(engine.getMergeStreak(), 1);

    // Undo back to initial board g0
    assert.equal(engine.undo(), true);
    assert.deepEqual(engine.getGrid(), g0);
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getMoves(), 0);
    assert.equal(engine.getMergeStreak(), 0);
    assert.equal(engine.canUndo(), false);
    assert.equal(engine.undo(), false);
  });

  it('detects 2048 win in Classic mode, blocks moves until continueEndless(), and keeps climbing', () => {
    const engine = new Game2048Engine({ mode: 'classic', seed: 99 });
    engine.loadGrid([
      1024, 1024, 0, 0,
      512, 256, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);

    const winMove = engine.move('left');
    assert.equal(winMove.moved, true);
    assert.equal(winMove.reached2048, true);
    assert.equal(winMove.status, 'won');
    assert.equal(engine.getStatus(), 'won');
    assert.equal(engine.getBestTile(), 2048);
    assert.equal(engine.hasReached2048(), true);
    assert.equal(engine.getWinForecast().label, '2048 REACHED');
    assert.equal(engine.getWinForecast().percent, 100);

    // Further moves are blocked while on the Classic win state
    const blocked = engine.move('down');
    assert.equal(blocked.moved, false);
    assert.equal(blocked.status, 'won');

    // Can also undo out of won state cleanly
    assert.equal(engine.undo(), true);
    assert.equal(engine.getStatus(), 'playing');
    assert.equal(engine.hasReached2048(), false);

    // Re-reach 2048 and continue into Endless mode
    const winAgain = engine.move('left');
    assert.equal(winAgain.status, 'won');
    assert.equal(engine.continueEndless(), true);
    assert.equal(engine.getMode(), 'endless');
    assert.equal(engine.getStatus(), 'playing');

    // Verify we can now merge past 2048 -> 4096 without interrupting play
    engine.loadGrid([
      2048, 2048, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], { mode: 'endless', hasWon2048: true });

    const superMove = engine.move('left');
    assert.equal(superMove.moved, true);
    assert.equal(superMove.status, 'playing');
    assert.equal(engine.getBestTile(), 4096);
    assert.equal(engine.getStatus(), 'playing');
  });
});

describe('Game2048Engine — Game Over, Hint Legality & Forecast Dynamics', () => {
  it('distinguishes true GAME OVER from full boards that still have a mergeable pair', () => {
    const deadGrid = [
      2, 4, 8, 16,
      16, 8, 4, 2,
      2, 4, 8, 16,
      16, 8, 4, 2,
    ];
    assert.equal(hasAdjacentMerge(deadGrid), false);
    assert.equal(hasAnyLegalMove(deadGrid), false);

    const deadEngine = new Game2048Engine({ seed: 11 });
    deadEngine.loadGrid(deadGrid);
    assert.equal(deadEngine.getStatus(), 'gameover');
    assert.equal(deadEngine.getBestMoveHint(), null);
    assert.deepEqual(deadEngine.getWinForecast().label, 'GRID LOCKED');
    assert.equal(deadEngine.getWinForecast().percent, 0);

    // Full board with ONLY a single vertical equal pair at (2,3) & (3,3)
    const fullWithVerticalMerge = [
      2, 4, 8, 16,
      16, 8, 4, 32,
      2, 4, 8, 64,
      16, 8, 4, 64,
    ];
    assert.equal(getEmptyIndices(fullWithVerticalMerge).length, 0);
    assert.equal(hasAdjacentMerge(fullWithVerticalMerge), true);
    assert.equal(hasAnyLegalMove(fullWithVerticalMerge), true);

    const aliveEngine = new Game2048Engine({ seed: 12 });
    aliveEngine.loadGrid(fullWithVerticalMerge);
    assert.equal(aliveEngine.getStatus(), 'playing');

    const hint = aliveEngine.getBestMoveHint();
    assert.ok(hint !== null, 'Expected a legal move hint on full board with mergeable pair');
    assert.ok(hint.direction === 'up' || hint.direction === 'down');
    assert.equal(slideGrid(fullWithVerticalMerge, hint.direction).moved, true);
  });

  it('always returns a legal state-changing move from getBestMoveHint() and spots immediate 2048 wins', () => {
    const winSetup = [
      1024, 1024, 256, 128,
      64, 32, 16, 8,
      4, 2, 0, 0,
      0, 0, 0, 0,
    ];
    const engine = new Game2048Engine({ seed: 5 });
    engine.loadGrid(winSetup);

    const winHint = engine.getBestMoveHint();
    assert.ok(winHint !== null);
    assert.ok(winHint.direction === 'left' || winHint.direction === 'right');
    assert.equal(slideGrid(winSetup, winHint.direction).moved, true);
    const applied = engine.move(winHint.direction);
    assert.equal(applied.moved, true);
    assert.equal(engine.getBestTile(), 2048);

    // Test legality across 20 random seeded moves
    const playEngine = new Game2048Engine({ seed: 314159 });
    for (let step = 0; step < 25; step += 1) {
      if (playEngine.getStatus() !== 'playing') {
        break;
      }
      const hint = playEngine.getBestMoveHint();
      assert.ok(hint !== null);
      assert.ok(ALL_DIRECTIONS.includes(hint.direction as Direction));
      const before = playEngine.getGrid();
      assert.equal(slideGrid(before, hint.direction).moved, true);
      const res = playEngine.move(hint.direction);
      assert.equal(res.moved, true);
    }
  });

  it('shifts getWinForecast() meaningfully between strong corner-anchored boards and critical boards', () => {
    const strongEngine = new Game2048Engine({ seed: 1 });
    strongEngine.loadGrid([
      1024, 512, 256, 128,
      16, 32, 64, 0,
      8, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const strongForecast = strongEngine.getWinForecast();
    assert.ok(
      strongForecast.label === 'LOCKED IN' || strongForecast.label === 'STRONG FLOW',
      `Expected LOCKED IN or STRONG FLOW, got ${strongForecast.label} (${strongForecast.percent}%)`,
    );
    assert.ok(strongForecast.percent >= 70);

    const criticalEngine = new Game2048Engine({ seed: 2 });
    criticalEngine.loadGrid([
      2, 4, 8, 16,
      32, 64, 128, 256,
      2, 4, 8, 16,
      32, 64, 128, 128,
    ]);
    const criticalForecast = criticalEngine.getWinForecast();
    assert.equal(criticalForecast.label, 'CRITICAL');
    assert.ok(criticalForecast.percent < 25);
    assert.ok(strongForecast.percent > criticalForecast.percent + 45);
  });

  it('performs full reset restoring initial 2-tile state, score, moves, streak, and status', () => {
    const engine = new Game2048Engine({ seed: 8080 });
    engine.loadGrid([
      1024, 1024, 16, 8,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ], { score: 5000, moves: 42, mergeStreak: 4, mode: 'classic' });

    const res = engine.move('left');
    assert.equal(res.status, 'won');
    assert.ok(engine.getScore() > 5000);

    engine.reset();
    assert.equal(engine.getStatus(), 'playing');
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getMoves(), 0);
    assert.equal(engine.getMergeStreak(), 0);
    assert.equal(engine.hasReached2048(), false);
    assert.equal(engine.canUndo(), false);
    assert.equal(getEmptyIndices(engine.getGrid()).length, 14);
    assert.ok(getBestTile(engine.getGrid()) === 2 || getBestTile(engine.getGrid()) === 4);
    assert.ok(engine.getHighScore() > 5000);
  });

  it('supports 2D matrix loading, validates bad inputs, and guides strong multi-move play via expectimax hints', () => {
    const engine = new Game2048Engine({ seed: 2026 });
    engine.loadGrid([
      [2, 4, 8, 16],
      [0, 2, 4, 8],
      [0, 0, 2, 4],
      [0, 0, 0, 2],
    ]);
    assert.deepEqual(engine.getMatrix(), [
      [2, 4, 8, 16],
      [0, 2, 4, 8],
      [0, 0, 2, 4],
      [0, 0, 0, 2],
    ]);
    assert.throws(() => engine.loadGrid([1, 2, 3]), /length 16/);
    assert.throws(() => engine.loadGrid(new Array<number>(16).fill(-2)), /Invalid tile value/);

    // Drive a fresh game for 80 expectimax steps and verify strong tile progression
    engine.start('endless');
    for (let step = 0; step < 80; step += 1) {
      if (engine.getStatus() !== 'playing') {
        break;
      }
      const hint = engine.getBestMoveHint();
      assert.ok(hint !== null);
      const res = engine.move(hint.direction);
      assert.equal(res.moved, true);
    }
    assert.ok(engine.getBestTile() >= 64, `Expected expectimax play to reach >= 64, got ${engine.getBestTile()}`);
    assert.ok(engine.getScore() >= 300, `Expected score >= 300, got ${engine.getScore()}`);
  });
});
