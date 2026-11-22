import { ArcadeAudio, initArcadeHeader } from './shared/arcade.js';

type GameKind = 'tetris' | 'tictactoe' | 'chess' | 'mahjong';

interface BackdropStar {
  x: number;
  y: number;
  r: number;
  speed: number;
  alpha: number;
  hue: string;
}

class LandingHubController {
  private readonly cards: HTMLAnchorElement[];
  private readonly canvases: Map<GameKind, HTMLCanvasElement> = new Map();
  private hoveredIndex: number | null = null;
  private focusedIndex: number | null = null;
  private rafId: number | null = null;
  private startTs = performance.now();

  private readonly backdropCanvas: HTMLCanvasElement | null;
  private backdropStars: BackdropStar[] = [];

  constructor() {
    this.cards = Array.from(document.querySelectorAll<HTMLAnchorElement>('.game-card'));
    this.backdropCanvas = document.getElementById('arcade-backdrop') as HTMLCanvasElement | null;

    this.cards.forEach((card) => {
      const kind = card.dataset.game as GameKind | undefined;
      const canvas = card.querySelector<HTMLCanvasElement>('.card-preview-canvas');
      if (kind && canvas) {
        this.canvases.set(kind, canvas);
      }
    });
  }

  public init(): void {
    initArcadeHeader();
    this.setupBackdrop();
    this.bindCardEvents();
    this.bindKeyboardNavigation();
    this.syncCardStates();
    this.renderPreviews(0);
    this.startLoop();
  }

  private getActiveIndex(): number | null {
    return this.hoveredIndex ?? this.focusedIndex;
  }

  private syncCardStates(): void {
    const activeIdx = this.getActiveIndex();
    this.cards.forEach((card, idx) => {
      const isActive = activeIdx === idx;
      const isDimmed = activeIdx !== null && activeIdx !== idx;
      card.setAttribute('data-active', String(isActive));
      card.setAttribute('data-dimmed', String(isDimmed));
      if (!isActive) {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      }
    });
  }

  private bindCardEvents(): void {
    this.cards.forEach((card, idx) => {
      card.addEventListener('pointerenter', () => {
        this.hoveredIndex = idx;
        this.syncCardStates();
        ArcadeAudio.playMove();
      });

      card.addEventListener('mouseenter', () => {
        if (this.hoveredIndex !== idx) {
          this.hoveredIndex = idx;
          this.syncCardStates();
        }
      });

      card.addEventListener('pointermove', (ev: PointerEvent) => {
        this.updateTiltAndSpotlight(card, ev.clientX, ev.clientY);
      });

      card.addEventListener('mousemove', (ev: MouseEvent) => {
        this.updateTiltAndSpotlight(card, ev.clientX, ev.clientY);
      });

      card.addEventListener('pointerleave', () => {
        if (this.hoveredIndex === idx) {
          this.hoveredIndex = null;
          this.syncCardStates();
        }
      });

      card.addEventListener('mouseleave', () => {
        if (this.hoveredIndex === idx) {
          this.hoveredIndex = null;
          this.syncCardStates();
        }
      });

      card.addEventListener('focus', () => {
        this.focusedIndex = idx;
        this.syncCardStates();
      });

      card.addEventListener('blur', () => {
        if (this.focusedIndex === idx) {
          this.focusedIndex = null;
          this.syncCardStates();
        }
      });

      card.addEventListener('click', () => {
        ArcadeAudio.playClick();
      });
    });
  }

  private updateTiltAndSpotlight(card: HTMLAnchorElement, clientX: number, clientY: number): void {
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const nx = (clientX - rect.left) / rect.width - 0.5;
    const ny = (clientY - rect.top) / rect.height - 0.5;
    const tiltX = (-ny * 9).toFixed(2);
    const tiltY = (nx * 9).toFixed(2);
    const spotX = ((nx + 0.5) * 100).toFixed(1);
    const spotY = ((ny + 0.5) * 100).toFixed(1);
    card.style.setProperty('--tilt-x', `${tiltX}deg`);
    card.style.setProperty('--tilt-y', `${tiltY}deg`);
    card.style.setProperty('--spot-x', `${spotX}%`);
    card.style.setProperty('--spot-y', `${spotY}%`);
  }

  private bindKeyboardNavigation(): void {
    window.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) {
        return;
      }

