/**
 * Mahjong Solitaire ("Imperial Tile Dynasty") — Browser UI, SVG Tile Artwork & Controls.
 */

import {
  ArcadeAudio,
  clamp,
  formatTime,
  initArcadeHeader,
} from '../../shared/arcade.js';
import {
  MahjongEngine,
  type BoardTile,
  type WinForecast,
} from './engine.js';
import { type LayoutId } from './layout.js';

const TILE_W = 54;
const TILE_H = 72;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const LAYER_SHIFT_X = 5;
const LAYER_SHIFT_Y = 6;
const EXTRUSION_PAD_X = 10;
const EXTRUSION_PAD_Y = 12;

const HIGH_SCORE_KEY_PREFIX = 'nexus-arcade:mahjong:best:';

const CHINESE_NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_GLYPHS: Record<number, string> = { 1: '東', 2: '南', 3: '西', 4: '北' };
const DRAGON_GLYPHS: Record<number, { glyph: string; color: string }> = {
  1: { glyph: '中', color: '#dc2626' },
  2: { glyph: '發', color: '#059669' },
  3: { glyph: '白', color: '#1d4ed8' },
};

function readBestScore(layoutId: LayoutId): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(`${HIGH_SCORE_KEY_PREFIX}${layoutId}`);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

function writeBestScore(layoutId: LayoutId, score: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${HIGH_SCORE_KEY_PREFIX}${layoutId}`, String(Math.floor(score)));
    }
  } catch {
    // Ignore storage restriction errors.
  }
}

function svgPipCircle(cx: number, cy: number, r: number, color: string): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#0f172a" stroke-width="0.6"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${Math.max(1.4, r * 0.56)}" fill="none" stroke="#fffdf7" stroke-width="0.9"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${Math.max(0.8, r * 0.22)}" fill="#fffdf7"/>`
  );
}

function svgBambooStalk(x: number, y: number, h: number, color: string): string {
  const midY = y + h / 2;
  return (
    `<rect x="${x - 2.3}" y="${y}" width="4.6" height="${h}" rx="2.2" fill="${color}" stroke="#06281e" stroke-width="0.5"/>` +
    `<line x1="${x - 3}" y1="${y + 1.5}" x2="${x + 3}" y2="${y + 1.5}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<line x1="${x - 3}" y1="${midY}" x2="${x + 3}" y2="${midY}" stroke="#fef3c7" stroke-width="1.2" stroke-linecap="round"/>` +
    `<line x1="${x - 3}" y1="${y + h - 1.5}" x2="${x + 3}" y2="${y + h - 1.5}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<line x1="${x - 0.6}" y1="${y + 3}" x2="${x - 0.6}" y2="${y + h - 3}" stroke="rgba(255,255,255,0.45)" stroke-width="0.9"/>`
  );
}

function renderCircleSvg(rank: number): string {
  const E = '#059669';
  const B = '#1d4ed8';
  const R = '#dc2626';

  switch (rank) {
    case 1:
      return (
        `<circle cx="27" cy="39" r="15.5" fill="#fef3c7" stroke="${E}" stroke-width="2.4"/>` +
        `<circle cx="27" cy="39" r="11.2" fill="none" stroke="${B}" stroke-width="1.6" stroke-dasharray="3 2"/>` +
        `<circle cx="27" cy="39" r="7.2" fill="${R}" stroke="#7f1d1d" stroke-width="0.9"/>` +
        `<circle cx="27" cy="39" r="2.8" fill="#fef08a"/>`
      );
    case 2:
      return svgPipCircle(27, 25, 7.2, E) + svgPipCircle(27, 51, 7.2, B);
    case 3:
      return (
        svgPipCircle(17, 21, 5.8, E) +
        svgPipCircle(27, 38, 5.8, R) +
        svgPipCircle(37, 55, 5.8, B)
      );
    case 4:
      return (
        svgPipCircle(18, 25, 6.1, B) +
        svgPipCircle(36, 25, 6.1, E) +
        svgPipCircle(18, 51, 6.1, E) +
        svgPipCircle(36, 51, 6.1, B)
      );
    case 5:
      return (
        svgPipCircle(16, 22, 5.2, B) +
        svgPipCircle(38, 22, 5.2, E) +
        svgPipCircle(27, 38, 5.4, R) +
        svgPipCircle(16, 54, 5.2, E) +
        svgPipCircle(38, 54, 5.2, B)
      );
    case 6:
      return (
        svgPipCircle(18, 20, 5.0, E) +
        svgPipCircle(36, 20, 5.0, E) +
        svgPipCircle(18, 39, 5.0, R) +
        svgPipCircle(36, 39, 5.0, R) +
        svgPipCircle(18, 56, 5.0, R) +
        svgPipCircle(36, 56, 5.0, R)
      );
    case 7:
      return (
        svgPipCircle(15, 17, 4.3, E) +
        svgPipCircle(27, 22, 4.3, E) +
        svgPipCircle(39, 27, 4.3, E) +
        svgPipCircle(18, 42, 4.8, R) +
        svgPipCircle(36, 42, 4.8, R) +
        svgPipCircle(18, 57, 4.8, R) +
        svgPipCircle(36, 57, 4.8, R)
      );
    case 8:
      return (
        svgPipCircle(18, 17, 4.4, B) +
        svgPipCircle(36, 17, 4.4, B) +
        svgPipCircle(18, 31, 4.4, B) +
        svgPipCircle(36, 31, 4.4, B) +
        svgPipCircle(18, 45, 4.4, B) +
        svgPipCircle(36, 45, 4.4, B) +
        svgPipCircle(18, 59, 4.4, B) +
        svgPipCircle(36, 59, 4.4, B)
      );
    default: {
      const xs = [15, 27, 39];
      const rows: Array<{ y: number; color: string }> = [
        { y: 20, color: E },
        { y: 38, color: R },
        { y: 56, color: B },
      ];
      return rows
        .map((row) => xs.map((x) => svgPipCircle(x, row.y, 4.3, row.color)).join(''))
        .join('');
    }
  }
}

