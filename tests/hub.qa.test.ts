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

describe('QA: Project Docs & Requirements Audit', () => {
  const rootDir = resolveDefaultRootDir();

  it('resolveDefaultRootDir locates the workspace root cleanly even from compiled test dirs', () => {
    assert.ok(fs.existsSync(path.join(rootDir, 'package.json')));
    assert.ok(fs.existsSync(path.join(rootDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(rootDir, 'ts', 'server.ts')));
  });

  it('README.md provides plain-English overview, build/start/stop commands, URL, and all game shortcuts', () => {
    const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    const lines = readme
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    assert.ok(lines[0]?.startsWith('# NEXUS ARCADE'));
    // Friendly plain-English paragraph immediately follows title
    assert.ok(lines[1] && !lines[1].startsWith('#') && !lines[1].startsWith('```'));
    assert.match(lines[1], /Tetris/i);
    assert.match(lines[1], /Tic-Tac-Toe/i);
    assert.match(lines[1], /Chess/i);
    assert.match(lines[1], /Mahjong/i);

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
    ]) {
      assert.ok(readme.includes(requiredCmd), `README.md missing "${requiredCmd}"`);
    }

    for (const sectionToken of [
      'Landing Hub',
      'Tetris',
      'Tic-Tac-Toe',
      'Chess',
      'Mahjong Solitaire',
      'Hard Drop',
      'Hold Piece',
      'Promotion',
      'Shuffle',
    ]) {
      assert.ok(readme.includes(sectionToken), `README.md missing "${sectionToken}"`);
    }
  });

  it('REQUIREMENTS.md documents hub layout, active/inactive modes, all 4 games, and test coverage', () => {
    const reqs = fs.readFileSync(path.join(rootDir, 'REQUIREMENTS.md'), 'utf8');
    for (const expected of [
      '80% of the viewport width',
      'aspect-ratio: 1 / 1',
      'border-radius: 26px',
      'games/tetris.html',
      'games/tictactoe.html',
      'games/chess.html',
      'games/mahjong.html',
      'TETROMINO OVERDRIVE',
      'NEURAL GRID DUEL',
      'GRANDMASTER PROTOCOL',
      'IMPERIAL TILE DYNASTY',
      'data-active="true"',
      'data-dimmed="true"',
      '1440×900',
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

  it('serves landing page, all 4 game routes, CSS, and compiled JS modules with expected headers', async () => {
    const expectedRoutes: Array<{ path: string; mime: string; bodyNeedle: RegExp }> = [
      { path: '/', mime: MIME_TYPES['.html'], bodyNeedle: /NEXUS ARCADE/ },
      { path: '/index.html', mime: MIME_TYPES['.html'], bodyNeedle: /card-tetris/ },
      { path: '/styles/theme.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.game-shell/ },
      { path: '/styles/landing.css', mime: MIME_TYPES['.css'], bodyNeedle: /\.game-grid/ },
      { path: '/dist/landing.js', mime: MIME_TYPES['.js'], bodyNeedle: /LandingHubController/ },
      { path: '/dist/shared/arcade.js', mime: MIME_TYPES['.js'], bodyNeedle: /ArcadeAudioEngine/ },
      { path: '/games/tetris.html', mime: MIME_TYPES['.html'], bodyNeedle: /tetris-canvas/ },
      { path: '/games/tictactoe.html', mime: MIME_TYPES['.html'], bodyNeedle: /ttt-grid/ },
      { path: '/games/chess.html', mime: MIME_TYPES['.html'], bodyNeedle: /chess-board/ },
      { path: '/games/mahjong.html', mime: MIME_TYPES['.html'], bodyNeedle: /mahjong-board/ },
      { path: '/dist/games/tetris/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /tetris/i },
      { path: '/dist/games/tictactoe/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /tictactoe/i },
      { path: '/dist/games/chess/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /chess/i },
      { path: '/dist/games/mahjong/main.js', mime: MIME_TYPES['.js'], bodyNeedle: /mahjong/i },
    ];

    for (const route of expectedRoutes) {
      const res = await sendHttpRequest(port, route.path);
      assert.equal(res.status, 200, `Expected 200 for ${route.path}, got ${res.status}`);
      assert.equal(res.headers['content-type'], route.mime);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.match(res.body, route.bodyNeedle);
    }

    const headRes = await sendHttpRequest(port, '/games/tetris.html', 'HEAD');
    assert.equal(headRes.status, 200);
    assert.equal(headRes.body, '');
    assert.ok(Number(headRes.headers['content-length']) > 100);
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

  it('verifies 1440x900 2x2 geometry, inactive state, hover tilt/canvas animation, keyboard nav, escape/blur, and mute persistence', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        // 1. Viewport fit & 80% grid width
        const viewportMetrics = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          backdropW: number;
          backdropH: number;
        }>(`({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          backdropW: document.getElementById('arcade-backdrop')?.width ?? 0,
          backdropH: document.getElementById('arcade-backdrop')?.height ?? 0,
        })`);
        assert.equal(viewportMetrics.innerWidth, 1440);
        assert.ok(
          viewportMetrics.scrollWidth <= viewportMetrics.innerWidth,
          `Unexpected horizontal overflow: ${viewportMetrics.scrollWidth} > ${viewportMetrics.innerWidth}`,
        );
        assert.equal(viewportMetrics.backdropW, 1440);
        assert.equal(viewportMetrics.backdropH, 900);

        const gridRect = await page.getRect('.game-grid');
        const widthRatio = gridRect.width / viewportMetrics.innerWidth;
        assert.ok(
          widthRatio >= 0.77 && widthRatio <= 0.83,
          `Expected .game-grid width ratio in [0.77, 0.83], got ${widthRatio.toFixed(4)}`,
        );

        // 2. 2x2 geometry, square cards, rounded corners >= 16px, inactive UI content
        const cards = await page.evaluate<
          Array<{
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
          }>
        >(`Array.from(document.querySelectorAll('.game-card')).map((card) => {
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
        })`);

        assert.equal(cards.length, 4);
        assert.deepEqual(
          cards.map((c) => c.game),
          ['tetris', 'tictactoe', 'chess', 'mahjong'],
        );
        assert.deepEqual(
          cards.map((c) => c.href),
          ['games/tetris.html', 'games/tictactoe.html', 'games/chess.html', 'games/mahjong.html'],
        );
        assert.deepEqual(
          cards.map((c) => c.nameText),
          ['TETRIS', 'TIC-TAC-TOE', 'CHESS', 'MAHJONG'],
        );
        assert.deepEqual(
          cards.map((c) => c.subtitleText),
          [
            'TETROMINO OVERDRIVE',
            'NEURAL GRID DUEL',
            'GRANDMASTER PROTOCOL',
            'IMPERIAL TILE DYNASTY',
          ],
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

        // Strict 2x2 grid alignment
        assert.ok(Math.abs(cards[0].top - cards[1].top) <= 4, 'Top row cards misaligned');
        assert.ok(Math.abs(cards[2].top - cards[3].top) <= 4, 'Bottom row cards misaligned');
        assert.ok(cards[2].top >= cards[0].bottom - 1, 'Bottom row overlaps top row');
        assert.ok(cards[3].top >= cards[1].bottom - 1, 'Bottom row overlaps top row');
        assert.ok(Math.abs(cards[0].left - cards[2].left) <= 4, 'Left column misaligned');
        assert.ok(Math.abs(cards[1].left - cards[3].left) <= 4, 'Right column misaligned');
        assert.ok(cards[1].left >= cards[0].right - 1, 'Top row columns overlap');

        // 3. Hover activation, sibling dimming, 3D tilt/spotlight, live canvas animation, and leave restore
        for (let idx = 0; idx < 4; idx += 1) {
          const nth = idx + 1;
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${nth})')?.getAttribute('data-active') === 'true'`,
          );

          // Off-center hover over key chip triggers real mousemove tilt & spotlight updates
          await page.hover(`.game-card:nth-child(${nth}) .card-key-chip`);
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );

          const activeSnapshot = await page.evaluate<{
            states: Array<{ active: string | null; dimmed: string | null; opacity: number }>;
            canvasOpacity: number;
            laserOpacity: number;
            spotlightOpacity: number;
            tiltX: string;
            tiltY: string;
            spotX: string;
            spotY: string;
            frame1: string;
          }>(`(() => {
            const all = Array.from(document.querySelectorAll('.game-card'));
            const cur = all[${idx}];
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
              frame1: canvas.toDataURL(),
            };
          })()`);

          for (let j = 0; j < 4; j += 1) {
            if (j === idx) {
              assert.equal(activeSnapshot.states[j].active, 'true');
              assert.equal(activeSnapshot.states[j].dimmed, 'false');
            } else {
              assert.equal(activeSnapshot.states[j].active, 'false');
              assert.equal(activeSnapshot.states[j].dimmed, 'true');
              assert.ok(activeSnapshot.states[j].opacity < 0.65);
            }
          }
          assert.ok(activeSnapshot.canvasOpacity > 0.4);
          assert.ok(activeSnapshot.laserOpacity > 0.9);
          assert.ok(activeSnapshot.spotlightOpacity > 0.9);
          assert.notEqual(activeSnapshot.tiltX, '');
          assert.notEqual(activeSnapshot.tiltY, '');
          assert.notEqual(activeSnapshot.spotX, '50%');
          assert.notEqual(activeSnapshot.spotY, '50%');

          await new Promise((r) => setTimeout(r, 120));
          const frame2 = await page.evaluate<string>(
            `document.querySelectorAll('.card-preview-canvas')[${idx}].toDataURL()`,
          );
          assert.notEqual(
            frame2,
            activeSnapshot.frame1,
            `Expected live animated preview canvas for card ${idx}`,
          );
        }

        // Moving mouse outside grid cleanly restores all cards to inactive
        await page.hover('.landing-header');
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );
        await page.waitFor(
          `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(4) .card-active-hud')).opacity) < 0.05`,
        );

        // 4. Keyboard grid navigation (focus, ArrowRight, ArrowDown, ArrowLeft, ArrowUp, Escape, blur)
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowRight');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(2)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowDown');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(4)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowLeft');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'",
        );
        await page.pressKey('ArrowUp');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'",
        );

        await page.pressKey('Escape');
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );

        await page.focus('.game-card:nth-child(2)');
        await page.waitFor(
          "document.querySelector('.game-card:nth-child(2)')?.getAttribute('data-active') === 'true'",
        );
        await page.evaluate<void>(`document.querySelector('.game-card:nth-child(2)').blur()`);
        await page.waitFor(
          `Array.from(document.querySelectorAll('.game-card')).every((el) => el.getAttribute('data-active') === 'false' && el.getAttribute('data-dimmed') === 'false')`,
        );

        // 5. Global mute button toggles state & persists in localStorage
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

  it('adapts cleanly across responsive desktop (1024x768) and mobile (480x844) viewports without overflow', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const tablet = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          gridWidth: number;
          cardRects: Array<{ w: number; h: number; top: number; radius: number }>;
        }>(`(() => {
          const grid = document.querySelector('.game-grid').getBoundingClientRect();
          const cardRects = Array.from(document.querySelectorAll('.game-card')).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              w: r.width,
              h: r.height,
              top: r.top,
              radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
            };
          });
          return {
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            gridWidth: grid.width,
            cardRects,
          };
        })()`);

        assert.ok(tablet.scrollWidth <= tablet.innerWidth);
        const ratio = tablet.gridWidth / tablet.innerWidth;
        assert.ok(ratio >= 0.77 && ratio <= 0.83, `Expected ~80% grid width at 1024px, got ${ratio}`);
        assert.ok(Math.abs(tablet.cardRects[0].top - tablet.cardRects[1].top) <= 4);
        for (const c of tablet.cardRects) {
          assert.ok(Math.abs(c.w - c.h) <= 3);
          assert.ok(c.radius >= 16);
        }
        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1024, height: 768 },
    );

    await withBrowserPage(
      baseUrl,
      async (page) => {
        const mobile = await page.evaluate<{
          innerWidth: number;
          scrollWidth: number;
          cardRects: Array<{ w: number; h: number; top: number; bottom: number; radius: number }>;
        }>(`({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cardRects: Array.from(document.querySelectorAll('.game-card')).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              w: r.width,
              h: r.height,
              top: r.top,
              bottom: r.bottom,
              radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
            };
          }),
        })`);

        assert.ok(mobile.scrollWidth <= mobile.innerWidth);
        for (let i = 0; i < mobile.cardRects.length; i += 1) {
          const c = mobile.cardRects[i];
          assert.ok(Math.abs(c.w - c.h) <= 3);
          assert.ok(c.radius >= 16);
          if (i > 0) {
            assert.ok(c.top >= mobile.cardRects[i - 1].bottom - 1, 'Expected stacked 1-col mobile grid');
          }
        }
        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 480, height: 844 },
    );
  });

  it('navigates cleanly from landing cards to all 4 game routes via click, shortcut key, Space, and Enter', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        // 1. Click card 1 -> Tetris, then click Back to Arcade
        await page.click('.game-card[data-game="tetris"]');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/tetris.html') && document.readyState === 'complete' && Boolean(document.querySelector('#tetris-canvas'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(
          "(window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) && document.readyState === 'complete' && document.querySelectorAll('.game-card').length === 4",
        );

        // 2. Numeric hotkey '2' -> Tic-Tac-Toe, then Back to Arcade
        await page.pressKey('2');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/tictactoe.html') && document.readyState === 'complete' && Boolean(document.querySelector('#ttt-grid'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(
          "(window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) && document.readyState === 'complete' && document.querySelectorAll('.game-card').length === 4",
        );

        // 3. Focus Chess card + press Space -> Chess, then Back to Arcade
        await page.focus('.game-card[data-game="chess"]');
        await page.pressKey('Space');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/chess.html') && document.readyState === 'complete' && Boolean(document.querySelector('#chess-board'))",
        );
        await page.click('.arcade-back-link');
        await page.waitFor(
          "(window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) && document.readyState === 'complete' && document.querySelectorAll('.game-card').length === 4",
        );

        // 4. Focus Mahjong card + press Enter -> Mahjong
        await page.focus('.game-card[data-game="mahjong"]');
        await page.pressKey('Enter');
        await page.waitFor(
          "window.location.pathname.endsWith('/games/mahjong.html') && document.readyState === 'complete' && Boolean(document.querySelector('#mahjong-board'))",
        );

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
