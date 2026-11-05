'use strict';

// Reusable offline harness: loads the userscript into jsdom with the same GM_* shims a
// userscript manager provides, and exposes small helpers for driving it.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'tieba-neat.user.js');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');

// Keep tests in step with the config schema without touching the script's internals.
const CONFIG_VERSION = Number((SCRIPT.match(/const CONFIG_VERSION = (\d+);/) || [])[1]);
if (!Number.isFinite(CONFIG_VERSION)) throw new Error('CONFIG_VERSION not found in userscript');

const DEFAULT_HTML = '<!doctype html><html><head></head><body></body></html>';
const NAV_ERROR = 'navigation to another Document';

function normalizeColor(value) {
  const v = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return v;
}

// Minimal canvas 2d context good enough for the script's isDarkColor() probe.
function installCanvasShim(window) {
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    const ctx = {
      _fill: '#000000',
      get fillStyle() { return this._fill; },
      set fillStyle(v) { this._fill = normalizeColor(v); },
    };
    return ctx;
  };
}

// jsdom rewrites the class attribute even when classList.add/remove/toggle would be a no-op,
// which browsers do not do. Without this, the script's own class toggles look like page
// mutations and a MutationObserver-driven flush runs forever, hiding "no DOM change" cases.
function installClassListShim(window) {
  const proto = window.DOMTokenList.prototype;
  const add = proto.add;
  const remove = proto.remove;
  const toggle = proto.toggle;
  proto.add = function addTokens(...tokens) {
    if (tokens.every((t) => this.contains(t))) return;
    return add.apply(this, tokens);
  };
  proto.remove = function removeTokens(...tokens) {
    if (!tokens.some((t) => this.contains(t))) return;
    return remove.apply(this, tokens);
  };
  proto.toggle = function toggleToken(token, force) {
    if (force !== undefined && this.contains(token) === !!force) return !!force;
    return toggle.apply(this, arguments);
  };
}

function createEnv({ html = DEFAULT_HTML, url = 'https://tieba.baidu.com/', cfg = {}, prepare } = {}) {
  const navErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    navErrors.push(String((err && err.message) || err));
  });

  const dom = new JSDOM(html, {
    url,
    virtualConsole,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const window = dom.window;

  const store = { cfg: { version: CONFIG_VERSION, ...structuredClone(cfg) } };
  window.GM_getValue = (key, fallback) => (key in store ? store[key] : fallback);
  window.GM_setValue = (key, value) => { store[key] = value; };
  const menus = {};
  window.GM_registerMenuCommand = (label, fn) => { menus[label] = fn; };
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  installCanvasShim(window);
  installClassListShim(window);

  const calls = { back: 0, forward: 0 };
  window.history.back = () => { calls.back += 1; };
  window.history.forward = () => { calls.forward += 1; };

  if (prepare) prepare({ window, dom, store });

  window.eval(SCRIPT);

  const doc = window.document;
  const env = {
    dom,
    window,
    doc,
    store,
    menus,
    calls,
    configVersion: CONFIG_VERSION,
    get navErrors() { return navErrors.slice(); },
    navigationCount() { return navErrors.filter((m) => m.includes(NAV_ERROR)).length; },
    // A window resize always asks the script for a full synchronous flush.
    flush() { window.dispatchEvent(new window.Event('resize')); },
    pushState(href, state = {}) { window.history.pushState(state, '', href); },
    replaceState(href, state = {}) { window.history.replaceState(state, '', href); },
    // Same-document traversal: move the URL, then fire popstate like the browser does.
    traverse(href, state = window.history.state) {
      dom.reconfigure({ url: new URL(href, window.location.href).href });
      window.dispatchEvent(new window.PopStateEvent('popstate', { state }));
    },
    click(selector) {
      const el = typeof selector === 'string' ? doc.querySelector(selector) : selector;
      if (!el) throw new Error(`element not found: ${selector}`);
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    openSettings() {
      const fn = menus['⚙️ 设置'];
      if (!fn) throw new Error('settings menu entry not registered');
      fn();
      const root = doc.getElementById('tn-root');
      if (!root) throw new Error('settings panel did not open');
      return root;
    },
    saveSettings(values = {}) {
      const root = env.openSettings();
      for (const [key, value] of Object.entries(values)) {
        const field = root.querySelector(`[data-k=${key}]`);
        if (!field) throw new Error(`settings field not found: ${key}`);
        if (field.type === 'checkbox') field.checked = !!value;
        else field.value = value;
      }
      root.querySelector('[data-act=save]').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      return store.cfg;
    },
  };
  return env;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait until `predicate` is truthy, or fail after `timeout` ms.
async function waitFor(predicate, { timeout = 2000, interval = 25, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await wait(interval);
  }
}

module.exports = {
  SCRIPT_PATH,
  CONFIG_VERSION,
  createEnv,
  wait,
  waitFor,
};