function renderBambooSvg(rank: number): string {
  const E = '#047857';
  const R = '#dc2626';
  const B = '#1d4ed8';

  switch (rank) {
    case 1:
      // Imperial Jade Sparrow perched on golden bamboo
      return (
        `<path d="M12 56H42" stroke="#b45309" stroke-width="2.6" stroke-linecap="round"/>` +
        `<path d="M21 50C17 44 17 34 23 27C27 23 32 22 36 25C33 27 33 30 35 32C40 35 42 42 38 48C34 52 26 53 21 50Z" fill="${E}" stroke="#064e3b" stroke-width="1"/>` +
        `<path d="M25 32C28 31 32 34 33 39C28 40 24 38 25 32Z" fill="#34d399"/>` +
        `<path d="M20 48L12 58L22 52Z" fill="#065f46"/>` +
        `<path d="M35 24L41 22L36 27Z" fill="#f59e0b"/>` +
        `<circle cx="32.5" cy="25.5" r="1.3" fill="#0f172a"/>` +
        `<path d="M25 22L28 16L30 22" fill="none" stroke="${R}" stroke-width="1.6" stroke-linecap="round"/>`
      );
    case 2:
      return svgBambooStalk(27, 14, 20, B) + svgBambooStalk(27, 40, 20, E);
    case 3:
      return (
        svgBambooStalk(27, 14, 19, B) +
        svgBambooStalk(18, 40, 20, E) +
        svgBambooStalk(36, 40, 20, E)
      );
    case 4:
      return (
        svgBambooStalk(18, 15, 20, B) +
        svgBambooStalk(36, 15, 20, E) +
        svgBambooStalk(18, 41, 20, E) +
        svgBambooStalk(36, 41, 20, B)
      );
    case 5:
      return (
        svgBambooStalk(15, 14, 20, E) +
        svgBambooStalk(39, 14, 20, B) +
        svgBambooStalk(27, 27, 20, R) +
        svgBambooStalk(15, 41, 20, B) +
        svgBambooStalk(39, 41, 20, E)
      );
    case 6:
      return (
        svgBambooStalk(15, 15, 20, E) +
        svgBambooStalk(27, 15, 20, E) +
        svgBambooStalk(39, 15, 20, E) +
        svgBambooStalk(15, 41, 20, B) +
        svgBambooStalk(27, 41, 20, B) +
        svgBambooStalk(39, 41, 20, B)
      );
    case 7:
      return (
        svgBambooStalk(27, 11, 15, R) +
        svgBambooStalk(15, 30, 14, E) +
        svgBambooStalk(27, 30, 14, B) +
        svgBambooStalk(39, 30, 14, E) +
        svgBambooStalk(15, 48, 14, E) +
        svgBambooStalk(27, 48, 14, B) +
        svgBambooStalk(39, 48, 14, E)
      );
    case 8:
      return (
        svgBambooStalk(15, 14, 19, E) +
        `<g transform="rotate(-18 22 24)">${svgBambooStalk(22, 14, 18, B)}</g>` +
        `<g transform="rotate(18 32 24)">${svgBambooStalk(32, 14, 18, B)}</g>` +
        svgBambooStalk(39, 14, 19, E) +
        svgBambooStalk(15, 41, 19, E) +
        `<g transform="rotate(18 22 50)">${svgBambooStalk(22, 41, 18, B)}</g>` +
        `<g transform="rotate(-18 32 50)">${svgBambooStalk(32, 41, 18, B)}</g>` +
        svgBambooStalk(39, 41, 19, E)
      );
    default: {
      const cols = [
        { x: 15, color: E },
        { x: 27, color: R },
        { x: 39, color: B },
      ];
      const ys = [12, 30, 48];
      return ys
        .map((y) => cols.map((col) => svgBambooStalk(col.x, y, 14, col.color)).join(''))
        .join('');
    }
  }
}

function renderCharacterSvg(rank: number): string {
  const numGlyph = CHINESE_NUMERALS[rank] ?? String(rank);
  return (
    `<text x="27" y="34" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a" font-family="serif">${numGlyph}</text>` +
    `<rect x="11" y="40" width="32" height="22" rx="4" fill="rgba(220,38,38,0.08)" stroke="rgba(220,38,38,0.4)" stroke-width="1"/>` +
    `<text x="27" y="57" text-anchor="middle" font-size="18" font-weight="800" fill="#dc2626" font-family="serif">萬</text>`
  );
}

