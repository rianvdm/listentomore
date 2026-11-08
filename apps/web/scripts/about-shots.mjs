// ABOUTME: Captures the six About page tile screenshots (public/images/about/<slug>.webp, 1200x750) with headless Chrome over CDP.
// ABOUTME: Targets local dev: production serves a Cloudflare bot challenge to headless Chrome.
//
// Rerun:
//   1. cd apps/web && pnpm exec wrangler d1 migrations apply DB --local
//   2. Seed a local-only public user (local D1 starts empty; never use --remote):
//      pnpm exec wrangler d1 execute DB --local --command "INSERT OR REPLACE INTO users (id, username, lastfm_username, display_name, profile_visibility) VALUES ('about-shots-bordesak', 'bordesak', 'bordesak', 'bordesak', 'public')"
//   3. pnpm dev (in another terminal; needs API keys in apps/web/.dev.vars)
//   4. pnpm --filter @listentomore/web run about-shots
// Env: BASE_URL (default http://localhost:8787), CHROME_PATH, SETTLE_MS (default 5000).
// Requires Node 22+ (global WebSocket).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787';
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 5000);
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/images/about');

// Mirrors ABOUT_FEATURES in src/pages/about/index.tsx (TSX can't be imported here).
// `scrollToHeading` is text of an <h2> scrolled to the top of the viewport; `scrollY` is a pixel offset.
const SHOTS = [
  { slug: 'album', path: '/album/6dVIqQ8qmQ5GBnJ9shOYGE' },
  { slug: 'genre', path: '/genre' },
  // /stats redirects signed-out visitors to /login, so use the public profile's stats section.
  { slug: 'listening', path: '/u/bordesak', scrollToHeading: 'Top Artists' },
  { slug: 'profile', path: '/u/bordesak', scrollY: 0 },
  { slug: 'discord', path: '/discord' },
  { slug: 'mcp', path: '/tools' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  waitFor(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const fn = (msg) => {
        if (msg.method === method) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve(msg.params);
        }
      };
      this.listeners.push(fn);
    });
  }
}

async function capture(cdp, sessionId, shot) {
  const url = new URL(shot.path, BASE_URL).toString();
  let status = 0;
  const onResponse = (msg) => {
    if (msg.method === 'Network.responseReceived' && msg.params.type === 'Document' && !status) {
      status = msg.params.response.status;
    }
  };
  cdp.listeners.push(onResponse);

  const loaded = cdp.waitFor('Page.loadEventFired');
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  cdp.listeners = cdp.listeners.filter((l) => l !== onResponse);
  await sleep(SETTLE_MS);

  const { result } = await cdp.send(
    'Runtime.evaluate',
    { expression: 'document.title', returnByValue: true },
    sessionId,
  );
  if (status !== 200) throw new Error(`${shot.slug}: ${url} returned status ${status}`);
  if (String(result.value).includes('Attention Required')) {
    throw new Error(`${shot.slug}: ${url} served a Cloudflare challenge page`);
  }

  if (shot.scrollToHeading) {
    const expr = `(() => { const el = [...document.querySelectorAll('h2')].find((h) => h.textContent.includes(${JSON.stringify(shot.scrollToHeading)})); if (!el) return false; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24); return true; })()`;
    const { result: found } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
    if (!found.value) throw new Error(`${shot.slug}: heading ${shot.scrollToHeading} not found on ${url}`);
    await sleep(1000);
  } else if (shot.scrollY !== undefined) {
    await cdp.send('Runtime.evaluate', { expression: `window.scrollTo(0, ${shot.scrollY})` }, sessionId);
    await sleep(500);
  }

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'webp', quality: 80, captureBeyondViewport: false },
    sessionId,
  );
  const file = path.join(OUT_DIR, `${shot.slug}.webp`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`${shot.slug}: ${url} -> ${file}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const port = await freePort();
  const profileDir = mkdtempSync(path.join(tmpdir(), 'about-shots-'));
  const chrome = spawn(
    CHROME_PATH,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', 'about:blank'],
    { stdio: 'ignore' },
  );

  try {
    const { webSocketDebuggerUrl } = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);

    for (const shot of SHOTS) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await capture(cdp, sessionId, shot);
    }
    ws.close();
  } finally {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
    // Chrome's helper processes can still hold files briefly after the main process exits.
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
