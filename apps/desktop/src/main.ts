/**
 * Electron main process for the AI Reading Assistant (local-only macOS desktop).
 *
 * Responsibilities:
 *   1. Resolve the per-user data directory and pass it to the API.
 *   2. Spawn the embedded NestJS API as a child node process on 127.0.0.1:4317.
 *   3. Wait until the API is healthy, then open the renderer window.
 *   4. Clean up the API child process on quit.
 *
 * ---------------------------------------------------------------------------
 * HOW THE API IS LAUNCHED
 * ---------------------------------------------------------------------------
 * DEV (ELECTRON_DEV=1):
 *   We are running from the repo working tree. The API entry is
 *   `<repoRoot>/apps/api/dist/main.js`, spawned with the system `node`
 *   (process.execPath is the Electron binary in dev, so we use ELECTRON_RUN_AS_NODE
 *   to make it behave as plain node). cwd is the api package dir so Prisma resolves
 *   its schema/engine from apps/api/node_modules as usual.
 *   The renderer is loaded from the Next dev server at http://localhost:3000.
 *
 * PACKAGED (electron-builder, asar):
 *   extraResources places files under `process.resourcesPath`:
 *     - resources/api/dist/main.js        -> API entry
 *     - resources/api/node_modules/**      -> API runtime deps (incl. @prisma/client,
 *                                             .prisma/client, query engine binary —
 *                                             unpacked from asar via asarUnpack)
 *     - resources/api/prisma/schema.prisma -> Prisma schema
 *     - resources/web/index.html           -> static Next.js export (loadFile)
 *   The API is spawned with `process.execPath` (the Electron binary) + env
 *   ELECTRON_RUN_AS_NODE=1, which runs it as a plain Node process using Electron's
 *   bundled Node runtime — so we don't ship a separate node binary. cwd is set to
 *   resources/api so Prisma resolves engine/schema relative to it.
 * ---------------------------------------------------------------------------
 */
import { app, BrowserWindow, ipcMain, shell, protocol, net, Notification } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// --- Contract constants (see MIGRATION_PLAN.md) ---------------------------
// TODO(free-port): v1 keeps the API port fixed at 4317. A future improvement is
// to scan for a free port and pass it through to both the API (API_PORT) and the
// renderer (NEXT_PUBLIC_API_URL is build-time today, so this needs a runtime
// handshake — e.g. inject the port via the preload bridge).
const API_PORT = 4317;
const API_HOST = '127.0.0.1';

// Custom scheme used to serve the static Next.js export as a real web "origin"
// in packaged mode. Loading the export over file:// breaks because Next emits
// absolute asset paths (/_next/...) and clean route links (/library,
// /read?bookId=...). Serving it from app://local/ makes those resolve, and the
// handler maps extension-less routes to their .html files.
const APP_SCHEME = 'app';
const APP_ORIGIN = 'app://local/';

// Update notifications use GitHub Releases as a zero-cost backend: on launch we
// ask the public GitHub API for the latest release and, if it's newer than the
// running version, show a notification that opens the download page. No server
// to host, and (unlike electron-updater auto-install) no code-signing needed —
// the user downloads + installs the new DMG manually. See checkForUpdates().
const GITHUB_REPO = 'tuanh2000/ai-reading-assistant';
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
// Delay the check so it never competes with API boot / first paint.
const UPDATE_CHECK_DELAY_MS = 5_000;

const HEALTH_PATH = '/api/books';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 400;

// Stable, human-readable name so the data dir is
// ~/Library/Application Support/AI Reading Assistant (not the package name
// "@reader/desktop"). Must be set before any app.getPath('userData') read.
app.setName('AI Reading Assistant');

const isDev = process.env.ELECTRON_DEV === '1' || !app.isPackaged;

let apiProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let apiExited = false;

// --- Paths ----------------------------------------------------------------

/** Repo root (dev only): apps/desktop/dist/main.js -> up 3 levels. */
function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

interface ApiLaunch {
  entry: string;
  cwd: string;
}

function resolveApiLaunch(): ApiLaunch {
  if (isDev) {
    const apiDir = path.join(repoRoot(), 'apps', 'api');
    return { entry: path.join(apiDir, 'dist', 'main.js'), cwd: apiDir };
  }
  // Packaged: files placed by electron-builder extraResources.
  const apiDir = path.join(process.resourcesPath, 'api');
  return { entry: path.join(apiDir, 'dist', 'main.js'), cwd: apiDir };
}

