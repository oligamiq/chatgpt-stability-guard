#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const DEFAULT_URL = 'https://chatgpt.com/share/6a71b843-4fcc-83eb-8eb5-42706097b7e0';
const TARGET_URL = process.env.CSG_LIVE_CHAT_URL || DEFAULT_URL;
const TEST_MODE = process.env.CSG_LIVE_SMOKE_TEST_MODE === '1';
const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';

class CompatibilityFailure extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CompatibilityFailure';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(700),
  ]);
  if (child.exitCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(700),
  ]);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.closedError = null;
    const failPending = error => {
      if (this.closedError) return;
      this.closedError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true });
      this.socket.addEventListener('close', () => reject(new Error('CDP WebSocket closed before ready')), { once: true });
    });
    this.socket.addEventListener('close', () => failPending(new Error('CDP WebSocket closed')));
    this.socket.addEventListener('error', () => failPending(new Error('CDP WebSocket error')));
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
    if (this.closedError) throw this.closedError;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP WebSocket is not open');
    const id = this.nextId++;
    let rejectResponse;
    const response = new Promise((resolve, reject) => {
      rejectResponse = reject;
      this.pending.set(id, { resolve, reject });
    });
    try {
      this.socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      this.pending.delete(id);
      rejectResponse(error);
    }
    return response;
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text || 'evaluation failed';
      throw new Error(description);
    }
    return response.result?.value;
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

function isTransientNavigationError(error) {
  const message = String(error?.message || error);
  return /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed/i.test(message);
}

async function waitFor(check, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastTransientError = '';
  while (Date.now() < deadline) {
    try {
      last = await check();
      lastTransientError = '';
      if (last) return last;
    } catch (error) {
      if (!isTransientNavigationError(error)) throw error;
      last = null;
      lastTransientError = String(error?.message || error);
    }
    await sleep(intervalMs);
  }
  const transient = lastTransientError ? `; transient=${lastTransientError}` : '';
  throw new Error(`Timed out waiting for live page state; last=${JSON.stringify(last)}${transient}`);
}

async function launchChrome(url) {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'csg-live-smoke-'));
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let browserWs;
  try {
    browserWs = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`Chrome DevTools startup timed out: ${stderr.slice(-1200)}`)), 15000);
      child.stderr.on('data', chunk => {
        stderr += String(chunk);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (!match) return;
        clearTimeout(timer);
        resolve(match[1]);
      });
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited before DevTools became ready: ${code}; ${stderr.slice(-1200)}`));
      });
    });
  } catch (error) {
    await stopChild(child);
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }

  return { child, profile, browserWs };
}

async function pageTarget(browserWs) {
  const parsed = new URL(browserWs);
  const endpoint = `http://${parsed.host}/json/list`;
  return waitFor(async () => {
    try {
      const targets = await (await fetch(endpoint)).json();
      return targets.find(target => {
        if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
        if (TEST_MODE) return target.url.includes('/share/');
        return target.url.startsWith('https://chatgpt.com/share/');
      }) || null;
    } catch {
      return null;
    }
  }, 15000);
}

function scriptSource(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

async function installChromeStub(cdp, settings) {
  const serialized = JSON.stringify(settings);
  await cdp.evaluate(`(() => {
    const settings = ${serialized};
    globalThis.__csgSmokeSettings = settings;
    globalThis.chrome = globalThis.chrome || {};
    chrome.runtime = { onMessage: { addListener() {} } };
    chrome.storage = { local: {
      remove() { return Promise.resolve(); },
      get(defaults = {}, callback) {
        const value = Object.prototype.hasOwnProperty.call(defaults, 'settings')
          ? { settings: Object.assign({}, defaults.settings || {}, globalThis.__csgSmokeSettings) }
          : Object.assign({}, defaults, { uiLanguage: 'en' });
        if (typeof callback === 'function') {
          callback(value);
          return undefined;
        }
        return Promise.resolve(value);
      }
    } };
  })()`);
}

async function injectStyle(cdp, css) {
  const encoded = JSON.stringify(css);
  await cdp.evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'csg-live-smoke-style';
    style.textContent = ${encoded};
    document.head.appendChild(style);
  })()`);
}

async function injectScript(cdp, source, label) {
  const expression = `${source}\n//# sourceURL=csg-live-smoke-${label}.js`;
  await cdp.evaluate(expression);
}

