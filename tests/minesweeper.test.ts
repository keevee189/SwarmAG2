import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIFFICULTIES,
  MinesweeperEngine,
  createSeededRng,
  type Difficulty,
} from '../ts/games/minesweeper/engine.js';

test('difficulty configurations and exact mine counts across beginner, intermediate, and expert', () => {
  const cases: Array<{ diff: Difficulty; rows: number; cols: number; mines: number }> = [
    { diff: 'beginner', rows: 9, cols: 9, mines: 10 },
    { diff: 'intermediate', rows: 12, cols: 12, mines: 22 },
    { diff: 'expert', rows: 16, cols: 16, mines: 40 },
  ];

  for (const spec of cases) {
    const engine = new MinesweeperEngine({
      difficulty: spec.diff,
      rng: createSeededRng(100 + spec.mines),
    });
    assert.equal(engine.getRows(), spec.rows);
    assert.equal(engine.getCols(), spec.cols);
    assert.equal(engine.getTotalMines(), spec.mines);
    assert.equal(engine.getTotalSafeCells(), spec.rows * spec.cols - spec.mines);
    assert.equal(engine.isMinesPlaced(), false);

    engine.start();
    const res = engine.reveal(Math.floor(spec.rows / 2), Math.floor(spec.cols / 2));
    assert.equal(res.ok, true);
    assert.equal(res.detonated, false);
    assert.equal(engine.isMinesPlaced(), true);

    const snapshot = engine.getSnapshot();
    const actualMines = snapshot.board.filter((c) => c.hasMine).length;
    assert.equal(actualMines, spec.mines, `Expected ${spec.mines} mines for ${spec.diff}`);
    assert.equal(DIFFICULTIES[spec.diff].mines, spec.mines);
  }
});

test('first-click 3x3 exclusion zone guarantees zero-cascade across positions and seeds', () => {
  const difficulties: Difficulty[] = ['beginner', 'intermediate', 'expert'];

  for (const diff of difficulties) {
    const cfg = DIFFICULTIES[diff];
    const clickTargets: Array<[number, number]> = [
      [0, 0],
      [0, Math.floor(cfg.cols / 2)],
      [Math.floor(cfg.rows / 2), Math.floor(cfg.cols / 2)],
      [cfg.rows - 1, cfg.cols - 1],
    ];

    for (let s = 0; s < clickTargets.length; s += 1) {
      const [clickR, clickC] = clickTargets[s];
      const engine = new MinesweeperEngine({
        difficulty: diff,
        rng: createSeededRng(5000 + s * 97 + cfg.mines),
      });

      const res = engine.reveal(clickR, clickC);
      assert.equal(res.ok, true);
      assert.equal(res.detonated, false);
      assert.equal(engine.getStatus(), 'playing');

      const clickedCell = engine.getCell(clickR, clickC);
      assert.ok(clickedCell);
      assert.equal(clickedCell.hasMine, false);
      assert.equal(clickedCell.adjacentMines, 0);

      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = clickR + dr;
          const cc = clickC + dc;
          if (rr >= 0 && rr < cfg.rows && cc >= 0 && cc < cfg.cols) {
            const neighbor = engine.getCell(rr, cc);
            assert.ok(neighbor);
            assert.equal(
              neighbor.hasMine,
              false,
              `Expected (${rr},${cc}) in 3x3 exclusion zone around (${clickR},${clickC}) to have no mine`,
            );
            assert.equal(neighbor.revealed, true);
          }
        }
      }

      assert.ok(res.newlyRevealed.length >= 4);
    }
  }
});

