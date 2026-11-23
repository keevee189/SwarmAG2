import { ArcadeAudio, initArcadeHeader } from './shared/arcade.js';

type GameKind = 'tetris' | 'tictactoe' | 'chess' | 'mahjong' | 'minesweeper' | 'game2048';

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
  private suppressHoverUntilMove = false;
  private lastPointerPos: { x: number; y: number } | null = null;
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

  private hasPointerMovedSinceLast(clientX: number, clientY: number, movementX = 0, movementY = 0): boolean {
    if (!this.lastPointerPos) {
      return movementX !== 0 || movementY !== 0;
    }
    return (
      Math.abs(clientX - this.lastPointerPos.x) > 0.5 ||
      Math.abs(clientY - this.lastPointerPos.y) > 0.5
    );
  }

  private bindCardEvents(): void {
    const onGlobalPointerDown = (ev: MouseEvent): void => {
      this.lastPointerPos = { x: ev.clientX, y: ev.clientY };
      this.suppressHoverUntilMove = false;
    };
    const onGlobalPointerMove = (ev: MouseEvent): void => {
      const moved = this.hasPointerMovedSinceLast(
        ev.clientX,
        ev.clientY,
        ev.movementX,
        ev.movementY,
      );
      if (!this.suppressHoverUntilMove || moved) {
        this.suppressHoverUntilMove = false;
        this.lastPointerPos = { x: ev.clientX, y: ev.clientY };
      }
    };
    window.addEventListener('pointerdown', onGlobalPointerDown, { capture: true });
    window.addEventListener('mousedown', onGlobalPointerDown, { capture: true });
    window.addEventListener('pointermove', onGlobalPointerMove, { capture: true });
    window.addEventListener('mousemove', onGlobalPointerMove, { capture: true });

    this.cards.forEach((card, idx) => {
      const handleEnter = (ev: MouseEvent, playAudio: boolean): void => {
        if (this.suppressHoverUntilMove) {
          if (!this.hasPointerMovedSinceLast(ev.clientX, ev.clientY)) {
            return;
          }
          this.suppressHoverUntilMove = false;
          this.lastPointerPos = { x: ev.clientX, y: ev.clientY };
        }
        const changed = this.hoveredIndex !== idx;
        this.hoveredIndex = idx;
        this.syncCardStates();
        if (playAudio && changed) {
          ArcadeAudio.playMove();
        }
      };

      const handleMove = (ev: MouseEvent): void => {
        if (this.suppressHoverUntilMove) {
          return;
        }
        if (this.hoveredIndex !== idx) {
          this.hoveredIndex = idx;
          this.syncCardStates();
        }
        this.updateTiltAndSpotlight(card, ev.clientX, ev.clientY);
      };

      card.addEventListener('pointerenter', (ev: PointerEvent) => handleEnter(ev, true));
      card.addEventListener('mouseenter', (ev: MouseEvent) => handleEnter(ev, false));
      card.addEventListener('pointermove', (ev: PointerEvent) => handleMove(ev));
      card.addEventListener('mousemove', (ev: MouseEvent) => handleMove(ev));

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

  private getGridColumnCount(): number {
    const grid = document.getElementById('game-grid');
    if (!grid) {
      return 1;
    }
    const raw = getComputedStyle(grid).gridTemplateColumns.trim();
    if (!raw || raw === 'none') {
      return 1;
    }
    return Math.max(1, raw.split(/\s+/).length);
  }

  private bindKeyboardNavigation(): void {
    window.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) {
        return;
      }

      if (ev.key >= '1' && ev.key <= '6') {
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
        this.suppressHoverUntilMove = true;
        this.hoveredIndex = null;
        this.focusedIndex = null;
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.cards.includes(active as HTMLAnchorElement)) {
          active.blur();
        }
        this.syncCardStates();
        return;
      }

      const key = ev.key;
      if (
        key === 'ArrowLeft' ||
        key === 'ArrowRight' ||
        key === 'ArrowUp' ||
        key === 'ArrowDown'
      ) {
        if (this.cards.length === 0) {
          return;
        }
        ev.preventDefault();
        const cols = this.getGridColumnCount();
        const arrowDeltas: Record<'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', number> = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -cols,
          ArrowDown: cols,
        };
        const activeElIdx =
          document.activeElement instanceof HTMLAnchorElement
            ? this.cards.indexOf(document.activeElement)
            : -1;
        const current =
          this.focusedIndex ?? this.hoveredIndex ?? (activeElIdx >= 0 ? activeElIdx : null);
        const nextIdx =
          current === null
            ? 0
            : (current + arrowDeltas[key] + this.cards.length) % this.cards.length;
        this.suppressHoverUntilMove = true;
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
    (['tetris', 'tictactoe', 'chess', 'mahjong', 'minesweeper', 'game2048'] as GameKind[]).forEach(
      (kind) => {
        this.renderCardPreview(kind, elapsedSec);
      },
    );
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
    } else if (kind === 'mahjong') {
      this.drawMahjongPreview(ctx, w, h, t);
    } else if (kind === 'minesweeper') {
      this.drawMinesweeperPreview(ctx, w, h, t);
    } else {
      this.draw2048Preview(ctx, w, h, t);
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

  private drawMinesweeperPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const dim = Math.min(w, h);
    const pad = dim * 0.095;
    const board = dim - pad * 2;
    const rows = 8;
    const cell = board / rows;
    const cx = pad + board * 0.5;
    const cy = pad + board * 0.5;

    // -1 = mine, 0 = safe blank, 1..3 = adjacent mine count
    const gridValues: number[][] = [
      [1, -1, 1, 0, 1, 1, 1, 0],
      [2, 3, 2, 0, 1, -1, 1, 0],
      [1, -1, 1, 0, 1, 1, 1, 0],
      [1, 1, 1, 0, 0, 1, 1, 1],
      [1, 1, 0, 0, 0, 1, -1, 1],
      [-1, 1, 0, 1, 1, 2, 1, 1],
      [1, 1, 0, 1, -1, 1, 1, 1],
      [0, 0, 0, 1, 1, 1, 1, -1],
    ];

    const numColors: Record<number, string> = {
      1: '#00f5ff',
      2: '#22c55e',
      3: '#fbbf24',
    };

    const cycle = t % 4.6;
    const waveRadius = Math.min(5.8, cycle * 2.1);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < rows; c += 1) {
        const x = pad + c * cell + 2;
        const y = pad + r * cell + 2;
        const size = cell - 4;
        const dist = Math.hypot(r - 3.5, c - 3.5);
        const val = gridValues[r][c];
        const revealed = dist <= waveRadius;

        if (revealed && val >= 0) {
          const frontier = Math.max(0, 1 - Math.abs(dist - waveRadius) / 0.9);
          ctx.fillStyle = `rgba(12, 26, 22, ${(0.72 + frontier * 0.22).toFixed(2)})`;
          ctx.strokeStyle = `rgba(34, 197, 94, ${(0.28 + frontier * 0.55).toFixed(2)})`;
          ctx.lineWidth = 1.5;
          ctx.fillRect(x, y, size, size);
          ctx.strokeRect(x, y, size, size);

          if (val > 0) {
            const color = numColors[val] ?? '#22c55e';
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10 + 4 * Math.sin(t * 4 + r + c);
            ctx.font = `900 ${Math.round(cell * 0.5)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(val), x + size / 2, y + size / 2 + 1);
            ctx.shadowBlur = 0;
          }
        } else {
          const breath = 0.14 + 0.08 * Math.sin(t * 2.6 + (r + c) * 0.45);
          ctx.fillStyle = `rgba(22, 35, 52, 0.85)`;
          ctx.strokeStyle = `rgba(34, 197, 94, ${breath.toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.fillRect(x, y, size, size);
          ctx.strokeRect(x, y, size, size);

          if (val === -1 && dist <= waveRadius + 0.6) {
            // Neon triangular radar flag on detected mine
            const fx = x + size * 0.36;
            const fy = y + size * 0.24;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx, y + size * 0.78);
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 12 + 5 * Math.sin(t * 6);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(x + size * 0.76, fy + size * 0.17);
            ctx.lineTo(fx, fy + size * 0.34);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }
    }

    // Expanding sonar ring + rotating radar scan sweep
    const ringProgress = (t * 0.55) % 1;
    const ringRadius = Math.max(8, ringProgress * board * 0.56);
    ctx.strokeStyle = `rgba(34, 197, 94, ${((1 - ringProgress) * 0.55).toFixed(3)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    const scanAngle = t * 1.9;
    const sweepEndX = cx + Math.cos(scanAngle) * (board * 0.48);
    const sweepEndY = cy + Math.sin(scanAngle) * (board * 0.48);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sweepEndX, sweepEndY);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private fillStrokeRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private draw2048Preview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const dim = Math.min(w, h);
    const pad = dim * 0.1;
    const board = dim - pad * 2;
    const gap = board * 0.048;
    const tileSize = (board - gap * 5) / 4;

    // Outer frame & 4x4 recessed grid slots
    ctx.fillStyle = 'rgba(15, 22, 42, 0.72)';
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.28)';
    ctx.lineWidth = 2;
    this.fillStrokeRoundRect(ctx, pad, pad, board, board, 18);

    const cellPos = (row: number, col: number): { x: number; y: number } => ({
      x: pad + gap + col * (tileSize + gap),
      y: pad + gap + row * (tileSize + gap),
    });

    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        const pos = cellPos(r, c);
        ctx.fillStyle = 'rgba(6, 10, 22, 0.72)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.lineWidth = 1.5;
        this.fillStrokeRoundRect(ctx, pos.x, pos.y, tileSize, tileSize, 10);
      }
    }

    const tilePalette: Record<number, { fill: string; stroke: string; text: string }> = {
      2: { fill: 'rgba(251, 146, 60, 0.18)', stroke: '#fdba74', text: '#ffedd5' },
      4: { fill: 'rgba(249, 115, 22, 0.24)', stroke: '#fb923c', text: '#fed7aa' },
      8: { fill: 'rgba(251, 113, 133, 0.26)', stroke: '#fb7185', text: '#ffe4e6' },
      16: { fill: 'rgba(244, 63, 94, 0.30)', stroke: '#f43f5e', text: '#fecdd3' },
      128: { fill: 'rgba(249, 115, 22, 0.34)', stroke: '#f97316', text: '#fff7ed' },
      256: { fill: 'rgba(234, 88, 12, 0.36)', stroke: '#fb923c', text: '#fef3c7' },
      512: { fill: 'rgba(251, 113, 133, 0.36)', stroke: '#fb7185', text: '#fff1f2' },
      1024: { fill: 'rgba(245, 158, 11, 0.36)', stroke: '#f59e0b', text: '#fef9c3' },
      2048: { fill: 'rgba(251, 191, 36, 0.40)', stroke: '#fbbf24', text: '#fef08a' },
    };

    const renderTile = (row: number, col: number, value: number, scale = 1): void => {
      const base = cellPos(row, col);
      const pal = tilePalette[value] ?? tilePalette[2048];
      const scaled = tileSize * scale;
      const dx = base.x + (tileSize - scaled) / 2;
      const dy = base.y + (tileSize - scaled) / 2;

      ctx.fillStyle = pal.fill;
      ctx.strokeStyle = pal.stroke;
      ctx.shadowColor = pal.stroke;
      ctx.shadowBlur = 12 + 5 * Math.sin(t * 3.8 + row + col);
      ctx.lineWidth = 2.5;
      this.fillStrokeRoundRect(ctx, dx, dy, scaled, scaled, 10);

      ctx.shadowBlur = 0;
      ctx.fillStyle = pal.text;
      const fontRatio = value >= 1024 ? 0.27 : value >= 128 ? 0.33 : 0.42;
      ctx.font = `900 ${Math.round(tileSize * fontRatio)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), dx + scaled / 2, dy + scaled / 2 + 1);
    };

    const drawShockwave = (row: number, col: number, progress: number, color: string): void => {
      if (progress <= 0 || progress >= 1) {
        return;
      }
      const pos = cellPos(row, col);
      const cx = pos.x + tileSize / 2;
      const cy = pos.y + tileSize / 2;
      const radius = tileSize * (0.45 + progress * 0.72);
      ctx.strokeStyle = color;
      ctx.globalAlpha = (1 - progress) * 0.85;
      ctx.lineWidth = 3.5 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Static anchor high-value tiles with subtle glow breathing
    renderTile(0, 0, 2048, 1 + 0.02 * Math.sin(t * 3.2));
    renderTile(0, 1, 512);
    renderTile(0, 2, 128);
    renderTile(1, 0, 256);

    // 4-beat cascading merge animation: 2+2->4, 4+4->8, 8+8->16, 1024+1024->2048
    const cycle = t % 4.8;
    const phase = Math.floor(cycle / 1.2);
    const localT = (cycle % 1.2) / 1.2;
    const moveProg = Math.min(1, localT / 0.52);
    const easedMove = 1 - Math.pow(1 - moveProg, 3);
    const mergeProg = localT >= 0.52 ? (localT - 0.52) / 0.48 : 0;
    const mergePop = mergeProg > 0 ? 1 + 0.14 * Math.sin(mergeProg * Math.PI) : 1;

    if (phase === 0) {
      if (localT < 0.52) {
        renderTile(3, 0, 2);
        renderTile(3, 2 - 2 * easedMove, 2);
      } else {
        renderTile(3, 0, 4, mergePop);
        drawShockwave(3, 0, mergeProg, '#fb923c');
      }
      renderTile(2, 0, 8);
      renderTile(0, 3, 1024);
    } else if (phase === 1) {
      if (localT < 0.52) {
        renderTile(3, 0, 4);
        renderTile(3, 3 - 3 * easedMove, 4);
      } else {
        renderTile(3, 0, 8, mergePop);
        drawShockwave(3, 0, mergeProg, '#fb7185');
      }
      renderTile(2, 0, 8);
      renderTile(0, 3, 1024);
    } else if (phase === 2) {
      if (localT < 0.52) {
        renderTile(2, 0, 8);
        renderTile(3 - easedMove, 0, 8);
      } else {
        renderTile(2, 0, 16, mergePop);
        drawShockwave(2, 0, mergeProg, '#f43f5e');
      }
      renderTile(0, 3, 1024);
    } else {
      renderTile(2, 0, 16);
      if (localT < 0.52) {
        renderTile(0, 3, 1024);
        renderTile(2 - 2 * easedMove, 3, 1024);
      } else {
        renderTile(0, 3, 2048, mergePop);
        drawShockwave(0, 3, mergeProg, '#fbbf24');
        drawShockwave(0, 3, Math.max(0, mergeProg - 0.18), '#f97316');
      }
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
