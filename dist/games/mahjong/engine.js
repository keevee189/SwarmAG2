/**
 * Pure Mahjong Solitaire game engine.
 * Zero DOM dependencies — runs identically in browser ESM and Node.js unit tests.
 */
import { clamp } from '../../shared/arcade.js';
import { buildMatchingPairsForCount, shuffleArray, tilesMatch, } from './tiles.js';
import { getLayout, } from './layout.js';
const BASE_MATCH_POINTS = 100;
const LAYER_BONUS_PER_Z = 25;
const COMBO_STEP = 0.25;
const MAX_COMBO_MULTIPLIER = 4;
/**
 * Deterministic PRNG (Mulberry32) for reproducible testing when a seed is provided.
 */
export function createSeededRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Computes exact Mahjong Solitaire blocking flags for a position against live tiles:
 * - Blocked on top: any live tile at z' > z with |x' - x| < 2 && |y' - y| < 2
 * - Blocked on left: any live tile at z' === z with x' === x - 2 && |y' - y| < 2
 * - Blocked on right: any live tile at z' === z with x' === x + 2 && |y' - y| < 2
 * - Free iff NOT blocked on top AND (NOT blocked on left OR NOT blocked on right).
 */
export function getBlockingStatus(target, livePositions) {
    let blockedTop = false;
    let blockedLeft = false;
    let blockedRight = false;
    for (const other of livePositions) {
        if (other.z > target.z) {
            if (Math.abs(other.x - target.x) < 2 && Math.abs(other.y - target.y) < 2) {
                blockedTop = true;
                if (blockedLeft && blockedRight) {
                    break;
                }
            }
        }
        else if (other.z === target.z && Math.abs(other.y - target.y) < 2) {
            if (other.x === target.x - 2) {
                blockedLeft = true;
            }
            else if (other.x === target.x + 2) {
                blockedRight = true;
            }
        }
    }
    return {
        blockedTop,
        blockedLeft,
        blockedRight,
        isFree: !blockedTop && (!blockedLeft || !blockedRight),
    };
}
/**
 * Convenience predicate returning whether `target` is currently free among `livePositions`.
 */
