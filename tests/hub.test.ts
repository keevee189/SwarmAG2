import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createAppServer, resolveDefaultRootDir } from '../ts/server.js';
import { ArcadeAudio, clamp, formatTime, initArcadeHeader } from '../ts/shared/arcade.js';
import { withBrowserPage } from './helpers/cdp.js';

function rawRequest(
  port: number,
  reqPath: string,
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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

describe('ts/shared/arcade.ts utilities', () => {
  it('formats non-negative durations as MM:SS and guards invalid inputs', () => {
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(7), '00:07');
    assert.equal(formatTime(65), '01:05');
    assert.equal(formatTime(599), '09:59');
    assert.equal(formatTime(3661.9), '61:01');
    assert.equal(formatTime(-12), '00:00');
    assert.equal(formatTime(Number.NaN), '00:00');
    assert.equal(formatTime(Number.POSITIVE_INFINITY), '00:00');
  });

  it('clamps numeric values cleanly including inverted bounds and NaN', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-4, 0, 10), 0);
    assert.equal(clamp(42, 0, 10), 10);
    assert.equal(clamp(5, 10, 0), 5);
    assert.equal(clamp(Number.NaN, 3, 9), 3);
  });

  it('safely manages mute state and SFX calls in Node without browser audio APIs', () => {
    const initial = ArcadeAudio.isMuted();
    try {
      ArcadeAudio.setMuted(false);
      assert.equal(ArcadeAudio.isMuted(), false);
      assert.equal(ArcadeAudio.toggleMute(), true);
      assert.equal(ArcadeAudio.isMuted(), true);
      assert.equal(ArcadeAudio.toggleMute(), false);
      assert.equal(ArcadeAudio.isMuted(), false);

      assert.doesNotThrow(() => {
        ArcadeAudio.playClick();
        ArcadeAudio.playMove();
        ArcadeAudio.playMatch();
        ArcadeAudio.playScore();
        ArcadeAudio.playWin();
        ArcadeAudio.playLose();
        ArcadeAudio.playError();
        ArcadeAudio.setMuted(true);
        ArcadeAudio.playWin();
        initArcadeHeader();
      });
    } finally {
      ArcadeAudio.setMuted(initial);
    }
  });
});

