import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createAppServer, MIME_TYPES, resolveDefaultRootDir } from '../ts/server.js';
import {
  ArcadeAudio,
  ArcadeAudioEngine,
  clamp,
  formatTime,
  initArcadeHeader,
} from '../ts/shared/arcade.js';
import { withBrowserPage } from './helpers/cdp.js';

interface HttpResponseResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface CardSnapshot {
  game: string;
  href: string;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
  radiusTL: number;
  radiusTR: number;
  radiusBL: number;
  radiusBR: number;
  active: string | null;
  dimmed: string | null;
  nameText: string;
  subtitleText: string;
  playBadgeText: string;
  svgWidth: number;
  svgHeight: number;
  hudOpacity: number;
  canvasOpacity: number;
  laserOpacity: number;
}

interface ActiveCardFitSnapshot {
  states: Array<{ active: string | null; dimmed: string | null; opacity: number }>;
  canvasOpacity: number;
  laserOpacity: number;
  spotlightOpacity: number;
  tiltX: string;
  tiltY: string;
  spotX: string;
  spotY: string;
  scrollFits: boolean;
  topFits: boolean;
  badgeBottom: number;
  hudBottom: number;
  cardBottom: number;
  topBarBottom: number;
  centerTop: number;
  centerBottom: number;
  hudTop: number;
  frame1: string;
}

const EXPECTED_GAMES = ['tetris', 'tictactoe', 'chess', 'mahjong', 'minesweeper', 'game2048'] as const;

const EXPECTED_HREFS = [
  'games/tetris.html',
  'games/tictactoe.html',
  'games/chess.html',
  'games/mahjong.html',
  'games/minesweeper.html',
  'games/game2048.html',
] as const;

const EXPECTED_NAMES = ['TETRIS', 'TIC-TAC-TOE', 'CHESS', 'MAHJONG', 'MINESWEEPER', '2048'] as const;

const EXPECTED_SUBTITLES = [
  'TETROMINO OVERDRIVE',
  'NEURAL GRID DUEL',
  'GRANDMASTER PROTOCOL',
  'IMPERIAL TILE DYNASTY',
  'QUANTUM MINESWEEPER',
  'HYPER 2048',
] as const;

function sendHttpRequest(
  port: number,
  reqPath: string,
  method = 'GET',
): Promise<HttpResponseResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function startEphemeralServer(rootDir: string): Promise<{
  server: http.Server;
  port: number;
  baseUrl: string;
}> {
  const server = createAppServer(rootDir);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object', 'Expected ephemeral TCP address');
  return {
    server,
    port: addr.port,
    baseUrl: `http://127.0.0.1:${addr.port}/`,
  };
}