export function isPositionFree(target, livePositions) {
    return getBlockingStatus(target, livePositions).isFree;
}
function pickWeightedSlot(candidates, positions, rng) {
    let totalWeight = 0;
    const weights = [];
    for (const idx of candidates) {
        const w = 1 + positions[idx].z * 0.65;
        weights.push(w);
        totalWeight += w;
    }
    let target = rng() * totalWeight;
    for (let i = 0; i < candidates.length; i += 1) {
        target -= weights[i];
        if (target <= 0) {
            return candidates[i];
        }
    }
    return candidates[candidates.length - 1];
}
function attemptConstructiveDeal(positions, pairs, minOpeningPairs, rng) {
    const n = positions.length;
    if (n !== pairs.length * 2) {
        return null;
    }
    let remaining = Array.from({ length: n }, (_, i) => i);
    const slotAssignments = [];
    const solutionOrder = [];
    let pairCursor = 0;
    const getFreeInRemaining = (indices) => {
        const livePos = indices.map((i) => positions[i]);
        const free = [];
        for (const idx of indices) {
            if (isPositionFree(positions[idx], livePos)) {
                free.push(idx);
            }
        }
        return free;
    };
    // Guarantee at least `minOpeningPairs` open pairs simultaneously on the initial full board.
    if (minOpeningPairs > 0 && remaining.length >= minOpeningPairs * 2) {
        const initialFree = shuffleArray(getFreeInRemaining(remaining), rng);
        const openingCount = Math.min(minOpeningPairs, Math.floor(initialFree.length / 2));
        const chosenSet = new Set();
        for (let k = 0; k < openingCount; k += 1) {
            const slotA = initialFree[k * 2];
            const slotB = initialFree[k * 2 + 1];
            const [tileA, tileB] = pairs[pairCursor];
            pairCursor += 1;
            slotAssignments.push({ slotIndex: slotA, tile: tileA });
            slotAssignments.push({ slotIndex: slotB, tile: tileB });
            solutionOrder.push([tileA.id, tileB.id]);
            chosenSet.add(slotA);
            chosenSet.add(slotB);
        }
        remaining = remaining.filter((idx) => !chosenSet.has(idx));
    }
    // Peel pairs in removal order from remaining unplaced slots until all slots are filled.
    while (remaining.length >= 2) {
        const free = getFreeInRemaining(remaining);
        if (free.length < 2) {
            return null;
        }
        let slotA = -1;
        let slotB = -1;
        // Lookahead when 4 slots remain so the final 2 slots are mutually non-blocking.
        if (remaining.length === 4) {
            const candidatePairs = [];
            for (let i = 0; i < free.length; i += 1) {
                for (let j = i + 1; j < free.length; j += 1) {
                    const a = free[i];
                    const b = free[j];
                    const rest = remaining.filter((idx) => idx !== a && idx !== b);
                    const restPos = rest.map((idx) => positions[idx]);
                    if (rest.length === 2 && isPositionFree(restPos[0], restPos) && isPositionFree(restPos[1], restPos)) {
                        candidatePairs.push([a, b]);
                    }
                }
            }
            if (candidatePairs.length === 0) {
                return null;
            }
            const chosen = candidatePairs[Math.floor(rng() * candidatePairs.length)];
            slotA = chosen[0];
            slotB = chosen[1];
        }
        else {
            slotA = pickWeightedSlot(free, positions, rng);
            const otherFree = free.filter((idx) => idx !== slotA);
            slotB = pickWeightedSlot(otherFree, positions, rng);
        }
        const [tileA, tileB] = pairs[pairCursor];
        pairCursor += 1;
        slotAssignments.push({ slotIndex: slotA, tile: tileA });
        slotAssignments.push({ slotIndex: slotB, tile: tileB });
        solutionOrder.push([tileA.id, tileB.id]);
        remaining = remaining.filter((idx) => idx !== slotA && idx !== slotB);
    }
    if (remaining.length !== 0 || pairCursor !== pairs.length) {
        return null;
    }
    return { slotAssignments, solutionOrder };
}
function buildConstructiveDeal(positions, pairs, minOpeningPairs, rng) {
    const maxAttempts = 128;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = attemptConstructiveDeal(positions, pairs, minOpeningPairs, rng);
        if (result) {
            return result;
        }
    }
    throw new Error(`Failed to construct a solvable deal after ${maxAttempts} attempts for ${positions.length} positions.`);
}
/**
 * Pure stateful Mahjong Solitaire engine with constructive guaranteed-solvable deals,
 * exact free-tile detection, combo scoring, undo, hint, shuffle, and win forecast.
 */
