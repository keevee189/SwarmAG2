/**
 * Pure tile definitions and 144-tile classic Mahjong deck builder.
 * Zero DOM dependencies.
 */

export type TileSuit =
  | 'bamboo'
  | 'character'
  | 'circle'
  | 'wind'
  | 'dragon'
  | 'season'
  | 'flower';

export interface TileDefinition {
  readonly kindId: string;
  readonly matchGroup: string;
  readonly suit: TileSuit;
  readonly rank: number;
  readonly label: string;
  readonly shortLabel: string;
}

export interface TileInstance extends TileDefinition {
  readonly id: string;
}

const WIND_SPECS: ReadonlyArray<{ key: string; rank: number; label: string; shortLabel: string }> = [
  { key: 'east', rank: 1, label: 'East Wind', shortLabel: 'E' },
  { key: 'south', rank: 2, label: 'South Wind', shortLabel: 'S' },
  { key: 'west', rank: 3, label: 'West Wind', shortLabel: 'W' },
  { key: 'north', rank: 4, label: 'North Wind', shortLabel: 'N' },
];

const DRAGON_SPECS: ReadonlyArray<{ key: string; rank: number; label: string; shortLabel: string }> = [
  { key: 'red', rank: 1, label: 'Red Dragon', shortLabel: '中' },
  { key: 'green', rank: 2, label: 'Green Dragon', shortLabel: '發' },
  { key: 'white', rank: 3, label: 'White Dragon', shortLabel: '白' },
];

const SEASON_SPECS: ReadonlyArray<{ key: string; rank: number; label: string; shortLabel: string }> = [
  { key: 'season-1', rank: 1, label: 'Spring (Season 1)', shortLabel: 'S1' },
  { key: 'season-2', rank: 2, label: 'Summer (Season 2)', shortLabel: 'S2' },
  { key: 'season-3', rank: 3, label: 'Autumn (Season 3)', shortLabel: 'S3' },
  { key: 'season-4', rank: 4, label: 'Winter (Season 4)', shortLabel: 'S4' },
];

const FLOWER_SPECS: ReadonlyArray<{ key: string; rank: number; label: string; shortLabel: string }> = [
  { key: 'flower-1', rank: 1, label: 'Plum (Flower 1)', shortLabel: 'F1' },
  { key: 'flower-2', rank: 2, label: 'Orchid (Flower 2)', shortLabel: 'F2' },
  { key: 'flower-3', rank: 3, label: 'Chrysanthemum (Flower 3)', shortLabel: 'F3' },
  { key: 'flower-4', rank: 4, label: 'Bamboo (Flower 4)', shortLabel: 'F4' },
];

const NUMBERED_SUIT_LABELS: Record<'bamboo' | 'character' | 'circle', { name: string; code: string }> = {
  bamboo: { name: 'Bamboo', code: 'B' },
  character: { name: 'Character', code: 'C' },
  circle: { name: 'Circle', code: 'D' },
};

/**
 * Fisher-Yates shuffle returning a new array.
 */
export function shuffleArray<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Generates the authentic 144-tile classic Mahjong deck:
 * - Bamboo 1–9 (x4 = 36)
 * - Characters 1–9 (x4 = 36)
 * - Circles 1–9 (x4 = 36)
 * - Winds E/S/W/N (x4 = 16)
 * - Dragons Red/Green/White (x4 = 12)
 * - Seasons 1–4 (x1 = 4, any Season matches any Season)
 * - Flowers 1–4 (x1 = 4, any Flower matches any Flower)
 */
export function createFullDeck(): TileInstance[] {
  const deck: TileInstance[] = [];

  const numberedSuits: ReadonlyArray<'bamboo' | 'character' | 'circle'> = [
    'bamboo',
    'character',
    'circle',
  ];

  for (const suit of numberedSuits) {
    const meta = NUMBERED_SUIT_LABELS[suit];
    for (let rank = 1; rank <= 9; rank += 1) {
      const kindId = `${suit}-${rank}`;
      for (let copy = 0; copy < 4; copy += 1) {
        deck.push({
          id: `${kindId}#${copy}`,
          kindId,
          matchGroup: kindId,
          suit,
          rank,
          label: `${rank} ${meta.name}`,
          shortLabel: `${rank}${meta.code}`,
        });
      }
    }
  }

  for (const wind of WIND_SPECS) {
    const kindId = `wind-${wind.key}`;
    for (let copy = 0; copy < 4; copy += 1) {
      deck.push({
        id: `${kindId}#${copy}`,
        kindId,
        matchGroup: kindId,
        suit: 'wind',
        rank: wind.rank,
        label: wind.label,
        shortLabel: wind.shortLabel,
      });
    }
  }

  for (const dragon of DRAGON_SPECS) {
    const kindId = `dragon-${dragon.key}`;
    for (let copy = 0; copy < 4; copy += 1) {
      deck.push({
        id: `${kindId}#${copy}`,
        kindId,
        matchGroup: kindId,
        suit: 'dragon',
        rank: dragon.rank,
        label: dragon.label,
        shortLabel: dragon.shortLabel,
      });
    }
  }

  for (const season of SEASON_SPECS) {
    deck.push({
      id: `${season.key}#0`,
      kindId: season.key,
      matchGroup: 'season',
      suit: 'season',
      rank: season.rank,
      label: season.label,
      shortLabel: season.shortLabel,
    });
  }

  for (const flower of FLOWER_SPECS) {
    deck.push({
      id: `${flower.key}#0`,
      kindId: flower.key,
      matchGroup: 'flower',
      suit: 'flower',
      rank: flower.rank,
      label: flower.label,
      shortLabel: flower.shortLabel,
    });
  }

  return deck;
}

/**
 * Returns true if two distinct tiles form a legal Mahjong match.
 * Identical kinds match, any Season matches any Season, and any Flower matches any Flower.
 */
export function tilesMatch(
  a: Pick<TileDefinition, 'matchGroup'> & { readonly id?: string },
  b: Pick<TileDefinition, 'matchGroup'> & { readonly id?: string },
): boolean {
  if (a.id !== undefined && b.id !== undefined && a.id === b.id) {
    return false;
  }
  return a.matchGroup === b.matchGroup;
}

/**
 * Partitions a deck (or subset) into guaranteed valid matching pairs for constructive dealing.
 */
export function buildMatchingPairsForCount(
  tileCount: number,
  rng: () => number = Math.random,
): Array<[TileInstance, TileInstance]> {
  if (tileCount <= 0 || tileCount % 2 !== 0 || tileCount > 144) {
    throw new Error(`Invalid Mahjong tile count: ${tileCount}. Expected an even integer in [2, 144].`);
  }

  const fullDeck = createFullDeck();
  const byGroup = new Map<string, TileInstance[]>();
  for (const tile of fullDeck) {
    const bucket = byGroup.get(tile.matchGroup);
    if (bucket) {
      bucket.push(tile);
    } else {
      byGroup.set(tile.matchGroup, [tile]);
    }
  }

  const allPairs: Array<[TileInstance, TileInstance]> = [];
  for (const bucket of byGroup.values()) {
    const shuffledBucket = shuffleArray(bucket, rng);
    for (let i = 0; i + 1 < shuffledBucket.length; i += 2) {
      allPairs.push([shuffledBucket[i], shuffledBucket[i + 1]]);
    }
  }

  const shuffledPairs = shuffleArray(allPairs, rng);
  return shuffledPairs.slice(0, tileCount / 2);
}
