import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MahjongEngine,
  getBlockingStatus,
  isPositionFree,
  type PlacedTileInput,
} from '../ts/games/mahjong/engine.js';
import {
  CLASSIC_TURTLE_LAYOUT,
  QUICK_DRAGON_LAYOUT,
  hasSameLayerOverlaps,
} from '../ts/games/mahjong/layout.js';
import {
  createFullDeck,
  tilesMatch,
  type TileInstance,
} from '../ts/games/mahjong/tiles.js';
import { createAppServer } from '../ts/server.js';
import { withBrowserPage } from './helpers/cdp.js';

function resolveRepoRoot(): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let current = startDir;
  for (let i = 0; i < 6; i += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'games', 'mahjong.html'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

function makeTestTile(
  id: string,
  kindId: string,
  matchGroup: string,
  suit: TileInstance['suit'] = 'bamboo',
  rank = 1,
): TileInstance {
  return {
    id,
    kindId,
    matchGroup,
    suit,
    rank,
    label: kindId,
    shortLabel: kindId,
  };
}

function solveByConstructedSolution(engine: MahjongEngine): void {
  const solution = engine.getConstructedSolution();
  const initialCount = engine.getTilesRemaining();
  assert.equal(solution.length, initialCount / 2);

  engine.start();
  assert.equal(engine.getStatus(), 'playing');

  let expectedRemaining = initialCount;
  let prevScore = 0;
  for (const [idA, idB] of solution) {
    assert.equal(engine.isTileFree(idA), true, `Expected ${idA} to be free`);
    assert.equal(engine.isTileFree(idB), true, `Expected ${idB} to be free`);

    const selA = engine.selectTile(idA);
    assert.equal(selA.action, 'selected');
    const selB = engine.selectTile(idB);
    assert.equal(selB.action, 'matched');
    assert.ok(selB.pointsAwarded > 0);

    expectedRemaining -= 2;
    assert.equal(engine.getTilesRemaining(), expectedRemaining);
    assert.ok(engine.getScore() > prevScore);
    prevScore = engine.getScore();
  }

  assert.equal(engine.getTilesRemaining(), 0);
  assert.equal(engine.getStatus(), 'victory');
  const forecast = engine.getWinForecast();
  assert.equal(forecast.label, 'VICTORY');
  assert.equal(forecast.percent, 100);
}

describe('Mahjong Solitaire QA — Adversarial Engine & Solvability Suite', () => {
  it('generates 10 boards across turtle (144) and dragon (72) with 0 overlaps, >=3 open pairs, and solves full boards to VICTORY', () => {
    const configs: ReadonlyArray<{ layoutId: 'turtle' | 'dragon'; seed: number }> = [
      { layoutId: 'turtle', seed: 1001 },
      { layoutId: 'turtle', seed: 2002 },
      { layoutId: 'turtle', seed: 3003 },
      { layoutId: 'turtle', seed: 4004 },
      { layoutId: 'turtle', seed: 5005 },
      { layoutId: 'dragon', seed: 6006 },
      { layoutId: 'dragon', seed: 7007 },
      { layoutId: 'dragon', seed: 8008 },
      { layoutId: 'dragon', seed: 9009 },
      { layoutId: 'dragon', seed: 10101 },
    ];

    let solvedTurtle = false;
    let solvedDragon = false;

    for (const { layoutId, seed } of configs) {
      const engine = new MahjongEngine({ layoutId, seed });
      const expectedTotal = layoutId === 'turtle' ? 144 : 72;
      const tiles = engine.getTiles();

      assert.equal(tiles.length, expectedTotal);
      assert.equal(engine.getTilesRemaining(), expectedTotal);

      // Unique tile IDs and even match-group cardinalities
      const idSet = new Set(tiles.map((t) => t.id));
      assert.equal(idSet.size, expectedTotal);
      const groupCounts = new Map<string, number>();
      for (const tile of tiles) {
        groupCounts.set(tile.matchGroup, (groupCounts.get(tile.matchGroup) ?? 0) + 1);
      }
      for (const [group, count] of groupCounts) {
        assert.equal(count % 2, 0, `Match group ${group} has odd count ${count}`);
      }

      // Zero same-layer overlaps
      const positions = tiles.map((t) => ({ x: t.x, y: t.y, z: t.z }));
      assert.equal(
        hasSameLayerOverlaps(positions),
        false,
        `Detected same-layer overlap on ${layoutId} seed ${seed}`,
      );

      // At least 3 open pairs initially
      assert.ok(
        engine.getPairsAvailableCount() >= 3,
        `Expected >=3 open pairs on ${layoutId} seed ${seed}, got ${engine.getPairsAvailableCount()}`,
      );

      // Solve at least one full 144-tile Turtle and one full 72-tile Dragon end-to-end
      if (layoutId === 'turtle' && !solvedTurtle) {
        solveByConstructedSolution(engine);
        solvedTurtle = true;
      } else if (layoutId === 'dragon' && !solvedDragon) {
        solveByConstructedSolution(engine);
        solvedDragon = true;
      }
    }

    assert.equal(solvedTurtle, true);
    assert.equal(solvedDragon, true);
  });

  it('solves a full 72-tile Quick Dragon board interactively via requestHint() down to VICTORY', () => {
    const engine = new MahjongEngine({ layoutId: 'dragon', seed: 4242 });
    engine.start();
    assert.equal(engine.getStatus(), 'playing');

    let steps = 0;
    while (engine.getTilesRemaining() > 0) {
      const hint = engine.requestHint();
      assert.ok(hint !== null, `Hint returned null with ${engine.getTilesRemaining()} tiles left`);
      const [idA, idB] = hint;
      assert.equal(engine.selectTile(idA).action, 'selected');
      const matchRes = engine.selectTile(idB);
      assert.equal(matchRes.action, 'matched');
      steps += 1;
      assert.ok(steps <= 36);
    }

    assert.equal(steps, 36);
    assert.equal(engine.getStatus(), 'victory');
    assert.equal(engine.getWinForecast().label, 'VICTORY');
    assert.equal(engine.getWinForecast().percent, 100);
  });

  it('enforces Season/Flower cross-matching rules and rejects non-matching & Season+Flower pairs', () => {
    const deck = createFullDeck();
    const seasons = deck.filter((t) => t.suit === 'season');
    const flowers = deck.filter((t) => t.suit === 'flower');
    const bamboo1 = deck.filter((t) => t.kindId === 'bamboo-1');
    const bamboo2 = deck.filter((t) => t.kindId === 'bamboo-2');

    assert.equal(seasons.length, 4);
    assert.equal(flowers.length, 4);

    // Explicit unit assertions requested: Flower1+Flower4 matches, Season2+Season3 matches, Season+Flower does NOT
    assert.equal(tilesMatch(flowers[0], flowers[3]), true);
    assert.equal(tilesMatch(seasons[1], seasons[2]), true);
    for (const s of seasons) {
      for (const f of flowers) {
        assert.equal(tilesMatch(s, f), false);
      }
    }
    assert.equal(tilesMatch(bamboo1[0], bamboo2[0]), false);

    // Full engine play verification of Season2+Season3, Flower1+Flower4, and Season+Flower mismatch
    const engine = MahjongEngine.fromCustomTiles([
      { tile: seasons[0], x: 0, y: 0, z: 0 }, // Season 1
      { tile: seasons[1], x: 4, y: 0, z: 0 }, // Season 2
      { tile: seasons[2], x: 8, y: 0, z: 0 }, // Season 3
      { tile: flowers[0], x: 0, y: 4, z: 0 }, // Flower 1
      { tile: flowers[3], x: 4, y: 4, z: 0 }, // Flower 4
      { tile: bamboo1[0], x: 0, y: 8, z: 0 },
      { tile: bamboo2[0], x: 4, y: 8, z: 0 },
    ]);
    engine.start();

    // Non-matching numbered tiles cannot match and reset combo
    assert.equal(engine.selectTile(bamboo1[0].id).action, 'selected');
    const badNum = engine.selectTile(bamboo2[0].id);
    assert.equal(badNum.action, 'mismatch');
    assert.equal(badNum.combo, 0);
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getTilesRemaining(), 7);

    // Season2 + Season3 matches cleanly
    assert.equal(engine.selectTile(seasons[1].id).action, 'selected');
    const seasonMatch = engine.selectTile(seasons[2].id);
    assert.equal(seasonMatch.action, 'matched');
    assert.equal(seasonMatch.combo, 1);
    assert.equal(engine.getTilesRemaining(), 5);

    // Season1 + Flower1 does NOT match and resets combo back to 0
    assert.equal(engine.selectTile(seasons[0].id).action, 'selected');
    const crossMismatch = engine.selectTile(flowers[0].id);
    assert.equal(crossMismatch.action, 'mismatch');
    assert.equal(crossMismatch.combo, 0);
    assert.equal(engine.getTilesRemaining(), 5);

    // Flower1 + Flower4 matches cleanly
    assert.equal(engine.selectTile(flowers[0].id).action, 'selected');
    const flowerMatch = engine.selectTile(flowers[3].id);
    assert.equal(flowerMatch.action, 'matched');
    assert.equal(flowerMatch.combo, 1);
    assert.equal(engine.getTilesRemaining(), 3);
  });

  it('prevents selecting or matching top-blocked and both-sides-blocked tiles including half-tile offsets', () => {
    const tCenter = makeTestTile('t-center', 'circle-1', 'circle-1', 'circle', 1);
    const tMatch = makeTestTile('t-match', 'circle-1', 'circle-1', 'circle', 1);
    const tLeft = makeTestTile('t-left', 'bamboo-2', 'bamboo-2', 'bamboo', 2);
    const tLeftMate = makeTestTile('t-left-mate', 'bamboo-2', 'bamboo-2', 'bamboo', 2);
    const tRight = makeTestTile('t-right', 'bamboo-3', 'bamboo-3', 'bamboo', 3);

    const tUnderHalf = makeTestTile('t-under-half', 'dragon-red', 'dragon-red', 'dragon', 1);
    const tTopOffset = makeTestTile('t-top-offset', 'dragon-red', 'dragon-red', 'dragon', 1);

    const engine = MahjongEngine.fromCustomTiles([
      // Horizontal sandwich with half-tile y offsets (|y'-y| = 1 < 2)
      { tile: tLeft, x: 2, y: 3, z: 0 },
      { tile: tCenter, x: 4, y: 4, z: 0 },
      { tile: tRight, x: 6, y: 5, z: 0 },
      // Free match mates so game starts in 'playing' state
      { tile: tLeftMate, x: 12, y: 0, z: 0 },
      { tile: tMatch, x: 12, y: 4, z: 0 },
      // Top-blocked via 1-half-tile overlap (x+1, y+1 on z=1)
      { tile: tUnderHalf, x: 2, y: 10, z: 0 },
      { tile: tTopOffset, x: 3, y: 11, z: 1 },
    ]);
    assert.equal(engine.start(), 'playing');

    const centerBlocking = engine.getTileBlockingStatus('t-center');
    assert.equal(centerBlocking.blockedTop, false);
    assert.equal(centerBlocking.blockedLeft, true);
    assert.equal(centerBlocking.blockedRight, true);
    assert.equal(centerBlocking.isFree, false);

    const underBlocking = engine.getTileBlockingStatus('t-under-half');
    assert.equal(underBlocking.blockedTop, true);
    assert.equal(underBlocking.blockedLeft, false);
    assert.equal(underBlocking.blockedRight, false);
    assert.equal(underBlocking.isFree, false);

    // Selecting either blocked tile is rejected with 'blocked'
    assert.equal(engine.selectTile('t-center').action, 'blocked');
    assert.equal(engine.selectTile('t-under-half').action, 'blocked');

    // Selecting the free mate and trying to click the blocked tile does not match or clear selection
    assert.equal(engine.selectTile('t-match').action, 'selected');
    assert.equal(engine.selectTile('t-center').action, 'blocked');
    assert.equal(engine.getSelectedTileId(), 't-match');
    assert.equal(engine.getTilesRemaining(), 7);

    // Removing left blocker frees t-center so it can now match t-match
    engine.clearSelection();
    assert.equal(engine.selectTile('t-left').action, 'selected');
    assert.equal(engine.selectTile('t-left-mate').action, 'matched');
    assert.equal(engine.isTileFree('t-center'), true);
    assert.equal(engine.selectTile('t-center').action, 'selected');
    assert.equal(engine.selectTile('t-match').action, 'matched');
    assert.equal(engine.getTilesRemaining(), 3);

    // Half-tile boundary check: |x' - x| === 2 on z+1 does NOT block top; |y' - y| === 2 does NOT block left/right
    assert.equal(isPositionFree({ x: 4, y: 4, z: 0 }, [{ x: 4, y: 4, z: 0 }, { x: 6, y: 4, z: 1 }]), true);
    assert.equal(
      getBlockingStatus({ x: 4, y: 4, z: 0 }, [
        { x: 4, y: 4, z: 0 },
        { x: 2, y: 6, z: 0 },
        { x: 6, y: 2, z: 0 },
      ]).isFree,
      true,
    );
  });

  it('restores exact board coordinates, score, combo, status, and tiles-left on Undo after Match and Undo after Shuffle', () => {
    const engine = new MahjongEngine({ layoutId: 'dragon', seed: 1337 });
    engine.start();

    // Perform 2 matches to build score and combo=2
    const hint1 = engine.requestHint();
    assert.ok(hint1 !== null);
    engine.selectTile(hint1[0]);
    const m1 = engine.selectTile(hint1[1]);
    assert.equal(m1.action, 'matched');

    const hint2 = engine.requestHint();
    assert.ok(hint2 !== null);
    engine.selectTile(hint2[0]);
    const m2 = engine.selectTile(hint2[1]);
    assert.equal(m2.action, 'matched');

    const preShuffleScore = engine.getScore();
    const preShuffleCombo = engine.getCombo();
    const preShuffleMoves = engine.getMoves();
    const preShuffleRemaining = engine.getTilesRemaining();
    assert.ok(preShuffleScore > 0);
    assert.equal(preShuffleCombo, 2);
    assert.equal(preShuffleMoves, 2);
    assert.equal(preShuffleRemaining, 68);

    const preShuffleCoords = new Map(
      engine.getLiveTiles().map((t) => [t.id, { x: t.x, y: t.y, z: t.z }]),
    );

    // Shuffle
    assert.equal(engine.shuffle(), true);
    assert.equal(engine.getTilesRemaining(), 68);
    assert.equal(engine.getScore(), preShuffleScore);
    assert.equal(engine.getCombo(), 0);

    let movedCount = 0;
    for (const tile of engine.getLiveTiles()) {
      const prev = preShuffleCoords.get(tile.id);
      assert.ok(prev);
      if (prev.x !== tile.x || prev.y !== tile.y || prev.z !== tile.z) {
        movedCount += 1;
      }
    }
    assert.ok(movedCount > 0, 'Expected shuffle to relocate tiles');

    // Undo shuffle -> exact pre-shuffle coordinates, score, combo=2, tilesRemaining=68
    const undoShuffle = engine.undo();
    assert.equal(undoShuffle.restored, true);
    assert.equal(undoShuffle.kind, 'shuffle');
    assert.equal(engine.getScore(), preShuffleScore);
    assert.equal(engine.getCombo(), preShuffleCombo);
    assert.equal(engine.getMoves(), preShuffleMoves);
    assert.equal(engine.getTilesRemaining(), preShuffleRemaining);
    for (const tile of engine.getLiveTiles()) {
      const prev = preShuffleCoords.get(tile.id);
      assert.deepEqual({ x: tile.x, y: tile.y, z: tile.z }, prev);
    }

    // Undo match 2 -> score drops to m1.pointsAwarded, combo=1, tilesRemaining=70
    const undoMatch2 = engine.undo();
    assert.equal(undoMatch2.restored, true);
    assert.equal(undoMatch2.kind, 'match');
    assert.equal(engine.getScore(), m1.pointsAwarded);
    assert.equal(engine.getCombo(), 1);
    assert.equal(engine.getMoves(), 1);
    assert.equal(engine.getTilesRemaining(), 70);

    // Undo match 1 -> score=0, combo=0, tilesRemaining=72
    const undoMatch1 = engine.undo();
    assert.equal(undoMatch1.restored, true);
    assert.equal(undoMatch1.kind, 'match');
    assert.equal(engine.getScore(), 0);
    assert.equal(engine.getCombo(), 0);
    assert.equal(engine.getMoves(), 0);
    assert.equal(engine.getTilesRemaining(), 72);
    assert.equal(engine.canUndo(), false);
  });

  it('restores deadlocked status and pre-shuffle coordinates when undoing a deadlock-recovery shuffle', () => {
    const tiles: PlacedTileInput[] = [
      { tile: makeTestTile('a1', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 1 },
      { tile: makeTestTile('a2', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 0 },
      { tile: makeTestTile('b1', 'circle-2', 'circle-2'), x: 4, y: 0, z: 1 },
      { tile: makeTestTile('b2', 'circle-2', 'circle-2'), x: 4, y: 0, z: 0 },
      { tile: makeTestTile('c1', 'character-3', 'character-3'), x: 8, y: 0, z: 1 },
      { tile: makeTestTile('c2', 'character-3', 'character-3'), x: 8, y: 0, z: 0 },
    ];
    const engine = MahjongEngine.fromCustomTiles(tiles, { seed: 7 });
    assert.equal(engine.start(), 'deadlocked');
    assert.equal(engine.getWinForecast().label, 'NO MOVES — SHUFFLE');

    assert.equal(engine.shuffle(), true);
    assert.equal(engine.getStatus(), 'playing');
    assert.ok(engine.getPairsAvailableCount() >= 1);

    const undoRes = engine.undo();
    assert.equal(undoRes.restored, true);
    assert.equal(undoRes.kind, 'shuffle');
    assert.equal(engine.getStatus(), 'deadlocked');
    assert.equal(engine.getPairsAvailableCount(), 0);
    assert.equal(engine.getWinForecast().label, 'NO MOVES — SHUFFLE');
  });

  it('reports accurate Win Forecast across HIGH CHANCE, FAVORABLE, RISKY, NO MOVES — SHUFFLE, and VICTORY', () => {
    // 1. HIGH CHANCE on healthy board
    const highBoard = MahjongEngine.fromCustomTiles([
      { tile: makeTestTile('h1a', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 0 },
      { tile: makeTestTile('h1b', 'bamboo-1', 'bamboo-1'), x: 4, y: 0, z: 0 },
      { tile: makeTestTile('h2a', 'circle-2', 'circle-2'), x: 8, y: 0, z: 0 },
      { tile: makeTestTile('h2b', 'circle-2', 'circle-2'), x: 12, y: 0, z: 0 },
    ]);
    highBoard.start();
    const fHigh = highBoard.getWinForecast();
    assert.equal(fHigh.label, 'HIGH CHANCE');
    assert.ok(fHigh.percent >= 75);

    // 2. FAVORABLE on moderate board (3 open pairs across 3 groups across 2 layers, 4 buried tiles)
    const favBoard = MahjongEngine.fromCustomTiles([
      { tile: makeTestTile('f1a', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 1 },
      { tile: makeTestTile('f1b', 'bamboo-1', 'bamboo-1'), x: 4, y: 0, z: 1 },
      { tile: makeTestTile('f2a', 'circle-2', 'circle-2'), x: 8, y: 0, z: 1 },
      { tile: makeTestTile('f2b', 'circle-2', 'circle-2'), x: 12, y: 0, z: 1 },
      { tile: makeTestTile('f3a', 'character-3', 'character-3'), x: 16, y: 0, z: 1 },
      { tile: makeTestTile('f3b', 'character-3', 'character-3'), x: 20, y: 0, z: 1 },
      { tile: makeTestTile('f4a', 'wind-east', 'wind-east'), x: 0, y: 0, z: 0 },
      { tile: makeTestTile('f4b', 'wind-east', 'wind-east'), x: 8, y: 0, z: 0 },
      { tile: makeTestTile('f5a', 'dragon-red', 'dragon-red'), x: 16, y: 0, z: 0 },
      { tile: makeTestTile('f5b', 'dragon-red', 'dragon-red'), x: 20, y: 0, z: 0 },
    ]);
    favBoard.start();
    const fFav = favBoard.getWinForecast();
    assert.equal(fFav.label, 'FAVORABLE');
    assert.ok(fFav.percent >= 50 && fFav.percent < 75);

    // 3. RISKY on 1-open-pair stacked trap board
    const riskyTiles: PlacedTileInput[] = [];
    const topKinds = ['bamboo-1', 'bamboo-1', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'circle-1'];
    const botKinds = ['circle-2', 'circle-2', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'circle-1'];
    for (let i = 0; i < topKinds.length; i += 1) {
      riskyTiles.push({ tile: makeTestTile(`rt-${i}`, topKinds[i], topKinds[i]), x: i * 4, y: 0, z: 3 });
      riskyTiles.push({ tile: makeTestTile(`rb-${i}`, botKinds[i], botKinds[i]), x: i * 4, y: 0, z: 0 });
    }
    const riskyBoard = MahjongEngine.fromCustomTiles(riskyTiles);
    riskyBoard.start();
    const fRisky = riskyBoard.getWinForecast();
    assert.equal(fRisky.label, 'RISKY');
    assert.ok(fRisky.percent > 0 && fRisky.percent < 50);

    // 4. NO MOVES — SHUFFLE on deadlocked board
    const deadBoard = MahjongEngine.fromCustomTiles([
      { tile: makeTestTile('d1', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 1 },
      { tile: makeTestTile('d2', 'bamboo-1', 'bamboo-1'), x: 0, y: 0, z: 0 },
    ]);
    deadBoard.start();
    const fDead = deadBoard.getWinForecast();
    assert.equal(fDead.label, 'NO MOVES — SHUFFLE');
    assert.equal(fDead.percent, 0);

    // 5. VICTORY after clearing final pair
    highBoard.selectTile('h1a');
    highBoard.selectTile('h1b');
    highBoard.selectTile('h2a');
    highBoard.selectTile('h2b');
    const fWin = highBoard.getWinForecast();
    assert.equal(fWin.label, 'VICTORY');
    assert.equal(fWin.percent, 100);
  });

  it('keeps layout definitions valid (144 turtle / 72 dragon, zero overlaps)', () => {
    assert.equal(CLASSIC_TURTLE_LAYOUT.tileCount, 144);
    assert.equal(hasSameLayerOverlaps(CLASSIC_TURTLE_LAYOUT.positions), false);
    assert.equal(QUICK_DRAGON_LAYOUT.tileCount, 72);
    assert.equal(hasSameLayerOverlaps(QUICK_DRAGON_LAYOUT.positions), false);
  });
});

interface ViewportLayoutSnapshot {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  stageRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  tileCount: number;
  clippedTileIds: string[];
  outOfViewportTileIds: string[];
}

describe('Mahjong Solitaire QA — Real Headless Chrome E2E Suite', () => {
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

  it('renders 1440x900 cleanly with no scrollbars/clipping, plays Start->Hint->Match->Undo->Shuffle->Reset, and switches to Dragon (72)', async () => {
    await withBrowserPage(
      `${baseUrl}/games/mahjong.html`,
      async (page) => {
        await page.waitFor("document.querySelectorAll('.mahjong-tile').length === 144");

        // Verify Back to Arcade link points to ../index.html and resolves HTTP 200
        const backHref = await page.evaluate<string | null>(
          "document.querySelector('.arcade-back-link')?.getAttribute('href') ?? null",
        );
        assert.equal(backHref, '../index.html');
        const indexRes = await fetch(`${baseUrl}/index.html`);
        assert.equal(indexRes.status, 200);

        // Initial telemetry & viewport fit check (144 Turtle tiles inside #stage-frame & 1440x900)
        const initialTilesLeft = await page.evaluate<string>(
          "document.getElementById('tiles-left-value')?.textContent?.trim() ?? ''",
        );
        assert.equal(initialTilesLeft, '144');

        const turtleFit = await page.evaluate<ViewportLayoutSnapshot>(`(() => {
          const frame = document.getElementById('stage-frame').getBoundingClientRect();
          const tiles = Array.from(document.querySelectorAll('.mahjong-tile'));
          const clippedTileIds = [];
          const outOfViewportTileIds = [];
          for (const el of tiles) {
            const r = el.getBoundingClientRect();
            const id = el.getAttribute('data-tile-id') || '';
            if (
              r.left < frame.left - 1 ||
              r.top < frame.top - 1 ||
              r.right > frame.right + 1 ||
              r.bottom > frame.bottom + 1
            ) {
              clippedTileIds.push(id);
            }
            if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) {
              outOfViewportTileIds.push(id);
            }
          }
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            stageRect: {
              left: frame.left,
              top: frame.top,
              right: frame.right,
              bottom: frame.bottom,
              width: frame.width,
              height: frame.height,
            },
            tileCount: tiles.length,
            clippedTileIds,
            outOfViewportTileIds,
          };
        })()`);

        assert.equal(turtleFit.tileCount, 144);
        assert.ok(
          turtleFit.scrollWidth <= turtleFit.innerWidth,
          `Horizontal overflow: scrollWidth=${turtleFit.scrollWidth} > innerWidth=${turtleFit.innerWidth}`,
        );
        assert.ok(
          turtleFit.scrollHeight <= turtleFit.innerHeight,
          `Vertical overflow: scrollHeight=${turtleFit.scrollHeight} > innerHeight=${turtleFit.innerHeight}`,
        );
        assert.deepEqual(turtleFit.clippedTileIds, [], 'Turtle tiles clipped outside #stage-frame');
        assert.deepEqual(turtleFit.outOfViewportTileIds, [], 'Turtle tiles outside viewport');

        // Start game via #start-btn
        await page.click('#start-btn');
        await page.waitFor("document.getElementById('stage-overlay')?.hidden === true");
        assert.equal(
          await page.evaluate<boolean>("Boolean(document.getElementById('start-btn')?.disabled)"),
          true,
        );

        // Verify Highlight Free toggle works
        await page.click('#highlight-btn');
        await page.waitFor("document.getElementById('mahjong-board')?.dataset.highlightFree === 'true'");
        await page.click('#highlight-btn');
        await page.waitFor("document.getElementById('mahjong-board')?.dataset.highlightFree === 'false'");

        // Verify clicking an exposed blocked tile (no upper tile covering its center) does not select it
        const exposedBlockedId = await page.evaluate<string | null>(`(() => {
          const blocked = Array.from(document.querySelectorAll('.mahjong-tile[data-free="false"]'));
          for (const el of blocked) {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit === el) {
              return el.getAttribute('data-tile-id');
            }
          }
          return null;
        })()`);
        if (exposedBlockedId) {
          await page.click(`[data-tile-id="${exposedBlockedId}"]`);
          const selectedAfterBlocked = await page.evaluate<string | null>(
            `document.querySelector('[data-tile-id="${exposedBlockedId}"]')?.getAttribute('data-selected') ?? null`,
          );
          assert.equal(selectedAfterBlocked, 'false');
        }

        // Click #hint-btn -> find 2 hinted tiles -> click both to match and remove them
        await page.click('#hint-btn');
        await page.waitFor("document.querySelectorAll('.mahjong-tile[data-hint=\"true\"]').length === 2");
        const hintedIds = await page.evaluate<string[]>(
          "Array.from(document.querySelectorAll('.mahjong-tile[data-hint=\"true\"]')).map(el => el.getAttribute('data-tile-id') || '')",
        );
        assert.equal(hintedIds.length, 2);
        assert.notEqual(hintedIds[0], hintedIds[1]);

        await page.click(`[data-tile-id="${hintedIds[0]}"]`);
        await page.waitFor(
          `document.querySelector('[data-tile-id="${hintedIds[0]}"]')?.getAttribute('data-selected') === 'true'`,
        );
        await page.click(`[data-tile-id="${hintedIds[1]}"]`);
        await page.waitFor("document.getElementById('tiles-left-value')?.textContent?.trim() === '142'");

        const afterMatch = await page.evaluate<{
          domCount: number;
          tilesLeft: string;
          score: number;
          combo: string;
          forecastLabel: string;
          forecastPct: string;
          forecastBarWidth: string;
        }>(`(() => ({
          domCount: document.querySelectorAll('.mahjong-tile').length,
          tilesLeft: document.getElementById('tiles-left-value')?.textContent?.trim() || '',
          score: Number(document.getElementById('score-value')?.textContent?.trim() || '0'),
          combo: document.getElementById('combo-value')?.textContent?.trim() || '',
          forecastLabel: document.getElementById('forecast-label')?.textContent?.trim() || '',
          forecastPct: document.getElementById('forecast-percent')?.textContent?.trim() || '',
          forecastBarWidth: document.getElementById('forecast-bar')?.style.width || '',
        }))()`);

        assert.equal(afterMatch.domCount, 142);
        assert.equal(afterMatch.tilesLeft, '142');
        assert.ok(afterMatch.score > 0, `Expected score > 0 after match, got ${afterMatch.score}`);
        assert.equal(afterMatch.combo, '1x');
        assert.ok(
          ['HIGH CHANCE', 'FAVORABLE', 'RISKY'].includes(afterMatch.forecastLabel),
          `Unexpected forecast label: ${afterMatch.forecastLabel}`,
        );
        assert.equal(afterMatch.forecastBarWidth, afterMatch.forecastPct);

        // Undo -> #tiles-left-value returns to 144 and score returns to 0
        await page.click('#undo-btn');
        await page.waitFor("document.getElementById('tiles-left-value')?.textContent?.trim() === '144'");
        assert.equal(
          await page.evaluate<number>("document.querySelectorAll('.mahjong-tile').length"),
          144,
        );
        assert.equal(
          await page.evaluate<string>("document.getElementById('score-value')?.textContent?.trim() ?? ''"),
          '0',
        );

        // Shuffle -> board stays at 144 tiles and remains playable
        await page.click('#shuffle-btn');
        await page.waitFor("document.getElementById('last-match-badge')?.textContent?.trim() === 'SHUFFLED'");
        assert.equal(
          await page.evaluate<number>("document.querySelectorAll('.mahjong-tile').length"),
          144,
        );
        assert.ok(
          await page.evaluate<number>("Number(document.getElementById('pairs-available-value')?.textContent || '0')") >= 1,
        );

        // Undo after shuffle works in UI too
        await page.click('#undo-btn');
        await page.waitFor("document.getElementById('last-match-badge')?.textContent?.trim() === 'UNDO'");
        assert.equal(
          await page.evaluate<number>("document.querySelectorAll('.mahjong-tile').length"),
          144,
        );

        // Reset -> score resets to 0, tiles left returns to 144, overlay visible
        await page.click('#reset-btn');
        await page.waitFor("document.getElementById('stage-overlay')?.hidden === false");
        assert.equal(
          await page.evaluate<string>("document.getElementById('score-value')?.textContent?.trim() ?? ''"),
          '0',
        );
        assert.equal(
          await page.evaluate<string>("document.getElementById('tiles-left-value')?.textContent?.trim() ?? ''"),
          '144',
        );

        // Switch to Dragon layout (#layout-dragon-btn) -> 72 tiles render cleanly with zero clipping/overflow
        await page.click('#layout-dragon-btn');
        await page.waitFor("document.querySelectorAll('.mahjong-tile').length === 72");
        assert.equal(
          await page.evaluate<string>("document.getElementById('tiles-left-value')?.textContent?.trim() ?? ''"),
          '72',
        );
        assert.equal(
          await page.evaluate<string | null>(
            "document.getElementById('layout-dragon-btn')?.getAttribute('aria-pressed') ?? null",
          ),
          'true',
        );

        const dragonFit = await page.evaluate<ViewportLayoutSnapshot>(`(() => {
          const frame = document.getElementById('stage-frame').getBoundingClientRect();
          const tiles = Array.from(document.querySelectorAll('.mahjong-tile'));
          const clippedTileIds = [];
          const outOfViewportTileIds = [];
          for (const el of tiles) {
            const r = el.getBoundingClientRect();
            const id = el.getAttribute('data-tile-id') || '';
            if (
              r.left < frame.left - 1 ||
              r.top < frame.top - 1 ||
              r.right > frame.right + 1 ||
              r.bottom > frame.bottom + 1
            ) {
              clippedTileIds.push(id);
            }
            if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) {
              outOfViewportTileIds.push(id);
            }
          }
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            stageRect: {
              left: frame.left,
              top: frame.top,
              right: frame.right,
              bottom: frame.bottom,
              width: frame.width,
              height: frame.height,
            },
            tileCount: tiles.length,
            clippedTileIds,
            outOfViewportTileIds,
          };
        })()`);

        assert.equal(dragonFit.tileCount, 72);
        assert.ok(dragonFit.scrollWidth <= dragonFit.innerWidth);
        assert.ok(dragonFit.scrollHeight <= dragonFit.innerHeight);
        assert.deepEqual(dragonFit.clippedTileIds, [], 'Dragon tiles clipped outside #stage-frame');
        assert.deepEqual(dragonFit.outOfViewportTileIds, [], 'Dragon tiles outside viewport');

        // Keyboard play verification on Dragon: Enter to start, F to highlight free, H for hint, Escape to deselect, match pair, R to reset
        await page.pressKey('Enter');
        await page.waitFor("document.getElementById('stage-overlay')?.hidden === true");
        await page.pressKey('f');
        await page.waitFor("document.getElementById('mahjong-board')?.dataset.highlightFree === 'true'");
        await page.pressKey('f');
        await page.waitFor("document.getElementById('mahjong-board')?.dataset.highlightFree === 'false'");

        await page.pressKey('h');
        await page.waitFor("document.querySelectorAll('.mahjong-tile[data-hint=\"true\"]').length === 2");
        const dragonHintIds = await page.evaluate<string[]>(
          "Array.from(document.querySelectorAll('.mahjong-tile[data-hint=\"true\"]')).map(el => el.getAttribute('data-tile-id') || '')",
        );
        await page.click(`[data-tile-id="${dragonHintIds[0]}"]`);
        await page.waitFor(
          `document.querySelector('[data-tile-id="${dragonHintIds[0]}"]')?.getAttribute('data-selected') === 'true'`,
        );
        await page.pressKey('Escape');
        await page.waitFor(
          `document.querySelector('[data-tile-id="${dragonHintIds[0]}"]')?.getAttribute('data-selected') === 'false'`,
        );
        await page.click(`[data-tile-id="${dragonHintIds[0]}"]`);
        await page.click(`[data-tile-id="${dragonHintIds[1]}"]`);
        await page.waitFor("document.getElementById('tiles-left-value')?.textContent?.trim() === '70'");
        const dragonScore = await page.evaluate<number>(
          "Number(document.getElementById('score-value')?.textContent || '0')",
        );
        assert.ok(dragonScore > 0);
        assert.equal(
          await page.evaluate<number>("Number(document.getElementById('high-score-value')?.textContent || '0')"),
          dragonScore,
        );

        await page.pressKey('r');
        await page.waitFor("document.getElementById('tiles-left-value')?.textContent?.trim() === '72'");
        assert.equal(
          await page.evaluate<string>("document.getElementById('score-value')?.textContent?.trim() ?? ''"),
          '0',
        );
        assert.equal(
          await page.evaluate<number>("Number(document.getElementById('high-score-value')?.textContent || '0')"),
          dragonScore,
        );

        assert.deepEqual(page.pageErrors, [], `Unexpected page errors: ${page.pageErrors.join('; ')}`);
        assert.deepEqual(page.consoleErrors, [], `Unexpected console errors: ${page.consoleErrors.join('; ')}`);
        assert.deepEqual(page.failedRequests, [], `Unexpected failed requests: ${page.failedRequests.join('; ')}`);
      },
      { width: 1440, height: 900 },
    );
  });
});