function renderWindSvg(rank: number): string {
  const glyph = WIND_GLYPHS[rank] ?? '風';
  return (
    `<rect x="9" y="14" width="36" height="46" rx="6" fill="none" stroke="rgba(30,58,138,0.28)" stroke-width="1.2"/>` +
    `<polygon points="27,17 31,21 27,25 23,21" fill="rgba(30,58,138,0.25)"/>` +
    `<text x="27" y="49" text-anchor="middle" font-size="27" font-weight="800" fill="#1e3a8a" font-family="serif">${glyph}</text>`
  );
}

function renderDragonSvg(rank: number): string {
  if (rank === 3) {
    // Classic White Dragon ornate blue lattice frame
    return (
      `<rect x="10" y="13" width="34" height="48" rx="4" fill="none" stroke="#1d4ed8" stroke-width="2.6"/>` +
      `<rect x="15" y="18" width="24" height="38" rx="2" fill="none" stroke="#3b82f6" stroke-width="1.3" stroke-dasharray="3 2"/>` +
      `<circle cx="10" cy="13" r="2.2" fill="#1d4ed8"/>` +
      `<circle cx="44" cy="13" r="2.2" fill="#1d4ed8"/>` +
      `<circle cx="10" cy="61" r="2.2" fill="#1d4ed8"/>` +
      `<circle cx="44" cy="61" r="2.2" fill="#1d4ed8"/>` +
      `<text x="27" y="45" text-anchor="middle" font-size="20" font-weight="700" fill="rgba(29,78,216,0.38)" font-family="serif">白</text>`
    );
  }
  const spec = DRAGON_GLYPHS[rank] ?? DRAGON_GLYPHS[1];
  return (
    `<path d="M12 18V12H18M36 12H42V18M12 56V62H18M36 62H42V56" fill="none" stroke="#d97706" stroke-width="1.6" stroke-linecap="round"/>` +
    `<text x="27" y="48" text-anchor="middle" font-size="30" font-weight="900" fill="${spec.color}" font-family="serif">${spec.glyph}</text>`
  );
}

