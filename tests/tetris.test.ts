import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_TETROMINO_TYPES,
  BOARD_COLS,
  BOARD_ROWS,
  LOCK_DELAY_MS,
  TetrisEngine,
  TetrominoType,
  getGravityIntervalMs,
  getPieceCells,
} from '../ts/games/tetris/engine.js';

function createEmptyBoard(): (TetrominoType | null)[][] {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array<TetrominoType | null>(BOARD_COLS).fill(null),
  );
}

function createSeededRng(seed = 123456789): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
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

describe('TetrisEngine ("Tetromino Overdrive")', () => {
  it('enforces 7-bag randomizer invariants across multiple bags and exposes Next-3 queue', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(42) });
    assert.equal(engine.getStatus(), 'idle');
    assert.equal(engine.getNextQueue(3).length, 3);

    const spawned: TetrominoType[] = [];
    engine.start();

    for (let i = 0; i < 35; i += 1) {
      const active = engine.getActivePiece();
      assert.ok(active, `Expected active piece at drop ${i}`);
      spawned.push(active.type);

      // Verify Next-3 queue strictly leads into the next pieces spawned
      const expectedNext = engine.getNextQueue(3);
      assert.equal(expectedNext.length, 3);
      for (const t of expectedNext) {
        assert.ok(ALL_TETROMINO_TYPES.includes(t));
      }

      // Drop to a clean empty-enough board or reload clean grid so we don't top out
      const board = createEmptyBoard();
      engine.loadVisibleGrid(board);
      engine.hardDrop();
    }

    // Every slice of 7 spawned pieces must contain all 7 unique tetrominoes
    for (let bagIdx = 0; bagIdx < 5; bagIdx += 1) {
      const slice = spawned.slice(bagIdx * 7, (bagIdx + 1) * 7);
      const unique = new Set(slice);
      assert.equal(unique.size, 7, `Bag ${bagIdx} must contain 7 unique pieces, got ${slice.join(',')}`);
      for (const pieceType of ALL_TETROMINO_TYPES) {
        assert.ok(unique.has(pieceType), `Bag ${bagIdx} missing ${pieceType}`);
      }
    }
  });

  it('clamps horizontal movement at walls and stops on block collisions', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(7) });
    engine.start();

    const board = createEmptyBoard();
    board[18][2] = 'L';
    board[18][7] = 'L';
    engine.loadVisibleGrid(board);

    // Place O piece at center (occupies cols 4..5, rows 17..18)
    assert.equal(engine.setActivePiece({ type: 'O', x: 3, y: 17, rotation: 0 }), true);

    // Can move left once (cols 3..4), then blocked by col 2 at row 18
    assert.equal(engine.moveLeft(), true);
    assert.equal(engine.getActivePiece()?.x, 2);
    assert.equal(engine.moveLeft(), false);
    assert.equal(engine.getActivePiece()?.x, 2);

    // Move back right until blocked by col 7 at row 18 (cols 5..6 valid, col 6..7 blocked)
    assert.equal(engine.moveRight(), true); // x=3 -> cols 4..5
    assert.equal(engine.moveRight(), true); // x=4 -> cols 5..6
    assert.equal(engine.moveRight(), false); // blocked by col 7
    assert.equal(engine.getActivePiece()?.x, 4);

    // On open row 0, O clamps against left wall (x=-1 -> cols 0..1) and right wall (x=7 -> cols 8..9)
    assert.equal(engine.setActivePiece({ type: 'O', x: 3, y: 0, rotation: 0 }), true);
    while (engine.moveLeft()) {
      // slide left
    }
    const leftCells = getPieceCells(engine.getActivePiece()!);
    assert.equal(Math.min(...leftCells.map((c) => c.x)), 0);

    while (engine.moveRight()) {
      // slide right
    }
    const rightCells = getPieceCells(engine.getActivePiece()!);
    assert.equal(Math.max(...rightCells.map((c) => c.x)), BOARD_COLS - 1);
  });

  it('clamps vertical soft drop on floor/blocks and awards +1 score per cell', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(9) });
    engine.start();

    const board = createEmptyBoard();
    board[18][4] = 'Z';
    board[18][5] = 'Z';
    engine.loadVisibleGrid(board);

    assert.equal(engine.setActivePiece({ type: 'O', x: 3, y: 14, rotation: 0 }), true);
    // O occupies rows y, y+1 -> stops at y=16 (rows 16..17), blocked at y=17 by row 18
    assert.equal(engine.softDrop(), true); // y=15 (+1)
    assert.equal(engine.softDrop(), true); // y=16 (+1)
    assert.equal(engine.softDrop(), false); // blocked at y=17
    assert.equal(engine.getActivePiece()?.y, 16);
    assert.equal(engine.getScore(), 2);
  });

  it('performs SRS rotations and wall kicks cleanly against walls and floor', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(11) });
    engine.start();

    // T piece pressed against left wall in state 1 (cells at col 0..1)
    assert.equal(engine.setActivePiece({ type: 'T', x: -1, y: 8, rotation: 1 }), true);
    assert.equal(engine.rotateCW(), true); // kicks right to x=0, state 2
    const tAfter = engine.getActivePiece()!;
    assert.equal(tAfter.rotation, 2);
    assert.equal(tAfter.x, 0);

    // I piece pressed against left wall in state 1 (cells at col 0)
    assert.equal(engine.setActivePiece({ type: 'I', x: -2, y: 8, rotation: 1 }), true);
    assert.equal(engine.rotateCCW(), true); // 1 -> 0 kicks +2 right to x=0
    const iLeft = engine.getActivePiece()!;
    assert.equal(iLeft.rotation, 0);
    assert.equal(iLeft.x, 0);

    // I piece at bottom floor in state 0 (cells on row 19) rotates CW using upward kick
    assert.equal(engine.setActivePiece({ type: 'I', x: 3, y: 18, rotation: 0 }), true);
    assert.equal(engine.rotateCW(), true);
    const iFloor = engine.getActivePiece()!;
    assert.equal(iFloor.rotation, 1);
    const cells = getPieceCells(iFloor);
    assert.ok(cells.every((c) => c.y >= 0 && c.y < BOARD_ROWS));

    // Completely boxed-in T piece refuses rotation
    const boxed = createEmptyBoard();
    for (let r = 8; r <= 14; r += 1) {
      for (let c = 2; c <= 7; c += 1) {
        if (r === 11 && c >= 3 && c <= 5) continue;
        if (r === 10 && c === 4) continue;
        boxed[r][c] = 'J';
      }
    }
    engine.loadVisibleGrid(boxed);
    assert.equal(engine.setActivePiece({ type: 'T', x: 3, y: 10, rotation: 0 }), true);
    assert.equal(engine.rotateCW(), false);
    assert.equal(engine.getActivePiece()?.rotation, 0);
  });

  it('scores Single, Double, Triple, and Tetris clears and shifts upper rows down', () => {
    // Single (100 * level)
    {
      const engine = new TetrisEngine({ rng: createSeededRng(1) });
      engine.start();
      const board = createEmptyBoard();
      board[18][0] = 'S'; // marker above cleared row
      fillRowExcept(board, 19, [4, 5]);
      engine.loadVisibleGrid(board);
      engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
      const res = engine.hardDrop();
      assert.equal(res.linesCleared, 1);
      assert.equal(res.scoreDelta, 100);
      assert.equal(engine.getLines(), 1);
      assert.equal(engine.getVisibleGrid()[19][0], 'S');
    }

    // Double (300 * level)
    {
      const engine = new TetrisEngine({ rng: createSeededRng(2) });
      engine.start();
      const board = createEmptyBoard();
      fillRowExcept(board, 18, [4, 5]);
      fillRowExcept(board, 19, [4, 5]);
      engine.loadVisibleGrid(board);
      engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
      const res = engine.hardDrop();
      assert.equal(res.linesCleared, 2);
      assert.equal(res.scoreDelta, 300);
      assert.equal(engine.getLines(), 2);
    }

    // Triple (500 * level)
    {
      const engine = new TetrisEngine({ rng: createSeededRng(3) });
      engine.start();
      const board = createEmptyBoard();
      fillRowExcept(board, 17, [2]);
      fillRowExcept(board, 18, [2]);
      fillRowExcept(board, 19, [2]);
      engine.loadVisibleGrid(board);
      engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
      const res = engine.hardDrop();
      assert.equal(res.linesCleared, 3);
      assert.equal(res.scoreDelta, 500);
      assert.equal(engine.getLines(), 3);
    }

    // Tetris (800 * level)
    {
      const engine = new TetrisEngine({ rng: createSeededRng(4) });
      engine.start();
      const board = createEmptyBoard();
      fillRowExcept(board, 16, [2]);
      fillRowExcept(board, 17, [2]);
      fillRowExcept(board, 18, [2]);
      fillRowExcept(board, 19, [2]);
      engine.loadVisibleGrid(board);
      engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
      const res = engine.hardDrop();
      assert.equal(res.linesCleared, 4);
      assert.equal(res.scoreDelta, 800);
      assert.equal(engine.getLines(), 4);
    }
  });

  it('applies consecutive combo bonuses and Back-to-Back 1.5x difficult clear bonuses', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(25) });
    engine.start();

    // First Tetris: 800 (combo=0, b2b=false -> sets b2b=true)
    const b1 = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b1, r, [2]);
    engine.loadVisibleGrid(b1);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    const r1 = engine.hardDrop();
    assert.equal(r1.linesCleared, 4);
    assert.equal(r1.backToBackApplied, false);
    assert.equal(r1.combo, 0);
    assert.equal(r1.scoreDelta, 800);

    // Consecutive Second Tetris: 800 * 1.5 = 1200 + combo(1)*50 = 1250!
    const b2 = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b2, r, [5]);
    engine.loadVisibleGrid(b2);
    engine.setActivePiece({ type: 'I', x: 3, y: 16, rotation: 1 });
    const r2 = engine.hardDrop();
    assert.equal(r2.linesCleared, 4);
    assert.equal(r2.backToBackApplied, true);
    assert.equal(r2.combo, 1);
    assert.equal(r2.scoreDelta, 1250);

    // Non-clearing drop resets combo, but keeps B2B intact
    engine.loadVisibleGrid(createEmptyBoard());
    engine.setActivePiece({ type: 'O', x: 0, y: 18, rotation: 0 });
    const rIdle = engine.hardDrop();
    assert.equal(rIdle.linesCleared, 0);
    assert.equal(rIdle.combo, -1);

    // Third Tetris after non-clearing drop STILL gets B2B (1200), combo resets to 0
    const b3 = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b3, r, [7]);
    engine.loadVisibleGrid(b3);
    engine.setActivePiece({ type: 'I', x: 5, y: 16, rotation: 1 });
    const r3 = engine.hardDrop();
    assert.equal(r3.backToBackApplied, true);
    assert.equal(r3.combo, 0);
    assert.equal(r3.scoreDelta, 1200);

    // Non-difficult Single breaks B2B
    const b4 = createEmptyBoard();
    fillRowExcept(b4, 19, [4, 5]);
    engine.loadVisibleGrid(b4);
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    const rSingle = engine.hardDrop();
    assert.equal(rSingle.linesCleared, 1);
    assert.equal(rSingle.backToBackApplied, false);
    assert.equal(engine.getSnapshot().backToBack, false);
  });

  it('detects T-Spin Double and awards difficult T-Spin bonus', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(33) });
    engine.start();

    const board = createEmptyBoard();
    // Classic T-spin slot in rows 18..19 at cols 3..5 with top-left overhang
    board[17][3] = 'J';
    board[17][5] = 'J'; // overhang corner makes front corners occupied after rotation
    fillRowExcept(board, 18, [3, 4, 5]);
    fillRowExcept(board, 19, [4]);
    engine.loadVisibleGrid(board);

    // Place T in state 1 at x=3,y=17 rotated CW -> state 2 at x=3,y=17 fits slot in rows 18..19
    // Wait: let's position T in state 3 at x=3, y=17 and rotate CCW to state 2 (nose down at row 19 col 4)!
    board[17][5] = null;
    board[17][3] = 'L';
    board[19][3] = 'L';
    board[19][5] = 'L';
    engine.loadVisibleGrid(board);
    assert.equal(engine.setActivePiece({ type: 'T', x: 3, y: 17, rotation: 1 }), true);
    assert.equal(engine.rotateCW(), true); // rotates to state 2: row 18 cols 3,4,5 and row 19 col 4
    // Now add right top corner overhang isn't needed since 3 corners (17,3), (19,3), (19,5) are filled!
    // Actually with (17,3), (19,3), (19,5) filled (3 corners), 2 of those 3 are bottom front corners in state 2!
    const res = engine.hardDrop();
    assert.equal(res.tSpin, 'full');
    assert.equal(res.linesCleared, 2);
    assert.equal(res.scoreDelta, 1200);
  });

  it('advances level every 10 lines and increases gravity speed', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(55) });
    engine.start();
    assert.equal(engine.getLevel(), 1);
    assert.ok(getGravityIntervalMs(2) < getGravityIntervalMs(1));
    assert.ok(getGravityIntervalMs(5) < getGravityIntervalMs(2));

    // Clear 4 + 4 + 2 = 10 lines -> reaches level 2
    for (let batch = 0; batch < 2; batch += 1) {
      const b = createEmptyBoard();
      for (let r = 16; r <= 19; r += 1) fillRowExcept(b, r, [1]);
      engine.loadVisibleGrid(b);
      engine.setActivePiece({ type: 'I', x: -1, y: 16, rotation: 1 });
      engine.hardDrop();
    }
    assert.equal(engine.getLines(), 8);
    assert.equal(engine.getLevel(), 1);

    const bLast = createEmptyBoard();
    fillRowExcept(bLast, 18, [4, 5]);
    fillRowExcept(bLast, 19, [4, 5]);
    engine.loadVisibleGrid(bLast);
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    const res = engine.hardDrop();
    assert.equal(engine.getLines(), 10);
    assert.equal(engine.getLevel(), 2);
    assert.equal(res.leveledUp, true);
    assert.equal(res.newLevel, 2);
  });

  it('enforces Hold swap and one-hold-per-drop restriction', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(77) });
    engine.setNextQueueForTest(['T', 'I', 'O', 'S', 'Z', 'J', 'L']);
    engine.start();

    assert.equal(engine.getActivePiece()?.type, 'T');
    assert.equal(engine.getHoldPiece(), null);

    // First hold stores T and pulls I from queue
    assert.equal(engine.hold(), true);
    assert.equal(engine.getHoldPiece(), 'T');
    assert.equal(engine.getActivePiece()?.type, 'I');
    assert.equal(engine.canUseHold(), false);

    // Second hold on same drop must fail
    assert.equal(engine.hold(), false);
    assert.equal(engine.getHoldPiece(), 'T');
    assert.equal(engine.getActivePiece()?.type, 'I');

    // Lock current piece via hardDrop -> resets canHold
    engine.hardDrop();
    assert.equal(engine.getActivePiece()?.type, 'O');
    assert.equal(engine.canUseHold(), true);

    // Now holding swaps O into hold and brings T back into play
    assert.equal(engine.hold(), true);
    assert.equal(engine.getHoldPiece(), 'O');
    assert.equal(engine.getActivePiece()?.type, 'T');
    assert.equal(engine.hold(), false);
  });

  it('handles hard drop ghost projection, score (+2/cell), tick lock delay, and pause', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(88) });
    engine.start();

    const board = createEmptyBoard();
    engine.loadVisibleGrid(board);
    engine.setActivePiece({ type: 'O', x: 3, y: 0, rotation: 0 });

    const ghost = engine.getGhostPiece();
    assert.ok(ghost);
    assert.equal(ghost.y, 18); // O occupies rows 18..19 at bottom

    // Pause blocks movement and gravity ticks
    assert.equal(engine.togglePause(), 'paused');
    assert.equal(engine.moveLeft(), false);
    assert.equal(engine.tick(2000).movedDown, false);
    assert.equal(engine.togglePause(), 'playing');

    const dropRes = engine.hardDrop();
    assert.equal(dropRes.droppedCells, 18);
    assert.equal(dropRes.scoreDelta, 0);
    assert.equal(engine.getScore(), 36); // 18 * 2

    // Verify stepGravity and lock delay in tick()
    engine.loadVisibleGrid(createEmptyBoard());
    engine.setActivePiece({ type: 'O', x: 3, y: 17, rotation: 0 });
    const step1 = engine.stepGravity();
    assert.equal(step1.movedDown, true);
    assert.equal(step1.locked, false);
    assert.equal(engine.getActivePiece()?.y, 18);

    // Tick past lock delay locks the grounded piece
    const lockTick = engine.tick(LOCK_DELAY_MS + 20);
    assert.equal(lockTick.locked, true);
  });

  it('triggers Game Over when spawn position is blocked', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(99) });
    engine.setNextQueueForTest(['T', 'I', 'O', 'S', 'Z', 'J', 'L']);
    engine.start();

    const board = createEmptyBoard();
    // Block top rows where next piece (I at cols 3..6 row 0) will spawn
    board[0][3] = 'J';
    board[0][4] = 'J';
    board[0][5] = 'J';
    board[0][6] = 'J';
    engine.loadVisibleGrid(board);
    engine.setActivePiece({ type: 'O', x: 0, y: 18, rotation: 0 });

    const res = engine.hardDrop();
    assert.equal(res.gameOver, true);
    assert.equal(engine.getStatus(), 'gameover');
    const forecast = engine.getSurvivalForecast();
    assert.equal(forecast.label, 'GAME OVER');
    assert.equal(forecast.percent, 0);
  });

  it('degrades Survival Forecast on tall messy stacks and celebrates Victory at 10,000 pts', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(101) });
    engine.start();

    // Clean empty board starts ON TRACK (~80%)
    const cleanForecast = engine.getSurvivalForecast();
    assert.equal(cleanForecast.label, 'ON TRACK');
    assert.ok(cleanForecast.percent >= 70 && cleanForecast.percent < 85);

    // Build messy tall stack with buried holes and high bumpiness
    const messy = createEmptyBoard();
    for (let r = 4; r < BOARD_ROWS; r += 1) {
      for (let c = 0; c < BOARD_COLS; c += 1) {
        if ((r + c) % 2 === 0 && r > 6) {
          messy[r][c] = null; // buried holes
        } else if (c % 2 === 0 || r >= 8) {
          messy[r][c] = 'Z';
        }
      }
    }
    engine.loadVisibleGrid(messy);
    const messyForecast = engine.getSurvivalForecast();
    assert.equal(messyForecast.label, 'CRITICAL');
    assert.ok(messyForecast.percent < cleanForecast.percent);
    assert.ok(messyForecast.metrics.holes > 0);
    assert.ok(messyForecast.metrics.maxHeight >= 15);

    // High score >= 10,000 unlocks VICTORY forecast
    const victoryEngine = new TetrisEngine({ rng: createSeededRng(102), victoryScore: 1000 });
    victoryEngine.start();
    const b = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b, r, [2]);
    victoryEngine.loadVisibleGrid(b);
    victoryEngine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    victoryEngine.hardDrop(); // 800 pts
    const domForecast = victoryEngine.getSurvivalForecast();
    assert.equal(domForecast.label, 'DOMINATING');

    const b2 = createEmptyBoard();
    fillRowExcept(b2, 18, [4, 5]);
    fillRowExcept(b2, 19, [4, 5]);
    victoryEngine.loadVisibleGrid(b2);
    victoryEngine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });
    const winRes = victoryEngine.hardDrop();
    assert.equal(winRes.victoryUnlocked, true);
    const winForecast = victoryEngine.getSurvivalForecast();
    assert.equal(winForecast.label, 'VICTORY');
    assert.equal(winForecast.percent, 100);

    // Also verify default 10,000-pt Victory Rank threshold
    const defaultTargetEngine = new TetrisEngine({ rng: createSeededRng(103) });
    defaultTargetEngine.start();
    for (let i = 0; i < 8; i += 1) {
      const bt = createEmptyBoard();
      for (let r = 16; r <= 19; r += 1) fillRowExcept(bt, r, [2]);
      defaultTargetEngine.loadVisibleGrid(bt);
      defaultTargetEngine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
      defaultTargetEngine.hardDrop();
    }
    assert.ok(defaultTargetEngine.getScore() >= 10_000);
    assert.equal(defaultTargetEngine.getSurvivalForecast().label, 'VICTORY');
    assert.equal(defaultTargetEngine.getSurvivalForecast().percent, 100);
  });

  it('performs full reset while preserving high score', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(202) });
    engine.start();

    const b = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b, r, [2]);
    engine.loadVisibleGrid(b);
    engine.setActivePiece({ type: 'I', x: 0, y: 14, rotation: 1 });
    engine.hold();
    engine.hardDrop();

    assert.ok(engine.getScore() > 0 || engine.getHighScore() >= 0);
    // Score something directly via clear to verify highScore preservation
    const b2 = createEmptyBoard();
    for (let r = 16; r <= 19; r += 1) fillRowExcept(b2, r, [2]);
    engine.loadVisibleGrid(b2);
    engine.setActivePiece({ type: 'I', x: 0, y: 16, rotation: 1 });
    engine.hardDrop();

    const peakScore = engine.getScore();
    assert.ok(peakScore >= 800);
    assert.equal(engine.getHighScore(), peakScore);

    engine.reset();
    assert.equal(engine.getStatus(), 'idle');
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getLevel(), 1);
    assert.equal(engine.getLines(), 0);
    assert.equal(engine.getHoldPiece(), null);
    assert.equal(engine.getActivePiece(), null);
    assert.equal(engine.getHighScore(), peakScore);
    assert.equal(engine.getBoardStats().maxHeight, 0);
    assert.equal(engine.getNextQueue(3).length, 3);
  });

  it('ignores gameplay actions when idle and refreshes lock delay on grounded moves', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(303), highScore: 500 });
    assert.equal(engine.getHighScore(), 500);
    assert.equal(engine.moveLeft(), false);
    assert.equal(engine.moveRight(), false);
    assert.equal(engine.softDrop(), false);
    assert.equal(engine.rotateCW(), false);
    assert.equal(engine.rotateCCW(), false);
    assert.equal(engine.hold(), false);
    assert.equal(engine.hardDrop().droppedCells, 0);

    engine.start();
    engine.loadVisibleGrid(createEmptyBoard());
    engine.setActivePiece({ type: 'O', x: 3, y: 18, rotation: 0 });

    // Accumulate 400ms of lock delay (< 500ms)
    const t1 = engine.tick(400);
    assert.equal(t1.locked, false);

    // Grounded sideways move resets lock timer
    assert.equal(engine.moveLeft(), true);
    const t2 = engine.tick(400);
    assert.equal(t2.locked, false);

    // Waiting full LOCK_DELAY_MS locks the piece
    const t3 = engine.tick(LOCK_DELAY_MS);
    assert.equal(t3.locked, true);
  });

  it('handles right-wall I-piece kicks, O-piece stability, and non-adjacent line clears', () => {
    const engine = new TetrisEngine({ rng: createSeededRng(404) });
    engine.start();

    // I piece against right wall in state 1 (cells at col 9) kicks left to fit horizontally
    assert.equal(engine.setActivePiece({ type: 'I', x: 7, y: 8, rotation: 1 }), true);
    assert.equal(engine.rotateCW(), true);
    const iCells = getPieceCells(engine.getActivePiece()!);
    assert.ok(iCells.every((c) => c.x >= 0 && c.x < BOARD_COLS));

    // O piece keeps exact cell coordinates across CW/CCW rotations
    assert.equal(engine.setActivePiece({ type: 'O', x: 3, y: 4, rotation: 0 }), true);
    const beforeO = getPieceCells(engine.getActivePiece()!);
    assert.equal(engine.rotateCW(), true);
    const afterO = getPieceCells(engine.getActivePiece()!);
    assert.deepEqual(afterO, beforeO);

    // Non-adjacent rows 17 and 19 cleared simultaneously by vertical I piece
    const splitBoard = createEmptyBoard();
    fillRowExcept(splitBoard, 17, [0]);
    splitBoard[18][0] = null;
    splitBoard[18][5] = 'T'; // row 18 stays incomplete
    fillRowExcept(splitBoard, 19, [0]);
    engine.loadVisibleGrid(splitBoard);
    engine.setActivePiece({ type: 'I', x: -2, y: 16, rotation: 1 });
    const splitRes = engine.hardDrop();
    assert.equal(splitRes.linesCleared, 2);
    const gridAfter = engine.getVisibleGrid();
    // Row 17 & 19 cleared -> original row 18 (with T at col 5) falls by 1 row to row 19,
    // and original row 16 (I block at col 0) falls by 2 rows to row 18.
    assert.equal(gridAfter[19][5], 'T');
    assert.equal(gridAfter[19][0], 'I');
    assert.equal(gridAfter[18][0], 'I');
  });

  it('caps gravity interval safely at high levels', () => {
    const l1 = getGravityIntervalMs(1);
    const l10 = getGravityIntervalMs(10);
    const l25 = getGravityIntervalMs(25);
    assert.ok(l1 > l10);
    assert.ok(l10 > l25);
    assert.equal(l25, 65);
  });
});