export class MahjongEngine {
    layoutId;
    layout;
    rng;
    tiles = [];
    tileMap = new Map();
    constructedSolution = [];
    status = 'ready';
    score = 0;
    combo = 0;
    maxCombo = 0;
    moves = 0;
    elapsedSeconds = 0;
    selectedTileId = null;
    hintPair = null;
    undoStack = [];
    initialTotalTiles = 144;
    constructor(options = {}) {
        this.layoutId = options.layoutId ?? 'turtle';
        this.layout = getLayout(this.layoutId);
        this.rng = options.seed !== undefined ? createSeededRng(options.seed) : Math.random;
        if (options.customTiles) {
            this.loadCustomTiles(options.customTiles);
        }
        else {
            this.dealFreshBoard();
        }
    }
    /**
     * Builds an engine loaded with explicit tile placements (useful for deterministic rule/deadlock tests).
     */
    static fromCustomTiles(customTiles, options = {}) {
        return new MahjongEngine({ ...options, customTiles });
    }
    loadCustomTiles(customTiles) {
        this.tiles = customTiles.map((entry) => ({
            ...entry.tile,
            x: entry.x,
            y: entry.y,
            z: entry.z,
            removed: false,
        }));
        this.rebuildTileMap();
        this.initialTotalTiles = this.tiles.length;
        this.constructedSolution = [];
        this.resetCounters('ready');
    }
    dealFreshBoard() {
        const positions = this.layout.positions;
        const pairs = buildMatchingPairsForCount(positions.length, this.rng);
        const minOpeningPairs = Math.min(3, Math.floor(positions.length / 2));
        const dealt = buildConstructiveDeal(positions, pairs, minOpeningPairs, this.rng);
        const assignedTiles = new Array(positions.length);
        for (const item of dealt.slotAssignments) {
            const pos = positions[item.slotIndex];
            assignedTiles[item.slotIndex] = {
                ...item.tile,
                x: pos.x,
                y: pos.y,
                z: pos.z,
                removed: false,
            };
        }
        this.tiles = assignedTiles;
        this.rebuildTileMap();
        this.initialTotalTiles = this.tiles.length;
        this.constructedSolution = dealt.solutionOrder.slice();
        this.resetCounters('ready');
    }
    rebuildTileMap() {
        this.tileMap.clear();
        for (const tile of this.tiles) {
            this.tileMap.set(tile.id, tile);
        }
    }
    resetCounters(initialStatus) {
        this.status = this.tiles.length === 0 ? 'victory' : initialStatus;
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.moves = 0;
        this.elapsedSeconds = 0;
        this.selectedTileId = null;
        this.hintPair = null;
        this.undoStack = [];
    }
    getLayoutId() {
        return this.layoutId;
    }
    getLayout() {
        return this.layout;
    }
    setLayout(layoutId, seed) {
        this.layoutId = layoutId;
        this.layout = getLayout(layoutId);
        if (seed !== undefined) {
            this.rng = createSeededRng(seed);
        }
        this.dealFreshBoard();
    }
    getStatus() {
        return this.status;
    }
    getScore() {
        return this.score;
    }
    getCombo() {
        return this.combo;
    }
    getMaxCombo() {
        return this.maxCombo;
    }
    getMoves() {
        return this.moves;
    }
    getElapsedSeconds() {
        return this.elapsedSeconds;
    }
    tickSecond(deltaSeconds = 1) {
        if (this.status === 'playing' && deltaSeconds > 0) {
            this.elapsedSeconds += deltaSeconds;
        }
        return this.elapsedSeconds;
    }
    getSelectedTileId() {
        return this.selectedTileId;
    }
    getHintPair() {
        return this.hintPair;
    }
    canUndo() {
        return this.undoStack.length > 0 && this.status !== 'ready';
    }
    getTiles() {
        return this.tiles;
    }
    getLiveTiles() {
        return this.tiles.filter((tile) => !tile.removed);
    }
    getTilesRemaining() {
        let count = 0;
        for (const tile of this.tiles) {
            if (!tile.removed) {
                count += 1;
            }
        }
        return count;
    }
    getTileById(id) {
        return this.tileMap.get(id);
    }
    getConstructedSolution() {
        return this.constructedSolution.slice();
    }
    getTileBlockingStatus(tileId) {
        const target = this.tileMap.get(tileId);
        if (!target || target.removed) {
            return { blockedTop: true, blockedLeft: true, blockedRight: true, isFree: false };
        }
        const live = this.getLiveTiles();
        return getBlockingStatus(target, live);
    }
    isTileFree(tileId) {
        return this.getTileBlockingStatus(tileId).isFree;
    }
    getFreeTiles() {
        const live = this.getLiveTiles();
        return live.filter((tile) => getBlockingStatus(tile, live).isFree);
    }
    /**
     * Returns all distinct valid matching pairs among currently free tiles.
     */
    getOpenPairs() {
        const free = this.getFreeTiles();
        const pairs = [];
        for (let i = 0; i < free.length; i += 1) {
            for (let j = i + 1; j < free.length; j += 1) {
                if (tilesMatch(free[i], free[j])) {
                    pairs.push([free[i], free[j]]);
                }
            }
        }
        return pairs;
    }
    getPairsAvailableCount() {
        return this.getOpenPairs().length;
    }
    /**
     * Starts gameplay from ready state and updates deadlock/victory status if needed.
     */
    start() {
        if (this.tiles.length === 0 || this.getTilesRemaining() === 0) {
            this.status = 'victory';
            return this.status;
        }
        if (this.status === 'ready') {
            this.status = this.getPairsAvailableCount() === 0 ? 'deadlocked' : 'playing';
        }
        return this.status;
    }
    /**
     * Resets board, score, combo, timer, and undo stack back to ready state.
     */
    reset(seed) {
        if (seed !== undefined) {
            this.rng = createSeededRng(seed);
        }
        this.dealFreshBoard();
    }
    /**
     * Selects a tile, handles deselection, or evaluates a pair match.
     */
    selectTile(tileId) {
        if (this.status !== 'playing') {
            return {
                action: 'ignored-not-playing',
                selectedId: this.selectedTileId,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        const tile = this.tileMap.get(tileId);
        if (!tile || tile.removed) {
            return {
                action: 'invalid-tile',
                selectedId: this.selectedTileId,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        if (!this.isTileFree(tileId)) {
            return {
                action: 'blocked',
                selectedId: this.selectedTileId,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        // Deselect when clicking the already-selected tile
        if (this.selectedTileId === tileId) {
            this.selectedTileId = null;
            return {
                action: 'deselected',
                selectedId: null,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        // First tile of pair
        if (this.selectedTileId === null) {
            this.selectedTileId = tileId;
            this.hintPair = null;
            return {
                action: 'selected',
                selectedId: tileId,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        const first = this.tileMap.get(this.selectedTileId);
        if (!first || first.removed) {
            this.selectedTileId = tileId;
            return {
                action: 'selected',
                selectedId: tileId,
                pointsAwarded: 0,
                combo: this.combo,
                status: this.status,
            };
        }
        // Check match
        if (tilesMatch(first, tile)) {
            const previousScore = this.score;
            const previousCombo = this.combo;
            const previousMaxCombo = this.maxCombo;
            const previousMoves = this.moves;
            const previousStatus = this.status;
            const previousSolution = this.constructedSolution.slice();
            const nextCombo = this.combo + 1;
            const multiplier = Math.min(MAX_COMBO_MULTIPLIER, 1 + (nextCombo - 1) * COMBO_STEP);
            const layerBonus = (first.z + tile.z) * LAYER_BONUS_PER_Z;
            const pointsAwarded = Math.round((BASE_MATCH_POINTS + layerBonus) * multiplier);
            this.undoStack.push({
                kind: 'match',
                tileAId: first.id,
                tileBId: tile.id,
                previousScore,
                previousCombo,
                previousMaxCombo,
                previousMoves,
                previousStatus,
                previousSolution,
            });
            first.removed = true;
            tile.removed = true;
            this.selectedTileId = null;
            this.hintPair = null;
            this.score += pointsAwarded;
            this.combo = nextCombo;
            if (nextCombo > this.maxCombo) {
                this.maxCombo = nextCombo;
            }
            this.moves += 1;
            this.refreshPlayStatus();
            return {
                action: 'matched',
                selectedId: null,
                matchedIds: [first.id, tile.id],
                pointsAwarded,
                combo: this.combo,
                status: this.status,
            };
        }
        // Mismatch: reset combo streak and switch or clear selection cleanly
        const mismatchIds = [first.id, tile.id];
        this.combo = 0;
        this.selectedTileId = null;
        this.hintPair = null;
        return {
            action: 'mismatch',
            selectedId: null,
            mismatchIds,
            pointsAwarded: 0,
            combo: this.combo,
            status: this.status,
        };
    }
    clearSelection() {
        this.selectedTileId = null;
        this.hintPair = null;
    }
    /**
     * Computes and activates a valid open pair hint (prefers pairs from the constructed solution or highest layer).
     */
    requestHint() {
        if (this.status !== 'playing') {
            return null;
        }
        const openPairs = this.getOpenPairs();
        if (openPairs.length === 0) {
            this.hintPair = null;
            return null;
        }
        // Prefer a pair present in the remaining constructed solution so hints stay constructive
        for (const [solA, solB] of this.constructedSolution) {
            const a = this.tileMap.get(solA);
            const b = this.tileMap.get(solB);
            if (a && b && !a.removed && !b.removed && this.isTileFree(a.id) && this.isTileFree(b.id)) {
                this.hintPair = [a.id, b.id];
                return this.hintPair;
            }
        }
        // Otherwise prefer the pair with highest combined z layer (helps uncover buried tiles)
        let bestPair = openPairs[0];
        let bestLayerSum = bestPair[0].z + bestPair[1].z;
        for (let i = 1; i < openPairs.length; i += 1) {
            const candidate = openPairs[i];
            const layerSum = candidate[0].z + candidate[1].z;
            if (layerSum > bestLayerSum) {
                bestLayerSum = layerSum;
                bestPair = candidate;
            }
        }
        this.hintPair = [bestPair[0].id, bestPair[1].id];
        return this.hintPair;
    }
    /**
     * Undoes the most recent match (or shuffle), restoring tiles, score, combo, and status.
     */
    undo() {
        if (!this.canUndo()) {
            return {
                restored: false,
                kind: 'none',
                restoredIds: [],
                status: this.status,
            };
        }
        const entry = this.undoStack.pop();
        if (!entry) {
            return {
                restored: false,
                kind: 'none',
                restoredIds: [],
                status: this.status,
            };
        }
        this.selectedTileId = null;
        this.hintPair = null;
        if (entry.kind === 'match') {
            const tileA = this.tileMap.get(entry.tileAId);
            const tileB = this.tileMap.get(entry.tileBId);
            if (tileA)
                tileA.removed = false;
            if (tileB)
                tileB.removed = false;
            this.score = entry.previousScore;
            this.combo = entry.previousCombo;
            this.maxCombo = entry.previousMaxCombo;
            this.moves = entry.previousMoves;
            this.status = entry.previousStatus;
            this.constructedSolution = entry.previousSolution.slice();
            return {
                restored: true,
                kind: 'match',
                restoredIds: [entry.tileAId, entry.tileBId],
                status: this.status,
            };
        }
        // Undo shuffle: restore exact pre-shuffle coordinates for each tile
        const restoredIds = [];
        for (const snap of entry.positions) {
            const tile = this.tileMap.get(snap.id);
            if (tile) {
                tile.x = snap.x;
                tile.y = snap.y;
                tile.z = snap.z;
                restoredIds.push(tile.id);
            }
        }
        this.combo = entry.previousCombo;
        this.status = entry.previousStatus;
        this.constructedSolution = entry.previousSolution.slice();
        return {
            restored: true,
            kind: 'shuffle',
            restoredIds,
            status: this.status,
        };
    }
    /**
     * Shuffles remaining live tiles across their current occupied positions,
     * guaranteeing >= 1 open pair whenever valid pairs & free positions exist.
     */
    shuffle() {
        if (this.status !== 'playing' && this.status !== 'deadlocked') {
            return false;
        }
        const live = this.getLiveTiles();
        if (live.length < 2) {
            return false;
        }
        const livePositions = live.map((t) => ({ x: t.x, y: t.y, z: t.z }));
        const freeSlotIndices = [];
        for (let i = 0; i < livePositions.length; i += 1) {
            if (isPositionFree(livePositions[i], livePositions)) {
                freeSlotIndices.push(i);
            }
        }
        if (freeSlotIndices.length < 2) {
            return false;
        }
        const pairs = this.partitionLiveTilesIntoPairs(live);
        if (pairs.length === 0) {
            return false;
        }
        const snapshot = live.map((t) => ({ id: t.id, x: t.x, y: t.y, z: t.z }));
        const previousCombo = this.combo;
        const previousStatus = this.status;
        const previousSolution = this.constructedSolution.slice();
        // First try full constructive deal on remaining live slots so the board becomes solvable
        const minOpen = Math.min(3, Math.floor(freeSlotIndices.length / 2), pairs.length);
        let constructive = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const res = attemptConstructiveDeal(livePositions, shuffleArray(pairs, this.rng), Math.max(1, minOpen), this.rng);
            if (res) {
                constructive = res;
                break;
            }
        }
        this.undoStack.push({
            kind: 'shuffle',
            positions: snapshot,
            previousCombo,
            previousStatus,
            previousSolution,
        });
        if (constructive) {
            for (const item of constructive.slotAssignments) {
                const pos = livePositions[item.slotIndex];
                const tile = this.tileMap.get(item.tile.id);
                if (tile) {
                    tile.x = pos.x;
                    tile.y = pos.y;
                    tile.z = pos.z;
                }
            }
            this.constructedSolution = constructive.solutionOrder.slice();
        }
        else {
            // Fallback: place one guaranteed matching pair on two free positions and shuffle the rest
            const shuffledFreeSlots = shuffleArray(freeSlotIndices, this.rng);
            const shuffledPairs = shuffleArray(pairs, this.rng);
            const [guaranteedA, guaranteedB] = shuffledPairs[0];
            const slotA = shuffledFreeSlots[0];
            const slotB = shuffledFreeSlots[1];
            const remainingSlots = shuffleArray(livePositions
                .map((_, idx) => idx)
                .filter((idx) => idx !== slotA && idx !== slotB), this.rng);
            const remainingTiles = shuffleArray(live.filter((t) => t.id !== guaranteedA.id && t.id !== guaranteedB.id), this.rng);
            guaranteedA.x = livePositions[slotA].x;
            guaranteedA.y = livePositions[slotA].y;
            guaranteedA.z = livePositions[slotA].z;
            guaranteedB.x = livePositions[slotB].x;
            guaranteedB.y = livePositions[slotB].y;
            guaranteedB.z = livePositions[slotB].z;
            for (let i = 0; i < remainingTiles.length; i += 1) {
                const targetPos = livePositions[remainingSlots[i]];
                remainingTiles[i].x = targetPos.x;
                remainingTiles[i].y = targetPos.y;
                remainingTiles[i].z = targetPos.z;
            }
            this.constructedSolution = [];
        }
        this.combo = 0;
        this.selectedTileId = null;
        this.hintPair = null;
        this.refreshPlayStatus();
        return true;
    }
    partitionLiveTilesIntoPairs(live) {
        const byGroup = new Map();
        for (const tile of live) {
            const bucket = byGroup.get(tile.matchGroup);
            if (bucket) {
                bucket.push(tile);
            }
            else {
                byGroup.set(tile.matchGroup, [tile]);
            }
        }
        const pairs = [];
        for (const bucket of byGroup.values()) {
            const shuffled = shuffleArray(bucket, this.rng);
            for (let i = 0; i + 1 < shuffled.length; i += 2) {
                pairs.push([shuffled[i], shuffled[i + 1]]);
            }
        }
        return pairs;
    }
    refreshPlayStatus() {
        const remaining = this.getTilesRemaining();
        if (remaining === 0) {
            this.status = 'victory';
            return;
        }
        const openPairs = this.getPairsAvailableCount();
        this.status = openPairs === 0 ? 'deadlocked' : 'playing';
    }
    /**
     * Computes Solvability Outlook / Win Forecast based on open pairs count,
     * pair parity / blocking depth (including vertical self-trapped pairs), and remaining layers.
     */
    getWinForecast() {
        const live = this.getLiveTiles();
        const tilesRemaining = live.length;
        if (tilesRemaining === 0) {
            return {
                label: 'VICTORY',
                percent: 100,
                detail: 'All tiles cleared — Imperial Dynasty complete!',
            };
        }
        const openPairs = this.getOpenPairs();
        const pairCount = openPairs.length;
        if (pairCount === 0) {
            return {
                label: 'NO MOVES — SHUFFLE',
                percent: 0,
                detail: `0 open pairs across ${tilesRemaining} tiles — shuffle or undo to recover.`,
            };
        }
        const freeTiles = live.filter((tile) => getBlockingStatus(tile, live).isFree);
        const layerSet = new Set(live.map((tile) => tile.z));
        const remainingLayers = layerSet.size;
        // Immediate trivial win: all remaining tiles are free and have open matches
        if (freeTiles.length === tilesRemaining && pairCount >= Math.floor(tilesRemaining / 2)) {
            return {
                label: 'HIGH CHANCE',
                percent: 98,
                detail: `${pairCount} open ${pairCount === 1 ? 'pair' : 'pairs'} with all ${tilesRemaining} tiles unlocked.`,
            };
        }
        // Distinct matchGroups currently open
        const openGroupSet = new Set();
        for (const [a] of openPairs) {
            openGroupSet.add(a.matchGroup);
        }
        // Analyze blocking depth & vertical self-trapped pairs
        let totalBlockingBurden = 0;
        const byGroup = new Map();
        for (const tile of live) {
            const bucket = byGroup.get(tile.matchGroup);
            if (bucket) {
                bucket.push(tile);
            }
            else {
                byGroup.set(tile.matchGroup, [tile]);
            }
            let aboveCount = 0;
            let leftBlocked = false;
            let rightBlocked = false;
            for (const other of live) {
                if (other.z > tile.z && Math.abs(other.x - tile.x) < 2 && Math.abs(other.y - tile.y) < 2) {
                    aboveCount += 1;
                }
                else if (other.z === tile.z && Math.abs(other.y - tile.y) < 2) {
                    if (other.x === tile.x - 2)
                        leftBlocked = true;
                    if (other.x === tile.x + 2)
                        rightBlocked = true;
                }
            }
            totalBlockingBurden += aboveCount + (leftBlocked && rightBlocked ? 0.65 : 0);
        }
        // Count pair parity / self-traps: a matchGroup with only 2 remaining tiles where one directly covers the other
        let trappedPairs = 0;
        for (const groupTiles of byGroup.values()) {
            if (groupTiles.length === 2) {
                const [a, b] = groupTiles;
                const aBlocksB = a.z > b.z && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
                const bBlocksA = b.z > a.z && Math.abs(b.x - a.x) < 2 && Math.abs(b.y - a.y) < 2;
                if (aBlocksB || bBlocksA) {
                    trappedPairs += 1;
                }
            }
        }
        const avgBurden = totalBlockingBurden / tilesRemaining;
        const clearProgress = clamp(1 - tilesRemaining / Math.max(1, this.initialTotalTiles), 0, 1);
        const openPairScore = clamp(Math.sqrt(pairCount) / Math.sqrt(10), 0, 1) * 42;
        const diversityScore = clamp(openGroupSet.size / 5, 0, 1) * 14;
        const progressScore = clearProgress * 16;
        const layerScore = clamp(1 - (remainingLayers - 1) / 5, 0, 1) * 10;
        const burdenPenalty = clamp(avgBurden / 1.5, 0, 1) * 12;
        const trapPenalty = Math.min(22, trappedPairs * 9);
        const lowPairPenalty = pairCount === 1 ? 16 : pairCount === 2 ? 6 : 0;
        const rawPercent = 30 +
            openPairScore +
            diversityScore +
            progressScore +
            layerScore -
            burdenPenalty -
            trapPenalty -
            lowPairPenalty;
        const percent = Math.round(clamp(rawPercent, 8, 99));
        let label;
        if (percent >= 75) {
            label = 'HIGH CHANCE';
        }
        else if (percent >= 50) {
            label = 'FAVORABLE';
        }
        else {
            label = 'RISKY';
        }
        const trapNote = trappedPairs > 0 ? ` • ${trappedPairs} stacked pair${trappedPairs > 1 ? 's' : ''}` : '';
        const detail = `${pairCount} open ${pairCount === 1 ? 'pair' : 'pairs'} • ${freeTiles.length}/${tilesRemaining} free across ${remainingLayers} ${remainingLayers === 1 ? 'layer' : 'layers'}${trapNote}`;
        return { label, percent, detail };
    }
}
//# sourceMappingURL=engine.js.map