      if (ev.key >= '1' && ev.key <= '4') {
        const target = this.cards[Number(ev.key) - 1];
        if (target) {
          ev.preventDefault();
          ArcadeAudio.playClick();
          target.focus();
          window.location.href = target.href;
        }
        return;
      }

      if (ev.key === 'Escape') {
        this.hoveredIndex = null;
        this.focusedIndex = null;
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.cards.includes(active as HTMLAnchorElement)) {
          active.blur();
        }
        this.syncCardStates();
        return;
      }

      const arrowDeltas: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -2,
        ArrowDown: 2,
      };
      if (ev.key in arrowDeltas) {
        ev.preventDefault();
        const current = this.focusedIndex ?? this.hoveredIndex;
        const nextIdx =
          current === null
            ? 0
            : (current + arrowDeltas[ev.key] + this.cards.length) % this.cards.length;
        this.hoveredIndex = null;
        this.focusedIndex = nextIdx;
        this.cards[nextIdx]?.focus();
        this.syncCardStates();
        ArcadeAudio.playMove();
        return;
      }

      if (ev.key === ' ' || ev.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLAnchorElement && this.cards.includes(activeEl)) {
          if (ev.key === ' ') {
            ev.preventDefault();
            ArcadeAudio.playClick();
            window.location.href = activeEl.href;
          }
        }
      }
    });
  }

  private setupBackdrop(): void {
    if (!this.backdropCanvas) {
      return;
    }
    const resize = (): void => {
      if (!this.backdropCanvas) {
        return;
      }
      this.backdropCanvas.width = window.innerWidth;
      this.backdropCanvas.height = window.innerHeight;
      const palette = ['#00f5ff', '#ff2bd6', '#8b5cf6', '#e2e8f0'];
      const count = 64;
      this.backdropStars = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 0.9 + (i % 3) * 0.65,
        speed: 8 + (i % 5) * 6,
        alpha: 0.2 + (i % 4) * 0.16,
        hue: palette[i % palette.length],
      }));
    };
    resize();
    window.addEventListener('resize', resize);
  }

  private startLoop(): void {
    const tick = (now: number): void => {
      const elapsedSec = (now - this.startTs) / 1000;
      this.renderBackdrop(elapsedSec);
      const activeIdx = this.getActiveIndex();
      if (activeIdx !== null) {
        const card = this.cards[activeIdx];
        const kind = card?.dataset.game as GameKind | undefined;
        if (kind) {
          this.renderCardPreview(kind, elapsedSec);
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private renderPreviews(elapsedSec: number): void {
    (['tetris', 'tictactoe', 'chess', 'mahjong'] as GameKind[]).forEach((kind) => {
      this.renderCardPreview(kind, elapsedSec);
    });
  }

  private renderBackdrop(t: number): void {
    const canvas = this.backdropCanvas;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Subtle moving starfield
    for (const star of this.backdropStars) {
      const y = (star.y + t * star.speed) % height;
      const pulse = 0.7 + 0.3 * Math.sin(t * 1.8 + star.x * 0.02);
      ctx.globalAlpha = star.alpha * pulse;
      ctx.fillStyle = star.hue;
      ctx.beginPath();
      ctx.arc(star.x, y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle synthwave horizon grid at bottom 24%
    ctx.globalAlpha = 0.16;
    const horizonY = height * 0.78;
    const vanishX = width * 0.5;
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(vanishX + i * 32, horizonY);
      ctx.lineTo(vanishX + i * 190, height);
      ctx.stroke();
    }
    const scroll = (t * 26) % 36;
    for (let row = 0; row < 6; row += 1) {
      const frac = ((row * 36 + scroll) / 216) ** 1.65;
      const y = horizonY + frac * (height - horizonY);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private renderCardPreview(kind: GameKind, t: number): void {
    const canvas = this.canvases.get(kind);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (kind === 'tetris') {
      this.drawTetrisPreview(ctx, w, h, t);
    } else if (kind === 'tictactoe') {
      this.drawTicTacToePreview(ctx, w, h, t);
    } else if (kind === 'chess') {
      this.drawChessPreview(ctx, w, h, t);
    } else {
      this.drawMahjongPreview(ctx, w, h, t);
    }
  }

  private drawTetrisPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cols = 10;
    const cell = w / cols;
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, h);
      ctx.stroke();
    }
    for (let y = 0; y <= cols; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell);
      ctx.lineTo(w, y * cell);
      ctx.stroke();
    }

    const shapes: Array<{ blocks: Array<[number, number]>; color: string; xBase: number; speed: number; offset: number }> = [
      { blocks: [[0, 0], [1, 0], [2, 0], [1, 1]], color: '#8b5cf6', xBase: 1, speed: 78, offset: 0 },
      { blocks: [[0, 0], [0, 1], [0, 2], [0, 3]], color: '#00f5ff', xBase: 6, speed: 96, offset: 140 },
      { blocks: [[0, 0], [1, 0], [1, 1], [2, 1]], color: '#ff2bd6', xBase: 3, speed: 68, offset: 290 },
      { blocks: [[0, 0], [1, 0], [0, 1], [1, 1]], color: '#fbbf24', xBase: 7, speed: 84, offset: 410 },
    ];

    for (const piece of shapes) {
      const yBase = ((t * piece.speed + piece.offset) % (h + 180)) - 120;
      ctx.fillStyle = piece.color;
      ctx.shadowColor = piece.color;
      ctx.shadowBlur = 16;
      for (const [bx, by] of piece.blocks) {
        const px = (piece.xBase + bx) * cell + 4;
        const py = yBase + by * cell + 4;
        ctx.fillRect(px, py, cell - 8, cell - 8);
      }
    }
    ctx.shadowBlur = 0;

    // Periodic neon line-clear beam
    const flash = Math.max(0, Math.sin(t * 2.6));
    if (flash > 0.72) {
      ctx.fillStyle = `rgba(0, 245, 255, ${(flash - 0.72) * 1.4})`;
      ctx.fillRect(0, h - cell * 2, w, cell);
    }
  }

  private drawTicTacToePreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const dim = Math.min(w, h);
    const pad = dim * 0.13;
    const size = dim - pad * 2;
    const step = size / 3;

    const gridAlpha = 0.28 + 0.16 * Math.sin(t * 3.1);
    ctx.strokeStyle = `rgba(255, 43, 214, ${gridAlpha.toFixed(3)})`;
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 8 + 4 * Math.sin(t * 2.4);
    for (let i = 1; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(pad + i * step, pad);
      ctx.lineTo(pad + i * step, pad + size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pad, pad + i * step);
      ctx.lineTo(pad + size, pad + i * step);
      ctx.stroke();
    }

    // Subtle moving target reticle inside the grid so every frame stays alive
    const cycle = t % 4.5;
    const scanX = pad + (0.5 + 0.35 * Math.sin(t * 2.1)) * size;
    const scanY = pad + (0.5 + 0.35 * Math.cos(t * 1.7)) * size;
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.22)';
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(scanX, scanY, step * 0.22, 0, Math.PI * 2);
    ctx.stroke();

    const moves: Array<{ r: number; c: number; mark: 'X' | 'O'; at: number }> = [
      { r: 1, c: 1, mark: 'X', at: 0.2 },
      { r: 0, c: 2, mark: 'O', at: 0.7 },
      { r: 0, c: 0, mark: 'X', at: 1.2 },
      { r: 2, c: 0, mark: 'O', at: 1.7 },
      { r: 2, c: 2, mark: 'X', at: 2.2 },
    ];

    for (const m of moves) {
      if (cycle < m.at) {
        continue;
      }
      const drawProg = Math.min(1, (cycle - m.at) / 0.28);
      const cx = pad + m.c * step + step / 2;
      const cy = pad + m.r * step + step / 2;
      const rad = step * 0.27;
      const glowPulse = 14 + 7 * Math.sin(t * 5.2 + m.at * 3.1);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      if (m.mark === 'X') {
        ctx.strokeStyle = '#00f5ff';
        ctx.shadowColor = '#00f5ff';
        ctx.shadowBlur = glowPulse;
        const p1 = Math.min(1, drawProg * 2);
        ctx.beginPath();
        ctx.moveTo(cx - rad, cy - rad);
        ctx.lineTo(cx - rad + rad * 2 * p1, cy - rad + rad * 2 * p1);
        ctx.stroke();
        if (drawProg > 0.5) {
          const p2 = (drawProg - 0.5) * 2;
          ctx.beginPath();
          ctx.moveTo(cx + rad, cy - rad);
          ctx.lineTo(cx + rad - rad * 2 * p2, cy - rad + rad * 2 * p2);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#ff2bd6';
        ctx.shadowColor = '#ff2bd6';
        ctx.shadowBlur = glowPulse;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * drawProg);
        ctx.stroke();
      }
    }

    if (cycle > 2.6) {
      const progress = Math.min(1, (cycle - 2.6) / 0.45);
      const pulse = 0.5 + 0.5 * Math.sin(t * 14);
      const x1 = pad + step * 0.4;
      const y1 = pad + step * 0.4;
      const x2 = pad + step * 2.6;
      const y2 = pad + step * 2.6;
      const tipX = x1 + (x2 - x1) * progress;
      const tipY = y1 + (y2 - y1) * progress;

      // Outer pulsing laser aura + bright core
      ctx.strokeStyle = `rgba(251, 191, 36, ${(0.32 + 0.38 * pulse).toFixed(3)})`;
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 22 + 16 * pulse;
      ctx.lineWidth = 11 + 4 * pulse;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 4.5 + 1.5 * pulse;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private drawChessPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const dim = Math.min(w, h);
    const pad = dim * 0.085;
    const board = dim - pad * 2;
    const sq = board / 8;

    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const dark = (r + c) % 2 === 1;
        ctx.fillStyle = dark ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(pad + c * sq, pad + r * sq, sq, sq);
      }
    }

    // Tactical ray sweep
    const sweepX = pad + ((Math.sin(t * 1.4) * 0.5 + 0.5) * 6 + 1) * sq;
    const sweepY = pad + ((Math.cos(t * 1.1) * 0.5 + 0.5) * 6 + 1) * sq;
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sweepX, pad);
    ctx.lineTo(sweepX, pad + board);
    ctx.moveTo(pad, sweepY);
    ctx.lineTo(pad + board, sweepY);
    ctx.stroke();

    // Animated knight & queen markers
    const gx = pad + (3.5 + Math.sin(t * 1.6) * 2) * sq;
    const gy = pad + (3.5 + Math.cos(t * 1.2) * 1.5) * sq;
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 20;
    ctx.font = `bold ${Math.round(sq * 0.72)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♕', gx, gy);

    ctx.fillStyle = '#00f5ff';
    ctx.shadowColor = '#00f5ff';
    ctx.fillText('♘', sweepX, sweepY);
    ctx.shadowBlur = 0;
  }

  private drawMahjongPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const sx = w / 520;
    const sy = h / 520;
    const tiles = [
      { x: 115 * sx, y: 120 * sy, sym: '發', color: '#10b981', phase: 0 },
      { x: 205 * sx, y: 120 * sy, sym: '中', color: '#fb7185', phase: 1.1 },
      { x: 295 * sx, y: 120 * sy, sym: '發', color: '#10b981', phase: 2.2 },
      { x: 160 * sx, y: 225 * sy, sym: '東', color: '#00f5ff', phase: 3.1 },
      { x: 255 * sx, y: 225 * sy, sym: '東', color: '#00f5ff', phase: 4.0 },
      { x: 205 * sx, y: 315 * sy, sym: '萬', color: '#fbbf24', phase: 5.0 },
    ];

    const tw = 76 * sx;
    const th = 98 * sy;
    const pairAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 2.2));
    ctx.strokeStyle = `rgba(16, 185, 129, ${pairAlpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(153 * sx, 170 * sy);
    ctx.lineTo(333 * sx, 170 * sy);
    ctx.stroke();

    for (const tile of tiles) {
      const floatY = Math.sin(t * 2 + tile.phase) * 6;
      const tx = tile.x;
      const ty = tile.y + floatY;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
      ctx.fillRect(tx + 6, ty + 8, tw, th);

      ctx.fillStyle = 'rgba(14, 22, 40, 0.92)';
      ctx.strokeStyle = tile.color;
      ctx.shadowColor = tile.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5;
      ctx.fillRect(tx, ty, tw, th);
      ctx.strokeRect(tx, ty, tw, th);

      ctx.shadowBlur = 0;
      ctx.fillStyle = tile.color;
      ctx.font = `bold ${Math.round(34 * Math.min(sx, sy))}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.sym, tx + tw / 2, ty + th / 2);
    }
    ctx.shadowBlur = 0;
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

const hub = new LandingHubController();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => hub.init());
} else {
  hub.init();
}
