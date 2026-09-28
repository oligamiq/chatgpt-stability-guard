#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const TEST_MODE = process.env.CSG_AUTH_CANARY_TEST_MODE === '1';
const TARGET_URL = process.env.CSG_AUTH_CANARY_URL || '';
const PROFILE_DIR = process.env.CSG_AUTH_CANARY_PROFILE || '/home/oligami/.local/share/csg-auth-canary-profile';
const LOCAL_STATE_DIR = process.env.CSG_AUTH_CANARY_STATE_DIR || '/home/oligami/.local/state/chatgpt-stability-guard/auth-canary';
const XVFB_BIN = process.env.CSG_AUTH_CANARY_XVFB || '/home/oligami/.local/opt/xvfb/usr/bin/Xvfb';
const ROOT_TIMEOUT_MS = TEST_MODE ? Number(process.env.CSG_AUTH_CANARY_ROOT_TIMEOUT_MS || 3000) : 30000;

class CompatibilityFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompatibilityFailure';
  }
}

class AuthFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthFailure';
  }
}
function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {}
  }
  throw new Error('Chrome/Chromium not found');
}

function findXvfb() {
  if (fs.existsSync(XVFB_BIN)) return XVFB_BIN;
  try { return execFileSync('which', ['Xvfb'], { encoding: 'utf8' }).trim(); } catch {}
  throw new Error(`Xvfb not found: ${XVFB_BIN}`);
}

async function launchVirtualDisplay() {
  const xvfb = findXvfb();
  let number = 90 + (process.pid % 100);
  while (number < 250 && fs.existsSync(`/tmp/.X11-unix/X${number}`)) number += 1;
  if (number >= 250) throw new Error('could not allocate an Xvfb display');
  const display = `:${number}`;
  const child = spawn(xvfb, [display, '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-noreset', '-ac'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    await waitFor(() => fs.existsSync(`/tmp/.X11-unix/X${number}`) ? display : null, 5000, 100);
  } catch (error) {
    await stopChild(child);
    throw new Error(`Xvfb failed to start: ${stderr.slice(-1000) || error.message}`);
  }
  return { child, display };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1200)]);
  if (child.exitCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1200)]);
}

function cleanupLocks(profile) {
  for (const name of ['SingletonCookie', 'SingletonLock', 'SingletonSocket', 'DevToolsActivePort']) {
    try { fs.rmSync(path.join(profile, name), { force: true }); } catch {}
  }
}
class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluation failed';
      throw new Error(description);
    }
    return result.result?.value;
  }

  close() { try { this.socket.close(); } catch {} }
}
async function waitFor(check, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      last = await check();
      lastError = '';
      if (last) return last;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? `; error=${lastError}` : '';
  throw new Error(`Timed out waiting for canary state; last=${JSON.stringify(last)}${suffix}`);
}

function validPrivateUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com' && /^\/(?:g\/[^/]+\/)?c\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function scriptSource(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

async function launchChrome() {
  const chrome = findChrome();
  let virtualDisplay = null;
  let profile = PROFILE_DIR;
  if (TEST_MODE) {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'csg-auth-canary-test-'));
  } else {
    if (!TARGET_URL || !validPrivateUrl(TARGET_URL)) throw new Error('CSG_AUTH_CANARY_URL must be a private ChatGPT conversation URL');
    if (!fs.existsSync(profile)) throw new Error(`authenticated Chrome profile not found: ${profile}`);
    cleanupLocks(profile);
  }
  const args = [
    `--user-data-dir=${profile}`,
    '--profile-directory=Default',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (TEST_MODE) {
    args.push('--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
  } else {
    args.push('--start-minimized', '--window-position=-20000,-20000');
  }
  args.push(TARGET_URL);

  if (!TEST_MODE) virtualDisplay = await launchVirtualDisplay();
  const env = TEST_MODE ? process.env : { ...process.env, DISPLAY: virtualDisplay.display };
  if (!TEST_MODE) delete env.XAUTHORITY;
  const child = spawn(chrome, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const browserWs = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome DevTools startup timed out: ${stderr.slice(-1000)}`)), 20000);
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools became ready: ${code}; ${stderr.slice(-1000)}`));
    });
  });
  return { child, profile, browserWs, virtualDisplay };
}
async function pageTarget(browserWs) {
  const host = new URL(browserWs).host;
  const expectedPath = (() => { try { return new URL(TARGET_URL).pathname; } catch { return ''; } })();
  return waitFor(async () => {
    const targets = await (await fetch(`http://${host}/json/list`)).json();
    return targets.find(target => {
      if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
      if (TEST_MODE) return target.url.startsWith(TARGET_URL);
      try {
        const parsed = new URL(target.url);
        return parsed.hostname === 'chatgpt.com' && parsed.pathname === expectedPath;
      } catch { return false; }
    }) || null;
  }, 15000);
}

