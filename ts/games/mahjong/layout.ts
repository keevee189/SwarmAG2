/**
 * Pure multi-layer half-tile coordinate layouts for Mahjong Solitaire.
 * Each tile at (x, y, z) covers the 2D half-tile footprint [x, x + 2) x [y, y + 2).
 * Zero DOM dependencies.
 */

export type LayoutId = 'turtle' | 'dragon';

export interface GridPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LayoutBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly widthUnits: number;
  readonly heightUnits: number;
}

export interface MahjongLayout {
  readonly id: LayoutId;
  readonly name: string;
  readonly tileCount: number;
  readonly layerCount: number;
  readonly positions: readonly GridPosition[];
  readonly bounds: LayoutBounds;
}

function addRow(
  target: GridPosition[],
  z: number,
  y: number,
  startX: number,
  endX: number,
): void {
  for (let x = startX; x <= endX; x += 2) {
    target.push({ x, y, z });
  }
}

function buildClassicTurtlePositions(): readonly GridPosition[] {
  const positions: GridPosition[] = [];

  // Layer 0 (87 tiles)
  addRow(positions, 0, 0, 2, 24);  // 12
  addRow(positions, 0, 2, 6, 20);  // 8
  addRow(positions, 0, 4, 4, 22);  // 10
  addRow(positions, 0, 6, 2, 24);  // 12
  addRow(positions, 0, 8, 2, 24);  // 12
  addRow(positions, 0, 10, 4, 22); // 10
  addRow(positions, 0, 12, 6, 20); // 8
  addRow(positions, 0, 14, 2, 24); // 12
  // Iconic left wing + double right wing at y = 7
  positions.push({ x: 0, y: 7, z: 0 });
  positions.push({ x: 26, y: 7, z: 0 });
  positions.push({ x: 28, y: 7, z: 0 });

  // Layer 1 (36 tiles: 6x6)
  for (let y = 2; y <= 12; y += 2) {
    addRow(positions, 1, y, 8, 18);
  }

  // Layer 2 (16 tiles: 4x4)
  for (let y = 4; y <= 10; y += 2) {
    addRow(positions, 2, y, 10, 16);
  }

  // Layer 3 (4 tiles: 2x2)
  for (let y = 6; y <= 8; y += 2) {
    addRow(positions, 3, y, 12, 14);
  }

  // Layer 4 (1 crown tile)
  positions.push({ x: 13, y: 7, z: 4 });

  return positions;
}

function buildQuickDragonPositions(): readonly GridPosition[] {
  const positions: GridPosition[] = [];

  // Layer 0 (40 tiles)
  addRow(positions, 0, 0, 6, 16);  // 6
  addRow(positions, 0, 2, 4, 18);  // 8
  addRow(positions, 0, 4, 0, 22);  // 12
  addRow(positions, 0, 6, 4, 18);  // 8
  addRow(positions, 0, 8, 6, 16);  // 6

  // Layer 1 (20 tiles)
  addRow(positions, 1, 2, 6, 16);  // 6
  addRow(positions, 1, 4, 4, 18);  // 8
  addRow(positions, 1, 6, 6, 16);  // 6

  // Layer 2 (8 tiles)
  addRow(positions, 2, 2, 10, 12); // 2
  addRow(positions, 2, 4, 8, 14);  // 4
  addRow(positions, 2, 6, 10, 12); // 2

  // Layer 3 (4 tiles: 2x2 crest centered across rows 2..6)
  addRow(positions, 3, 3, 10, 12); // 2
  addRow(positions, 3, 5, 10, 12); // 2

  return positions;
}

/**
 * Checks whether two grid positions overlap on the same layer.
 */
export function positionsOverlapOnSameLayer(a: GridPosition, b: GridPosition): boolean {
  return a.z === b.z && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/**
 * Returns true if any two positions on the same layer overlap.
 */
export function hasSameLayerOverlaps(positions: readonly GridPosition[]): boolean {
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positionsOverlapOnSameLayer(positions[i], positions[j])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes half-tile coordinate bounds for a layout.
 */
export function computeLayoutBounds(positions: readonly GridPosition[]): LayoutBounds {
  if (positions.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      maxZ: 0,
      widthUnits: 0,
      heightUnits: 0,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxZ = 0;
  for (const pos of positions) {
    if (pos.x < minX) minX = pos.x;
    if (pos.x + 2 > maxX) maxX = pos.x + 2;
    if (pos.y < minY) minY = pos.y;
    if (pos.y + 2 > maxY) maxY = pos.y + 2;
    if (pos.z > maxZ) maxZ = pos.z;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    maxZ,
    widthUnits: maxX - minX,
    heightUnits: maxY - minY,
  };
}

function createLayout(id: LayoutId, name: string, positions: readonly GridPosition[]): MahjongLayout {
  const layers = new Set(positions.map((p) => p.z));
  return {
    id,
    name,
    tileCount: positions.length,
    layerCount: layers.size,
    positions,
    bounds: computeLayoutBounds(positions),
  };
}

const turtlePositions = buildClassicTurtlePositions();
const dragonPositions = buildQuickDragonPositions();

export const CLASSIC_TURTLE_LAYOUT: MahjongLayout = createLayout(
  'turtle',
  'Classic Turtle (144)',
  turtlePositions,
);

export const QUICK_DRAGON_LAYOUT: MahjongLayout = createLayout(
  'dragon',
  'Quick Dragon (72)',
  dragonPositions,
);

export const MAHJONG_LAYOUTS: Record<LayoutId, MahjongLayout> = {
  turtle: CLASSIC_TURTLE_LAYOUT,
  dragon: QUICK_DRAGON_LAYOUT,
};

export function getLayout(id: LayoutId): MahjongLayout {
  return MAHJONG_LAYOUTS[id];
}
