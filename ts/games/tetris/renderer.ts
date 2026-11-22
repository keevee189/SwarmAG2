/**
 * 60fps glowing neon Canvas renderer for Tetris ("Tetromino Overdrive").
 */

import {
  BOARD_COLS,
  BOARD_ROWS,
  PIECE_COLORS,
  TetrisSnapshot,
  TetrominoType,
  getPieceCells,
  getPieceMatrix,
} from './engine.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  lifeMs: number;
  maxLifeMs: number;
}

interface RowFlash {
  row: number;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
}

interface FloatingCallout {
  text: string;
  subtext: string;
  x: number;
  y: number;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
}

export interface TetrisRendererCanvases {
  boardCanvas: HTMLCanvasElement;
  nextCanvas: HTMLCanvasElement | null;
  holdCanvas: HTMLCanvasElement | null;
}

const LOGICAL_CELL_SIZE = 32;
const BOARD_LOGICAL_WIDTH = BOARD_COLS * LOGICAL_CELL_SIZE; // 320
const BOARD_LOGICAL_HEIGHT = BOARD_ROWS * LOGICAL_CELL_SIZE; // 640

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Handles Retina/HiDPI canvas drawing for main board, Hold preview, and Next-3 queue.
 */
export class TetrisRenderer {
  private readonly boardCanvas: HTMLCanvasElement;
  private readonly nextCanvas: HTMLCanvasElement | null;
  private readonly holdCanvas: HTMLCanvasElement | null;

  private readonly boardCtx: CanvasRenderingContext2D | null;
  private readonly nextCtx: CanvasRenderingContext2D | null;
  private readonly holdCtx: CanvasRenderingContext2D | null;

  private particles: Particle[] = [];
  private rowFlashes: RowFlash[] = [];
  private callouts: FloatingCallout[] = [];
  private lastSeenClearId = 0;
  private pulseClockMs = 0;

  constructor(canvases: TetrisRendererCanvases) {
    this.boardCanvas = canvases.boardCanvas;
    this.nextCanvas = canvases.nextCanvas;
    this.holdCanvas = canvases.holdCanvas;

    this.boardCtx = this.boardCanvas.getContext('2d');
    this.nextCtx = this.nextCanvas ? this.nextCanvas.getContext('2d') : null;
    this.holdCtx = this.holdCanvas ? this.holdCanvas.getContext('2d') : null;
  }

  public clearEffects(): void {
    this.particles = [];
    this.rowFlashes = [];
    this.callouts = [];
    this.lastSeenClearId = 0;
  }

  public render(snapshot: TetrisSnapshot, dtMs = 16.67): void {
    this.pulseClockMs += dtMs;
    this.syncClearEffects(snapshot);
    this.updateEffects(dtMs);

    this.renderBoard(snapshot);
    this.renderHold(snapshot);
    this.renderNextQueue(snapshot);
  }