test('BFS flood-fill cascade opens connected zero region and perimeter while respecting flags', () => {
  const engine = new MinesweeperEngine({ difficulty: 'beginner' });
  // Place mines at col 4 for rows 0..4 to wall off left region from right region, plus (4,0..3)
  // Wait: let's isolate a 3x3 zero corner at (0,0)-(2,2) by placing mines along row 3 & col 3
  const mines: Array<[number, number]> = [
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 0],
    [3, 1],
    [3, 2],
    [3, 3],
    [8, 8],
  ];
  engine.loadCustomMineLayout(mines, { rows: 9, cols: 9 });

  // Flag one perimeter safe cell (2,2) before revealing (0,0) to verify BFS respects flags
  const flagRes = engine.toggleFlag(2, 2);
  assert.equal(flagRes.ok, true);
  assert.equal(flagRes.flagged, true);

  const revealRes = engine.reveal(0, 0);
  assert.equal(revealRes.ok, true);
  assert.equal(revealRes.detonated, false);

  // Cells (0..2, 0..2) minus flagged (2,2) should all be revealed (8 cells)
  assert.equal(revealRes.newlyRevealed.length, 8);
  assert.equal(engine.getCell(2, 2)?.revealed, false);
  assert.equal(engine.getCell(2, 2)?.flagged, true);

  // Beyond the mine wall (e.g. (0,4) or (4,0)), cells must remain unrevealed
  assert.equal(engine.getCell(0, 4)?.revealed, false);
  assert.equal(engine.getCell(4, 0)?.revealed, false);

  // Numbers on perimeter inside region should match mine neighbors
  assert.equal(engine.getCell(0, 2)?.adjacentMines, 2);
  assert.equal(engine.getCell(1, 2)?.adjacentMines, 3);
});

test('flag toggle and guard preventing revealing flagged cells', () => {
  const engine = new MinesweeperEngine({ difficulty: 'beginner' });
  engine.loadCustomMineLayout([
    [0, 0],
    [4, 4],
  ], { rows: 9, cols: 9 });

  // Toggle flag on mine (0,0)
  const f1 = engine.toggleFlag(0, 0);
  assert.equal(f1.ok, true);
  assert.equal(f1.flagged, true);
  assert.equal(f1.minesLeft, 1);

  // Attempting to reveal flagged cell is blocked
  const blockedReveal = engine.reveal(0, 0);
  assert.equal(blockedReveal.ok, false);
  assert.equal(blockedReveal.reason, 'flagged');
  assert.equal(blockedReveal.detonated, false);
  assert.equal(engine.getStatus(), 'playing');

  // Unflagging restores reveal capability
  const f2 = engine.toggleFlag(0, 0);
  assert.equal(f2.ok, true);
  assert.equal(f2.flagged, false);
  assert.equal(f2.minesLeft, 2);

  // Reveal safe cell (1,1) then verify revealed cell cannot be flagged
  const safeReveal = engine.reveal(1, 1);
  assert.equal(safeReveal.ok, true);
  assert.equal(engine.getCell(1, 1)?.adjacentMines, 1);

  const flagRevealed = engine.toggleFlag(1, 1);
  assert.equal(flagRevealed.ok, false);
  assert.equal(flagRevealed.reason, 'already-revealed');
});

test('chording completes safe neighbors cleanly and detonates on mis-flagged mine', () => {
  // 1. Safe chord completion
  const safeEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  safeEngine.loadCustomMineLayout([[0, 0]], { rows: 5, cols: 5 });

  // Reveal (1,1) which has adjacentMines === 1
  const r1 = safeEngine.reveal(1, 1);
  assert.equal(r1.ok, true);
  assert.equal(safeEngine.getCell(1, 1)?.adjacentMines, 1);

  // Chord before flagging fails with flag-count-mismatch
  const earlyChord = safeEngine.chord(1, 1);
  assert.equal(earlyChord.ok, false);
  assert.equal(earlyChord.reason, 'flag-count-mismatch');

  // Flag true mine at (0,0) and chord (1,1) -> reveals remaining safe cells & wins 5x5 board
  safeEngine.toggleFlag(0, 0);
  const scoreBeforeChord = safeEngine.getScore();
  const goodChord = safeEngine.chord(1, 1);
  assert.equal(goodChord.ok, true);
  assert.equal(goodChord.detonated, false);
  assert.equal(goodChord.status, 'won');
  assert.ok(goodChord.newlyRevealed.length > 1);
  assert.ok(safeEngine.getScore() > scoreBeforeChord);

  // 2. Mis-flagged mine detonation
  const badEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  badEngine.loadCustomMineLayout([[0, 0]], { rows: 5, cols: 5 });
  badEngine.reveal(1, 1);

  // Mis-flag safe cell (0,1) instead of mine (0,0)
  badEngine.toggleFlag(0, 1);
  const badChord = badEngine.chord(1, 1);
  assert.equal(badChord.ok, true);
  assert.equal(badChord.detonated, true);
  assert.equal(badChord.status, 'lost');
  assert.equal(badEngine.getCell(0, 0)?.detonated, true);
  assert.equal(badEngine.getCell(0, 1)?.wrongFlag, true);
});