describe('ts/server.ts static HTTP server', () => {
  let server: http.Server;
  let port = 0;

  before(async () => {
    server = createAppServer(resolveDefaultRootDir());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        port = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('serves / as index.html with text/html MIME type', async () => {
    const res = await rawRequest(port, '/');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /text\/html/);
    assert.match(res.body, /NEXUS ARCADE/);
  });

  it('serves CSS and compiled JS modules with correct MIME types', async () => {
    const css = await rawRequest(port, '/styles/theme.css');
    assert.equal(css.status, 200);
    assert.match(String(css.headers['content-type']), /text\/css/);

    const landingCss = await rawRequest(port, '/styles/landing.css');
    assert.equal(landingCss.status, 200);
    assert.match(String(landingCss.headers['content-type']), /text\/css/);

    const arcadeJs = await rawRequest(port, '/dist/shared/arcade.js');
    assert.equal(arcadeJs.status, 200);
    assert.match(String(arcadeJs.headers['content-type']), /javascript/);

    const landingJs = await rawRequest(port, '/dist/landing.js');
    assert.equal(landingJs.status, 200);
    assert.match(String(landingJs.headers['content-type']), /javascript/);
  });

  it('supports HEAD requests and rejects unsupported HTTP methods with 405', async () => {
    const head = await rawRequest(port, '/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');

    const post = await rawRequest(port, '/', 'POST');
    assert.equal(post.status, 405);
  });

  it('returns 404 for missing routes and blocks path traversal with 403', async () => {
    const missing = await rawRequest(port, '/does-not-exist-xyz.html');
    assert.equal(missing.status, 404);

    const traversal1 = await rawRequest(port, '/../package.json');
    assert.equal(traversal1.status, 403);

    const traversal2 = await rawRequest(port, '/games/../../package.json');
    assert.equal(traversal2.status, 403);

    const traversal3 = await rawRequest(port, '/%2e%2e/package.json');
    assert.equal(traversal3.status, 403);
  });
});

describe('NEXUS ARCADE landing page (CDP)', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    server = createAppServer(resolveDefaultRootDir());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        baseUrl = `http://127.0.0.1:${addr.port}/`;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('renders 80%-width 3x2 square rounded cards and transitions inactive/active/dimmed states', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const gridRect = await page.getRect('.game-grid');
        const viewportW = await page.evaluate<number>('window.innerWidth');
        assert.ok(
          Math.abs(gridRect.width / viewportW - 0.8) < 0.02,
          `Expected .game-grid width ~80% of ${viewportW}, got ${gridRect.width}`,
        );

        const cardChecks = await page.evaluate<
          Array<{
            game: string;
            href: string;
            width: number;
            height: number;
            top: number;
            left: number;
            borderRadius: string;
            active: string | null;
            dimmed: string | null;
          }>
        >(`(() => {
          return Array.from(document.querySelectorAll('.game-card')).map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              game: el.getAttribute('data-game') || '',
              href: el.getAttribute('href') || '',
              width: r.width,
              height: r.height,
              top: r.top,
              left: r.left,
              borderRadius: cs.borderRadius,
              active: el.getAttribute('data-active'),
              dimmed: el.getAttribute('data-dimmed'),
            };
          });
        })()`);

        assert.equal(cardChecks.length, 6);
        assert.deepEqual(
          cardChecks.map((c) => c.game),
          ['tetris', 'tictactoe', 'chess', 'mahjong', 'minesweeper', 'game2048'],
        );
        assert.deepEqual(
          cardChecks.map((c) => c.href),
          [
            'games/tetris.html',
            'games/tictactoe.html',
            'games/chess.html',
            'games/mahjong.html',
            'games/minesweeper.html',
            'games/game2048.html',
          ],
        );

        for (const c of cardChecks) {
          assert.ok(Math.abs(c.width - c.height) < 2, `Expected square card, got ${c.width}x${c.height}`);
          assert.equal(c.borderRadius, '26px');
          assert.equal(c.active, 'false');
          assert.equal(c.dimmed, 'false');
        }

        // Verify 3x2 grid rows & columns at 1440x900
        assert.ok(cardChecks[0].left < cardChecks[1].left);
        assert.ok(cardChecks[1].left < cardChecks[2].left);
        assert.ok(Math.abs(cardChecks[0].top - cardChecks[1].top) < 2);
        assert.ok(Math.abs(cardChecks[1].top - cardChecks[2].top) < 2);

        assert.ok(cardChecks[3].left < cardChecks[4].left);
        assert.ok(cardChecks[4].left < cardChecks[5].left);
        assert.ok(Math.abs(cardChecks[3].top - cardChecks[4].top) < 2);
        assert.ok(Math.abs(cardChecks[4].top - cardChecks[5].top) < 2);

        assert.ok(cardChecks[3].top > cardChecks[0].top + cardChecks[0].height * 0.5);
        assert.ok(Math.abs(cardChecks[3].left - cardChecks[0].left) < 2);
        assert.ok(Math.abs(cardChecks[4].left - cardChecks[1].left) < 2);
        assert.ok(Math.abs(cardChecks[5].left - cardChecks[2].left) < 2);

        // Hover each of the 6 cards -> active mode, sibling dimming, and clean card bounds
        for (let idx = 0; idx < 6; idx += 1) {
          const nth = idx + 1;
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `document.querySelector('.game-card:nth-child(${nth})')?.getAttribute('data-active') === 'true'`,
          );
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );

          const hoverSnap = await page.evaluate<{
            states: Array<{ active: string | null; dimmed: string | null }>;
            fitsInsideCard: boolean;
          }>(`(() => {
            const cards = Array.from(document.querySelectorAll('.game-card'));
            const activeCard = cards[${idx}];
            const inner = activeCard.querySelector('.card-inner');
            const cardRect = activeCard.getBoundingClientRect();
            const badgeRect = activeCard.querySelector('.card-play-badge').getBoundingClientRect();
            const topRect = activeCard.querySelector('.card-top-bar').getBoundingClientRect();
            const fitsInsideCard =
              inner.scrollHeight <= inner.clientHeight + 1 &&
              topRect.top >= cardRect.top - 1 &&
              badgeRect.bottom <= cardRect.bottom + 1;
            return {
              states: cards.map((el) => ({
                active: el.getAttribute('data-active'),
                dimmed: el.getAttribute('data-dimmed'),
              })),
              fitsInsideCard,
            };
          })()`);

          assert.equal(hoverSnap.fitsInsideCard, true, `Card ${idx} active HUD clipped at 1440x900`);
          const expectedStates = Array.from({ length: 6 }, (_, j) => ({
            active: j === idx ? 'true' : 'false',
            dimmed: j === idx ? 'false' : 'true',
          }));
          assert.deepEqual(hoverSnap.states, expectedStates);
        }

        // Hover header -> cleanly returns all 6 cards to inactive mode
        await page.hover('.landing-header');
        await page.waitFor(
          "Array.from(document.querySelectorAll('.game-card')).every(el => el.getAttribute('data-active') === 'false')",
        );

        const afterLeave = await page.evaluate<Array<{ active: string | null; dimmed: string | null }>>(
          `Array.from(document.querySelectorAll('.game-card')).map(el => ({
            active: el.getAttribute('data-active'),
            dimmed: el.getAttribute('data-dimmed')
          }))`,
        );
        assert.deepEqual(
          afterLeave,
          Array.from({ length: 6 }, () => ({ active: 'false', dimmed: 'false' })),
        );

        // Dynamic keyboard focus + arrow key navigation on 3x2 grid (0 -> 1 -> 4 -> 5 -> 2)
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor("document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'");
        await page.pressKey('ArrowRight');
        await page.waitFor("document.querySelector('.game-card:nth-child(2)')?.getAttribute('data-active') === 'true'");

        await page.pressKey('ArrowDown');
        await page.waitFor("document.querySelector('.game-card:nth-child(5)')?.getAttribute('data-active') === 'true'");

        await page.pressKey('ArrowRight');
        await page.waitFor("document.querySelector('.game-card:nth-child(6)')?.getAttribute('data-active') === 'true'");

        await page.pressKey('ArrowUp');
        await page.waitFor("document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'");

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });

  it('fits 3-column square cards cleanly at 1024x768 and adapts ArrowDown to 2-column tablet layout', async () => {
    await withBrowserPage(
      baseUrl,
      async (page) => {
        const layout = await page.evaluate<
          Array<{ w: number; h: number; top: number; left: number; radius: string }>
        >(`Array.from(document.querySelectorAll('.game-card')).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            w: r.width,
            h: r.height,
            top: r.top,
            left: r.left,
            radius: getComputedStyle(el).borderRadius,
          };
        })`);

        assert.equal(layout.length, 6);
        for (const c of layout) {
          assert.ok(Math.abs(c.w - c.h) < 2, `Expected square card at 1024x768, got ${c.w}x${c.h}`);
          assert.equal(c.radius, '26px');
        }
        // Still 3 columns on row 1 at 1024px
        assert.ok(Math.abs(layout[0].top - layout[1].top) < 2);
        assert.ok(Math.abs(layout[1].top - layout[2].top) < 2);
        assert.ok(layout[3].top > layout[0].top + layout[0].h * 0.5);

        // Verify active HUD & PLAY NOW fit without overflow inside square cards at 1024x768
        for (const nth of [5, 6]) {
          await page.hover(`.game-card:nth-child(${nth})`);
          await page.waitFor(
            `parseFloat(getComputedStyle(document.querySelector('.game-card:nth-child(${nth}) .card-active-hud')).opacity) > 0.9`,
          );
          const fit = await page.evaluate<{
            scrollFits: boolean;
            badgeBottom: number;
            cardBottom: number;
            centerBottom: number;
            hudTop: number;
          }>(`(() => {
            const card = document.querySelector('.game-card:nth-child(${nth})');
            const inner = card.querySelector('.card-inner');
            const cr = card.getBoundingClientRect();
            const br = card.querySelector('.card-play-badge').getBoundingClientRect();
            const ctr = card.querySelector('.card-center').getBoundingClientRect();
            const hud = card.querySelector('.card-active-hud').getBoundingClientRect();
            return {
              scrollFits: inner.scrollHeight <= inner.clientHeight + 1,
              badgeBottom: br.bottom,
              cardBottom: cr.bottom,
              centerBottom: ctr.bottom,
              hudTop: hud.top,
            };
          })()`);
          assert.equal(fit.scrollFits, true);
          assert.ok(
            fit.badgeBottom <= fit.cardBottom + 1,
            `Card ${nth} PLAY NOW clipped at 1024x768: badgeBottom=${fit.badgeBottom} > cardBottom=${fit.cardBottom}`,
          );
          assert.ok(
            fit.centerBottom <= fit.hudTop + 2,
            `Card ${nth} center overlapped active HUD at 1024x768`,
          );
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
        const tabletRows = await page.evaluate<Array<{ top: number; left: number }>>(
          `Array.from(document.querySelectorAll('.game-card')).map((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, left: r.left };
          })`,
        );
        assert.equal(tabletRows.length, 6);
        assert.ok(Math.abs(tabletRows[0].top - tabletRows[1].top) < 2);
        assert.ok(tabletRows[2].top > tabletRows[0].top + 40);

        await page.hover('.landing-header');
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor("document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'");
        await page.pressKey('ArrowDown');
        await page.waitFor("document.querySelector('.game-card:nth-child(3)')?.getAttribute('data-active') === 'true'");

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 900, height: 800 },
    );

    await withBrowserPage(
      baseUrl,
      async (page) => {
        await page.click('.hero-tagline');
        await page.focus('.game-card:nth-child(1)');
        await page.waitFor("document.querySelector('.game-card:nth-child(1)')?.getAttribute('data-active') === 'true'");
        await page.pressKey('ArrowDown');
        await page.waitFor("document.querySelector('.game-card:nth-child(2)')?.getAttribute('data-active') === 'true'");
        await new Promise((r) => setTimeout(r, 120));
        const activeStates = await page.evaluate<Array<string | null>>(
          `Array.from(document.querySelectorAll('.game-card')).map(el => el.getAttribute('data-active'))`,
        );
        assert.deepEqual(activeStates, ['false', 'true', 'false', 'false', 'false', 'false']);

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 480, height: 844 },
    );
  });
});