  private syncClearEffects(snapshot: TetrisSnapshot): void {
    const clear = snapshot.lastClear;
    if (!clear) {
      this.lastSeenClearId = 0;
      return;
    }
    if (clear.id === this.lastSeenClearId) {
      return;
    }
    this.lastSeenClearId = clear.id;

    const palette = ['#00f5ff', '#ff2bd6', '#fbbf24', '#10b981', '#c084fc'];
    const accent = clear.linesCleared >= 4 ? '#00f5ff' : clear.tSpin !== 'none' ? '#ff2bd6' : '#fbbf24';

    for (const row of clear.clearedVisibleRows) {
      this.rowFlashes.push({
        row,
        color: accent,
        lifeMs: 0,
        maxLifeMs: 280,
      });

      const cy = (row + 0.5) * LOGICAL_CELL_SIZE;
      const particleCount = clear.linesCleared >= 4 ? 18 : 12;
      for (let i = 0; i < particleCount; i += 1) {
        const cx = ((i + 0.5) / particleCount) * BOARD_LOGICAL_WIDTH;
        const angle = -Math.PI * Math.random();
        const speed = 60 + Math.random() * 190;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 90,
          vy: Math.sin(angle) * speed - 35,
          size: 3 + Math.random() * 4,
          color: palette[i % palette.length],
          alpha: 1,
          lifeMs: 0,
          maxLifeMs: 460 + Math.random() * 220,
        });
      }
    }

    if (clear.label) {
      const targetRow =
        clear.clearedVisibleRows.length > 0
          ? clear.clearedVisibleRows[0]
          : snapshot.activePiece
            ? Math.max(2, snapshot.activePiece.y)
            : 6;
      this.callouts.push({
        text: clear.label,
        subtext: clear.scoreDelta > 0 ? `+${clear.scoreDelta.toLocaleString()}` : '',
        x: BOARD_LOGICAL_WIDTH / 2,
        y: Math.max(48, targetRow * LOGICAL_CELL_SIZE),
        color: accent,
        lifeMs: 0,
        maxLifeMs: 900,
      });
    }
  }

  private updateEffects(dtMs: number): void {
    const dtSec = dtMs / 1000;

    this.rowFlashes = this.rowFlashes.filter((flash) => {
      flash.lifeMs += dtMs;
      return flash.lifeMs < flash.maxLifeMs;
    });

    this.particles = this.particles.filter((p) => {
      p.lifeMs += dtMs;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 420 * dtSec;
      p.alpha = Math.max(0, 1 - p.lifeMs / p.maxLifeMs);
      return p.lifeMs < p.maxLifeMs;
    });

    this.callouts = this.callouts.filter((c) => {
      c.lifeMs += dtMs;
      c.y -= 28 * dtSec;
      return c.lifeMs < c.maxLifeMs;
    });
  }

  private prepareContext(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    logicalW: number,
    logicalH: number,
  ): void {
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const targetW = Math.round(logicalW * dpr);
    const targetH = Math.round(logicalH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private renderBoard(snapshot: TetrisSnapshot): void {
    const ctx = this.boardCtx;
    if (!ctx) {
      return;
    }
    this.prepareContext(this.boardCanvas, ctx, BOARD_LOGICAL_WIDTH, BOARD_LOGICAL_HEIGHT);

    // Background obsidian gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, BOARD_LOGICAL_HEIGHT);
    bgGrad.addColorStop(0, '#050814');
    bgGrad.addColorStop(0.55, '#070b1a');
    bgGrad.addColorStop(1, '#04060f');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, BOARD_LOGICAL_WIDTH, BOARD_LOGICAL_HEIGHT);

    // Subtle danger zone pulse when stack is critical
    const maxHeight = snapshot.forecast.metrics.maxHeight;
    if (maxHeight >= 15 && snapshot.status === 'playing') {
      const pulse = 0.08 + 0.08 * Math.sin(this.pulseClockMs * 0.009);
      const dangerGrad = ctx.createLinearGradient(0, 0, 0, LOGICAL_CELL_SIZE * 4);
      dangerGrad.addColorStop(0, `rgba(251, 113, 133, ${pulse})`);
      dangerGrad.addColorStop(1, 'rgba(251, 113, 133, 0)');
      ctx.fillStyle = dangerGrad;
      ctx.fillRect(0, 0, BOARD_LOGICAL_WIDTH, LOGICAL_CELL_SIZE * 4);
    }

    // Crisp subtle cyber grid
    ctx.lineWidth = 1;
    for (let col = 1; col < BOARD_COLS; col += 1) {
      const x = col * LOGICAL_CELL_SIZE + 0.5;
      ctx.strokeStyle = col === 5 ? 'rgba(0, 245, 255, 0.09)' : 'rgba(148, 163, 184, 0.06)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BOARD_LOGICAL_HEIGHT);
      ctx.stroke();
    }
    for (let row = 1; row < BOARD_ROWS; row += 1) {
      const y = row * LOGICAL_CELL_SIZE + 0.5;
      ctx.strokeStyle = row % 4 === 0 ? 'rgba(0, 245, 255, 0.08)' : 'rgba(148, 163, 184, 0.055)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BOARD_LOGICAL_WIDTH, y);
      ctx.stroke();
    }

    // Locked blocks
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const cell = snapshot.grid[row][col];
        if (cell) {
          this.drawNeonBlock(
            ctx,
            col * LOGICAL_CELL_SIZE,
            row * LOGICAL_CELL_SIZE,
            LOGICAL_CELL_SIZE,
            PIECE_COLORS[cell],
            false,
          );
        }
      }
    }

    // Ghost drop projection
    if (snapshot.ghostPiece && snapshot.status !== 'gameover') {
      const ghostColor = PIECE_COLORS[snapshot.ghostPiece.type];
      const ghostCells = getPieceCells(snapshot.ghostPiece);
      for (const cell of ghostCells) {
        if (cell.y >= 0 && cell.y < BOARD_ROWS) {
          this.drawGhostBlock(
            ctx,
            cell.x * LOGICAL_CELL_SIZE,
            cell.y * LOGICAL_CELL_SIZE,
            LOGICAL_CELL_SIZE,
            ghostColor,
          );
        }
      }
    }

    // Active falling piece
    if (snapshot.activePiece) {
      const activeColor = PIECE_COLORS[snapshot.activePiece.type];
      const activeCells = getPieceCells(snapshot.activePiece);
      for (const cell of activeCells) {
        if (cell.y >= 0 && cell.y < BOARD_ROWS) {
          this.drawNeonBlock(
            ctx,
            cell.x * LOGICAL_CELL_SIZE,
            cell.y * LOGICAL_CELL_SIZE,
            LOGICAL_CELL_SIZE,
            activeColor,
            true,
          );
        }
      }
    }

    // Row clear laser flashes
    for (const flash of this.rowFlashes) {
      const progress = flash.lifeMs / flash.maxLifeMs;
      const alpha = Math.max(0, 1 - progress);
      const y = flash.row * LOGICAL_CELL_SIZE;
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.72})`;
      ctx.fillRect(0, y, BOARD_LOGICAL_WIDTH, LOGICAL_CELL_SIZE);
      ctx.fillStyle = hexToRgba(flash.color, alpha * 0.85);
      ctx.fillRect(0, y + LOGICAL_CELL_SIZE * 0.3, BOARD_LOGICAL_WIDTH, LOGICAL_CELL_SIZE * 0.4);
      ctx.restore();
    }

    // Spark particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // Floating score / combo callout
    for (const c of this.callouts) {
      const progress = c.lifeMs / c.maxLifeMs;
      const alpha = progress < 0.2 ? progress / 0.2 : Math.max(0, 1 - (progress - 0.2) / 0.8);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = '800 15px Orbitron, Inter, sans-serif';
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(c.text, c.x, c.y);
      if (c.subtext) {
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.fillStyle = c.color;
        ctx.fillText(c.subtext, c.x, c.y + 17);
      }
      ctx.restore();
    }
  }

  private renderHold(snapshot: TetrisSnapshot): void {
    if (!this.holdCanvas || !this.holdCtx) {
      return;
    }
    const w = 112;
    const h = 92;
    this.prepareContext(this.holdCanvas, this.holdCtx, w, h);
    const ctx = this.holdCtx;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060a17';
    ctx.fillRect(0, 0, w, h);

    if (!snapshot.holdPiece) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EMPTY', w / 2, h / 2);
      return;
    }

    ctx.save();
    if (snapshot.status === 'playing' && !snapshot.canHold) {
      ctx.globalAlpha = 0.42;
    }
    this.drawPreviewPiece(ctx, snapshot.holdPiece, w / 2, h / 2, 20);
    ctx.restore();
  }

  private renderNextQueue(snapshot: TetrisSnapshot): void {
    if (!this.nextCanvas || !this.nextCtx) {
      return;
    }
    const w = 112;
    const h = 264;
    this.prepareContext(this.nextCanvas, this.nextCtx, w, h);
    const ctx = this.nextCtx;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060a17';
    ctx.fillRect(0, 0, w, h);

    const slotHeight = h / 3;
    for (let i = 0; i < 3; i += 1) {
      const yTop = i * slotHeight;
      if (i > 0) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(12, yTop + 0.5);
        ctx.lineTo(w - 12, yTop + 0.5);
        ctx.stroke();
      }
      const pieceType = snapshot.nextQueue[i];
      if (pieceType) {
        this.drawPreviewPiece(ctx, pieceType, w / 2, yTop + slotHeight / 2, i === 0 ? 20 : 18);
      }
    }
  }

  private drawPreviewPiece(
    ctx: CanvasRenderingContext2D,
    type: TetrominoType,
    centerX: number,
    centerY: number,
    cellSize: number,
  ): void {
    const matrix = getPieceMatrix(type, 0);
    let minC = 4;
    let maxC = -1;
    let minR = 4;
    let maxR = -1;
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (matrix[r][c] === 1) {
          minC = Math.min(minC, c);
          maxC = Math.max(maxC, c);
          minR = Math.min(minR, r);
          maxR = Math.max(maxR, r);
        }
      }
    }

    const pieceWidth = (maxC - minC + 1) * cellSize;
    const pieceHeight = (maxR - minR + 1) * cellSize;
    const startX = centerX - pieceWidth / 2 - minC * cellSize;
    const startY = centerY - pieceHeight / 2 - minR * cellSize;
    const color = PIECE_COLORS[type];

    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (matrix[r][c] === 1) {
          this.drawNeonBlock(
            ctx,
            startX + c * cellSize,
            startY + r * cellSize,
            cellSize,
            color,
            true,
          );
        }
      }
    }
  }

  private drawGhostBlock(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
  ): void {
    const pad = 2;
    const bx = x + pad;
    const by = y + pad;
    const bs = size - pad * 2;

    ctx.save();
    ctx.fillStyle = hexToRgba(color, 0.08);
    ctx.fillRect(bx, by, bs, bs);
    ctx.strokeStyle = hexToRgba(color, 0.52);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    ctx.restore();
  }

  private drawNeonBlock(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    isActive: boolean,
  ): void {
    const pad = 1.5;
    const bx = x + pad;
    const by = y + pad;
    const bs = size - pad * 2;

    ctx.save();
    if (isActive) {
      ctx.shadowColor = hexToRgba(color, 0.65);
      ctx.shadowBlur = 10;
    }

    // Core block gradient
    const grad = ctx.createLinearGradient(bx, by, bx + bs, by + bs);
    grad.addColorStop(0, hexToRgba(color, 0.96));
    grad.addColorStop(1, hexToRgba(color, 0.62));
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bs, bs);

    ctx.shadowBlur = 0;

    // Inner top/left highlight bevel
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.fillRect(bx, by, bs, 2.5);
    ctx.fillRect(bx, by, 2.5, bs);

    // Inner bottom/right shadow bevel
    ctx.fillStyle = 'rgba(4, 7, 18, 0.48)';
    ctx.fillRect(bx, by + bs - 2.5, bs, 2.5);
    ctx.fillRect(bx + bs - 2.5, by, 2.5, bs);

    // Luminous inner facet
    const inset = Math.max(4, bs * 0.24);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(bx + inset, by + inset, bs - inset * 2, bs - inset * 2);

    // Outer neon border
    ctx.strokeStyle = isActive ? '#ffffff' : hexToRgba(color, 0.92);
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    ctx.restore();
  }
}