test('frontier deduction solver getHint() handles direct rules, pairwise subset reduction, and probability fallback', () => {
  // Case A: Opening hint before first reveal
  const freshEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  const openHint = freshEngine.getHint();
  assert.ok(openHint);
  assert.equal(openHint.kind, 'opening');
  assert.equal(openHint.certainty, 1);

  // Case B: Pairwise subset reduction (1-2 pattern along top wall)
  // 5x5 board, mines at (0,2) and (0,4).
  // Reveal row 1: (1,0)=0, (1,1)=1, (1,2)=1 -> wait let's construct exact 1-2 along row 0:
  // Suppose mines ONLY at (0,2) and (0,4)? Wait:
  // If mines at (0,2) and (0,4) on 4x5 board:
  // (1,0) sees {(0,0),(0,1)} -> count 0 (not 1-2).
  // Better: mines at (0,2) and (4,4) (far away), and reveal (1,0), (1,1):
  // Wait: let's build classic 1-2-1 along row 0:
  // Row 0 unrevealed: (0,0), (0,1), (0,2), (0,3)
  // Put mines at (0,0) and (0,2) and (4,4)!
  // Let's check row 1 values if we reveal row 1..4 and (0,3):
  // (1,0) neighbors in row 0 = {(0,0), (0,1)} -> mine at (0,0) => adj = 1!
  // (1,1) neighbors in row 0 = {(0,0), (0,1), (0,2)} -> mines at (0,0),(0,2) => adj = 2!
  // (1,2) neighbors in row 0 = {(0,1), (0,2), (0,3)} -> mine at (0,2) => adj = 1!
  // Now suppose ONLY (1,0)=1 and (1,1)=2 and (1,2)=1 are revealed (and (0,3) is safe or revealed, wait: keep (2,0..2) revealed 0s!):
  // If we reveal (2,0) on a board with mines at (0,0), (0,2), (4,4):
  // (2,0) is 0! Wait: BFS from (2,0) reveals (1,0)=1, (1,1)=2, (1,2)=1, (1,3)=1, (0,3)=0? Wait (0,3) is adjacent to (0,2), so (0,3)=1!
  // Look at unrevealed neighbors of (1,0), (1,1), (1,2) after revealing (2,0) AND revealing (1,3)=1? Wait BFS reveals ALL 0s!
  // Let's check what BFS from (2,0) reveals when mines are at (0,0), (0,2), (4,4):
  // Row 0: [M, 2, M, 1, 0] -> (0,4)=0!
  // To avoid BFS leaking around the side at (0,4), put a mine at (0,4) too or use 4 columns: cols 0..3!
  // On 4x4 board with mines at (0,0) and (0,2):
  // Row 0: [M(0,0), 2(0,1), M(0,2), 1(0,3)]
  // Row 1: [1(1,0), 2(1,1), 1(1,2), 1(1,3)]
  // Row 2: [0, 0, 0, 0]
  // Row 3: [0, 0, 0, 0]
  // When we reveal (3,0), BFS reveals rows 2, 3, and all of row 1: (1,0)=1, (1,1)=2, (1,2)=1, (1,3)=1!
  // Row 0 remains COMPLETELY unrevealed: {(0,0), (0,1), (0,2), (0,3)}!
  // Look at the constraints on row 0:
  // - (1,0)=1 => {(0,0), (0,1)} has 1 mine.
  // - (1,1)=2 => {(0,0), (0,1), (0,2)} has 2 mines.
  // - (1,2)=1 => {(0,1), (0,2), (0,3)} has 1 mine.
  // - (1,3)=1 => {(0,2), (0,3)} has 1 mine.
  // Notice: NO single cell has a direct count rule (counts are 1/2, 2/3, 1/3, 1/2)!
  // Pairwise subset reduction compares (1,0) {0,1}=1 against (1,1) {0,1,2}=2 => (0,2) is 100% MINE!
  // And compares (1,3) {2,3}=1 against (1,1) => (0,0) is 100% MINE!
  // Then pass 2 simplifies (1,0) and (1,3) => (0,1) and (0,3) are 100% SAFE!
  const subsetEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  subsetEngine.loadCustomMineLayout(
    [
      [0, 0],
      [0, 2],
    ],
    { rows: 4, cols: 4 },
  );
  subsetEngine.reveal(3, 0);

  // Confirm row 0 is still unrevealed
  assert.equal(subsetEngine.getCell(0, 0)?.revealed, false);
  assert.equal(subsetEngine.getCell(0, 1)?.revealed, false);
  assert.equal(subsetEngine.getCell(0, 2)?.revealed, false);
  assert.equal(subsetEngine.getCell(0, 3)?.revealed, false);

  const subsetHint = subsetEngine.getHint();
  assert.ok(subsetHint);
  assert.equal(subsetHint.kind, 'safe');
  assert.equal(subsetHint.action, 'reveal');
  assert.equal(subsetHint.certainty, 1);
  assert.equal(subsetHint.mineProbability, 0);
  // Must be either (0,1) or (0,3), never a mine!
  assert.equal(subsetHint.row, 0);
  assert.ok(subsetHint.col === 1 || subsetHint.col === 3);

  // Case C: Subset deduction yielding ONLY a 100% provable mine (no provable safe cell yet)
  // 4x4 board, mines at (0,0), (0,2), (0,3), (1,3), (2,3), (3,0), (3,2).
  // Reveal (1,0)=1, (1,1)=2, (1,2)=3, (2,0)=1, (2,1)=2, (2,2)=3:
  // (1,0)=1 sees {(0,0),(0,1)} -> count 1; (1,1)=2 sees {(0,0),(0,1),(0,2)} -> count 2 -> (0,2) MINE!
  // (2,0)=1 sees {(3,0),(3,1)} -> count 1; (2,1)=2 sees {(3,0),(3,1),(3,2)} -> count 2 -> (3,2) MINE!
  // No cell is provably safe yet, so getHint() must return a 100% mine hint!
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
    ],
    { rows: 4, cols: 4 },
  );
  mineSubsetEngine.reveal(1, 0);
  mineSubsetEngine.reveal(1, 1);
  mineSubsetEngine.reveal(1, 2);
  mineSubsetEngine.reveal(2, 0);
  mineSubsetEngine.reveal(2, 1);
  mineSubsetEngine.reveal(2, 2);

  const mineHint = mineSubsetEngine.getHint();
  assert.ok(mineHint);
  assert.equal(mineHint.kind, 'mine');
  assert.equal(mineHint.action, 'flag');
  assert.equal(mineHint.certainty, 1);
  assert.equal(mineHint.mineProbability, 1);
  assert.equal(mineHint.row, 0);
  assert.equal(mineHint.col, 2);

  // Case D: Fallback to lowest-mine-probability cell when no pure logical deduction exists
  // 3x3 board with 2 mines: (0,1) and (2,2).
  // Reveal (0,0)=1 (neighbors (0,1),(1,0),(1,1) -> 1/3 mine prob = 0.333)
  // Compare vs (2,1) or interior: wait let's make two disjoint constraints with distinct probabilities!
  // 3x5 board, mines at (0,1) and (2,4):
  // Reveal (0,0)=1 -> neighbors {(0,1), (1,0), (1,1)} have 1/3 = 33.3% risk.
  // Reveal (0,4)=0? No, keep (0,4) unrevealed; reveal (1,3)=1? Wait if mine is at (2,4), (2,3)=1 has 3 neighbors -> 1/3.
  // What if we have 1 mine at (0,1) on a 4x4 board (totalMines = 1):
  // Reveal (0,0)=1 -> {(0,1), (1,0), (1,1)} has 1/3 = 33.3% risk!
  // Wait: if totalMines = 1 and (0,0)=1, then all OTHER cells outside {(0,1),(1,0),(1,1)} would be deduced 0% safe!
  // To have NO 100% deduction everywhere, put 2 mines: (0,1) and (2,2) on 3x4 board, and reveal (0,0)=1 and (2,3)=1?
  // (0,0)=1 sees 3 cells {(0,1),(1,0),(1,1)} (prob 1/3 = 33.3%).
  // (2,3)=1 sees 3 cells {(1,2),(1,3),(2,2)} (prob 1/3 = 33.3%).
  // Meanwhile uninvolved non-frontier cells have 0 mines left (0% safe)!
  // Instead, make ALL cells involved or have remaining mines > 0 on non-frontier!
  // Example: 2x5 board, 3 mines at (0,1), (0,3), (1,4).
  // Reveal (0,0)=1 -> {(1,0), (0,1), (1,1)} = 1/3 = 33.3%.
  // Reveal (1,2)=2? Wait (1,2) neighbors (0,1),(0,2),(0,3),(1,1),(1,3) -> has 2 mines out of 5 = 40%!
  // Wait let's make a clean 1x4 board or 2x4 board:
  // 2x4 board, 3 mines at (0,1), (0,2), (1,3).
  // Reveal (0,0)=1 (sees {(0,1),(1,0),(1,1)} -> 1/3 = 33.3%).
  // Non-frontier cells are {(0,2),(0,3),(1,2),(1,3)} with 2 mines left -> 2/4 = 50% risk!
  // No 100% deduction exists anywhere, and lowest-probability cell is in {(0,1),(1,0),(1,1)} (~33.3%)!
  const guessEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  guessEngine.loadCustomMineLayout(
    [
      [0, 1],
      [0, 2],
      [1, 3],
    ],
    { rows: 2, cols: 4 },
  );
  guessEngine.reveal(0, 0);

  const guessHint = guessEngine.getHint();
  assert.ok(guessHint);
  assert.equal(guessHint.kind, 'guess');
  assert.equal(guessHint.action, 'reveal');
  assert.ok(guessHint.mineProbability > 0 && guessHint.mineProbability < 0.4);
  const inLowRiskCluster =
    (guessHint.row === 0 && guessHint.col === 1) ||
    (guessHint.row === 1 && guessHint.col === 0) ||
    (guessHint.row === 1 && guessHint.col === 1);
  assert.equal(inLowRiskCluster, true);
});