async function installChromeStub(cdp) {
  await cdp.evaluate(`(() => {
    const overrides = {
      enabled:true, hideThinking:false, hideTools:false,
      hideToolSummary:true, hideToolEmbeds:true,
      prehideToolPlaceholders:false, hideOldAppLoadErrors:true,
      dimTraces:true, compactTraces:true, reduceMotion:true,
      lazyHeavyBlocks:true, freezeOldTurns:false,
      showRecentOnly:false, autoContinueIncomplete:false,
      showStatus:false
    };
    globalThis.chrome = globalThis.chrome || {};
    chrome.runtime = { onMessage: { addListener() {} } };
    chrome.storage = { local: {
      remove() { return Promise.resolve(); },
      get(defaults = {}, callback) {
        const value = Object.prototype.hasOwnProperty.call(defaults, 'settings')
          ? { settings: Object.assign({}, defaults.settings || {}, overrides) }
          : Object.assign({}, defaults, { uiLanguage: 'en' });
        if (typeof callback === 'function') { callback(value); return undefined; }
        return Promise.resolve(value);
      }
    } };
  })()`);
}
async function injectStyle(cdp, css) {
  const encoded = JSON.stringify(css);
  await cdp.evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'csg-auth-canary-style';
    style.textContent = ${encoded};
    document.head.appendChild(style);
  })()`);
}

async function injectScript(cdp, source) {
  await cdp.evaluate(`${source}\n//# sourceURL=csg-authenticated-canary-content.js`);
}

async function snapshot(cdp) {
  return cdp.evaluate(`(() => {
    const root = document.documentElement;
    const bodyText = String(document.body?.innerText || '').slice(0, 1000).toLowerCase();
    const title = String(document.title || '').toLowerCase();
    const challengePage = (title.includes('just a moment') || bodyText.includes('just a moment')) &&
      (bodyText.includes('security') || bodyText.includes('verify') || bodyText.includes('cloudflare'));
    const loginPage = location.pathname.startsWith('/auth/') || bodyText.includes('log in or sign up');
    const exchanges = [...document.querySelectorAll('[data-turn-key]')];
    const portals = [...document.querySelectorAll('[data-mcp-app-portal-target]')]
      .filter(portal => portal.closest('[data-turn-key]') && portal.querySelector('iframe[title="desktop-commander-home"]'));
    const portalRows = portals.map(portal => {
      const rect = portal.getBoundingClientRect();
      const style = getComputedStyle(portal);
      const header = portal.previousElementSibling;
      const headerRect = header?.getBoundingClientRect();
      const headerStyle = header ? getComputedStyle(header) : null;
      return {
        hidden: style.display === 'none' && rect.width === 0 && rect.height === 0,
        owned: portal.getAttribute('data-csg-inline-preview-hidden') === 'true',
        headerHidden: !header || (headerStyle.display === 'none' && headerRect.width === 0 && headerRect.height === 0),
        iframeConnected: Boolean(portal.querySelector('iframe[title="desktop-commander-home"]')?.isConnected),
      };
    });
    const resultCards = [...document.querySelectorAll('.csg-tool-result-card')];
    const resultVisible = resultCards.filter(card => {
      const r = card.getBoundingClientRect(), s = getComputedStyle(card);
      return s.display !== 'none' && r.width > 0 && r.height > 0;
    }).length;
    return {
      pageReady: document.readyState !== 'loading' && Boolean(document.body),
      challengePage,
      loginPage,
      routePrivate: location.pathname.startsWith('/c/') || (location.pathname.startsWith('/g/') && location.pathname.includes('/c/')),
      exchangeCount: exchanges.length,
      portalCount: portalRows.length,
      hiddenPortalCount: portalRows.filter(row => row.hidden && row.owned).length,
      visiblePortalCount: portalRows.filter(row => !row.hidden).length,
      visibleHeaderCount: portalRows.filter(row => !row.headerHidden).length,
      iframeConnectedCount: portalRows.filter(row => row.iframeConnected).length,
      resultCardCount: resultCards.length,
      visibleResultCardCount: resultVisible,
      contentReady: root?.dataset.csgContentReady || '',
      hideEmbedGate: Boolean(root?.classList.contains('csg-hide-tool-embeds')),
      hideSummaryGate: Boolean(root?.classList.contains('csg-hide-tool-summary')),
    };
  })()`);
}