async function snapshot(cdp) {
  return cdp.evaluate(`(() => {
    const root = document.documentElement;
    if (!root) {
      return {
        url: location.href,
        turnCount: 0,
        contentReady: '',
        recentState: '',
        recentMode: '',
        hiddenOldTurns: 0,
        foldedTurns: 0,
        hiddenOldExchanges: 0,
        chatToggleCount: 0,
        globalRecentUi: false,
      };
    }
    const turns = [...document.querySelectorAll(${JSON.stringify(TURN_SELECTOR)})];
    const hidden = turns.filter(turn => turn.classList.contains('csg-hidden-old-turn')).length;
    const folded = turns.filter(turn => turn.classList.contains('csg-chat-collapsed')).length;
    const toggles = document.querySelectorAll('.csg-chat-toggle').length;
    const globalRecentUi = Boolean(document.getElementById('csg-recent-accordion') || document.getElementById('csg-recent-scrollbar'));
    return {
      url: location.href,
      turnCount: turns.length,
      contentReady: root.dataset.csgContentReady || '',
      recentState: root.dataset.csgRecentState || '',
      recentMode: root.dataset.csgRecentMode || '',
      hiddenOldTurns: hidden,
      foldedTurns: folded,
      hiddenOldExchanges: Number(root.dataset.csgRecentHiddenExchanges || 0),
      chatToggleCount: toggles,
      globalRecentUi,
    };
  })()`);
}

function isPublicChatGptShare(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com' && parsed.pathname.startsWith('/share/');
  } catch {
    return false;
  }
}

async function runSmoke() {
  if (!TEST_MODE && !isPublicChatGptShare(TARGET_URL)) {
    throw new Error('CSG_LIVE_CHAT_URL must be a public https://chatgpt.com/share/... URL');
  }
  const launched = await launchChrome(TARGET_URL);
  let cdp;
  try {
    const target = await pageTarget(launched.browserWs);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    await waitFor(async () => {
      const state = await snapshot(cdp);
      const routeReady = TEST_MODE ? state.url.includes('/share/') : state.url.startsWith('https://chatgpt.com/share/');
      return state.turnCount >= 4 && routeReady ? state : null;
    }, 20000);

    try {
      await installChromeStub(cdp, {
        enabled: true,
        showRecentOnly: false,
        showStatus: false,
      });
      await injectStyle(cdp, scriptSource('content.css'));
      await injectScript(cdp, scriptSource('content.js'), 'content');

      const core = await waitFor(async () => {
        const state = await snapshot(cdp);
        return state.contentReady === '1' ? state : null;
      }, 10000);

      await cdp.evaluate(`Object.assign(globalThis.__csgSmokeSettings, {
        enabled: true,
        showRecentOnly: true,
        recentExchanges: 3,
        showStatus: false
      })`);
      await injectScript(cdp, scriptSource('recent-window.js'), 'recent-window');

      const recent = await waitFor(async () => {
        const state = await snapshot(cdp);
        if (state.recentState === 'degraded') {
          throw new Error(`Recent-N degraded on the live ChatGPT DOM: ${JSON.stringify(state)}`);
        }
        return state.recentState === 'ready' ? state : null;
      }, 30000, 400);

      const failures = [];
      if (core.turnCount < 4) failures.push(`too few turns after core injection: ${core.turnCount}`);
      if (recent.recentMode !== 'per-chat') failures.push(`Recent-N mode is ${recent.recentMode || '(empty)'}`);
      if (recent.hiddenOldTurns + recent.foldedTurns < 1) failures.push('Recent-N did not fold any earlier mounted chat');
      if (recent.chatToggleCount < 1) failures.push('Per-chat fold toggles are missing');
      if (recent.globalRecentUi) failures.push('Legacy fixed Recent-N UI is still present');

      return { targetUrl: TARGET_URL, core, recent, failures };
    } catch (error) {
      throw new CompatibilityFailure(`Guard failed on the loaded ChatGPT conversation: ${error?.message || error}`, error);
    }
  } finally {
    cdp?.close();
    await stopChild(launched.child);
    fs.rmSync(launched.profile, { recursive: true, force: true });
  }
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const outputPath = path.join(ARTIFACT_DIR, 'live-site-smoke.json');

try {
  const result = await runSmoke();
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length) {
    console.error('LIVE SITE SMOKE FAILED');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 2;
  } else {
    console.log(`PASS live-site smoke: core ready; Recent-N ready with ${result.recent.hiddenOldTurns} earlier mounted turn(s) hidden`);
  }
  console.log(`Diagnostics: ${outputPath}`);
} catch (error) {
  const compatibility = error instanceof CompatibilityFailure;
  const result = {
    targetUrl: TARGET_URL,
    errorType: compatibility ? 'compatibility' : 'infrastructure',
    fatalError: String(error?.stack || error),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`${compatibility ? 'LIVE SITE SMOKE FAILED' : 'LIVE SITE SMOKE ERROR'}: ${error?.message || error}`);
  console.error(`Diagnostics: ${outputPath}`);
  process.exitCode = compatibility ? 2 : 3;
}