test('victory and detonation terminal states block further board mutations', () => {
  // Victory path
  const winEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  winEngine.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
  // Revealing (2,2)=0 triggers BFS clearing all 8 safe cells
  const winRes = winEngine.reveal(2, 2);
  assert.equal(winRes.ok, true);
  assert.equal(winRes.status, 'won');
  assert.equal(winEngine.getSafeLeft(), 0);
  assert.equal(winEngine.getMinesLeft(), 0);
  assert.equal(winEngine.getCell(0, 0)?.flagged, true);

  assert.equal(winEngine.reveal(0, 0).ok, false);
  assert.equal(winEngine.toggleFlag(0, 0).ok, false);
  assert.equal(winEngine.chord(1, 1).ok, false);
  assert.equal(winEngine.getHint(), null);
  assert.equal(winEngine.requestHint(), null);

  // Detonation path
  const loseEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  loseEngine.loadCustomMineLayout(
    [
      [0, 0],
      [2, 2],
    ],
    { rows: 3, cols: 3 },
  );
  // Mis-flag (0,1) first, then detonate (0,0)
  loseEngine.toggleFlag(0, 1);
  const boomRes = loseEngine.reveal(0, 0);
  assert.equal(boomRes.ok, true);
  assert.equal(boomRes.detonated, true);
  assert.equal(boomRes.status, 'lost');
  assert.equal(loseEngine.getCell(0, 0)?.detonated, true);
  assert.equal(loseEngine.getCell(2, 2)?.revealed, true);
  assert.equal(loseEngine.getCell(0, 1)?.wrongFlag, true);

  assert.equal(loseEngine.reveal(1, 1).ok, false);
  assert.equal(loseEngine.toggleFlag(1, 1).ok, false);
  assert.equal(loseEngine.chord(1, 1).ok, false);
  assert.equal(loseEngine.getHint(), null);
});