async function stopServer(server: http.Server | undefined): Promise<void> {
  if (!server) {
    return;
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

const READ_CARDS_EXPR = `Array.from(document.querySelectorAll('.game-card')).map((card) => {
  const r = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const svg = card.querySelector('.card-icon svg');
  const svgR = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
  const hud = card.querySelector('.card-active-hud');
  const canvas = card.querySelector('.card-preview-canvas');
  const laser = card.querySelector('.card-laser-border');
  return {
    game: card.getAttribute('data-game') ?? '',
    href: card.getAttribute('href') ?? '',
    width: r.width,
    height: r.height,
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    radiusTL: parseFloat(cs.borderTopLeftRadius),
    radiusTR: parseFloat(cs.borderTopRightRadius),
    radiusBL: parseFloat(cs.borderBottomLeftRadius),
    radiusBR: parseFloat(cs.borderBottomRightRadius),
    active: card.getAttribute('data-active'),
    dimmed: card.getAttribute('data-dimmed'),
    nameText: (card.querySelector('.card-name')?.textContent ?? '').trim(),
    subtitleText: (card.querySelector('.card-subtitle')?.textContent ?? '').trim(),
    playBadgeText: (card.querySelector('.card-play-badge')?.textContent ?? '').trim(),
    svgWidth: svgR.width,
    svgHeight: svgR.height,
    hudOpacity: hud ? parseFloat(getComputedStyle(hud).opacity) : -1,
    canvasOpacity: canvas ? parseFloat(getComputedStyle(canvas).opacity) : -1,
    laserOpacity: laser ? parseFloat(getComputedStyle(laser).opacity) : -1,
  };
})`;

function buildActiveSnapshotExpr(idx: number): string {
  return `(() => {
    const all = Array.from(document.querySelectorAll('.game-card'));
    const cur = all[${idx}];
    const inner = cur.querySelector('.card-inner');
    const cr = cur.getBoundingClientRect();
    const topBar = cur.querySelector('.card-top-bar').getBoundingClientRect();
    const center = cur.querySelector('.card-center').getBoundingClientRect();
    const hud = cur.querySelector('.card-active-hud').getBoundingClientRect();
    const badge = cur.querySelector('.card-play-badge').getBoundingClientRect();
    const canvas = cur.querySelector('.card-preview-canvas');
    return {
      states: all.map((el) => ({
        active: el.getAttribute('data-active'),
        dimmed: el.getAttribute('data-dimmed'),
        opacity: parseFloat(getComputedStyle(el).opacity),
      })),
      canvasOpacity: parseFloat(getComputedStyle(canvas).opacity),
      laserOpacity: parseFloat(getComputedStyle(cur.querySelector('.card-laser-border')).opacity),
      spotlightOpacity: parseFloat(getComputedStyle(cur.querySelector('.card-spotlight')).opacity),
      tiltX: cur.style.getPropertyValue('--tilt-x'),
      tiltY: cur.style.getPropertyValue('--tilt-y'),
      spotX: cur.style.getPropertyValue('--spot-x'),
      spotY: cur.style.getPropertyValue('--spot-y'),
      scrollFits: inner.scrollHeight <= inner.clientHeight + 1,
      topFits: topBar.top >= cr.top - 1,
      badgeBottom: badge.bottom,
      hudBottom: hud.bottom,
      cardBottom: cr.bottom,
      topBarBottom: topBar.bottom,
      centerTop: center.top,
      centerBottom: center.bottom,
      hudTop: hud.top,
      frame1: canvas.toDataURL(),
    };
  })()`;
}

function assert3x2DesktopGrid(cards: CardSnapshot[], label: string): void {
  assert.equal(cards.length, 6);
  // Row 0: cards 0, 1, 2
  assert.ok(Math.abs(cards[0].top - cards[1].top) <= 4, `${label}: row 0 top misaligned (0 vs 1)`);
  assert.ok(Math.abs(cards[1].top - cards[2].top) <= 4, `${label}: row 0 top misaligned (1 vs 2)`);
  assert.ok(cards[1].left >= cards[0].right - 1, `${label}: col 0/1 overlap on row 0`);
  assert.ok(cards[2].left >= cards[1].right - 1, `${label}: col 1/2 overlap on row 0`);

  // Row 1: cards 3, 4, 5
  assert.ok(Math.abs(cards[3].top - cards[4].top) <= 4, `${label}: row 1 top misaligned (3 vs 4)`);
  assert.ok(Math.abs(cards[4].top - cards[5].top) <= 4, `${label}: row 1 top misaligned (4 vs 5)`);
  assert.ok(cards[4].left >= cards[3].right - 1, `${label}: col 0/1 overlap on row 1`);
  assert.ok(cards[5].left >= cards[4].right - 1, `${label}: col 1/2 overlap on row 1`);

  // Row separation & column alignment
  assert.ok(cards[3].top >= cards[0].bottom - 1, `${label}: row 1 overlaps row 0 (col 0)`);
  assert.ok(cards[4].top >= cards[1].bottom - 1, `${label}: row 1 overlaps row 0 (col 1)`);
  assert.ok(cards[5].top >= cards[2].bottom - 1, `${label}: row 1 overlaps row 0 (col 2)`);
  assert.ok(Math.abs(cards[0].left - cards[3].left) <= 4, `${label}: col 0 misaligned`);
  assert.ok(Math.abs(cards[1].left - cards[4].left) <= 4, `${label}: col 1 misaligned`);
  assert.ok(Math.abs(cards[2].left - cards[5].left) <= 4, `${label}: col 2 misaligned`);
}

describe('QA: Project Docs & Requirements Audit', () => {
  const rootDir = resolveDefaultRootDir();

  it('resolveDefaultRootDir locates the workspace root cleanly even from compiled test dirs', () => {
    assert.ok(fs.existsSync(path.join(rootDir, 'package.json')));
    assert.ok(fs.existsSync(path.join(rootDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(rootDir, 'ts', 'server.ts')));
  });

  it('README.md provides plain-English overview, build/start/stop commands, URLs, and all 6 game shortcuts', () => {
    const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    const lines = readme
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    assert.ok(lines[0]?.startsWith('# NEXUS ARCADE'));
    assert.ok(lines[1] && !lines[1].startsWith('#') && !lines[1].startsWith('```'));
    assert.match(lines[1], /Tetris/i);
    assert.match(lines[1], /Tic-Tac-Toe/i);
    assert.match(lines[1], /Chess/i);
    assert.match(lines[1], /Mahjong/i);
    assert.match(lines[1], /Minesweeper/i);
    assert.match(lines[1], /2048/i);

    for (const requiredCmd of [
      'npm install',
      'npm run typecheck',
      'npm run build',
      'npm run test:compile',
      'npm test',
      'npm start',
      'npm run start:bg',
      'npm run stop',
      'http://localhost:4173',
      'http://localhost:4173/games/tetris.html',
      'http://localhost:4173/games/tictactoe.html',
      'http://localhost:4173/games/chess.html',
      'http://localhost:4173/games/mahjong.html',
      'http://localhost:4173/games/minesweeper.html',
      'http://localhost:4173/games/game2048.html',
    ]) {
      assert.ok(readme.includes(requiredCmd), `README.md missing "${requiredCmd}"`);
    }

    for (const sectionToken of [
      'Landing Hub',
      '`1`–`6`',
      'Tetris',
      'Tic-Tac-Toe',
      'Chess',
      'Mahjong Solitaire',
      'Minesweeper',
      'QUANTUM MINESWEEPER',
      '2048',
      'HYPER 2048',
      'Hard Drop',
      'Hold Piece',
      'Promotion',
      'Shuffle',
      '#flag-mode-btn',
      '#difficulty-control',
      'Mines Left',
      'Safe Left',
      '#forecast-label',
      'Chord',
      '#continue-btn',
      '#mode-control',
      '#btn-up',
      '#hint-direction-badge',
      'Best Tile',
      'Merge Streak',
      'Expectimax',
    ]) {
      assert.ok(readme.includes(sectionToken), `README.md missing "${sectionToken}"`);
    }
  });

  it('REQUIREMENTS.md documents 3x2 hub layout, active/inactive modes, all 6 games, and test coverage', () => {
    const reqs = fs.readFileSync(path.join(rootDir, 'REQUIREMENTS.md'), 'utf8');
    for (const expected of [
      '6 CABINETS ONLINE',
      '80% of the viewport width',
      'repeat(3, 1fr)',
      'repeat(2, 1fr)',
      'aspect-ratio: 1 / 1',
      'border-radius: 26px',
      'games/tetris.html',
      'games/tictactoe.html',
      'games/chess.html',
      'games/mahjong.html',
      'games/minesweeper.html',
      'games/game2048.html',
      'TETROMINO OVERDRIVE',
      'NEURAL GRID DUEL',
      'GRANDMASTER PROTOCOL',
      'IMPERIAL TILE DYNASTY',
      'QUANTUM MINESWEEPER',
      'HYPER 2048',
      'data-active="true"',
      'data-dimmed="true"',
      '1440×900',
      '1024×768',
      '#mine-board',
      '#mines-left-value',
      '#safe-left-value',
      '#grid-2048',
      '#best-tile-value',
      '#merge-streak-value',
      'tests/minesweeper.test.ts',
      'tests/game2048.test.ts',
    ]) {
      assert.ok(reqs.includes(expected), `REQUIREMENTS.md missing "${expected}"`);
    }
  });
});

describe('QA: Shared Utilities & Server Adversarial Checks', () => {
  const rootDir = resolveDefaultRootDir();
  let server: http.Server;
  let port = 0;

  before(async () => {
    const started = await startEphemeralServer(rootDir);
    server = started.server;
    port = started.port;
  });

  after(async () => {
    await stopServer(server);
  });

  it('validates standalone ArcadeAudioEngine and edge inputs for formatTime & clamp', () => {
    const engine = new ArcadeAudioEngine();
    assert.equal(engine.isMuted(), false);
    assert.equal(engine.setMuted(true), true);
    assert.equal(engine.isMuted(), true);
    assert.equal(engine.toggleMute(), false);
    assert.equal(engine.isMuted(), false);
    assert.doesNotThrow(() => {
      engine.playClick();
      engine.playMove();
      engine.playMatch();
      engine.playScore();
      engine.playWin();
      engine.playLose();
      engine.playError();
    });

    assert.equal(formatTime(-0), '00:00');
    assert.equal(formatTime(0.9), '00:00');
    assert.equal(formatTime(59.99), '00:59');
    assert.equal(formatTime(60), '01:00');
    assert.equal(formatTime(Number.NEGATIVE_INFINITY), '00:00');

    assert.equal(clamp(10, 10, 10), 10);
    assert.equal(clamp(0, -5, -1), -1);
    assert.equal(clamp(Number.NaN, 12, 4), 4);
    assert.equal(typeof ArcadeAudio.isMuted(), 'boolean');
    assert.doesNotThrow(() => initArcadeHeader());
  });

  it('serves landing page, all 6 game routes, CSS, and compiled JS modules with expected headers', async () => {
    const expectedRoutes: Array<{ path: string; mime: string; bodyNeedle: RegExp }> = [
      { path: '/', mime: MIME_TYPES['.html'], bodyNeedle: /6 CABINETS ONLINE/ },
      { path: '/index.html', mime: MIME_TYPES['.html'], bodyNeedle: /card-game2048/ },
      { path: '/styles/theme.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.game-shell/ },
      { path: '/styles/landing.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.card-minesweeper/ },
      { path: '/styles/tetris.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.tetris-stage/ },
      { path: '/styles/tictactoe.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.ttt-grid-stage/ },
      { path: '/styles/chess.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.chess-stage/ },
      { path: '/styles/mahjong.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.mahjong-stage/ },
      { path: '/styles/minesweeper.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.mine-board-frame/ },
      { path: '/styles/game2048.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.grid-2048/ },
      { path: '/dist/landing.js', mime: MIME_TYPES['.js'], bodyNeedle: /drawMinesweeperPreview/ },
      { path: '/dist/shared/arcade.js', mime: MIME_TYPES['.js'], bodyNeedle: /ArcadeAudioEngine/ },
      { path: '/games/tetris.html', mime: MIME_TYPES['.html'], bodyNeedle: /tetris-canvas/ },
      { path: '/games/tictactoe.html', mime: MIME_TYPES['.html'], bodyNeedle: /ttt-grid/ },
      { path: '/games/chess.html', mime: MIME_TYPES['.html'], bodyNeedle: /chess-board/ },
      { path: '/games/mahjong.html', mime: MIME_TYPES['.html'], bodyNeedle: /mahjong-board/ },
      { path: '/games/minesweeper.html', mime: MIME_TYPES['.html'], bodyNeedle: /mine-board/ },
      { path: '/games/game2048.html', mime: MIME_TYPES['.html'], bodyNeedle: /grid-2048/ },
      { path: '/dist/games/tetris/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /tetris/i },
      { path: '/dist/games/tictactoe/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /tictactoe/i },
      { path: '/dist/games/chess/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /chess/i },
      { path: '/dist/games/mahjong/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /mahjong/i },
      {
        path: '/dist/games/minesweeper/engine.js',
        mime: MIME_TYPES['.js'],
        bodyNeedle: /MinesweeperEngine/,
      },
      {
        path: '/dist/games/minesweeper/main.js',
        mime: MIME_TYPES['.js'],
        bodyNeedle: /mine-board/,
      },
      {
        path: '/dist/games/game2048/engine.js',
        mime: MIME_TYPES['.js'],
        bodyNeedle: /Game2048Engine/,
      },
      {
        path: '/dist/games/game2048/main.js',
        mime: MIME_TYPES['.js'],
        bodyNeedle: /grid-2048/,
      },
    ];

    for (const route of expectedRoutes) {
      const res = await sendHttpRequest(port, route.path);
      assert.equal(res.status, 200, `Expected 200 for ${route.path}, got ${res.status}`);
      assert.equal(res.headers['content-type'], route.mime);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.match(res.body, route.bodyNeedle);
    }

    for (const headPath of ['/games/minesweeper.html', '/games/game2048.html']) {
      const headRes = await sendHttpRequest(port, headPath, 'HEAD');
      assert.equal(headRes.status, 200);
      assert.equal(headRes.body, '');
      assert.ok(Number(headRes.headers['content-length']) > 100);
    }
  });

  it('handles query strings, directories, invalid URI encodings, null bytes, traversal, and 405 methods safely', async () => {
    const queryRes = await sendHttpRequest(port, '/index.html?v=qa-check');
    assert.equal(queryRes.status, 200);

    const dirRes1 = await sendHttpRequest(port, '/games');
    assert.equal(dirRes1.status, 404);

    const dirRes2 = await sendHttpRequest(port, '/games/');
    assert.equal(dirRes2.status, 404);

    const badEncoding = await sendHttpRequest(port, '/%E0%A4%A');
    assert.equal(badEncoding.status, 400);

    const nullByte = await sendHttpRequest(port, '/index.html%00.png');
    assert.equal(nullByte.status, 400);

    for (const attackPath of [
      '/..',
      '/../package.json',
      '/%2e%2e%2fpackage.json',
      '/%2e%2e%5cpackage.json',
      '/games/../../ts/server.ts',
    ]) {
      const res = await sendHttpRequest(port, attackPath);
      assert.equal(res.status, 403, `Expected 403 for ${attackPath}, got ${res.status}`);
    }

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await sendHttpRequest(port, '/', method);
      assert.equal(res.status, 405, `Expected 405 for ${method}`);
    }
  });
});

describe('QA: NEXUS ARCADE Landing Page Browser Verification (CDP)', () => {
  const rootDir = resolveDefaultRootDir();
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const started = await startEphemeralServer(rootDir);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  after(async () => {
    await stopServer(server);
  });

  it('verifies 1440x900 3x2 geometry, inactive state, 6-card hover tilt/HUD bounds/canvas animation, dynamic arrows, escape/blur, and mute persistence', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const viewportMetrics = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          backdropW: number;
          backdropH: number;
          statusText: string;
          taglineText: string;
        }>(`({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          backdropW: document.getElementById('arcade-backdrop')?.width ?? 0,
          backdropH: document.getElementById('arcade-backdrop')?.height ?? 0,
          statusText: (document.querySelector('.header-status-pill')?.textContent ?? '').trim(),
          taglineText: (document.querySelector('.hero-tagline')?.textContent ?? '').trim(),
        })`);
        assert.equal(viewportMetrics.innerWidth, 1440);
        assert.ok(
          viewportMetrics.scrollWidth <= viewportMetrics.innerWidth,
          `Unexpected horizontal overflow: ${viewportMetrics.scrollWidth} > ${viewportMetrics.innerWidth}`,
        );
        assert.equal(viewportMetrics.backdropW, 1440);
        assert.equal(viewportMetrics.backdropH, 900);
        assert.match(viewportMetrics.statusText, /6 CABINETS ONLINE/);
        assert.match(viewportMetrics.taglineText, /1.*6/);

        const gridRect = await page.getRect('.game-grid');
        const widthRatio = gridRect.width / viewportMetrics.innerWidth;
        assert.ok(
          widthRatio >= 0.77 && widthRatio <= 0.83,
          `Expected .game-grid width ratio in [0.77, 0.83], got ${widthRatio.toFixed(4)}`,
        );

        const cards = await page.evaluate<CardSnapshot[]>(READ_CARDS_EXPR);
        assert.equal(cards.length, 6);
        assert.deepEqual(
          cards.map((c) => c.game),
          [...EXPECTED_GAMES],
        );
        assert.deepEqual(
          cards.map((c) => c.href),
          [...EXPECTED_HREFS],
        );
        assert.deepEqual(
          cards.map((c) => c.nameText),
          [...EXPECTED_NAMES],
        );
        assert.deepEqual(
          cards.map((c) => c.subtitleText),
          [...EXPECTED_SUBTITLES],
        );

        for (const c of cards) {
          assert.ok(
            Math.abs(c.width - c.height) <= 3,
            `Card ${c.game} should be square, got ${c.width}x${c.height}`,
          );
          assert.ok(c.radiusTL >= 16 && c.radiusTR >= 16 && c.radiusBL >= 16 && c.radiusBR >= 16);
          assert.notEqual(c.active, 'true');
          assert.notEqual(c.dimmed, 'true');
          assert.ok(c.svgWidth > 40 && c.svgHeight > 40, `Missing visible SVG on ${c.game}`);
          assert.match(c.playBadgeText, /PLAY NOW/);
          assert.equal(c.hudOpacity, 0);
          assert.equal(c.canvasOpacity, 0);
          assert.equal(c.laserOpacity, 0);
        }

        assert3x2DesktopGrid(cards, '1440x900');

        // Hover activation across all 6 cards: sibling dimming, bounds check, 3D tilt/spotlight, live canvas delta
        for (let idx = 0; idx < 6; idx += 1) {
          const nth = idx + 1;
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${nth})')?.getAttribute('data-active') === 'true'`,
          );

          await page.hover(`.game-card:nth-child(${nth}) .card-key-chip`);
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );

          const snap = await page.evaluate<ActiveCardFitSnapshot>(buildActiveSnapshotExpr(idx));

          for (let j = 0; j < 6; j += 1) {
            if (j === idx) {
              assert.equal(snap.states[j].active, 'true');
              assert.equal(snap.states[j].dimmed, 'false');
            } else {
              assert.equal(snap.states[j].active, 'false');
              assert.equal(snap.states[j].dimmed, 'true');
              assert.ok(snap.states[j].opacity < 0.65);
            }
          }
          assert.equal(snap.scrollFits, true, `Card ${idx} inner scroll overflow at 1440x900`);
          assert.equal(snap.topFits, true, `Card ${idx} top bar clipped at 1440x900`);
          assert.ok(
            snap.badgeBottom <= snap.cardBottom + 1 && snap.hudBottom <= snap.cardBottom + 1,
            `Card ${idx} PLAY NOW/HUD clipped at 1440x900`,
          );
          assert.ok(snap.topBarBottom <= snap.centerTop + 2, `Card ${idx} top/center overlap`);
          assert.ok(snap.centerBottom <= snap.hudTop + 2, `Card ${idx} center/HUD overlap`);
          assert.ok(snap.canvasOpacity > 0.4);
          assert.ok(snap.laserOpacity > 0.9);
          assert.ok(snap.spotlightOpacity > 0.9);
          assert.notEqual(snap.tiltX, '');
          assert.notEqual(snap.tiltY, '');
          assert.notEqual(snap.spotX, '50%');
          assert.notEqual(snap.spotY, '50%');

          await new Promise((r) => setTimeout(r, 120));
          const frame2 = await page.evaluate<string>(
            `document.querySelectorAll('.card-preview-canvas')[${idx}].toDataURL()`,
          );
          assert.notEqual(
            frame2,
            snap.frame1,
            `Expected live animated preview canvas for card ${idx} (${EXPECTED_GAMES[idx]})`,
          );
        }

        // Moving mouse outside grid cleanly restores all 6 cards to inactive
        await page.hover('.landing-header');
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );
        await page.waitFor(
          `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(6) .card-active-hud')).opacity) < 0.05`,
        );

        // Dynamic 3x2 keyboard navigation (0 -> 1 -> 4 -> 5 -> wrap 2 -> 1 -> wrap 4 -> 1 -> 0 -> 3)
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );
        const navSteps: Array<[string, number]> = [
          ['ArrowRight', 2],
          ['ArrowDown', 5],
          ['ArrowRight', 6],
          ['ArrowDown', 3],
          ['ArrowLeft', 2],
          ['ArrowUp', 5],
          ['ArrowUp', 2],
          ['ArrowLeft', 1],
          ['ArrowDown', 4],
        ];
        for (const [key, expectedNth] of navSteps) {
          await page.pressKey(key);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${expectedNth})')?.getAttribute('data-active') === 'true'`,
          );
        }

        await page.pressKey('Escape');
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );

        await page.focus('.game-card:nth-child(6)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(6)')?.getAttribute('data-active') === 'true'",
        );
        await page.evaluate<void>(`document.querySelector('.game-card:nth-child(6)').blur()`);
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );

        // Global mute button toggles state & persists in localStorage
        await page.click('[data-mute-toggle]');
        const mutedState = await page.evaluate<{
          pressed: string | null;
          label: string;
          stored: string | null;
        }>(`({
          pressed: document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') ?? null,
          label: (document.querySelector('[data-mute-label]')?.textContent ?? '').trim(),
          stored: localStorage.getItem('nexus-arcade:muted'),
        })`);
        assert.deepEqual(mutedState, { pressed: 'true', label: 'Muted', stored: '1' });

        await page.click('[data-mute-toggle]');
        const unmutedState = await page.evaluate<{
          pressed: string | null;
          label: string;
          stored: string | null;
        }>(`({
          pressed: document.querySelector('[data-mute-toggle]')?.getAttribute('aria-pressed') ?? null,
          label: (document.querySelector('[data-mute-label]')?.textContent ?? '').trim(),
          stored: localStorage.getItem('nexus-arcade:muted'),
        })`);
        assert.deepEqual(unmutedState, { pressed: 'false', label: 'Sound On', stored: '0' });

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('verifies 1024x768 3x2 square layout, zero active-HUD clipping across all 6 cards, and responsive 820x900 & 480x844 ArrowDown stepping', async () => {
    // 1. Desktop 1024x768 (3x2 grid, all 6 cards active HUD + PLAY NOW bounds check + ArrowDown 0->3)
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const metrics = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          gridWidth: number;
          cards: CardSnapshot[];
        }>(`(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          gridWidth: document.querySelector('.game-grid').getBoundingClientRect().width,
          cards: ${READ_CARDS_EXPR},
        }))()`);

        assert.equal(metrics.innerWidth, 1024);
        assert.ok(metrics.scrollWidth <= metrics.innerWidth);
        const widthRatio = metrics.gridWidth / metrics.innerWidth;
        assert.ok(
          widthRatio >= 0.77 && widthRatio <= 0.83,
          `Expected ~80% grid width at 1024x768, got ${widthRatio.toFixed(4)}`,
        );

        for (const c of metrics.cards) {
          assert.ok(Math.abs(c.width - c.height) <= 3, `Non-square card ${c.game} at 1024x768`);
          assert.ok(c.radiusTL >= 16);
        }
        assert3x2DesktopGrid(metrics.cards, '1024x768');

        for (let idx = 0; idx < 6; idx += 1) {
          const nth = idx + 1;
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${nth})')?.getAttribute('data-active') === 'true'`,
          );
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );
          const snap = await page.evaluate<ActiveCardFitSnapshot>(buildActiveSnapshotExpr(idx));
          assert.equal(snap.scrollFits, true, `Card ${idx} inner scroll overflow at 1024x768`);
          assert.equal(snap.topFits, true, `Card ${idx} top bar clipped at 1024x768`);
          assert.ok(
            snap.badgeBottom <= snap.cardBottom + 1 && snap.hudBottom <= snap.cardBottom + 1,
            `Card ${idx} PLAY NOW/HUD clipped at 1024x768: badgeBottom=${snap.badgeBottom}, cardBottom=${snap.cardBottom}`,
          );
          assert.ok(
            snap.topBarBottom <= snap.centerTop + 2,
            `Card ${idx} top bar overlaps center at 1024x768`,
          );
          assert.ok(
            snap.centerBottom <= snap.hudTop + 2,
            `Card ${idx} center overlaps active HUD at 1024x768`,
          );
        }

        await page.hover('.landing-header');
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(4)')?.getAttribute('data-active') === 'true'",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1024, height: 768 },
    );

    // 2. Tablet 820x900 (2-col x 3-row layout + ArrowDown 0->2->4)
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const tablet = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          gridWidth: number;
          cards: CardSnapshot[];
        }>(`(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          gridWidth: document.querySelector('.game-grid').getBoundingClientRect().width,
          cards: ${READ_CARDS_EXPR},
        }))()`);

        assert.equal(tablet.innerWidth, 820);
        assert.ok(tablet.scrollWidth <= tablet.innerWidth);
        const ratio = tablet.gridWidth / tablet.innerWidth;
        assert.ok(ratio >= 0.77 && ratio <= 0.83, `Expected ~80% width at 820x900, got ${ratio}`);
        assert.equal(tablet.cards.length, 6);
        for (const c of tablet.cards) {
          assert.ok(Math.abs(c.width - c.height) <= 3);
          assert.ok(c.radiusTL >= 16);
        }
        // Strict 2-column x 3-row geometry
        assert.ok(Math.abs(tablet.cards[0].top - tablet.cards[1].top) <= 4);
        assert.ok(tablet.cards[1].left >= tablet.cards[0].right - 1);
        assert.ok(tablet.cards[2].top >= tablet.cards[0].bottom - 1);
        assert.ok(Math.abs(tablet.cards[2].top - tablet.cards[3].top) <= 4);
        assert.ok(tablet.cards[4].top >= tablet.cards[2].bottom - 1);
        assert.ok(Math.abs(tablet.cards[4].top - tablet.cards[5].top) <= 4);
        assert.ok(Math.abs(tablet.cards[0].left - tablet.cards[2].left) <= 4);
        assert.ok(Math.abs(tablet.cards[2].left - tablet.cards[4].left) <= 4);
        assert.ok(Math.abs(tablet.cards[1].left - tablet.cards[3].left) <= 4);
        assert.ok(Math.abs(tablet.cards[3].left - tablet.cards[5].left) <= 4);

        for (const nth of [5, 6]) {
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${nth})')?.getAttribute('data-active') === 'true'`,
          );
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );
          const snap = await page.evaluate<ActiveCardFitSnapshot>(buildActiveSnapshotExpr(nth - 1));
          assert.equal(snap.scrollFits, true, `Card ${nth - 1} inner scroll overflow at 820x900`);
          assert.ok(
            snap.badgeBottom <= snap.cardBottom + 1 && snap.hudBottom <= snap.cardBottom + 1,
            `Card ${nth - 1} PLAY NOW/HUD clipped at 820x900`,
          );
        }

        // Focus Chrome page cleanly without activating any card before testing DOM focus + ArrowDown
        await page.hover('.landing-header');
        await page.click('.hero-tagline');
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(5)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowUp');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 820, height: 900 },
    );

    // 3. Mobile 480x844 (1-col x 6-row layout + ArrowDown 0->1->2)
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const mobile = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          cards: CardSnapshot[];
        }>(`(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cards: ${READ_CARDS_EXPR},
        }))()`);

        assert.equal(mobile.innerWidth, 480);
        assert.ok(mobile.scrollWidth <= mobile.innerWidth);
        assert.equal(mobile.cards.length, 6);
        for (let i = 0; i < mobile.cards.length; i += 1) {
          const c = mobile.cards[i];
          assert.ok(Math.abs(c.width - c.height) <= 3);
          assert.ok(c.radiusTL >= 16);
          if (i > 0) {
            assert.ok(
              c.top >= mobile.cards[i - 1].bottom - 1,
              `Expected stacked 1-col mobile grid at index ${i}`,
            );
            assert.ok(Math.abs(c.left - mobile.cards[0].left) <= 4);
          }
        }

        await page.click('.hero-tagline');
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowDown');
        const afterDown1 = await page.evaluate<{
          activeCards: Array<string | null>;
          activeElGame: string | null;
          gridCols: string;
          scrollY: number;
        }>(`({
          activeCards: Array.from(document.querySelectorAll('.game-card')).map((el) => el.getAttribute('data-active')),
          activeElGame: document.activeElement?.getAttribute('data-game') ?? null,
          gridCols: getComputedStyle(document.getElementById('game-grid')).gridTemplateColumns,
          scrollY: window.scrollY,
        })`);
        assert.equal(
          afterDown1.activeCards[1],
          'true',
          `Expected card 1 (index 1) active after ArrowDown at 480x844, got ${JSON.stringify(afterDown1)}`,
        );
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 480, height: 844 },
    );
  });

  it('navigates cleanly from landing cards to all 6 game routes via click, hotkeys 1-6, Space, and Enter with .arcade-back-link return', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const expectLandingReady =
          "(window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) && document.readyState === 'complete' && document.querySelectorAll('.game-card').length === 6";

        // 1. Click card 1 -> Tetris, then click Back to Arcade
        await page.click('.game-card[data-game="tetris"]');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/tetris.html') && document.readyState === 'complete' && Boolean(document.querySelector('#tetris-canvas'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 2. Numeric hotkey '2' -> Tic-Tac-Toe, then Back to Arcade
        await page.pressKey('2');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/tictactoe.html') && document.readyState === 'complete' && Boolean(document.querySelector('#ttt-grid'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 3. Focus Chess card + press Space -> Chess, then Back to Arcade
        await page.focus('.game-card[data-game="chess"]');
        await page.pressKey('Space');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/chess.html') && document.readyState === 'complete' && Boolean(document.querySelector('#chess-board'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 4. Focus Mahjong card + press Enter -> Mahjong, then Back to Arcade
        await page.focus('.game-card[data-game="mahjong"]');
        await page.pressKey('Enter');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/mahjong.html') && document.readyState === 'complete' && Boolean(document.querySelector('#mahjong-board'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 5. Click card 5 -> Minesweeper, then Back to Arcade
        await page.click('.game-card[data-game="minesweeper"]');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/minesweeper.html') && document.readyState === 'complete' && document.querySelectorAll('#mine-board .mine-cell').length === 81",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 6. Numeric hotkey '5' -> Minesweeper, then Back to Arcade
        await page.pressKey('5');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/minesweeper.html') && document.readyState === 'complete' && Boolean(document.querySelector('#mine-board'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 7. Click card 6 -> Hyper 2048, then Back to Arcade
        await page.click('.game-card[data-game="game2048"]');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/game2048.html') && document.readyState === 'complete' && document.querySelectorAll('#grid-2048 .cell-2048').length === 16",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 8. Numeric hotkey '6' -> Hyper 2048, then Back to Arcade
        await page.pressKey('6');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/game2048.html') && document.readyState === 'complete' && Boolean(document.querySelector('#grid-2048'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 9. Focus card 5 + Space -> Minesweeper, then Back to Arcade
        await page.focus('.game-card[data-game="minesweeper"]');
        await page.pressKey('Space');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/minesweeper.html') && document.readyState === 'complete' && Boolean(document.querySelector('#mine-board'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(expectLandingReady);

        // 10. Focus card 6 + Enter -> Hyper 2048
        await page.focus('.game-card[data-game="game2048"]');
        await page.pressKey('Enter');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/game2048.html') && document.readyState === 'complete' && Boolean(document.querySelector('#grid-2048'))",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