/** Packaged: directory holding the static Next.js export (resources/web). */
function resolveRendererDir(): string {
  return path.join(process.resourcesPath, 'web');
}

/**
 * Serve the static export over the custom app:// scheme.
 *
 *   app://local/                 -> index.html
 *   app://local/_next/static/... -> the asset file
 *   app://local/library          -> library.html   (clean route → .html)
 *   app://local/read?bookId=x    -> read.html
 *
 * The scheme is registered as standard+secure (see registerSchemesAsPrivileged
 * at module load) so absolute asset paths and the History API behave as on http.
 */
function registerAppProtocol(rendererDir: string): void {
  const root = path.normalize(rendererDir);
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';

    let filePath = path.normalize(path.join(root, rel));

    // Map extension-less clean routes (e.g. /library) to their exported .html.
    if (!path.extname(filePath)) {
      if (fs.existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
      else if (fs.existsSync(path.join(filePath, 'index.html')))
        filePath = path.join(filePath, 'index.html');
    }

    // Containment guard: never serve outside the renderer dir.
    if (!filePath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      const notFound = path.join(root, '404.html');
      if (fs.existsSync(notFound)) {
        return net.fetch(pathToFileURL(notFound).toString());
      }
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// --- API child process ----------------------------------------------------

function ensureDataDir(): string {
  const dataDir = app.getPath('userData');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  } catch (err) {
    console.error('[desktop] failed to create data dir', dataDir, err);
  }
  return dataDir;
}

/**
 * The API encrypts user-supplied AI provider keys with AES-256-GCM, keyed by
 * APP_ENCRYPTION_KEY. In dev the API picks this up from the repo .env; the
 * packaged app gets no .env, so we must supply it here or saving a key 500s.
 *
 * We generate a random 32-byte secret on first run and persist it in the data
 * dir (mode 0600) so stored keys stay decryptable across restarts. It lives
 * next to reader.db — same trust boundary as the encrypted data it protects.
 */
function getOrCreateEncryptionKey(dataDir: string): string {
  const keyFile = path.join(dataDir, '.encryption-key');
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing) return existing;
    }
  } catch (err) {
    console.error('[desktop] failed to read encryption key, regenerating', err);
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
  } catch (err) {
    console.error('[desktop] failed to persist encryption key', err);
  }
  return secret;
}