test('scoring math rewards cascades, chording, difficulty, victory bonus, and applies mild hint penalty', () => {
  // Compare single reveal vs cascade vs chord vs hint penalty
  const e1 = new MinesweeperEngine({ difficulty: 'beginner' });
  e1.loadCustomMineLayout([[0, 0]], { rows: 4, cols: 4 });
  const single = e1.reveal(1, 1); // adjacentMines = 1 -> single cell revealed
  assert.equal(single.newlyRevealed.length, 1);
  assert.equal(single.pointsAwarded, 10);
  assert.equal(e1.getScore(), 10);

  // Requesting a hint applies mild penalty (-25, clamped >= 0)
  e1.reveal(1, 0); // +10 => score 20
  e1.reveal(0, 1); // +10 => score 30
  assert.equal(e1.getScore(), 30);
  const h1 = e1.requestHint();
  assert.ok(h1);
  assert.equal(e1.getHintsUsed(), 1);
  assert.equal(e1.getScore(), 5);
  // Repeating identical hint without moving does not double-penalize
  const h1Repeat = e1.requestHint();
  assert.ok(h1Repeat);
  assert.equal(e1.getHintsUsed(), 1);
  assert.equal(e1.getScore(), 5);

  // Cascade bonus check: 3-cell cascade > 3 * 10
  const eCascade = new MinesweeperEngine({ difficulty: 'beginner' });
  eCascade.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
  const cascade = eCascade.reveal(2, 2); // reveals 8 safe cells + victory clear bonus
  assert.equal(cascade.newlyRevealed.length, 8);
  assert.ok(cascade.pointsAwarded > 80);
  assert.ok(eCascade.getScore() > cascade.pointsAwarded); // Victory bonus added!
  assert.equal(eCascade.getHighScore('beginner'), eCascade.getScore());

  // Difficulty multiplier check (expert > beginner for single safe reveal)
  const eExpert = new MinesweeperEngine({ difficulty: 'expert' });
  eExpert.loadCustomMineLayout([[0, 0]], { rows: 16, cols: 16 });
  const expertSingle = eExpert.reveal(1, 1);
  assert.equal(expertSingle.pointsAwarded, 20);
});

