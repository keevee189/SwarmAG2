import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ALL_TETROMINO_TYPES,
  BOARD_COLS,
  BOARD_ROWS,
  LOCK_DELAY_MS,
  MAX_LOCK_RESETS,
  TetrisEngine,
  TetrominoType,
  getPieceCells,
} from '../ts/games/tetris/engine.js';
import { createAppServer, resolveDefaultRootDir } from '../ts/server.js';
import { withBrowserPage } from './helpers/cdp.js';

function createEmptyBoard(): (TetrominoType | null)[][] {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array<TetrominoType | null>(BOARD_COLS).fill(null),
  );
}

function createSeededRng(seed = 20261122): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fillRowExcept(
  board: (TetrominoType | null)[][],
  row: number,
  emptyCols: number[],
  fillType: TetrominoType = 'J',
): void {
  const emptySet = new Set(emptyCols);
  for (let col = 0; col < BOARD_COLS; col += 1) {
    board[row][col] = emptySet.has(col) ? null : fillType;
  }
}

function resolveRepoRoot(): string {
  const resolved = resolveDefaultRootDir();
  if (fs.existsSync(path.join(resolved, 'games', 'tetris.html'))) {
    return resolved;
  }
  return path.resolve(process.cwd());
}

describe('TetrisEngine QA Adversarial & Edge-Case Suite', () => {
  it('maintains 7-bag permutations and exact Next-3 lookahead across 8 full bags (56 pieces)', () => {
    for (const seed of [17, 991, 424242]) {
      const engine = new TetrisEngine({ rng: createSeededRng(seed) });
      engine.start();

      const spawned: TetrominoType[] = [];
      let predictedNext3 = engine.getNextQueue(3);

      for (let i = 0; i < 56; i += 1) {
        const active = engine.getActivePiece();
        assert.ok(active, `Expected active piece at step ${i}`);
        spawned.push(active.type);

        if (i > 0) {
          assert.equal(
            active.type,
            predictedNext3[0],
            `Spawned piece ${active.type} did not match predicted queue head ${predictedNext3[0]} at step ${i}`,
          );
        }

        const queue = engine.getNextQueue(3);
        assert.equal(queue.length, 3);
        for (const piece of queue) {
          assert.ok(ALL_TETROMINO_TYPES.includes(piece));
        }
        predictedNext3 = queue;

        engine.loadVisibleGrid(createEmptyBoard());
        engine.hardDrop();
      }

      for (let bag = 0; bag < 8; bag += 1) {
        const slice = spawned.slice(bag * 7, (bag + 1) * 7);
        assert.equal(slice.length, 7);
        assert.equal(
          new Set(slice).size,
          7,
          `Bag ${bag} (seed ${seed}) violated 7-bag uniqueness: ${slice.join(',')}`,
        );
      }
    }
  });

  it('handles SRS wall-kick edge cases against left/right/floor bounds and obstacle kicks', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(101) });
    engine.start();

    // T-piece on right wall in state 3 (cells in col 9) rotating CCW -> state 2 kicks left
    engine.loadVisibleGrid(createEmptyBoard());
    assert.equal(engine.setActivePiece({ type: 'T', x: 8, y: 8, rotation: 3 }), true);
    assert.equal(engine.rotateCCW(), true);
    const tRight = engine.getActivePiece()!;
    assert.equal(tRight.rotation, 2);
    assert.equal(tRight.x, 7);
    assert.ok(getPieceCells(tRight).every((c) => c.x >= 0 && c.x < BOARD_COLS));

    // J-piece resting on floor in state 2 (bottom row 19) rotating CW/CCW kicks upward within bounds
    engine.loadVisibleGrid(createEmptyBoard());
    assert.equal(engine.setActivePiece({ type: 'J', x: 4, y: 17, rotation: 2 }), true);
    assert.equal(engine.rotateCW(), true);
    const jFloor = engine.getActivePiece()!;
    assert.equal(jFloor.rotation, 3);
    assert.ok(getPieceCells(jFloor).every((c) => c.y >= 0 && c.y < BOARD_ROWS));

    // I-piece on right wall in state 1 (cells in col 9) rotating CCW (1>0) kicks -2 left
    engine.loadVisibleGrid(createEmptyBoard());
    assert.equal(engine.setActivePiece({ type: 'I', x: 7, y: 10, rotation: 1 }), true);
    assert.equal(engine.rotateCCW(), true);
    const iRight = engine.getActivePiece()!;
    assert.equal(iRight.rotation, 0);
    assert.ok(getPieceCells(iRight).every((c) => c.x >= 0 && c.x < BOARD_COLS));

    // I-piece on floor in state 2 (horizontal bar on row 19 -> y=17) rotating CW (2>3) kicks upward
    engine.loadVisibleGrid(createEmptyBoard());
    assert.equal(engine.setActivePiece({ type: 'I', x: 3, y: 17, rotation: 2 }), true);
    assert.equal(engine.rotateCW(), true);
    const iFloor = engine.getActivePiece()!;
    assert.equal(iFloor.rotation, 3);
    assert.ok(getPieceCells(iFloor).every((c) => c.y >= 0 && c.y < BOARD_ROWS));

    // S-piece SRS 5th kick (index 4: [-1, +2]) dropping 2 rows down into a vertical pocket
    // State 0 at (4, 15): cells (5,15), (6,15), (4,16), (5,16)
    // State 1 at (4, 15) + (-1, +2) = (3, 17): cells (4,17), (4,18), (5,18), (5,19)
    // Kick offsets for 0>1: [0,0], [-1,0], [-1,-1], [0,2], [-1,2]
    // Kick 0 (4,15) needs (5,15),(5,16),(6,16),(6,17) -> block (6,17)
    // Kick 1 (3,15) needs (4,15),(4,16),(5,16),(5,17) -> block (4,15)
    // Kick 2 (3,14) needs (4,14),(4,15),(5,15),(5,16) -> already blocked by (4,15)
    // Kick 3 (4,17) needs (5,17),(5,18),(6,18),(6,19) -> block (6,19)
    // Kick 4 (3,17) needs (4,17),(4,18),(5,18),(5,19) -> keep ALL free!
    const sKickBoard = createEmptyBoard();
    sKickBoard[17][6] = 'L'; // blocks kick 0
    sKickBoard[15][4] = 'L'; // blocks kick 1 & 2
    sKickBoard[19][6] = 'L'; // blocks kick 3
    engine.loadVisibleGrid(sKickBoard);
    assert.equal(engine.setActivePiece({ type: 'S', x: 4, y: 15, rotation: 0 }), true);
    assert.equal(engine.rotateCW(), true);
    const sKicked = engine.getActivePiece()!;
    assert.equal(sKicked.rotation, 1);
    assert.equal(sKicked.x, 3);
    assert.equal(sKicked.y, 17);
  });

  it('computes T-Spin Mini, T-Spin Triple (5th kick), B2B 1.5x, and level-scaled combo math accurately', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(202) });
    engine.start();

    // 1. T-Spin Mini (0 lines): 3 corners filled, only 1 front corner filled, kick index != 4
    // T at (3, 17) rot 0 -> front corners are (3,17) and (5,17); back corners are (3,19) and (5,19)
    const miniBoard = createEmptyBoard();
    miniBoard[17][3] = 'J'; // front-left
    miniBoard[19][3] = 'J'; // back-left
    miniBoard[19][5] = 'J'; // back-right
    engine.loadVisibleGrid(miniBoard);
    assert.equal(engine.setActivePiece({ type: 'T', x: 3, y: 17, rotation: 3 }), true);
    assert.equal(engine.rotateCW(), true); // 3>0 at (0,0) kick -> state 0
    const miniRes = engine.hardDrop();
    assert.equal(miniRes.tSpin, 'mini');
    assert.equal(miniRes.linesCleared, 0);
    assert.equal(miniRes.scoreDelta, 100);
    assert.equal(miniRes.label, 'T-SPIN MINI');

    // 2a. Moving sideways after rotation cancels T-Spin even with 3 corners occupied
    const cancelBoard = createEmptyBoard();
    cancelBoard[18][1] = 'J'; // blocks kick 0 for 1>0 at (1,17)
    cancelBoard[17][3] = 'J'; // blocks kick 1 for 1>0 at (1,17)
    cancelBoard[18][5] = 'J'; // top-right corner of (3,18), plus 2 floor corners -> 3 corners
    engine.loadVisibleGrid(cancelBoard);
    assert.equal(engine.setActivePiece({ type: 'T', x: 1, y: 17, rotation: 1 }), true);
    assert.equal(engine.rotateCCW(), true); // kicks via [1,1] to (2,18) rot 0
    assert.equal(engine.moveRight(), true); // slides to (3,18) rot 0 (3 corners filled!)
    const slideDrop = engine.hardDrop();
    assert.equal(slideDrop.droppedCells, 0);
    assert.equal(slideDrop.tSpin, 'none');

    // 2b. Dropping > 0 cells after rotation cancels T-Spin
    engine.loadVisibleGrid(createEmptyBoard());
    assert.equal(engine.setActivePiece({ type: 'T', x: 3, y: 15, rotation: 1 }), true);
    assert.equal(engine.rotateCW(), true);
    const nonSpinDrop = engine.hardDrop();
    assert.equal(nonSpinDrop.droppedCells, 2);
    assert.equal(nonSpinDrop.tSpin, 'none');

    // 3. T-Spin Mini Single (200 * level) starts B2B chain, followed by B2B T-Spin Triple at level 1 -> 1600 * 1.5 + 50 = 2450!
    const miniSingleBoard = createEmptyBoard();
    miniSingleBoard[17][3] = 'L'; // front-left for rot 0
    miniSingleBoard[19][3] = 'L';
    miniSingleBoard[19][5] = 'L';
    fillRowExcept(miniSingleBoard, 18, [3, 4, 5], 'L');
    engine.loadVisibleGrid(miniSingleBoard);
    assert.equal(engine.setActivePiece({ type: 'T', x: 3, y: 17, rotation: 3 }), true);
    assert.equal(engine.rotateCW(), true); // rot 0, row 17 col 4, row 18 cols 3,4,5
    const rMiniSingle = engine.hardDrop(); // grounded: droppedCells=0 preserves rotation
    assert.equal(rMiniSingle.tSpin, 'mini');
    assert.equal(rMiniSingle.linesCleared, 1);
    assert.equal(rMiniSingle.scoreDelta, 200);
    assert.equal(rMiniSingle.backToBackApplied, false);
    assert.equal(rMiniSingle.combo, 0);

    // Next: T-Spin Triple via 5th SRS kick (0>3 kick index 4 = [1, 2]) OR full 3-row clear
    // Setup 0>3 at (2, 15) -> kick 4 [1, 2] lands at (3, 17) rot 3 (cells: (4,17), (3,18), (4,18), (4,19)):
    // Block kicks 0..3 for 0>3 ([0,0], [1,0], [1,-1], [0,2], [1,2]):
    // Kick 0 (2,15) rot 3 needs (3,17) -> filled by fillRowExcept(17, [4])
    // Kick 1 (3,15) rot 3 needs (4,15) -> block (4,15)
    // Kick 2 (3,14) rot 3 needs (4,15) -> blocked by (4,15)
    // Kick 3 (2,17) rot 3 needs (3,17),(2,18),(3,19) -> filled by fillRowExcept
    // Kick 4 (3,17) rot 3 needs (4,17),(3,18),(4,18),(4,19) -> keep free!
    // Corners of (3,17): (3,17), (5,17), (3,19), (5,19) are all filled!
    const tstBoard = createEmptyBoard();
    tstBoard[15][4] = 'S';
    fillRowExcept(tstBoard, 17, [4], 'S');
    fillRowExcept(tstBoard, 18, [3, 4], 'S');
    fillRowExcept(tstBoard, 19, [4], 'S');
    engine.loadVisibleGrid(tstBoard);
    assert.equal(engine.setActivePiece({ type: 'T', x: 2, y: 15, rotation: 0 }), true);
    assert.equal(engine.rotateCCW(), true);
    const tPlaced = engine.getActivePiece()!;
    assert.equal(tPlaced.rotation, 3);
    assert.equal(tPlaced.x, 3);
    assert.equal(tPlaced.y, 17);

    const rTst = engine.hardDrop();
    assert.equal(rTst.tSpin, 'full');
    assert.equal(rTst.linesCleared, 3);
    assert.equal(rTst.backToBackApplied, true);
    assert.equal(rTst.combo, 1);
    // Base TST = 1600 * 1.5 (B2B) = 2400 + combo(1)*50*1 = 2450
    assert.equal(rTst.scoreDelta, 2450);

    // 4. Advance lines to reach Level 2, then verify level multiplier applies to both clear and combo
    // Currently lines = 1 + 3 = 4. Clear 6 more lines (4 + 2) via two setups so combo continues!
    const b4 = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b4, r, [2]);
    engine.loadVisibleGrid(b4);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    const rTet = engine.hardDrop(); // lines=8 (still level 1), combo=2 -> 800*1.5 + 2*50 = 1300
    assert.equal(rTet.scoreDelta, 1300);
    assert.equal(engine.getLevel(), 1);

    // Level-up clear: 2 lines -> hits 10 lines -> level transitions 1 -> 2, scored at currentLevel=1
    const b2 = createEmptyBoard();
    fillRowExcept(b2, 18, [4, 5]);
    fillRowExcept(b2, 19, [4, 5]);
    engine.loadVisibleGrid(b2);
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    const rLvlUp = engine.hardDrop(); // lines=10 -> level 2, breaks B2B, combo=3 -> 300*1 + 3*50*1 = 450
    assert.equal(rLvlUp.leveledUp, true);
    assert.equal(rLvlUp.newLevel, 2);
    assert.equal(rLvlUp.scoreDelta, 450);

    // Clear at Level 2 with combo=4: Single = 100*2 + 4*50*2 = 200 + 400 = 600
    const b1 = createEmptyBoard();
    fillRowExcept(b1, 19, [4, 5]);
    engine.loadVisibleGrid(b1);
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    const rLvl2 = engine.hardDrop();
    assert.equal(rLvl2.linesCleared, 1);
    assert.equal(rLvl2.combo, 4);
    assert.equal(rLvl2.scoreDelta, 600);
  });

  it('enforces strict double-hold lock guard across consecutive holds and state transitions before lock', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(303) });
    engine.setNextQueueForTest(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

    // Cannot hold while idle
    assert.equal(engine.hold(), false);
    assert.equal(engine.canUseHold(), false);

    engine.start();
    assert.equal(engine.getActivePiece()?.type, 'I');
    assert.equal(engine.canUseHold(), true);

    // First hold stores I, pulls O
    assert.equal(engine.hold(), true);
    assert.equal(engine.getHoldPiece(), 'I');
    assert.equal(engine.getActivePiece()?.type, 'O');
    assert.equal(engine.canUseHold(), false);

    // Consecutive holds before lock must all fail even after moves, rotations, softDrops, and non-locking ticks
    assert.equal(engine.hold(), false);
    assert.equal(engine.moveLeft(), true);
    assert.equal(engine.rotateCW(), true);
    assert.equal(engine.softDrop(), true);
    engine.tick(100);
    assert.equal(engine.hold(), false);
    assert.equal(engine.getHoldPiece(), 'I');
    assert.equal(engine.getActivePiece()?.type, 'O');

    // Lock O via hardDrop -> unlocks hold for T
    engine.hardDrop();
    assert.equal(engine.getActivePiece()?.type, 'T');
    assert.equal(engine.canUseHold(), true);

    // Rotate T, then hold -> swaps T with I and resets spawned I rotation to 0 at spawn x=3
    assert.equal(engine.rotateCW(), true);
    assert.equal(engine.hold(), true);
    assert.equal(engine.getHoldPiece(), 'T');
    const swapped = engine.getActivePiece()!;
    assert.equal(swapped.type, 'I');
    assert.equal(swapped.rotation, 0);
    assert.equal(swapped.x, 3);
    assert.equal(engine.canUseHold(), false);
    assert.equal(engine.hold(), false);

    // Cannot hold while paused
    engine.hardDrop(); // unlocks hold for S
    assert.equal(engine.canUseHold(), true);
    assert.equal(engine.togglePause(), 'paused');
    assert.equal(engine.hold(), false);
    assert.equal(engine.canUseHold(), false);

    // Triggering game over on hold swap when spawn cells are obstructed
    assert.equal(engine.togglePause(), 'playing');
    const blocked = createEmptyBoard();
    blocked[0][4] = 'J';
    blocked[1][4] = 'J';
    engine.loadVisibleGrid(blocked);
    engine.setActivePiece({ type: 'S', x: 0, y: 18, rotation: 0 });
    assert.equal(engine.hold(), true); // attempts to spawn T at (3,0), which overlaps (4,0)/(4,1)
    assert.equal(engine.getStatus(), 'gameover');
    assert.equal(engine.getActivePiece(), null);
  });

  it('freezes gravity/timer when paused and enforces MAX_LOCK_RESETS cap against infinite stalling', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(404) });
    engine.start();
    engine.loadVisibleGrid(createEmptyBoard());
    engine.setActivePiece({ type: 'O', x: 3, y: 2, rotation: 0 });

    // Advance 1.5s while playing so piece drops and elapsedMs increments
    engine.tick(1500);
    const snapBeforePause = engine.getSnapshot();
    const yBeforePause = snapBeforePause.activePiece!.y;
    const elapsedBeforePause = snapBeforePause.elapsedMs;
    assert.ok(yBeforePause > 2);
    assert.equal(elapsedBeforePause, 1500);

    // Pause freezes everything
    assert.equal(engine.togglePause(), 'paused');
    const pausedTick = engine.tick(5000);
    assert.equal(pausedTick.movedDown, false);
    assert.equal(pausedTick.locked, false);
    assert.equal(engine.moveLeft(), false);
    assert.equal(engine.moveRight(), false);
    assert.equal(engine.softDrop(), false);
    assert.equal(engine.rotateCW(), false);
    assert.equal(engine.rotateCCW(), false);
    assert.equal(engine.stepGravity().movedDown, false);
    assert.equal(engine.hardDrop().droppedCells, 0);

    const snapDuringPause = engine.getSnapshot();
    assert.equal(snapDuringPause.activePiece!.y, yBeforePause);
    assert.equal(snapDuringPause.elapsedMs, elapsedBeforePause);

    // Invalid dtMs values must be ignored cleanly while playing
    assert.equal(engine.togglePause(), 'playing');
    assert.equal(engine.tick(0).movedDown, false);
    assert.equal(engine.tick(-50).movedDown, false);
    assert.equal(engine.tick(Number.NaN).movedDown, false);
    assert.equal(engine.tick(Number.POSITIVE_INFINITY).movedDown, false);
    assert.equal(engine.getSnapshot().elapsedMs, elapsedBeforePause);

    // Exhaust MAX_LOCK_RESETS (15) on grounded O-piece, then verify 16th move does NOT reset lock delay
    engine.loadVisibleGrid(createEmptyBoard());
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    for (let i = 0; i < MAX_LOCK_RESETS; i += 1) {
      assert.equal(engine.tick(LOCK_DELAY_MS - 100).locked, false);
      const moved = i % 2 === 0 ? engine.moveLeft() : engine.moveRight();
      assert.equal(moved, true);
    }
    // Accumulate 400ms, perform 16th grounded move (exceeds MAX_LOCK_RESETS), then 120ms -> locks!
    assert.equal(engine.tick(LOCK_DELAY_MS - 100).locked, false);
    assert.equal(engine.moveLeft(), true);
    const finalLock = engine.tick(120);
    assert.equal(finalLock.locked, true);
  });

  it('handles rapid start/reset cycles cleanly without stale state leaks', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(505) });

    // Score high once to verify highScore persists across many resets
    engine.start();
    const b = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b, r, [2]);
    engine.loadVisibleGrid(b);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    engine.hardDrop();
    const best = engine.getHighScore();
    assert.ok(best >= 800);

    for (let cycle = 0; cycle < 20; cycle += 1) {
      engine.reset();
      assert.equal(engine.getStatus(), 'idle');

      // Calling start() repeatedly while playing must be idempotent
      engine.start();
      engine.start();
      assert.equal(engine.getStatus(), 'playing');

      engine.moveLeft();
      engine.rotateCW();
      if (cycle % 2 === 0) {
        engine.hold();
      }
      engine.tick(350);
      engine.hardDrop();

      if (cycle % 3 === 0) {
        engine.togglePause();
        assert.equal(engine.getStatus(), 'paused');
      }

      engine.reset();
      const snap = engine.getSnapshot();
      assert.equal(snap.status, 'idle');
      assert.equal(snap.score, 0);
      assert.equal(snap.highScore, best);
      assert.equal(snap.level, 1);
      assert.equal(snap.lines, 0);
      assert.equal(snap.combo, -1);
      assert.equal(snap.backToBack, false);
      assert.equal(snap.victoryReached, false);
      assert.equal(snap.elapsedMs, 0);
      assert.equal(snap.activePiece, null);
      assert.equal(snap.ghostPiece, null);
      assert.equal(snap.holdPiece, null);
      assert.equal(snap.canHold, false);
      assert.equal(snap.lastClear, null);
      assert.equal(snap.nextQueue.length, 3);
      assert.equal(snap.forecast.label, 'ON TRACK');
      assert.equal(snap.forecast.percent, 80);
    }

    // Starting directly from gameover resets cleanly into playing
    engine.start();
    const topBlocked = createEmptyBoard();
    for (let c = 0; c < BOARD_COLS; c += 1) topBlocked[0][c] = 'Z';
    engine.loadVisibleGrid(topBlocked);
    engine.setActivePiece({ type: 'O', x: 0, y: -2, rotation: 0 });
    engine.hardDrop();
    assert.equal(engine.getStatus(), 'gameover');
    engine.start();
    assert.equal(engine.getStatus(), 'playing');
    assert.equal(engine.getScore(), 0);
    assert.ok(engine.getActivePiece() !== null);
  });

  it('transitions Survival Forecast across ON TRACK, DOMINATING, PRESSURE, CRITICAL, VICTORY, and GAME OVER', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(606), victoryScore: 2000 });

    // 1. Initial idle -> ON TRACK (80%)
    const idleForecast = engine.getSurvivalForecast();
    assert.equal(idleForecast.label, 'ON TRACK');
    assert.equal(idleForecast.percent, 80);

    // 2. Score progress on clean stack -> DOMINATING (>= 85%)
    engine.start();
    const bTet = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(bTet, r, [2]);
    engine.loadVisibleGrid(bTet);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    engine.hardDrop(); // 800 / 2000 = 40% progress -> rawPercent ~87%
    const domForecast = engine.getSurvivalForecast();
    assert.equal(domForecast.label, 'DOMINATING');
    assert.ok(domForecast.percent >= 85 && domForecast.percent <= 99);

    // 3. Moderate stack height + a couple of holes -> PRESSURE (35%..59%)
    const pressureBoard = createEmptyBoard();
    for (let r = 10; r < BOARD_ROWS; r += 1) {
      for (let c = 0; c < BOARD_COLS - 1; c += 1) {
        pressureBoard[r][c] = 'J';
      }
    }
    pressureBoard[15][2] = null;
    pressureBoard[17][5] = null;
    pressureBoard[18][7] = null;
    engine.loadVisibleGrid(pressureBoard);
    const pressureForecast = engine.getSurvivalForecast();
    assert.equal(pressureForecast.label, 'PRESSURE');
    assert.ok(pressureForecast.percent >= 35 && pressureForecast.percent < 60);

    // 4. Severe tall & hole-ridden stack -> CRITICAL (< 35%)
    const criticalBoard = createEmptyBoard();
    for (let r = 4; r < BOARD_ROWS; r += 1) {
      for (let c = 0; c < BOARD_COLS; c += 1) {
        if ((r + c) % 2 === 0 && r > 5) {
          criticalBoard[r][c] = null;
        } else if (c < 8) {
          criticalBoard[r][c] = 'Z';
        }
      }
    }
    engine.loadVisibleGrid(criticalBoard);
    const criticalForecast = engine.getSurvivalForecast();
    assert.equal(criticalForecast.label, 'CRITICAL');
    assert.ok(criticalForecast.percent >= 4 && criticalForecast.percent < 35);

    // 5. Reaching victoryScore -> VICTORY (100%)
    const winBoard = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(winBoard, r, [2]);
    engine.loadVisibleGrid(winBoard);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    const winDrop = engine.hardDrop(); // +1200 B2B -> score 2000 >= victoryScore
    assert.equal(winDrop.victoryUnlocked, true);
    const victoryForecast = engine.getSurvivalForecast();
    assert.equal(victoryForecast.label, 'VICTORY');
    assert.equal(victoryForecast.percent, 100);

    // 6. Topping out even after Victory -> GAME OVER (0%)
    const topOutBoard = createEmptyBoard();
    topOutBoard[0][3] = 'L';
    topOutBoard[0][4] = 'L';
    topOutBoard[0][5] = 'L';
    topOutBoard[0][6] = 'L';
    engine.loadVisibleGrid(topOutBoard);
    engine.setActivePiece({ type: 'O', x: 0, y: 18, rotation: 0 });
    const topOutRes = engine.hardDrop();
    assert.equal(topOutRes.gameOver, true);
    const overForecast = engine.getSurvivalForecast();
    assert.equal(overForecast.label, 'GAME OVER');
    assert.equal(overForecast.percent, 0);
    assert.match(overForecast.detail, /Victory Rank/);
  });

  it('guards snapshot immutability, invalid grid loads, highScore monotonicity, and Lock Out game over', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(707), highScore: 100 });
    assert.equal(engine.getHighScore(), 100);
    engine.setHighScore(50);
    assert.equal(engine.getHighScore(), 100);
    engine.setHighScore(Number.NaN);
    assert.equal(engine.getHighScore(), 100);
    engine.setHighScore(450.9);
    assert.equal(engine.getHighScore(), 450);

    assert.throws(() => engine.loadVisibleGrid([]), /Expected 20 rows/);
    assert.throws(() => engine.loadVisibleGrid(Array.from({ length: BOARD_ROWS }, () => [])), /Expected 10 columns/);

    engine.start();
    const gridCopy = engine.getVisibleGrid();
    gridCopy[19][0] = 'I';
    assert.equal(engine.getVisibleGrid()[19][0], null);

    const activeCopy = engine.getActivePiece()!;
    const origX = activeCopy.x;
    activeCopy.x = 99;
    assert.equal(engine.getActivePiece()!.x, origX);

    // Lock Out: piece locked completely in buffer rows (all cells y < 0) triggers LOCK OUT game over
    const lockOutBoard = createEmptyBoard();
    for (let c = 0; c < BOARD_COLS; c += 1) {
      lockOutBoard[0][c] = 'J';
    }
    engine.loadVisibleGrid(lockOutBoard);
    assert.equal(engine.setActivePiece({ type: 'I', x: 3, y: -2, rotation: 0 }), true); // occupies y=-1 (buffer)
    const lockOutRes = engine.hardDrop();
    assert.equal(lockOutRes.locked, true);
    assert.equal(lockOutRes.gameOver, true);
    assert.equal(lockOutRes.label, 'LOCK OUT');
    assert.equal(engine.getStatus(), 'gameover');
  });
});