function startApi(dataDir: string): void {
  const { entry, cwd } = resolveApiLaunch();

  if (!fs.existsSync(entry)) {
    console.error(
      `[desktop] API entry not found at ${entry}. ` +
        `Did you build the API (pnpm --filter @reader/api build)?`,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Run Electron's binary as plain Node (uses bundled Node runtime in prod).
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    READER_DATA_DIR: dataDir,
    API_PORT: String(API_PORT),
    // Bind localhost-only per contract; the API builds DATABASE_URL from
    // READER_DATA_DIR itself (file:${READER_DATA_DIR}/reader.db).
    API_HOST,
    // Secret the API uses to AES-encrypt stored AI provider keys.
    APP_ENCRYPTION_KEY: getOrCreateEncryptionKey(dataDir),
  };

  console.log(`[desktop] spawning API: ${process.execPath} ${entry} (cwd=${cwd})`);
  apiProcess = spawn(process.execPath, [entry], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  apiProcess.stdout?.on('data', (d) => process.stdout.write(`[api] ${d}`));
  apiProcess.stderr?.on('data', (d) => process.stderr.write(`[api] ${d}`));

  apiProcess.on('exit', (code, signal) => {
    apiExited = true;
    console.log(`[desktop] API process exited code=${code} signal=${signal}`);
  });
  apiProcess.on('error', (err) => {
    console.error('[desktop] failed to spawn API process', err);
  });
}

function stopApi(): void {
  if (apiProcess && !apiExited) {
    console.log('[desktop] stopping API process');
    try {
      apiProcess.kill('SIGTERM');
      // TODO(windows): SIGTERM is best-effort on win32; use taskkill /pid /T /F.
    } catch (err) {
      console.error('[desktop] error stopping API', err);
    }
  }
  apiProcess = null;
}

// --- Health wait ----------------------------------------------------------

function pingApi(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: API_HOST, port: API_PORT, path: HEALTH_PATH, timeout: 2000 },
      (res) => {
        // Any HTTP response means the server is up and routing requests.
        res.resume();
        resolve(true);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForApi(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (apiExited) {
      console.error('[desktop] API exited before becoming healthy');
      return false;
    }
    if (await pingApi()) {
      console.log('[desktop] API is healthy');
      return true;
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
  }
  console.error(`[desktop] API health check timed out after ${HEALTH_TIMEOUT_MS}ms`);
  return false;
}

// --- Update notifications (zero-cost, via GitHub Releases) -----------------

/**
 * Compare two dotted version strings (e.g. "0.2.0" vs "0.1.3"). Returns a
 * positive number if `a` is newer than `b`, negative if older, 0 if equal.
 * Any pre-release suffix (e.g. "-beta.1") is ignored — good enough to decide
 * "is there a newer stable release than what I'm running".
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Ask GitHub for the latest published release and, if it's newer than the
 * running version, show a notification that opens the release page when
 * clicked. Best-effort and silent on any failure (offline, rate-limited, no
 * releases yet) — a failed update check must never disrupt the app.
 *
 * Cost model: GitHub's REST API and release downloads are free for public
 * repos. One unauthenticated request per launch is far under the 60/hour/IP
 * limit. There is no server to run.
 */
async function checkForUpdates(): Promise<void> {
  if (isDev) return; // dev builds report version 0.0.0-ish; don't nag.
  if (!Notification.isSupported()) return;

  try {
    const res = await net.fetch(LATEST_RELEASE_API, {
      headers: {
        // GitHub requires a User-Agent; the API version header is recommended.
        'User-Agent': 'AI-Reading-Assistant',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) {
      console.log(`[desktop] update check skipped (HTTP ${res.status})`);
      return;
    }
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      name?: string;
    };
    const latest = release.tag_name;
    const current = app.getVersion();
    if (!latest || compareVersions(latest, current) <= 0) {
      console.log(`[desktop] up to date (current ${current}, latest ${latest ?? 'n/a'})`);
      return;
    }

    console.log(`[desktop] update available: ${current} -> ${latest}`);
    const downloadUrl = release.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`;
    const notification = new Notification({
      title: 'Update available',
      body: `AI Reading Assistant ${latest} is available. Click to download.`,
    });
    notification.on('click', () => {
      void shell.openExternal(downloadUrl);
    });
    notification.show();
  } catch (err) {
    console.log('[desktop] update check failed (ignored):', (err as Error).message);
  }
}

// --- Window ---------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'AI Reading Assistant',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the system browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('file://') ||
      url.startsWith(`${APP_SCHEME}://`)
    ) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL(APP_ORIGIN);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- App lifecycle --------------------------------------------------------

async function bootstrap(): Promise<void> {
  ipcMain.handle('desktop:get-version', () => app.getVersion());

  // In packaged mode the renderer is served over app:// from resources/web.
  if (!isDev) {
    registerAppProtocol(resolveRendererDir());
  }

  const dataDir = ensureDataDir();
  console.log(`[desktop] data dir: ${dataDir}`);
  startApi(dataDir);

  const healthy = await waitForApi();
  if (!healthy) {
    // Still open the window so the user sees *something* and logs are visible;
    // the renderer will surface API errors on its own.
    console.error('[desktop] proceeding to open window despite unhealthy API');
  }
  createWindow();

  // Best-effort, non-blocking update check a few seconds after launch.
  setTimeout(() => {
    void checkForUpdates();
  }, UPDATE_CHECK_DELAY_MS);
}

// Must run before app 'ready': make app:// behave like a standard, secure
// origin so absolute asset paths, fetch, and the History API work.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// Single-instance lock: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      console.error('[desktop] bootstrap failed', err);
      app.quit();
    });

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    // macOS apps typically stay alive until Cmd+Q, but this is a
    // single-window document app — quit fully so the API is torn down.
    stopApi();
    app.quit();
  });

  app.on('before-quit', () => {
    stopApi();
  });
}