test('getWinForecast() shifts dynamically across idle, deductible, certain win, risky, victory, and detonated', () => {
  // Idle -> FAVORABLE
  const engine = new MinesweeperEngine({ difficulty: 'beginner' });
  const idleForecast = engine.getWinForecast();
  assert.equal(idleForecast.label, 'FAVORABLE');
  assert.equal(idleForecast.percent, 85);

  // Fully deductible -> CERTAIN WIN (e.g. 1 mine at (0,0), reveal (1,1)=1 and flag (0,0) -> all remaining cells 100% safe!)
  engine.loadCustomMineLayout([[0, 0]], { rows: 3, cols: 3 });
  engine.reveal(1, 1);
  engine.toggleFlag(0, 0);
  const certainForecast = engine.getWinForecast();
  assert.equal(certainForecast.label, 'CERTAIN WIN');
  assert.ok(certainForecast.percent >= 94 && certainForecast.percent <= 99);

  // Partially deductible frontier (1-2 subset where remaining non-frontier unknown cells aren't all solved)
  const deductEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  deductEngine.loadCustomMineLayout(
    [
      [0, 0],
      [0, 2],
      [0, 3],
      [1, 3],
      [3, 1],
    ],
    { rows: 4, cols: 4 },
  );
  deductEngine.reveal(1, 0);
  deductEngine.reveal(1, 1);
  deductEngine.reveal(1, 2);
  deductEngine.reveal(2, 0);
  deductEngine.reveal(2, 1);
  deductEngine.reveal(2, 2);
  const deductForecast = deductEngine.getWinForecast();
  assert.equal(deductForecast.label, 'DEDUCTIBLE');
  assert.ok(deductForecast.percent >= 74 && deductForecast.percent <= 93);

  // Ambiguous high-risk frontier -> RISKY
  const riskyEngine = new MinesweeperEngine({ difficulty: 'beginner' });
  riskyEngine.loadCustomMineLayout(
    [
      [0, 1],
      [0, 2],
      [1, 3],
    ],
    { rows: 2, cols: 4 },
  );
  riskyEngine.reveal(0, 0);
  const riskyForecast = riskyEngine.getWinForecast();
  assert.equal(riskyForecast.label, 'RISKY');
  assert.ok(riskyForecast.percent < 55);

  // Victory -> VICTORY (100%)
  engine.chord(1, 1);
  assert.equal(engine.getStatus(), 'won');
  const winForecast = engine.getWinForecast();
  assert.equal(winForecast.label, 'VICTORY');
  assert.equal(winForecast.percent, 100);

  // Detonated -> DETONATED (0%)
  riskyEngine.reveal(0, 1);
  assert.equal(riskyEngine.getStatus(), 'lost');
  const loseForecast = riskyEngine.getWinForecast();
  assert.equal(loseForecast.label, 'DETONATED');
  assert.equal(loseForecast.percent, 0);
});

