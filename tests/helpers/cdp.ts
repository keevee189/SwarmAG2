import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface LaunchOptions {
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface BrowserPage {
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  evaluate<T>(expr: string): Promise<T>;
  click(selector: string): Promise<void>;
  hover(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  pressKey(key: string, code?: string): Promise<void>;
  waitFor(expr: string, timeoutMs?: number): Promise<void>;
  getRect(selector: string): Promise<ElementRect>;
  close(): Promise<void>;
}

interface KeyDescriptor {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const SPECIAL_KEYS: Record<string, KeyDescriptor> = {
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

function resolveKeyDescriptor(key: string, explicitCode?: string): KeyDescriptor {
  const special = SPECIAL_KEYS[key];
  if (special) {
    return {
      ...special,
      code: explicitCode ?? special.code,
    };
  }
  if (key.length === 1) {
    const ch = key;
    const upper = ch.toUpperCase();
    const charCode = upper.charCodeAt(0);
    let defaultCode = explicitCode ?? '';
    if (!defaultCode) {
      if (ch >= 'a' && ch <= 'z') {
        defaultCode = `Key${upper}`;
      } else if (ch >= 'A' && ch <= 'Z') {
        defaultCode = `Key${upper}`;
      } else if (ch >= '0' && ch <= '9') {
        defaultCode = `Digit${ch}`;
      }
    }
    return {
      key: ch,
      code: defaultCode || ch,
      keyCode: charCode,
      text: ch,
    };
  }
  return {
    key,
    code: explicitCode ?? key,
    keyCode: 0,
  };
}

function findChromeBinary(): string {
  const candidates = ['/usr/bin/google-chrome', '/snap/bin/chromium'];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) {
      return bin;
    }
  }
  throw new Error(`No headless Chrome/Chromium binary found (checked ${candidates.join(', ')})`);
}

async function discoverDebugPort(
  proc: ChildProcess,
  userDataDir: string,
  stderrChunks: string[],
  timeoutMs: number,
): Promise<number> {
  const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Chrome exited early with code ${proc.exitCode}: ${stderrChunks.join('').slice(-500)}`,
      );
    }

    const joined = stderrChunks.join('');
    const wsMatch = /DevTools listening on ws:\/\/[^:]+:(\d+)\//i.exec(joined);
    if (wsMatch) {
      return Number(wsMatch[1]);
    }

    if (fs.existsSync(activePortPath)) {
      const raw = fs.readFileSync(activePortPath, 'utf8').trim();
      const firstLine = raw.split(/\r?\n/)[0]?.trim();
      const parsed = Number(firstLine);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }

    await new Promise((r) => setTimeout(r, 40));
  }

  throw new Error(
    `Timed out waiting for Chrome DevTools port. stderr: ${stderrChunks.join('').slice(-500)}`,
  );
}

interface CdpTargetInfo {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function findPageTargetWsUrl(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (resp.ok) {
        const targets = (await resp.json()) as CdpTargetInfo[];
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // DevTools HTTP endpoint not ready yet.
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out discovering CDP page target on port ${port}`);
}

class CdpConnection {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly eventListeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      let msg: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string; code?: number };
      };
      try {
        msg = JSON.parse(raw) as typeof msg;
      } catch {
        return;
      }

      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (!entry) {
          return;
        }
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`CDP error (${msg.error.code ?? -1}): ${msg.error.message ?? 'unknown'}`));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }

      if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          const params = msg.params ?? {};
          for (const listener of listeners) {
            listener(params);
          }
        }
      }
    });

    this.ws.addEventListener('close', () => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  public static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out connecting to CDP WebSocket: ${wsUrl}`));
      }, timeoutMs);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`Failed connecting to CDP WebSocket: ${wsUrl}`));
        },
        { once: true },
      );
    });
    return new CdpConnection(ws);
  }

  public on(method: string, listener: (params: Record<string, unknown>) => void): void {
    const existing = this.eventListeners.get(method) ?? [];
    existing.push(listener);
    this.eventListeners.set(method, existing);
  }

  public send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send CDP command ${method}: socket not open`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  public close(): void {
    try {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    } catch {
      // Ignore socket shutdown errors.
    }
  }
}