describe('Tetris ("Tetromino Overdrive") Real Headless Chrome E2E QA', () => {
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

  it('loads /games/tetris.html cleanly at 1440x900 with zero errors, valid navigation, mute toggle, and no viewport overflow', async () => {
    await withBrowserPage(
      `${baseUrl}/games/tetris.html`,
      async (page) => {
        await page.waitFor("document.querySelector('#start-btn') !== null");

        const layout = await page.evaluate<{
          backHref: string | null;
          backRect: { width: number; height: number };
          startVisible: boolean;
          resetVisible: boolean;
          canvasRect: { width: number; height: number };
          scrollWidth: number;
          innerWidth: number;
          innerHeight: number;
          startRectBottom: number;
          resetRectBottom: number;
          overlayHidden: boolean;
          scoreText: string;
          linesText: string;
          levelText: string;
          forecastLabel: string;
          forecastPercent: string;
          forecastWidth: string;
          statusTag: string;
          pauseDisabled: boolean;
        }>(`(() => {
          const back = document.querySelector('.arcade-back-link');
          const start = document.getElementById('start-btn');
          const pause = document.getElementById('pause-btn');
          const reset = document.getElementById('reset-btn');
          const canvas = document.getElementById('tetris-canvas');
          const overlay = document.getElementById('game-overlay');
          const br = back ? back.getBoundingClientRect() : { width: 0, height: 0 };
          const sr = start ? start.getBoundingClientRect() : { width: 0, height: 0, bottom: 0 };
          const rr = reset ? reset.getBoundingClientRect() : { width: 0, height: 0, bottom: 0 };
          const cr = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
          return {
            backHref: back ? back.getAttribute('href') : null,
            backRect: { width: br.width, height: br.height },
            startVisible: sr.width > 0 && sr.height > 0,
            resetVisible: rr.width > 0 && rr.height > 0,
            canvasRect: { width: cr.width, height: cr.height },
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            startRectBottom: sr.bottom,
            resetRectBottom: rr.bottom,
            overlayHidden: overlay ? overlay.hidden : false,
            scoreText: document.getElementById('score-value')?.textContent?.trim() ?? '',
            linesText: document.getElementById('lines-value')?.textContent?.trim() ?? '',
            levelText: document.getElementById('level-value')?.textContent?.trim() ?? '',
            forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
            forecastPercent: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
            forecastWidth: document.getElementById('forecast-fill')?.style.width ?? '',
            statusTag: document.getElementById('status-tag')?.textContent?.trim() ?? '',
            pauseDisabled: pause ? pause.disabled : false,
          };
        })()`);

        assert.equal(layout.backHref, '../index.html');
        assert.ok(layout.backRect.width > 0 && layout.backRect.height > 0);
        assert.equal(layout.startVisible, true);
        assert.equal(layout.resetVisible, true);
        assert.ok(layout.canvasRect.width >= 240 && layout.canvasRect.height >= 480);
        assert.ok(
          layout.scrollWidth <= layout.innerWidth,
          `Horizontal overflow detected: scrollWidth=${layout.scrollWidth} > innerWidth=${layout.innerWidth}`,
        );
        assert.ok(layout.startRectBottom <= layout.innerHeight);
        assert.ok(layout.resetRectBottom <= layout.innerHeight);

        // Verify all major stage/sidebar/HUD cards fit inside 1440px width without clipping
        const bounds = await page.evaluate<Array<{ id: string; left: number; right: number; width: number; height: number }>>(`(() => {
          const selectors = ['.arcade-topbar', '.tetris-stage', '.game-sidebar', '.predictor-card', '#hold-canvas', '#next-canvas', '#tetris-canvas', '.touch-controls'];
          return selectors.map((sel) => {
            const el = document.querySelector(sel);
            const r = el ? el.getBoundingClientRect() : { left: -1, right: -1, width: 0, height: 0 };
            return { id: sel, left: r.left, right: r.right, width: r.width, height: r.height };
          });
        })()`);
        for (const item of bounds) {
          assert.ok(item.width > 0 && item.height > 0, `Element ${item.id} has zero dimensions`);
          assert.ok(item.left >= 0 && item.right <= layout.innerWidth, `Element ${item.id} clipped horizontally: left=${item.left}, right=${item.right}`);
        }
        assert.equal(layout.overlayHidden, false);
        assert.equal(layout.scoreText, '0');
        assert.equal(layout.linesText, '0');
        assert.equal(layout.levelText, '1');
        assert.equal(layout.forecastLabel, 'ON TRACK');
        assert.equal(layout.forecastPercent, '80%');
        assert.equal(layout.forecastWidth, '80%');
        assert.equal(layout.statusTag, 'STANDBY');
        assert.equal(layout.pauseDisabled, true);

        // Verify Back to Arcade target is reachable
        const backResp = await fetch(`${baseUrl}/index.html`);
        assert.equal(backResp.status, 200);

        // Verify mute toggle updates aria-pressed, label, and localStorage
        const muteBefore = await page.evaluate<string | null>(
          "document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') ?? null",
        );
        assert.equal(muteBefore, 'false');

        await page.click('[data-mute-toggle]');
        await page.waitFor(
          "document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') === 'true'",
        );
        const mutedState = await page.evaluate<{ label: string; stored: string | null }>(`({
          label: document.querySelector('[data-mute-label]')?.textContent?.trim() ?? '',
          stored: localStorage.getItem('nexus-arcade:muted'),
        })`);
        assert.equal(mutedState.label, 'Muted');
        assert.equal(mutedState.stored, '1');

        await page.click('[data-mute-toggle]');
        await page.waitFor(
          "document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') === 'false'",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('plays full keyboard session (Start, Hold, Move, Rotate, Hard Drop, Pause/Resume, Reset) via real DOM & CDP events', async () => {
    await withBrowserPage(
      `${baseUrl}/games/tetris.html`,
      async (page) => {
        await page.waitFor("document.querySelector('#start-btn') !== null");

        // Click #start-btn and verify active game state
        await page.click('#start-btn');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");

        const startedState = await page.evaluate<{
          startDisabled: boolean;
          startText: string;
          pauseDisabled: boolean;
          statusTag: string;
          boardNonBlank: boolean;
          nextNonBlank: boolean;
        }>(`(() => {
          const start = document.getElementById('start-btn');
          const pause = document.getElementById('pause-btn');
          const hasPixels = (id) => {
            const c = document.getElementById(id);
            if (!c) return false;
            const ctx = c.getContext('2d');
            if (!ctx) return false;
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let unique = new Set();
            for (let i = 0; i < data.length; i += 64) {
              unique.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
              if (unique.size > 4) return true;
            }
            return false;
          };
          return {
            startDisabled: start ? start.disabled : false,
            startText: start?.textContent?.trim() ?? '',
            pauseDisabled: pause ? pause.disabled : true,
            statusTag: document.getElementById('status-tag')?.textContent?.trim() ?? '',
            boardNonBlank: hasPixels('tetris-canvas'),
            nextNonBlank: hasPixels('next-canvas'),
          };
        })()`);

        assert.equal(startedState.startDisabled, true);
        assert.equal(startedState.startText, 'Running');
        assert.equal(startedState.pauseDisabled, false);
        assert.equal(startedState.statusTag, 'LVL 1');
        assert.equal(startedState.boardNonBlank, true);
        assert.equal(startedState.nextNonBlank, true);

        // Verify soft drop (+1/cell) before hard drops
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, '')) >= 1",
        );

        // Hold piece via 'c', move left/right, rotate CW/CCW, and hard drop via Space
        await page.pressKey('c');
        await page.pressKey('ArrowLeft');
        await page.pressKey('ArrowUp');
        await page.pressKey('z');
        await page.pressKey('Space');

        await page.waitFor(
          "Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, '')) > 10",
        );

        // Spread hard drops across columns so stack doesn't top out immediately
        await page.pressKey('ArrowRight');
        await page.pressKey('ArrowRight');
        await page.pressKey('Space');

        await page.pressKey('ArrowLeft');
        await page.pressKey('ArrowLeft');
        await page.pressKey('ArrowLeft');
        await page.pressKey('Space');

        const midGame = await page.evaluate<{
          score: number;
          highScore: number;
          forecastLabel: string;
          forecastPercent: string;
          forecastFillWidth: string;
          holdHasPiecePixels: boolean;
        }>(`(() => {
          const score = Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, ''));
          const highScore = Number((document.getElementById('high-score-value')?.textContent ?? '0').replace(/,/g, ''));
          const hold = document.getElementById('hold-canvas');
          let holdHasPiecePixels = false;
          if (hold) {
            const ctx = hold.getContext('2d');
            if (ctx) {
              const data = ctx.getImageData(0, 0, hold.width, hold.height).data;
              const colors = new Set();
              for (let i = 0; i < data.length; i += 16) {
                colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
                if (colors.size > 3) {
                  holdHasPiecePixels = true;
                  break;
                }
              }
            }
          }
          return {
            score,
            highScore,
            forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
            forecastPercent: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
            forecastFillWidth: document.getElementById('forecast-fill')?.style.width ?? '',
            holdHasPiecePixels,
          };
        })()`);

        assert.ok(midGame.score >= 60, `Expected score >= 60 after 3 hard drops, got ${midGame.score}`);
        assert.ok(midGame.highScore >= midGame.score);
        assert.equal(midGame.holdHasPiecePixels, true);
        assert.ok(
          ['DOMINATING', 'ON TRACK', 'PRESSURE', 'CRITICAL', 'VICTORY'].includes(
            midGame.forecastLabel,
          ),
          `Unexpected forecast label: ${midGame.forecastLabel}`,
        );
        assert.match(midGame.forecastPercent, /^\d+%$/);
        assert.equal(midGame.forecastFillWidth, midGame.forecastPercent);

        // Pause via 'p', verify gameplay input is frozen and overlay appears
        await page.pressKey('p');
        await page.waitFor("document.getElementById('status-tag')?.textContent?.trim() === 'PAUSED'");
        const pausedScore = await page.evaluate<number>(
          "Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, ''))",
        );
        await page.pressKey('ArrowLeft');
        await page.pressKey('Space');
        await new Promise((r) => setTimeout(r, 180));
        const scoreAfterPausedKeys = await page.evaluate<number>(
          "Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, ''))",
        );
        assert.equal(scoreAfterPausedKeys, pausedScore);

        // Resume via 'p'
        await page.pressKey('p');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");

        // Also verify on-screen Hard Drop button adds points
        await page.click('#btn-drop');
        await page.waitFor(
          `Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, '')) > ${pausedScore}`,
        );
        const peakScore = await page.evaluate<number>(
          "Number((document.getElementById('score-value')?.textContent ?? '0').replace(/,/g, ''))",
        );

        // Click #reset-btn and verify full reset + preserved high score + no stale RAF leaks
        await page.click('#reset-btn');
        await page.waitFor("document.getElementById('status-tag')?.textContent?.trim() === 'STANDBY'");
        await new Promise((r) => setTimeout(r, 220));

        const resetState = await page.evaluate<{
          score: string;
          highScore: number;
          lines: string;
          level: string;
          time: string;
          combo: string;
          b2b: string;
          overlayHidden: boolean;
          startDisabled: boolean;
          startText: string;
          pauseDisabled: boolean;
          forecastLabel: string;
          forecastPercent: string;
          forecastWidth: string;
          statusTag: string;
        }>(`(() => ({
          score: document.getElementById('score-value')?.textContent?.trim() ?? '',
          highScore: Number((document.getElementById('high-score-value')?.textContent ?? '0').replace(/,/g, '')),
          lines: document.getElementById('lines-value')?.textContent?.trim() ?? '',
          level: document.getElementById('level-value')?.textContent?.trim() ?? '',
          time: document.getElementById('time-value')?.textContent?.trim() ?? '',
          combo: document.getElementById('combo-value')?.textContent?.trim() ?? '',
          b2b: document.getElementById('b2b-value')?.textContent?.trim() ?? '',
          overlayHidden: document.getElementById('game-overlay')?.hidden ?? true,
          startDisabled: document.getElementById('start-btn')?.disabled ?? true,
          startText: document.getElementById('start-btn')?.textContent?.trim() ?? '',
          pauseDisabled: document.getElementById('pause-btn')?.disabled ?? false,
          forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
          forecastPercent: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
          forecastWidth: document.getElementById('forecast-fill')?.style.width ?? '',
          statusTag: document.getElementById('status-tag')?.textContent?.trim() ?? '',
        }))()`);

        assert.equal(resetState.score, '0');
        assert.equal(resetState.highScore, peakScore);
        assert.equal(resetState.lines, '0');
        assert.equal(resetState.level, '1');
        assert.equal(resetState.time, '00:00');
        assert.equal(resetState.combo, '0x');
        assert.equal(resetState.b2b, 'OFF');
        assert.equal(resetState.overlayHidden, false);
        assert.equal(resetState.startDisabled, false);
        assert.equal(resetState.startText, 'Start');
        assert.equal(resetState.pauseDisabled, true);
        assert.equal(resetState.forecastLabel, 'ON TRACK');
        assert.equal(resetState.forecastPercent, '80%');
        assert.equal(resetState.forecastWidth, '80%');
        assert.equal(resetState.statusTag, 'STANDBY');

        const storedHigh = await page.evaluate<string | null>(
          "localStorage.getItem('nexus-arcade:tetris-highscore')",
        );
        assert.equal(storedHigh, String(peakScore));

        // Verify keyboard Enter starts and keyboard 'r' resets cleanly
        await page.pressKey('Enter');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");
        await page.pressKey('r');
        await page.waitFor("document.getElementById('status-tag')?.textContent?.trim() === 'STANDBY'");

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('reaches GAME OVER on center top-out in Chrome and recovers cleanly via Play Again', async () => {
    await withBrowserPage(
      `${baseUrl}/games/tetris.html`,
      async (page) => {
        await page.waitFor("document.querySelector('#overlay-action-btn') !== null");

        // Rapid start/reset cycle via UI buttons before playing
        await page.click('#overlay-action-btn');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");
        await page.click('#reset-btn');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === false");
        await page.click('#overlay-action-btn');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");

        // Hard drop straight down in center columns until top-out occurs
        for (let i = 0; i < 30; i += 1) {
          const isOver = await page.evaluate<boolean>(
            "document.getElementById('status-tag')?.textContent?.trim() === 'GAME OVER'",
          );
          if (isOver) {
            break;
          }
          await page.pressKey('Space');
        }

        await page.waitFor("document.getElementById('status-tag')?.textContent?.trim() === 'GAME OVER'");

        const overState = await page.evaluate<{
          overlayHidden: boolean;
          overlayTitle: string;
          startText: string;
          forecastLabel: string;
          forecastPercent: string;
          forecastWidth: string;
        }>(`(() => ({
          overlayHidden: document.getElementById('game-overlay')?.hidden ?? true,
          overlayTitle: document.getElementById('overlay-title')?.textContent?.trim() ?? '',
          startText: document.getElementById('start-btn')?.textContent?.trim() ?? '',
          forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
          forecastPercent: document.getElementById('forecast-percent')?.textContent?.trim() ?? '',
          forecastWidth: document.getElementById('forecast-fill')?.style.width ?? '',
        }))()`);

        assert.equal(overState.overlayHidden, false);
        assert.equal(overState.overlayTitle, 'GAME OVER');
        assert.equal(overState.startText, 'Play Again');
        assert.equal(overState.forecastLabel, 'GAME OVER');
        assert.equal(overState.forecastPercent, '0%');
        assert.equal(overState.forecastWidth, '0%');

        // Recover via #start-btn ("Play Again")
        await page.click('#start-btn');
        await page.waitFor("document.getElementById('game-overlay')?.hidden === true");
        const restarted = await page.evaluate<{
          score: string;
          statusTag: string;
          forecastLabel: string;
        }>(`(() => ({
          score: document.getElementById('score-value')?.textContent?.trim() ?? '',
          statusTag: document.getElementById('status-tag')?.textContent?.trim() ?? '',
          forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() ?? '',
        }))()`);
        assert.equal(restarted.score, '0');
        assert.equal(restarted.statusTag, 'LVL 1');
        assert.equal(restarted.forecastLabel, 'ON TRACK');

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
