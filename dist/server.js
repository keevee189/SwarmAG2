import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const DEFAULT_PORT = 4173;
export const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
};
/**
 * Resolves the workspace root directory when not explicitly provided.
 */
export function resolveDefaultRootDir() {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    let current = moduleDir;
    for (let i = 0; i < 4; i += 1) {
        if (fs.existsSync(path.join(current, 'package.json')) &&
            fs.existsSync(path.join(current, 'ts'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return process.cwd();
}
function sendPlain(res, statusCode, message, headOnly = false) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    if (headOnly) {
        res.end();
        return;
    }
    res.end(message);
}
/**
 * Creates a zero-dependency static HTTP server for Nexus Arcade.
 */
export function createAppServer(rootDir = resolveDefaultRootDir()) {
    const resolvedRoot = path.resolve(rootDir);
    return http.createServer(async (req, res) => {
        const method = (req.method ?? 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
            sendPlain(res, 405, 'Method Not Allowed', false);
            return;
        }
        const headOnly = method === 'HEAD';
        const rawUrl = req.url ?? '/';
        const rawPath = rawUrl.split('?')[0].split('#')[0];
        if (rawPath.includes('\0')) {
            sendPlain(res, 400, 'Bad Request', headOnly);
            return;
        }
        let decodedPath;
        try {
            decodedPath = decodeURIComponent(rawPath);
        }
        catch {
            sendPlain(res, 400, 'Bad Request', headOnly);
            return;
        }
        if (decodedPath.includes('\0')) {
            sendPlain(res, 400, 'Bad Request', headOnly);
            return;
        }
        const segments = decodedPath.split(/[\\/]/);
        if (segments.includes('..')) {
            sendPlain(res, 403, 'Forbidden', headOnly);
            return;
        }
        const relativeTarget = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
        const candidatePath = path.resolve(resolvedRoot, relativeTarget);
        if (candidatePath !== resolvedRoot && !candidatePath.startsWith(resolvedRoot + path.sep)) {
            sendPlain(res, 403, 'Forbidden', headOnly);
            return;
        }
        try {
            const stat = await fsp.stat(candidatePath);
            if (!stat.isFile()) {
                sendPlain(res, 404, 'Not Found', headOnly);
                return;
            }
            const realRoot = await fsp.realpath(resolvedRoot);
            const realFile = await fsp.realpath(candidatePath);
            if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
                sendPlain(res, 403, 'Forbidden', headOnly);
                return;
            }
            const ext = path.extname(realFile).toLowerCase();
            const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
            const content = await fsp.readFile(realFile);
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': content.byteLength,
                'Cache-Control': 'no-store',
            });
            if (headOnly) {
                res.end();
                return;
            }
            res.end(content);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                sendPlain(res, 404, 'Not Found', headOnly);
                return;
            }
            sendPlain(res, 500, 'Internal Server Error', headOnly);
        }
    });
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function waitForHttpReady(port, childPid, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    const url = `http://127.0.0.1:${port}/`;
    while (Date.now() < deadline) {
        if (!isProcessAlive(childPid)) {
            throw new Error(`Daemon process ${childPid} exited prematurely. Check server.log.`);
        }
        try {
            const resp = await fetch(url);
            if (resp.status === 200) {
                return;
            }
        }
        catch {
            // Server not listening yet.
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for server at ${url}`);
}
async function runForeground(rootDir, port) {
    const pidPath = path.join(rootDir, '.server.pid');
    const server = createAppServer(rootDir);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    await fsp.writeFile(pidPath, `${process.pid}\n`, 'utf8');
    console.log(`Nexus Arcade server running at http://localhost:${port} (PID ${process.pid})`);
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        try {
            const currentPid = fs.existsSync(pidPath) ? fs.readFileSync(pidPath, 'utf8').trim() : '';
            if (currentPid === String(process.pid)) {
                fs.unlinkSync(pidPath);
            }
        }
        catch {
            // Ignore PID cleanup errors.
        }
        server.closeAllConnections?.();
        server.close(() => {
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
async function runDaemon(rootDir, port) {
    const pidPath = path.join(rootDir, '.server.pid');
    const logPath = path.join(rootDir, 'server.log');
    if (fs.existsSync(pidPath)) {
        const existingRaw = fs.readFileSync(pidPath, 'utf8').trim();
        const existingPid = Number(existingRaw);
        if (Number.isInteger(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
            console.log(`Nexus Arcade server already running at http://localhost:${port} (PID ${existingPid})`);
            return;
        }
        try {
            fs.unlinkSync(pidPath);
        }
        catch {
            // Ignore stale PID cleanup errors.
        }
    }
    const outFd = fs.openSync(logPath, 'a');
    const errFd = fs.openSync(logPath, 'a');
    const scriptPath = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [scriptPath], {
        cwd: rootDir,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        env: {
            ...process.env,
            PORT: String(port),
        },
    });
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    child.unref();
    const childPid = child.pid;
    if (!childPid) {
        throw new Error('Failed to spawn Nexus Arcade daemon process.');
    }
    await waitForHttpReady(port, childPid);
    console.log(`http://localhost:${port} (PID ${childPid})`);
}
async function runStop(rootDir) {
    const pidPath = path.join(rootDir, '.server.pid');
    if (!fs.existsSync(pidPath)) {
        console.log('No .server.pid file found; Nexus Arcade server is not running.');
        return;
    }
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) {
        await fsp.rm(pidPath, { force: true });
        console.log('Removed invalid .server.pid file.');
        return;
    }
    if (isProcessAlive(pid)) {
        process.kill(pid, 'SIGTERM');
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && isProcessAlive(pid)) {
            await new Promise((r) => setTimeout(r, 80));
        }
        if (isProcessAlive(pid)) {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch {
                // Process exited concurrently.
            }
        }
        console.log(`Stopped Nexus Arcade server (PID ${pid}).`);
    }
    else {
        console.log(`Cleaned up stale PID file for process ${pid}.`);
    }
    await fsp.rm(pidPath, { force: true });
}
function isDirectCliExecution() {
    const arg = process.argv[1];
    if (!arg) {
        return false;
    }
    try {
        return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
    }
}
if (isDirectCliExecution()) {
    const rootDir = resolveDefaultRootDir();
    const port = Number(process.env.PORT) || DEFAULT_PORT;
    const args = new Set(process.argv.slice(2));
    const main = async () => {
        if (args.has('--stop')) {
            await runStop(rootDir);
            return;
        }
        if (args.has('--daemon')) {
            await runDaemon(rootDir, port);
            return;
        }
        await runForeground(rootDir, port);
    };
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map