async function captureLocalScreenshot(cdp) {
  if (TEST_MODE) return '';
  fs.mkdirSync(LOCAL_STATE_DIR, { recursive: true, mode: 0o700 });
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const latest = path.join(LOCAL_STATE_DIR, 'latest.png');
  fs.writeFileSync(latest, Buffer.from(result.data, 'base64'), { mode: 0o600 });
  return latest;
}

function writeArtifact(payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const target = path.join(ARTIFACT_DIR, 'authenticated-site-canary.json');
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}
async function runCanary() {
  const launched = await launchChrome();
  let cdp;
  try {
    const target = await pageTarget(launched.browserWs);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const loaded = await waitFor(async () => {
      const state = await snapshot(cdp);
      return state.pageReady ? state : null;
    }, 30000);
    if (loaded.challengePage) throw new AuthFailure('ChatGPT returned a challenge page');

    let before;
    try {
      before = await waitFor(async () => {
        const state = await snapshot(cdp);
        return state.routePrivate && state.exchangeCount >= 4 && state.portalCount >= 1 ? state : null;
      }, ROOT_TIMEOUT_MS);
    } catch (error) {
      const final = await snapshot(cdp);
      if (final.challengePage) throw new AuthFailure('ChatGPT returned a challenge page');
      if (final.loginPage || !final.routePrivate) throw new AuthFailure('authenticated private conversation is no longer available');
      throw new CompatibilityFailure(`authenticated DOM contract changed: exchanges=${final.exchangeCount}, mcpPortals=${final.portalCount}`);
    }

    await installChromeStub(cdp);
    await injectStyle(cdp, scriptSource('content.css'));
    await injectScript(cdp, scriptSource('content.js'));

    const settled = await waitFor(async () => {
      const state = await snapshot(cdp);
      const fullySuppressed = state.contentReady === '1' && state.portalCount >= 1 &&
        state.hiddenPortalCount === state.portalCount && state.visiblePortalCount === 0 &&
        state.visibleHeaderCount === 0 && state.iframeConnectedCount === state.portalCount;
      return fullySuppressed ? state : null;
    }, 15000, 300);

    const failures = [];
    if (settled.exchangeCount < 4) failures.push(`authenticated exchange roots dropped to ${settled.exchangeCount}`);
    if (settled.portalCount < 1) failures.push('desktop-commander MCP portals disappeared from the canary conversation');
    if (settled.hiddenPortalCount !== settled.portalCount) failures.push(`only ${settled.hiddenPortalCount}/${settled.portalCount} MCP portals were hidden`);
    if (settled.visiblePortalCount !== 0) failures.push(`${settled.visiblePortalCount} MCP portal(s) remain visible`);
    if (settled.visibleHeaderCount !== 0) failures.push(`${settled.visibleHeaderCount} MCP header(s) remain visible`);
    if (settled.iframeConnectedCount !== settled.portalCount) failures.push('one or more MCP iframes were detached instead of being safely hidden');
    if (!settled.hideEmbedGate || !settled.hideSummaryGate) failures.push('Guard root setting gates are missing after injection');
    if (settled.visibleResultCardCount !== 0) failures.push(`${settled.visibleResultCardCount} classified tool result card(s) remain visible`);

    const screenshotPath = await captureLocalScreenshot(cdp);
    const result = { mode: TEST_MODE ? 'fixture' : 'authenticated-live', before, after: settled, failures, screenshotSavedLocally: Boolean(screenshotPath) };
    if (failures.length) throw new CompatibilityFailure(failures.join('; '));
    return result;
  } finally {
    cdp?.close();
    await stopChild(launched.child);
    if (launched.virtualDisplay?.child) await stopChild(launched.virtualDisplay.child);
    if (TEST_MODE) {
      try { fs.rmSync(launched.profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch {}
    } else {
      cleanupLocks(launched.profile);
    }
  }
}
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
try {
  const result = await runCanary();
  const artifact = writeArtifact(result);
  console.log(`PASS authenticated-site canary: ${result.after.hiddenPortalCount}/${result.after.portalCount} MCP portals hidden; ${result.after.exchangeCount} exchange roots`);
  console.log(`Diagnostics: ${artifact}`);
} catch (error) {
  const compatibility = error instanceof CompatibilityFailure;
  const auth = error instanceof AuthFailure;
  const errorType = compatibility ? 'compatibility' : auth ? 'authentication' : 'infrastructure';
  const artifact = writeArtifact({
    mode: TEST_MODE ? 'fixture' : 'authenticated-live',
    errorType,
    fatalError: String(error?.message || error),
  });
  console.error(`${compatibility ? 'AUTHENTICATED SITE CANARY FAILED' : 'AUTHENTICATED SITE CANARY ERROR'}: ${error?.message || error}`);
  console.error(`Diagnostics: ${artifact}`);
  process.exitCode = compatibility ? 2 : 3;
}