function renderSeasonSvg(rank: number): string {
  const banner = `<rect x="13" y="55" width="28" height="10" rx="3" fill="#fef3c7" stroke="#d97706" stroke-width="0.8"/><text x="27" y="62.5" text-anchor="middle" font-size="6.4" font-weight="800" fill="#92400e" font-family="monospace">SEASON</text>`;
  switch (rank) {
    case 1:
      // Spring: Blossom + sprout
      return (
        `<circle cx="27" cy="27" r="5" fill="#fb7185"/>` +
        `<circle cx="20" cy="31" r="5" fill="#f43f5e"/>` +
        `<circle cx="34" cy="31" r="5" fill="#f43f5e"/>` +
        `<circle cx="23" cy="38" r="5" fill="#fb7185"/>` +
        `<circle cx="31" cy="38" r="5" fill="#fb7185"/>` +
        `<circle cx="27" cy="33" r="3.4" fill="#fbbf24"/>` +
        `<path d="M27 42V51M27 48C32 45 35 45 36 42" stroke="#059669" stroke-width="2" fill="none" stroke-linecap="round"/>` +
        banner
      );
    case 2:
      // Summer: Radiant sun
      return (
        `<circle cx="27" cy="33" r="10" fill="#f59e0b" stroke="#b45309" stroke-width="1"/>` +
        `<circle cx="27" cy="33" r="6" fill="#fde047"/>` +
        `<path d="M27 16V20M27 46V50M10 33H14M40 33H44M15 21L18 24M36 42L39 45M39 21L36 24M18 42L15 45" stroke="#d97706" stroke-width="2" stroke-linecap="round"/>` +
        banner
      );
    case 3:
      // Autumn: Maple leaf
      return (
        `<path d="M27 17L30 25L39 23L34 31L41 36L31 38L33 45L27 41L21 45L23 38L13 36L20 31L15 23L24 25Z" fill="#ea580c" stroke="#9a3412" stroke-width="0.9"/>` +
        `<path d="M27 41V51" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>` +
        banner
      );
    default:
      // Winter: Snowflake
      return (
        `<path d="M27 17V49M13 25L41 41M41 25L13 41" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round"/>` +
        `<path d="M24 20L27 23L30 20M24 46L27 43L30 46M16 23L17 27L13 28M38 38L37 42L41 43" stroke="#0369a1" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
        `<circle cx="27" cy="33" r="3.5" fill="#bae6fd" stroke="#0284c7" stroke-width="1.2"/>` +
        banner
      );
  }
}

function renderFlowerSvg(rank: number): string {
  const banner = `<rect x="13" y="55" width="28" height="10" rx="3" fill="#fce7f3" stroke="#be185d" stroke-width="0.8"/><text x="27" y="62.5" text-anchor="middle" font-size="6.4" font-weight="800" fill="#9d174d" font-family="monospace">FLOWER</text>`;
  switch (rank) {
    case 1:
      // Plum blossom
      return (
        `<circle cx="27" cy="24" r="5.5" fill="#ec4899"/>` +
        `<circle cx="35" cy="30" r="5.5" fill="#db2777"/>` +
        `<circle cx="32" cy="39" r="5.5" fill="#ec4899"/>` +
        `<circle cx="22" cy="39" r="5.5" fill="#db2777"/>` +
        `<circle cx="19" cy="30" r="5.5" fill="#ec4899"/>` +
        `<circle cx="27" cy="33" r="4" fill="#fde047"/>` +
        `<path d="M27 43V51" stroke="#047857" stroke-width="2" stroke-linecap="round"/>` +
        banner
      );
    case 2:
      // Orchid
      return (
        `<path d="M27 18C32 24 32 30 27 34C22 30 22 24 27 18Z" fill="#a855f7"/>` +
        `<path d="M14 29C20 26 25 28 27 34C21 36 16 34 14 29Z" fill="#c084fc"/>` +
        `<path d="M40 29C34 26 29 28 27 34C33 36 38 34 40 29Z" fill="#c084fc"/>` +
        `<path d="M21 43C23 36 31 36 33 43C30 47 24 47 21 43Z" fill="#e11d48"/>` +
        `<circle cx="27" cy="35" r="2.6" fill="#fde047"/>` +
        banner
      );
    case 3:
      // Chrysanthemum
      return (
        `<g transform="translate(27 33)">` +
        `<ellipse rx="3.2" ry="13" fill="#f59e0b"/>` +
        `<ellipse rx="3.2" ry="13" transform="rotate(45)" fill="#fbbf24"/>` +
        `<ellipse rx="3.2" ry="13" transform="rotate(90)" fill="#f59e0b"/>` +
        `<ellipse rx="3.2" ry="13" transform="rotate(135)" fill="#fbbf24"/>` +
        `<circle r="4.8" fill="#dc2626"/>` +
        `<circle r="2" fill="#fef08a"/>` +
        `</g>` +
        banner
      );
    default:
      // Bamboo Gentleman
      return (
        svgBambooStalk(24, 17, 33, '#059669') +
        svgBambooStalk(32, 22, 28, '#10b981') +
        `<path d="M24 27C17 24 14 27 13 31C18 32 21 30 24 27Z" fill="#047857"/>` +
        `<path d="M32 31C39 28 42 31 43 35C38 36 35 34 32 31Z" fill="#059669"/>` +
        banner
      );
  }
}

function renderTileSvg(tile: BoardTile): string {
  let inner = '';
  switch (tile.suit) {
    case 'circle':
      inner = renderCircleSvg(tile.rank);
      break;
    case 'bamboo':
      inner = renderBambooSvg(tile.rank);
      break;
    case 'character':
      inner = renderCharacterSvg(tile.rank);
      break;
    case 'wind':
      inner = renderWindSvg(tile.rank);
      break;
    case 'dragon':
      inner = renderDragonSvg(tile.rank);
      break;
    case 'season':
      inner = renderSeasonSvg(tile.rank);
      break;
    case 'flower':
      inner = renderFlowerSvg(tile.rank);
      break;
  }
  return `<svg viewBox="0 0 54 72" class="tile-svg" aria-hidden="true">${inner}</svg>`;
}

function getForecastColorClass(forecast: WinForecast): string {
  switch (forecast.label) {
    case 'VICTORY':
    case 'HIGH CHANCE':
      return 'is-emerald';
    case 'FAVORABLE':
      return 'is-cyan';
    case 'RISKY':
      return 'is-gold';
    case 'NO MOVES — SHUFFLE':
      return 'is-crimson';
  }
}

class MahjongController {
  private readonly engine = new MahjongEngine({ layoutId: 'turtle' });
  private readonly tileElements = new Map<string, HTMLButtonElement>();
  private highlightFree = false;
  private bestScore = 0;
  private timerIntervalId: number | null = null;
  private mismatchTimeoutId: number | null = null;
  private boardGeneration = 0;
  private lastBannerMessage = 'Ready — Press Start or Enter to begin your Imperial Dynasty.';
  private lastMatchBadgeText = 'SOLVABLE DEAL';

  // DOM Elements
  private readonly stageFrame = document.getElementById('stage-frame') as HTMLElement;
  private readonly boardViewport = document.getElementById('board-viewport') as HTMLElement;
  private readonly boardEl = document.getElementById('mahjong-board') as HTMLElement;
  private readonly statusBanner = document.getElementById('status-banner') as HTMLElement;
  private readonly statusText = document.getElementById('status-text') as HTMLElement;
  private readonly lastMatchBadge = document.getElementById('last-match-badge') as HTMLElement;

  private readonly stageOverlay = document.getElementById('stage-overlay') as HTMLElement;
  private readonly overlayEyebrow = document.getElementById('overlay-eyebrow') as HTMLElement;
  private readonly overlayTitle = document.getElementById('overlay-title') as HTMLElement;
  private readonly overlayMessage = document.getElementById('overlay-message') as HTMLElement;
  private readonly overlayPrimaryBtn = document.getElementById('overlay-primary-btn') as HTMLButtonElement;
  private readonly overlaySecondaryBtn = document.getElementById('overlay-secondary-btn') as HTMLButtonElement;

  private readonly startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  private readonly resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
  private readonly hintBtn = document.getElementById('hint-btn') as HTMLButtonElement;
  private readonly undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
  private readonly shuffleBtn = document.getElementById('shuffle-btn') as HTMLButtonElement;
  private readonly highlightBtn = document.getElementById('highlight-btn') as HTMLButtonElement;
  private readonly layoutTurtleBtn = document.getElementById('layout-turtle-btn') as HTMLButtonElement;
  private readonly layoutDragonBtn = document.getElementById('layout-dragon-btn') as HTMLButtonElement;

  private readonly scoreValue = document.getElementById('score-value') as HTMLElement;
  private readonly highScoreValue = document.getElementById('high-score-value') as HTMLElement;
  private readonly tilesLeftValue = document.getElementById('tiles-left-value') as HTMLElement;
  private readonly pairsAvailableValue = document.getElementById('pairs-available-value') as HTMLElement;
  private readonly comboValue = document.getElementById('combo-value') as HTMLElement;
  private readonly timerValue = document.getElementById('timer-value') as HTMLElement;

  private readonly forecastPercent = document.getElementById('forecast-percent') as HTMLElement;
  private readonly forecastBar = document.getElementById('forecast-bar') as HTMLElement;
  private readonly forecastLabel = document.getElementById('forecast-label') as HTMLElement;
  private readonly forecastMetaLayers = document.getElementById('forecast-meta-layers') as HTMLElement;
  private readonly forecastDetail = document.getElementById('forecast-detail') as HTMLElement;

  private boardNaturalW = 848;
  private boardNaturalH = 620;
  private originShiftX = 0;
  private originShiftY = 0;

  constructor() {
    initArcadeHeader();
    this.bestScore = readBestScore(this.engine.getLayoutId());
    this.bindEvents();
    this.rebuildBoardDom();
    this.updateScale();
    this.syncAllUi();
  }

  private bindEvents(): void {
    const bindButton = (btn: HTMLButtonElement, action: () => void): void => {
      btn.addEventListener('click', (event) => {
        if (event.detail > 0) {
          btn.blur();
        }
        action();
      });
    };

    bindButton(this.startBtn, () => this.handleStart());
    bindButton(this.resetBtn, () => this.handleReset());
    bindButton(this.hintBtn, () => this.handleHint());
    bindButton(this.undoBtn, () => this.handleUndo());
    bindButton(this.shuffleBtn, () => this.handleShuffle());
    bindButton(this.highlightBtn, () => this.handleToggleHighlight());

    bindButton(this.layoutTurtleBtn, () => this.handleLayoutChange('turtle'));
    bindButton(this.layoutDragonBtn, () => this.handleLayoutChange('dragon'));

    bindButton(this.overlayPrimaryBtn, () => {
      const status = this.engine.getStatus();
      if (status === 'ready') {
        this.handleStart();
      } else if (status === 'deadlocked') {
        this.handleShuffle();
      } else {
        this.handleReset();
      }
    });

    bindButton(this.overlaySecondaryBtn, () => {
      if (this.engine.getStatus() === 'deadlocked' && this.engine.canUndo()) {
        this.handleUndo();
      } else {
        this.handleReset();
      }
    });

    this.boardEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const tileBtn = target?.closest<HTMLButtonElement>('[data-tile-id]');
      if (!tileBtn) return;
      if (event.detail > 0) {
        tileBtn.blur();
      }
      const tileId = tileBtn.dataset.tileId;
      if (tileId) {
        this.handleTileClick(tileId);
      }
    });

    document.addEventListener('keydown', (event) => this.handleKeydown(event));

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.updateScale());
      observer.observe(this.stageFrame);
    }
    window.addEventListener('resize', () => this.updateScale());
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement | null;

    if (key === 'enter') {
      if (
        this.engine.getStatus() === 'ready' &&
        (!target || target === document.body || !target.closest('button, a, select, input'))
      ) {
        event.preventDefault();
        this.handleStart();
      }
      return;
    }

    switch (key) {
      case 'h':
        event.preventDefault();
        this.handleHint();
        break;
      case 'u':
      case 'z':
        event.preventDefault();
        this.handleUndo();
        break;
      case 's':
        event.preventDefault();
        this.handleShuffle();
        break;
      case 'f':
        event.preventDefault();
        this.handleToggleHighlight();
        break;
      case 'r':
        event.preventDefault();
        this.handleReset();
        break;
      case 'escape':
        event.preventDefault();
        this.engine.clearSelection();
        this.syncTileStates();
        break;
      default:
        break;
    }
  }

  private computeBoardGeometry(): void {
    const layout = this.engine.getLayout();
    const bounds = layout.bounds;
    this.originShiftX = bounds.maxZ * LAYER_SHIFT_X - bounds.minX * HALF_W + 4;
    this.originShiftY = bounds.maxZ * LAYER_SHIFT_Y - bounds.minY * HALF_H + 4;
    this.boardNaturalW =
      bounds.widthUnits * HALF_W + bounds.maxZ * LAYER_SHIFT_X + EXTRUSION_PAD_X + 8;
    this.boardNaturalH =
      bounds.heightUnits * HALF_H + bounds.maxZ * LAYER_SHIFT_Y + EXTRUSION_PAD_Y + 8;
  }

  private updateScale(): void {
    const availW = Math.max(240, this.stageFrame.clientWidth - 20);
    const availH = Math.max(200, this.stageFrame.clientHeight - 20);
    const scale = clamp(
      Math.min(availW / this.boardNaturalW, availH / this.boardNaturalH),
      0.32,
      1.12,
    );

    this.boardViewport.style.setProperty('--board-w', `${this.boardNaturalW}px`);
    this.boardViewport.style.setProperty('--board-h', `${this.boardNaturalH}px`);
    this.boardViewport.style.setProperty('--board-scale', scale.toFixed(4));
  }

  private positionTileElement(btn: HTMLButtonElement, tile: BoardTile): void {
    const left = this.originShiftX + tile.x * HALF_W - tile.z * LAYER_SHIFT_X;
    const top = this.originShiftY + tile.y * HALF_H - tile.z * LAYER_SHIFT_Y;
    const zIndex = tile.z * 1000 + Math.round(tile.y * 10) + Math.round(tile.x);
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.style.zIndex = String(zIndex);
  }

  private rebuildBoardDom(): void {
    this.computeBoardGeometry();
    this.tileElements.clear();
    this.boardEl.replaceChildren();

    const fragment = document.createDocumentFragment();
    for (const tile of this.engine.getLiveTiles()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mahjong-tile';
      btn.dataset.tileId = tile.id;
      btn.dataset.suit = tile.suit;
      btn.dataset.kind = tile.kindId;
      btn.title = tile.label;
      btn.innerHTML = `<span class="tile-corner-pip">${tile.shortLabel}</span>${renderTileSvg(tile)}`;
      this.positionTileElement(btn, tile);
      this.tileElements.set(tile.id, btn);
      fragment.appendChild(btn);
    }

    this.boardEl.appendChild(fragment);
    this.updateScale();
  }

  private clearMismatchTimers(): void {
    if (this.mismatchTimeoutId !== null) {
      window.clearTimeout(this.mismatchTimeoutId);
      this.mismatchTimeoutId = null;
    }
    for (const btn of this.tileElements.values()) {
      delete btn.dataset.mismatch;
    }
  }

  private stopTimer(): void {
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerIntervalId = window.setInterval(() => {
      if (this.engine.getStatus() !== 'playing') {
        this.stopTimer();
        return;
      }
      this.engine.tickSecond(1);
      this.timerValue.textContent = formatTime(this.engine.getElapsedSeconds());
    }, 1000);
  }

  private handleStart(): void {
    const prev = this.engine.getStatus();
    if (prev !== 'ready') {
      return;
    }
    const next = this.engine.start();
    ArcadeAudio.playClick();
    if (next === 'playing') {
      this.lastBannerMessage = 'Match free tile pairs to clear the Imperial pyramid.';
      this.lastMatchBadgeText = 'ACTIVE';
      this.startTimer();
    } else if (next === 'deadlocked') {
      this.lastBannerMessage = 'No open pairs remaining — Shuffle or Undo to continue.';
      this.lastMatchBadgeText = 'DEADLOCK';
      ArcadeAudio.playLose();
    }
    this.syncAllUi();
  }

  private handleReset(): void {
    this.boardGeneration += 1;
    this.stopTimer();
    this.clearMismatchTimers();
    this.engine.reset();
    ArcadeAudio.playClick();
    this.lastBannerMessage = 'Ready — Press Start or Enter to begin your Imperial Dynasty.';
    this.lastMatchBadgeText = 'SOLVABLE DEAL';
    this.rebuildBoardDom();
    this.syncAllUi();
  }

  private handleLayoutChange(layoutId: LayoutId): void {
    if (layoutId === this.engine.getLayoutId()) {
      return;
    }
    this.boardGeneration += 1;
    this.stopTimer();
    this.clearMismatchTimers();
    this.engine.setLayout(layoutId);
    this.bestScore = readBestScore(layoutId);
    ArcadeAudio.playClick();
    this.lastBannerMessage = `${this.engine.getLayout().name} ready — Press Start or Enter to play.`;
    this.lastMatchBadgeText = 'SOLVABLE DEAL';
    this.rebuildBoardDom();
    this.syncAllUi();
  }

  private handleTileClick(tileId: string): void {
    if (this.engine.getStatus() === 'ready') {
      ArcadeAudio.playError();
      this.lastBannerMessage = 'Press Start (or Enter) to activate the board before matching.';
      this.syncStatusBanner();
      return;
    }

    const result = this.engine.selectTile(tileId);

    switch (result.action) {
      case 'selected':
        ArcadeAudio.playClick();
        break;
      case 'deselected':
        ArcadeAudio.playClick();
        break;
      case 'blocked':
        ArcadeAudio.playError();
        this.lastBannerMessage = 'Tile is blocked — must be clear on top and open on left or right.';
        break;
      case 'matched': {
        if (result.matchedIds) {
          for (const id of result.matchedIds) {
            const btn = this.tileElements.get(id);
            if (btn) {
              btn.remove();
              this.tileElements.delete(id);
            }
          }
        }
        const matchedTile = result.matchedIds ? this.engine.getTileById(result.matchedIds[0]) : undefined;
        const label = matchedTile ? matchedTile.label : 'Pair';
        this.lastMatchBadgeText = `+${result.pointsAwarded} PTS`;
        if (result.combo >= 3) {
          ArcadeAudio.playScore();
        } else {
          ArcadeAudio.playMatch();
        }

        if (this.engine.getScore() > this.bestScore) {
          this.bestScore = this.engine.getScore();
          writeBestScore(this.engine.getLayoutId(), this.bestScore);
        }

        if (result.status === 'victory') {
          this.stopTimer();
          ArcadeAudio.playWin();
          this.lastBannerMessage = `VICTORY! Cleared all ${this.engine.getLayout().tileCount} tiles in ${formatTime(this.engine.getElapsedSeconds())}!`;
          this.lastMatchBadgeText = 'VICTORY';
        } else if (result.status === 'deadlocked') {
          this.stopTimer();
          ArcadeAudio.playLose();
          this.lastBannerMessage = 'No open pairs remaining — Shuffle or Undo to continue!';
          this.lastMatchBadgeText = 'NO MOVES';
        } else {
          this.lastBannerMessage = `Matched ${label} (+${result.pointsAwarded} pts${result.combo > 1 ? ` • ${result.combo}x Combo` : ''})`;
        }
        break;
      }
      case 'mismatch': {
        ArcadeAudio.playError();
        this.lastBannerMessage = 'Tiles do not match — combo streak reset.';
        this.lastMatchBadgeText = 'MISMATCH';
        this.flashMismatch(result.mismatchIds);
        break;
      }
      default:
        break;
    }

    this.syncAllUi();
  }

  private flashMismatch(ids?: readonly [string, string]): void {
    if (!ids) return;
    this.clearMismatchTimers();
    const gen = this.boardGeneration;
    for (const id of ids) {
      const btn = this.tileElements.get(id);
      if (btn) {
        btn.dataset.mismatch = 'true';
      }
    }
    this.mismatchTimeoutId = window.setTimeout(() => {
      if (this.boardGeneration !== gen) return;
      for (const id of ids) {
        const btn = this.tileElements.get(id);
        if (btn) {
          delete btn.dataset.mismatch;
        }
      }
      this.mismatchTimeoutId = null;
    }, 340);
  }

  private handleHint(): void {
    if (this.engine.getStatus() !== 'playing') {
      ArcadeAudio.playError();
      return;
    }
    const hint = this.engine.requestHint();
    if (hint) {
      ArcadeAudio.playMove();
      const tileA = this.engine.getTileById(hint[0]);
      this.lastBannerMessage = tileA
        ? `Hint highlighted: open pair of ${tileA.label}.`
        : 'Hint highlighted an available open pair.';
      this.lastMatchBadgeText = 'HINT';
    } else {
      ArcadeAudio.playError();
      this.lastBannerMessage = 'No open pairs available — try Shuffle or Undo.';
    }
    this.syncAllUi();
  }

  private handleUndo(): void {
    const undoRes = this.engine.undo();
    if (!undoRes.restored) {
      ArcadeAudio.playError();
      return;
    }
    this.clearMismatchTimers();
    ArcadeAudio.playMove();
    if (undoRes.status === 'playing' && this.timerIntervalId === null) {
      this.startTimer();
    }
    this.lastBannerMessage =
      undoRes.kind === 'shuffle' ? 'Restored pre-shuffle tile arrangement.' : 'Last matched pair restored.';
    this.lastMatchBadgeText = 'UNDO';
    this.rebuildBoardDom();
    this.syncAllUi();
  }

  private handleShuffle(): void {
    if (this.engine.getStatus() !== 'playing' && this.engine.getStatus() !== 'deadlocked') {
      ArcadeAudio.playError();
      return;
    }
    const ok = this.engine.shuffle();
    if (!ok) {
      ArcadeAudio.playError();
      return;
    }
    this.clearMismatchTimers();
    ArcadeAudio.playMove();
    if (this.engine.getStatus() === 'playing' && this.timerIntervalId === null) {
      this.startTimer();
    }
    this.lastBannerMessage = `Remaining tiles shuffled — ${this.engine.getPairsAvailableCount()} open pairs ready.`;
    this.lastMatchBadgeText = 'SHUFFLED';
    this.rebuildBoardDom();
    this.syncAllUi();
  }

  private handleToggleHighlight(): void {
    this.highlightFree = !this.highlightFree;
    ArcadeAudio.playClick();
    this.syncControls();
    this.boardEl.dataset.highlightFree = String(this.highlightFree);
  }

  private syncAllUi(): void {
    this.syncTileStates();
    this.syncHud();
    this.syncForecast();
    this.syncControls();
    this.syncStatusBanner();
    this.syncOverlay();
  }

  private syncTileStates(): void {
    const liveTiles = this.engine.getLiveTiles();
    const selectedId = this.engine.getSelectedTileId();
    const hintPair = this.engine.getHintPair();
    const hintSet = hintPair ? new Set(hintPair) : null;

    this.boardEl.dataset.highlightFree = String(this.highlightFree);

    for (const tile of liveTiles) {
      const btn = this.tileElements.get(tile.id);
      if (!btn) continue;
      const isFree = this.engine.isTileFree(tile.id);
      const isSelected = selectedId === tile.id;
      const isHinted = hintSet !== null && hintSet.has(tile.id);

      btn.dataset.free = String(isFree);
      btn.dataset.selected = String(isSelected);
      btn.dataset.hint = String(isHinted);
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.setAttribute('aria-label', `${tile.label} (${isFree ? 'Free' : 'Blocked'})`);
    }
  }

  private syncHud(): void {
    this.scoreValue.textContent = String(this.engine.getScore());
    this.highScoreValue.textContent = String(Math.max(this.bestScore, this.engine.getScore()));
    this.tilesLeftValue.textContent = String(this.engine.getTilesRemaining());
    this.pairsAvailableValue.textContent = String(this.engine.getPairsAvailableCount());
    this.comboValue.textContent = `${this.engine.getCombo()}x`;
    this.timerValue.textContent = formatTime(this.engine.getElapsedSeconds());
  }

  private syncForecast(): void {
    const forecast = this.engine.getWinForecast();
    const colorClass = getForecastColorClass(forecast);
    const liveLayers = new Set(this.engine.getLiveTiles().map((t) => t.z)).size;

    this.forecastPercent.textContent = `${forecast.percent}%`;
    this.forecastPercent.className = `stat-value forecast-pct ${colorClass}`;
    this.forecastBar.style.width = `${forecast.percent}%`;
    this.forecastBar.className = `predictor-fill ${colorClass}`;
    this.forecastLabel.textContent = forecast.label;
    this.forecastMetaLayers.textContent = `${liveLayers} ${liveLayers === 1 ? 'LAYER' : 'LAYERS'}`;
    this.forecastDetail.textContent = forecast.detail;
  }

  private syncControls(): void {
    const status = this.engine.getStatus();
    const layoutId = this.engine.getLayoutId();

    this.startBtn.disabled = status !== 'ready';
    this.hintBtn.disabled = status !== 'playing' || this.engine.getPairsAvailableCount() === 0;
    this.undoBtn.disabled = !this.engine.canUndo();
    this.shuffleBtn.disabled = status !== 'playing' && status !== 'deadlocked';

    this.highlightBtn.setAttribute('aria-pressed', String(this.highlightFree));
    this.highlightBtn.classList.toggle('is-active', this.highlightFree);
    this.highlightBtn.textContent = this.highlightFree
      ? 'Highlight Free: ON'
      : 'Highlight Free: OFF';

    const isTurtle = layoutId === 'turtle';
    this.layoutTurtleBtn.classList.toggle('is-active', isTurtle);
    this.layoutTurtleBtn.setAttribute('aria-pressed', String(isTurtle));
    this.layoutDragonBtn.classList.toggle('is-active', !isTurtle);
    this.layoutDragonBtn.setAttribute('aria-pressed', String(!isTurtle));
  }

  private syncStatusBanner(): void {
    const status = this.engine.getStatus();
    this.statusText.textContent = this.lastBannerMessage;
    this.lastMatchBadge.textContent = this.lastMatchBadgeText;

    this.statusBanner.classList.remove('is-info', 'is-active', 'is-victory', 'is-warning', 'is-defeat');
    switch (status) {
      case 'ready':
        this.statusBanner.classList.add('is-info');
        break;
      case 'playing':
        this.statusBanner.classList.add('is-active');
        break;
      case 'deadlocked':
        this.statusBanner.classList.add('is-warning');
        break;
      case 'victory':
        this.statusBanner.classList.add('is-victory');
        break;
    }
  }

  private syncOverlay(): void {
    const status = this.engine.getStatus();
    if (status === 'playing') {
      this.stageOverlay.hidden = true;
      return;
    }

    this.stageOverlay.hidden = false;

    if (status === 'ready') {
      const layout = this.engine.getLayout();
      this.overlayEyebrow.textContent = `${layout.name.toUpperCase()} • SOLVABLE DEAL`;
      this.overlayTitle.textContent = 'IMPERIAL TILE DYNASTY';
      this.overlayMessage.textContent =
        'Match free tile pairs (clear on top with left or right side open). ' +
        'Any Season matches any Season, and any Flower matches any Flower.';
      this.overlayPrimaryBtn.textContent = 'Start Dynasty';
      this.overlayPrimaryBtn.className = 'btn btn-primary';
      this.overlaySecondaryBtn.hidden = true;
    } else if (status === 'deadlocked') {
      this.overlayEyebrow.textContent = 'DEADLOCK DETECTED';
      this.overlayTitle.textContent = 'NO OPEN PAIRS';
      this.overlayMessage.textContent =
        'No legal pairs remain exposed. Shuffle the remaining tiles for a fresh solvable arrangement or undo your last match.';
      this.overlayPrimaryBtn.textContent = 'Shuffle Tiles';
      this.overlayPrimaryBtn.className = 'btn btn-secondary';
      this.overlaySecondaryBtn.textContent = 'Undo Last Move';
      this.overlaySecondaryBtn.hidden = !this.engine.canUndo();
    } else {
      this.overlayEyebrow.textContent = 'DYNASTY COMPLETE';
      this.overlayTitle.textContent = 'VICTORY!';
      this.overlayMessage.textContent =
        `Final Score: ${this.engine.getScore()} pts • Time: ${formatTime(this.engine.getElapsedSeconds())} • ` +
        `Best Streak: ${this.engine.getMaxCombo()}x`;
      this.overlayPrimaryBtn.textContent = 'New Deal';
      this.overlayPrimaryBtn.className = 'btn btn-primary';
      this.overlaySecondaryBtn.hidden = true;
    }
  }
}

if (typeof document !== 'undefined') {
  const boot = (): void => {
    new MahjongController();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