async function killProcess(proc: ChildProcess): Promise<void> {
  const pid = proc.pid;
  const signalGroup = (sig: NodeJS.Signals): boolean => {
    if (pid) {
      try {
        process.kill(-pid, sig);
        return true;
      } catch {
        // Fallback to direct process signal if group already gone or unsupported.
      }
    }
    try {
      proc.kill(sig);
      return true;
    } catch {
      return false;
    }
  };

  if (proc.exitCode === null) {
    await new Promise<void>((resolve) => {
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          if (killTimer) clearTimeout(killTimer);
          if (hardTimer) clearTimeout(hardTimer);
          resolve();
        }
      };
      proc.once('exit', finish);
      if (!signalGroup('SIGTERM')) {
        finish();
        return;
      }
      killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          if (!signalGroup('SIGKILL')) {
            finish();
          }
        }
      }, 1000);
      killTimer.unref();
      hardTimer = setTimeout(finish, 2500);
      hardTimer.unref();
    });
  }

  // Ensure no Chrome helper subprocess in the group survived the leader exit.
  if (pid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // ESRCH expected when all group processes have exited.
    }
  }
}

async function removeDirBestEffort(dirPath: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fsp.rm(dirPath, {
        recursive: true,
        force: true,
        maxRetries: 12,
        retryDelay: 50,
      });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      if (attempt < 5 && (code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'EPERM')) {
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      if (code === 'ENOTEMPTY' || code === 'EBUSY') {
        return;
      }
      throw err;
    }
  }
}

function formatRemoteObject(obj: Record<string, unknown> | undefined): string {
  if (!obj) {
    return 'unknown';
  }
  if (typeof obj.description === 'string' && obj.description.length > 0) {
    return obj.description;
  }
  if ('value' in obj && obj.value !== undefined) {
    return String(obj.value);
  }
  return typeof obj.type === 'string' ? `[${obj.type}]` : 'unknown';
}

/**
 * Launches headless Chrome via CDP, navigates to `url`, and returns an instrumented page handle.
 */
