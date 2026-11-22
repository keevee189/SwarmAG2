import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFullDeck,
  tilesMatch,
  type TileInstance,
} from '../ts/games/mahjong/tiles.js';
import {
  CLASSIC_TURTLE_LAYOUT,
  QUICK_DRAGON_LAYOUT,
  hasSameLayerOverlaps,
} from '../ts/games/mahjong/layout.js';
import {
  MahjongEngine,
  getBlockingStatus,
  isPositionFree,
} from '../ts/games/mahjong/engine.js';

function makeTile(
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

test('full 144-tile deck integrity', () => {
  const deck = createFullDeck();
  assert.equal(deck.length, 144);

  const uniqueIds = new Set(deck.map((t) => t.id));
  assert.equal(uniqueIds.size, 144);

  const countBySuit = new Map<string, number>();
  const countByKind = new Map<string, number>();
  for (const tile of deck) {
    countBySuit.set(tile.suit, (countBySuit.get(tile.suit) ?? 0) + 1);
    countByKind.set(tile.kindId, (countByKind.get(tile.kindId) ?? 0) + 1);
  }

  assert.equal(countBySuit.get('bamboo'), 36);
  assert.equal(countBySuit.get('character'), 36);
  assert.equal(countBySuit.get('circle'), 36);
  assert.equal(countBySuit.get('wind'), 16);
  assert.equal(countBySuit.get('dragon'), 12);
  assert.equal(countBySuit.get('season'), 4);
  assert.equal(countBySuit.get('flower'), 4);

  for (let r = 1; r <= 9; r += 1) {
    assert.equal(countByKind.get(`bamboo-${r}`), 4);
    assert.equal(countByKind.get(`character-${r}`), 4);
    assert.equal(countByKind.get(`circle-${r}`), 4);
  }
  for (const w of ['east', 'south', 'west', 'north']) {
    assert.equal(countByKind.get(`wind-${w}`), 4);
  }
  for (const d of ['red', 'green', 'white']) {
    assert.equal(countByKind.get(`dragon-${d}`), 4);
  }
  for (let i = 1; i <= 4; i += 1) {
    assert.equal(countByKind.get(`season-${i}`), 1);
    assert.equal(countByKind.get(`flower-${i}`), 1);
  }
});

test('Season-to-Season and Flower-to-Flower matching rules', () => {
  const deck = createFullDeck();
  const seasons = deck.filter((t) => t.suit === 'season');
  const flowers = deck.filter((t) => t.suit === 'flower');
  const bamboo1s = deck.filter((t) => t.kindId === 'bamboo-1');

  assert.equal(seasons.length, 4);
  assert.equal(flowers.length, 4);

  // Any distinct Season matches any other Season
  for (let i = 0; i < seasons.length; i += 1) {
    assert.equal(tilesMatch(seasons[i], seasons[i]), false);
    for (let j = i + 1; j < seasons.length; j += 1) {
      assert.equal(tilesMatch(seasons[i], seasons[j]), true);
    }
  }

  // Any distinct Flower matches any other Flower
  for (let i = 0; i < flowers.length; i += 1) {
    assert.equal(tilesMatch(flowers[i], flowers[i]), false);
    for (let j = i + 1; j < flowers.length; j += 1) {
      assert.equal(tilesMatch(flowers[i], flowers[j]), true);
    }
  }

  // Seasons do not match Flowers or numbered suits
  assert.equal(tilesMatch(seasons[0], flowers[0]), false);
  assert.equal(tilesMatch(seasons[0], bamboo1s[0]), false);
  assert.equal(tilesMatch(bamboo1s[0], bamboo1s[1]), true);
});

test('layout spot counts and zero same-layer overlaps', () => {
  assert.equal(CLASSIC_TURTLE_LAYOUT.tileCount, 144);
  assert.equal(CLASSIC_TURTLE_LAYOUT.positions.length, 144);
  assert.equal(CLASSIC_TURTLE_LAYOUT.layerCount, 5);
  assert.equal(hasSameLayerOverlaps(CLASSIC_TURTLE_LAYOUT.positions), false);

  assert.equal(QUICK_DRAGON_LAYOUT.tileCount, 72);
  assert.equal(QUICK_DRAGON_LAYOUT.positions.length, 72);
  assert.equal(QUICK_DRAGON_LAYOUT.layerCount, 4);
  assert.equal(hasSameLayerOverlaps(QUICK_DRAGON_LAYOUT.positions), false);
});

test('exact top, left, and right blocking rules', () => {
  const target = { x: 4, y: 4, z: 0 };

  // Alone -> free
  assert.equal(isPositionFree(target, [target]), true);

  // Left neighbor only -> free
  assert.equal(isPositionFree(target, [target, { x: 2, y: 4, z: 0 }]), true);

  // Right neighbor only -> free
  assert.equal(isPositionFree(target, [target, { x: 6, y: 4, z: 0 }]), true);

  // Left and right neighbors -> blocked
  const sandwiched = getBlockingStatus(target, [
    target,
    { x: 2, y: 4, z: 0 },
    { x: 6, y: 4, z: 0 },
  ]);
  assert.equal(sandwiched.blockedLeft, true);
  assert.equal(sandwiched.blockedRight, true);
  assert.equal(sandwiched.blockedTop, false);
  assert.equal(sandwiched.isFree, false);

  // Half-tile vertical offset still blocks on left/right when |y' - y| < 2
  assert.equal(
    isPositionFree(target, [target, { x: 2, y: 5, z: 0 }, { x: 6, y: 3, z: 0 }]),
    false,
  );
  // |y' - y| === 2 does not block horizontally
  assert.equal(
    isPositionFree(target, [target, { x: 2, y: 6, z: 0 }, { x: 6, y: 4, z: 0 }]),
    true,
  );

  // Top partial overlap blocks even if left and right are completely open
  const topBlocked = getBlockingStatus(target, [target, { x: 5, y: 5, z: 1 }]);
  assert.equal(topBlocked.blockedTop, true);
  assert.equal(topBlocked.isFree, false);

  // Adjacent upper tile with |x' - x| === 2 does not block on top
  assert.equal(isPositionFree(target, [target, { x: 6, y: 4, z: 1 }]), true);
});

test('constructive generator guarantees >= 3 open pairs and full solvability to 0 tiles', () => {
  for (const layoutId of ['turtle', 'dragon'] as const) {
    for (const seed of [101, 202, 303, 404, 505]) {
      const engine = new MahjongEngine({ layoutId, seed });
      const expectedTotal = layoutId === 'turtle' ? 144 : 72;

      assert.equal(engine.getTilesRemaining(), expectedTotal);
      assert.ok(
        engine.getPairsAvailableCount() >= 3,
        `Expected >= 3 open pairs on ${layoutId} seed ${seed}, got ${engine.getPairsAvailableCount()}`,
      );

      const solution = engine.getConstructedSolution();
      assert.equal(solution.length, expectedTotal / 2);

      engine.start();
      for (const [idA, idB] of solution) {
        assert.equal(engine.isTileFree(idA), true, `Expected ${idA} free on ${layoutId} seed ${seed}`);
        assert.equal(engine.isTileFree(idB), true, `Expected ${idB} free on ${layoutId} seed ${seed}`);
        const resA = engine.selectTile(idA);
        assert.equal(resA.action, 'selected');
        const resB = engine.selectTile(idB);
        assert.equal(resB.action, 'matched');
      }

      assert.equal(engine.getTilesRemaining(), 0);
      assert.equal(engine.getStatus(), 'victory');
      assert.equal(engine.getWinForecast().label, 'VICTORY');
      assert.equal(engine.getWinForecast().percent, 100);
    }
  }
});

test('match scoring, layer bonus, combo streak, mismatch reset, and lifecycle guards', () => {
  const b1a = makeTile('b1a', 'bamboo-1', 'bamboo-1', 'bamboo', 1);
  const b1b = makeTile('b1b', 'bamboo-1', 'bamboo-1', 'bamboo', 1);
  const c2a = makeTile('c2a', 'circle-2', 'circle-2', 'circle', 2);
  const c2b = makeTile('c2b', 'circle-2', 'circle-2', 'circle', 2);
  const d3a = makeTile('d3a', 'character-3', 'character-3', 'character', 3);
  const d3b = makeTile('d3b', 'character-3', 'character-3', 'character', 3);

  const engine = MahjongEngine.fromCustomTiles([
    { tile: b1a, x: 0, y: 0, z: 0 },
    { tile: b1b, x: 4, y: 0, z: 0 },
    { tile: c2a, x: 0, y: 4, z: 0 },
    { tile: c2b, x: 4, y: 4, z: 0 },
    { tile: d3a, x: 0, y: 8, z: 2 },
    { tile: d3b, x: 4, y: 8, z: 2 },
  ]);

  // Ignored before start
  assert.equal(engine.selectTile('b1a').action, 'ignored-not-playing');

  engine.start();
  assert.equal(engine.getStatus(), 'playing');

  // Deselect when clicking same tile twice
  assert.equal(engine.selectTile('b1a').action, 'selected');
  assert.equal(engine.selectTile('b1a').action, 'deselected');

  // Match 1 on z=0: 100 * 1.0 = 100
  engine.selectTile('b1a');
  const m1 = engine.selectTile('b1b');
  assert.equal(m1.action, 'matched');
  assert.equal(m1.pointsAwarded, 100);
  assert.equal(m1.combo, 1);

  // Match 2 on z=0: 100 * 1.25 = 125
  engine.selectTile('c2a');
  const m2 = engine.selectTile('c2b');
  assert.equal(m2.action, 'matched');
  assert.equal(m2.pointsAwarded, 125);
  assert.equal(m2.combo, 2);
  assert.equal(engine.getScore(), 225);

  // Undo last match restores score/combo/tiles
  const undoRes = engine.undo();
  assert.equal(undoRes.restored, true);
  assert.equal(engine.getScore(), 100);
  assert.equal(engine.getCombo(), 1);
  assert.equal(engine.getTilesRemaining(), 4);

  // Mismatch resets combo to 0
  assert.equal(engine.selectTile('c2a').action, 'selected');
  const mismatch = engine.selectTile('d3a');
  assert.equal(mismatch.action, 'mismatch');
  assert.equal(mismatch.combo, 0);

  // Layer bonus on z=2 + z=2: (100 + (2+2)*25) * 1.0 = 200
  engine.selectTile('d3a');
  const m3 = engine.selectTile('d3b');
  assert.equal(m3.action, 'matched');
  assert.equal(m3.pointsAwarded, 200);
  assert.equal(engine.getScore(), 300);
});

test('hint pair finder returns valid free matching pair', () => {
  const engine = new MahjongEngine({ layoutId: 'dragon', seed: 77 });
  engine.start();

  const hint = engine.requestHint();
  assert.ok(hint !== null);
  const [idA, idB] = hint;
  assert.notEqual(idA, idB);
  assert.equal(engine.isTileFree(idA), true);
  assert.equal(engine.isTileFree(idB), true);

  const tileA = engine.getTileById(idA);
  const tileB = engine.getTileById(idB);
  assert.ok(tileA && tileB);
  assert.equal(tilesMatch(tileA, tileB), true);

  assert.equal(engine.selectTile(idA).action, 'selected');
  assert.equal(engine.selectTile(idB).action, 'matched');
  assert.equal(engine.getTilesRemaining(), 70);
});

test('deadlock detection, forecast NO MOVES, and shuffle recovery', () => {
  // 4 pairs stacked at 4 separate columns: mates sit directly underneath on z=0,
  // so only 4 distinct non-matching tiles are free on z=1 -> 0 open pairs!
  const a1 = makeTile('a1', 'bamboo-1', 'bamboo-1', 'bamboo', 1);
  const a2 = makeTile('a2', 'bamboo-1', 'bamboo-1', 'bamboo', 1);
  const b1 = makeTile('b1', 'circle-2', 'circle-2', 'circle', 2);
  const b2 = makeTile('b2', 'circle-2', 'circle-2', 'circle', 2);
  const c1 = makeTile('c1', 'character-3', 'character-3', 'character', 3);
  const c2 = makeTile('c2', 'character-3', 'character-3', 'character', 3);
  const d1 = makeTile('d1', 'wind-east', 'wind-east', 'wind', 1);
  const d2 = makeTile('d2', 'wind-east', 'wind-east', 'wind', 1);

  const engine = MahjongEngine.fromCustomTiles(
    [
      { tile: a1, x: 0, y: 0, z: 1 },
      { tile: a2, x: 0, y: 0, z: 0 },
      { tile: b1, x: 4, y: 0, z: 1 },
      { tile: b2, x: 4, y: 0, z: 0 },
      { tile: c1, x: 8, y: 0, z: 1 },
      { tile: c2, x: 8, y: 0, z: 0 },
      { tile: d1, x: 12, y: 0, z: 1 },
      { tile: d2, x: 12, y: 0, z: 0 },
    ],
    { seed: 42 },
  );

  assert.equal(engine.getPairsAvailableCount(), 0);
  engine.start();
  assert.equal(engine.getStatus(), 'deadlocked');

  const deadForecast = engine.getWinForecast();
  assert.equal(deadForecast.label, 'NO MOVES — SHUFFLE');
  assert.equal(deadForecast.percent, 0);

  const shuffled = engine.shuffle();
  assert.equal(shuffled, true);
  assert.ok(engine.getPairsAvailableCount() >= 1);
  assert.equal(engine.getStatus(), 'playing');

  const recoveredForecast = engine.getWinForecast();
  assert.notEqual(recoveredForecast.label, 'NO MOVES — SHUFFLE');
  assert.ok(recoveredForecast.percent > 0);
});

test('forecast calculation differentiates healthy, risky, deadlocked, and victory states', () => {
  const healthy = new MahjongEngine({ layoutId: 'turtle', seed: 9 });
  healthy.start();
  const f1 = healthy.getWinForecast();
  assert.ok(f1.label === 'HIGH CHANCE' || f1.label === 'FAVORABLE');
  assert.ok(f1.percent >= 50 && f1.percent <= 99);

  // Risky board: 16 tiles across 4 layers with only 1 open pair & stacked traps
  const tiles: PlacedTileInputForTest[] = [];
  const groups = ['bamboo-1', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'circle-1', 'circle-2', 'circle-3', 'circle-4'];
  // Top layer z=1 has only 1 matching pair (bamboo-1), and 3 unmatched blockers over buried mates
  const topKinds = ['bamboo-1', 'bamboo-1', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'circle-1', 'circle-2', 'circle-3'];
  const botKinds = ['circle-4', 'circle-4', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'circle-1', 'circle-2', 'circle-3'];
  void groups;
  for (let i = 0; i < 8; i += 1) {
    const x = i * 4;
    tiles.push({
      tile: makeTile(`top-${i}`, topKinds[i], topKinds[i]),
      x,
      y: 0,
      z: 3,
    });
    tiles.push({
      tile: makeTile(`bot-${i}`, botKinds[i], botKinds[i]),
      x,
      y: 0,
      z: 0,
    });
  }
  const riskyEngine = MahjongEngine.fromCustomTiles(tiles);
  riskyEngine.start();
  assert.equal(riskyEngine.getPairsAvailableCount(), 1);
  const fRisky = riskyEngine.getWinForecast();
  assert.equal(fRisky.label, 'RISKY');
  assert.ok(fRisky.percent < 50);
});

interface PlacedTileInputForTest {
  tile: TileInstance;
  x: number;
  y: number;
  z: number;
}

test('reset restores ready state, score, combo, timer, and full tile count', () => {
  const engine = new MahjongEngine({ layoutId: 'dragon', seed: 12 });
  engine.start();
  engine.tickSecond(18);
  const hint = engine.requestHint();
  assert.ok(hint !== null);
  engine.selectTile(hint[0]);
  engine.selectTile(hint[1]);

  assert.ok(engine.getScore() > 0);
  assert.equal(engine.getCombo(), 1);
  assert.equal(engine.getElapsedSeconds(), 18);
  assert.equal(engine.getTilesRemaining(), 70);

  engine.reset(12);
  assert.equal(engine.getStatus(), 'ready');
  assert.equal(engine.getScore(), 0);
  assert.equal(engine.getCombo(), 0);
  assert.equal(engine.getElapsedSeconds(), 0);
  assert.equal(engine.getTilesRemaining(), 72);
  assert.equal(engine.canUndo(), false);
  assert.ok(engine.getPairsAvailableCount() >= 3);
});