test('tick(dtMs), setDifficulty(), and full reset() preserve high score and restore clean initial state', () => {
  const engine = new MinesweeperEngine({
    difficulty: 'beginner',
    rng: createSeededRng(777),
  });

  // tick ignored when idle
  engine.tick(5000);
  assert.equal(engine.getElapsedMs(), 0);

  engine.start();
  engine.tick(2500);
  engine.tick(-100);
  engine.tick(Number.NaN);
  assert.equal(engine.getElapsedMs(), 2500);
  assert.equal(engine.getElapsedSeconds(), 2);

  engine.reveal(4, 4);
  engine.requestHint();
  const peakHighScore = engine.getHighScore('beginner');
  assert.ok(engine.getScore() > 0);
  assert.ok(peakHighScore > 0);

  // Full reset clears board, timer, score, hints, minesPlaced, while preserving high score
  engine.reset();
  assert.equal(engine.getStatus(), 'idle');
  assert.equal(engine.isMinesPlaced(), false);
  assert.equal(engine.getScore(), 0);
  assert.equal(engine.getElapsedMs(), 0);
  assert.equal(engine.getHintsUsed(), 0);
  assert.equal(engine.getActiveHint(), null);
  assert.equal(engine.getFlagsCount(), 0);
  assert.equal(engine.getMinesLeft(), 10);
  assert.equal(engine.getSafeLeft(), 71);
  assert.equal(engine.getHighScore('beginner'), peakHighScore);

  // Switching difficulty updates geometry and resets cleanly
  engine.setDifficulty('expert');
  assert.equal(engine.getDifficulty(), 'expert');
  assert.equal(engine.getRows(), 16);
  assert.equal(engine.getCols(), 16);
  assert.equal(engine.getTotalMines(), 40);
  assert.equal(engine.getSafeLeft(), 216);
  assert.equal(engine.getStatus(), 'idle');
});