export async function launchBrowserPage(
  url: string,
  options: LaunchOptions = {},
): Promise<BrowserPage> {
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const chromeBin = findChromeBinary();
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-arcade-cdp-'));
  const stderrChunks: string[] = [];

  const proc = spawn(
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--window-size=${width},${height}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      'about:blank',
    ],
    {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString('utf8'));
  });

  let cdp: CdpConnection | null = null;
  let closed = false;

  const cleanup = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      if (cdp) {
        await Promise.race([
          cdp.send('Browser.close').catch(() => undefined),
          new Promise<void>((r) => setTimeout(r, 400)),
        ]);
        cdp.close();
      }
      await killProcess(proc);
    } finally {
      await removeDirBestEffort(userDataDir);
    }
  };

  try {
    const port = await discoverDebugPort(proc, userDataDir, stderrChunks, timeoutMs);
    const pageWsUrl = await findPageTargetWsUrl(port, timeoutMs);
    cdp = await CdpConnection.connect(pageWsUrl, timeoutMs);

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const requestUrls = new Map<string, string>();

    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails as Record<string, unknown> | undefined;
      const exception = details?.exception as Record<string, unknown> | undefined;
      const msg =
        (typeof exception?.description === 'string' && exception.description) ||
        (typeof details?.text === 'string' && details.text) ||
        'Uncaught page exception';
      pageErrors.push(msg);
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const args = (params.args as Array<Record<string, unknown>> | undefined) ?? [];
        consoleErrors.push(args.map(formatRemoteObject).join(' ') || 'console.error');
      }
    });

    cdp.on('Network.requestWillBeSent', (params) => {
      const requestId = params.requestId as string | undefined;
      const request = params.request as { url?: string } | undefined;
      if (requestId && request?.url) {
        requestUrls.set(requestId, request.url);
      }
    });

    cdp.on('Network.loadingFailed', (params) => {
      const requestId = params.requestId as string | undefined;
      const reqUrl = (requestId ? requestUrls.get(requestId) : undefined) ?? 'unknown-url';
      const errorText = String(params.errorText ?? 'loadingFailed');
      failedRequests.push(`${reqUrl} (${errorText})`);
    });

    cdp.on('Network.responseReceived', (params) => {
      const response = params.response as { status?: number; url?: string } | undefined;
      if (response && typeof response.status === 'number' && response.status >= 400) {
        failedRequests.push(`${response.status} ${response.url ?? ''}`);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loadDone = new Promise<void>((resolve) => {
      cdp?.on('Page.loadEventFired', () => resolve());
    });

    const navResult = await cdp.send<{ errorText?: string }>('Page.navigate', { url });
    if (navResult?.errorText) {
      throw new Error(`Navigation to ${url} failed: ${navResult.errorText}`);
    }

    await Promise.race([
      loadDone,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for page load: ${url}`)), timeoutMs),
      ),
    ]);

    const evaluate = async <T>(expr: string): Promise<T> => {
      if (!cdp) {
        throw new Error('Browser page is closed');
      }
      const res = await cdp.send<{
        result?: { value?: T; description?: string; type?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        const desc =
          res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          'Evaluation error';
        throw new Error(`evaluate(${expr}) failed: ${desc}`);
      }
      return res.result?.value as T;
    };

    const getRect = async (selector: string): Promise<ElementRect> => {
      const rect = await evaluate<ElementRect | null>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom
        };
      })()`);
      if (!rect) {
        throw new Error(`Element not found for selector: ${selector}`);
      }
      return rect;
    };

    const hover = async (selector: string): Promise<void> => {
      if (!cdp) {
        throw new Error('Browser page is closed');
      }
      const rect = await getRect(selector);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        pointerType: 'mouse',
      });
      await new Promise((r) => setTimeout(r, 20));
    };

    const click = async (selector: string): Promise<void> => {
      if (!cdp) {
        throw new Error('Browser page is closed');
      }
      const rect = await getRect(selector);
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error(`Element has zero size for click: ${selector}`);
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        pointerType: 'mouse',
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
        pointerType: 'mouse',
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
        pointerType: 'mouse',
      });
      await new Promise((r) => setTimeout(r, 20));
    };

    const focus = async (selector: string): Promise<void> => {
      const ok = await evaluate<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || typeof el.focus !== 'function') return false;
        el.focus();
        return document.activeElement === el;
      })()`);
      if (!ok) {
        throw new Error(`Unable to focus element for selector: ${selector}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    };

    const pressKey = async (key: string, code?: string): Promise<void> => {
      if (!cdp) {
        throw new Error('Browser page is closed');
      }
      const desc = resolveKeyDescriptor(key, code);
      await cdp.send('Input.dispatchKeyEvent', {
        type: desc.text ? 'keyDown' : 'rawKeyDown',
        key: desc.key,
        code: desc.code,
        windowsVirtualKeyCode: desc.keyCode,
        nativeVirtualKeyCode: desc.keyCode,
        ...(desc.text ? { text: desc.text, unmodifiedText: desc.text } : {}),
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: desc.key,
        code: desc.code,
        windowsVirtualKeyCode: desc.keyCode,
        nativeVirtualKeyCode: desc.keyCode,
      });
      await new Promise((r) => setTimeout(r, 20));
    };

    const waitFor = async (expr: string, waitTimeoutMs = 5000): Promise<void> => {
      const waitDeadline = Date.now() + waitTimeoutMs;
      let lastErr: unknown = null;
      while (Date.now() < waitDeadline) {
        try {
          const ok = await evaluate<boolean>(`Boolean(${expr})`);
          if (ok) {
            return;
          }
          lastErr = null;
        } catch (err) {
          lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      const suffix = lastErr ? ` (last error: ${String(lastErr)})` : '';
      throw new Error(`waitFor(${expr}) timed out after ${waitTimeoutMs}ms${suffix}`);
    };

    await waitFor("document.readyState === 'complete'", timeoutMs);

    return {
      pageErrors,
      consoleErrors,
      failedRequests,
      evaluate,
      click,
      hover,
      focus,
      pressKey,
      waitFor,
      getRect,
      close: cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Convenience wrapper that launches a headless Chrome page, runs `fn`, and always closes Chrome.
 */
export async function withBrowserPage<T>(
  url: string,
  fn: (page: BrowserPage) => Promise<T>,
  options?: LaunchOptions,
): Promise<T> {
  const page = await launchBrowserPage(url, options);
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}
