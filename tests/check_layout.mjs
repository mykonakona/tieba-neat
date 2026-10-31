// Offline browser checks: only sanitized fixtures are opened; no dependencies.
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = join(ROOT, 'snapshots', 'sanitized');
const files = (await readdir(FIXTURES)).filter((f) => /^\d+-(post|home|forum|profile)\.html$/.test(f)).sort();
assert(files.length, 'No sanitized fixtures found. Run python tools/sanitize_snapshots.py first.');
const profile = await mkdtemp(join(tmpdir(), 'tieba-neat-check-'));
const browser = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=19223',
  `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws;
let sequence = 0;
const pending = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const inspect = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), visible: !!el.getClientRects().length && getComputedStyle(el).display !== 'none', overflowPx: Math.max(0, el.scrollWidth - el.clientWidth) };
  };
  return {
    viewport: innerWidth, documentOverflow: document.documentElement.scrollWidth > innerWidth,
    main: box('.main-content'),
    post: box('.pc-pb-box > .container > .center-content'),
    profile: box('.usercenter-content-wrapper > .center-content'),
    home: box('.home-page-wrapper .center-content'),
    postSide: box('.pb-page-wrapper .right-nav-bar'),
    profileSide: box('.usercenter-content-wrapper > .right-nav-bar'),
    profileTools: box('.usual-function-wrapper'),
    leftNav: box('.left-content'),
    forum: box('.frs-feed-list'),
    forumSide: box('.frs-right-sidebar'),
    menus: [...document.querySelectorAll('.top-nav-bar .menu-list > *')].map(el => ({
      message: !!el.querySelector('use[*|href*="message" i]'),
      visible: !!el.getClientRects().length && getComputedStyle(el).display !== 'none',
    })),
  };
})()`;

async function settings(values) {
  await evaluate(`(() => {
    window.testMenus[0]();
    const root = document.querySelector('#tn-root');
    for (const [key, value] of Object.entries(${JSON.stringify(values)})) {
      const el = root.querySelector('[data-k="' + key + '"], [data-block="' + key + '"]');
      if (!el) throw new Error('Missing setting: ' + key);
      if (typeof value === 'boolean') el.checked = value; else el.value = value;
    }
    root.querySelector('[data-act="save"]').click();
  })()`);
  await delay(200);
}

try {
  const columnWidths = new Map();
  const noNavWidths = new Map();
  let tabs;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { tabs = await (await fetch('http://127.0.0.1:19223/json/list')).json(); break; } catch { await delay(100); }
  }
  assert(tabs?.length, 'Headless Edge did not start');
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    const task = pending.get(msg.id);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(msg.id);
    if (msg.error) task.reject(new Error(JSON.stringify(msg.error))); else task.resolve(msg.result);
  });
  await send('Page.enable');
  // Block all network traffic, even if a future fixture accidentally keeps a URL.
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  const script = await readFile(join(ROOT, 'tieba-neat.user.js'), 'utf8');
  for (const file of files) {
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(join(FIXTURES, file)).href });
    await delay(350);
    await evaluate(`document.querySelector('#tn-style')?.remove();`);
    const baseline = await evaluate(inspect);
    await evaluate(`window.testMenus = []; window.testSaved = { blocks: { hotTopic: true, hotForum: true, ads: true } }; window.GM_getValue = () => window.testSaved; window.GM_setValue = (key, val) => { window.testSaved = val; }; window.GM_registerMenuCommand = (label, fn) => window.testMenus.push(fn);`);
    await evaluate(script);
    await delay(400);
    for (const width of [2560, 1920, 1366, 1006, 768]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1440, deviceScaleFactor: 1, mobile: false });
      const result = await evaluate(inspect);
      for (const key of ['post', 'home', 'forum', 'profile']) {
        if (!result[key]) continue;
        if (!columnWidths.has(width)) columnWidths.set(width, new Map());
        columnWidths.get(width).set(key, result[key].width);
      }
      if (result.post?.overflowPx > 24 || result.profile?.overflowPx > 2) console.log('Overflow detail:', await evaluate(`(() => {
        const root = document.querySelector('.pc-pb-box > .container > .center-content, .usercenter-content-wrapper > .center-content');
        const right = root.getBoundingClientRect().right;
        return [...root.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > right + 24).slice(0, 12).map(el => ({tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', width: Math.round(el.getBoundingClientRect().width), style: el.getAttribute('style')}));
      })()`));
      const message = result.menus.filter((m) => m.message);
      assert.equal(message.length, 1, `${file}: message icon must be identifiable`);
      assert(message[0].visible, `${file}: message icon hidden`);
      assert(result.menus.filter((m) => !m.message).every((m) => !m.visible), `${file}: promotional icons visible`);
      assert(!result.documentOverflow, `${file} ${width}: document overflow`);
      if (result.post) {
        assert(!result.postSide.visible, 'Post recommendations visible');
        assert(result.post.right <= width && result.post.left >= 0, `${file} ${width}: post outside viewport`);
        if (width === 2560) assert.equal(result.post.width, 1200, 'Post column not widened');
        // Original reply separators intentionally bleed 11px into the gutter.
        assert(result.post.overflowPx <= 24, `${file} ${width}: post content overflow`);
      }
      if (result.profile) {
        assert(!result.profileTools.visible, 'Profile promotions visible');
        if (width === 2560) assert.equal(result.profile.width, 1200, 'Profile column not widened');
        assert(result.profile.overflowPx <= 2, `${file} ${width}: profile content overflow`);
        assert(result.profile.width >= Math.min(480, result.main.width - 100), `${file} ${width}: profile squeezed by sidebar`);
      }
      console.log(JSON.stringify({ file, ...result }));
    }
    const pageKey = file.match(/-(post|home|forum|profile)\.html$/)[1];
    await send('Emulation.setDeviceMetricsOverride', { width: 1006, height: 1440, deviceScaleFactor: 1, mobile: false });
    await settings({ leftNav: true });
    const noNav = await evaluate(inspect);
    assert(!noNav.leftNav.visible, `${file}: left nav still visible`);
    assert(noNav[pageKey], `${file}: missing column after hiding nav`);
    noNavWidths.set(pageKey, noNav[pageKey].width);
    await settings({ leftNav: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    await settings({ colWidth: '1440px' });
    let changed = await evaluate(inspect);
    if (changed.post || changed.profile) assert.equal((changed.post || changed.profile).width, 1440, 'Live column setting failed');
    await settings({ wide: false, topExtras: false, postSidebar: false, profileTools: false });
    changed = await evaluate(inspect);
    assert(changed.menus.every((m) => m.visible), 'Top icons did not restore');
    if (changed.post) assert.equal(changed.post.width, baseline.post.width, 'Post width did not restore');
    if (changed.profile) assert.equal(changed.profile.width, baseline.profile.width, 'Profile width did not restore');
    await settings({ wide: true, postSidebar: false, profileSidebar: true });
    changed = await evaluate(inspect);
    if (changed.post) assert(changed.postSide.visible, 'Post sidebar toggle failed');
    if (changed.profile) {
      assert(!changed.profileSide.visible, 'Profile sidebar toggle failed');
      assert.equal(changed.profile.width, 1440, 'Profile column did not fill sidebar space');
    }
    const mutations = await evaluate(`new Promise(resolve => {
      let count = 0;
      const observer = new MutationObserver(records => count += records.length);
      observer.observe(document.querySelector('#tn-style'), { childList: true, subtree: true });
      document.body.appendChild(document.createElement('div'));
      setTimeout(() => { observer.disconnect(); resolve(count); }, 700);
    })`);
    assert.equal(mutations, 0, 'Style observer keeps rewriting CSS');
    await evaluate(`document.querySelector('#tn-style').remove()`);
    await delay(250);
    assert(await evaluate(`!!document.querySelector('#tn-style')`), 'Removed stylesheet not reattached');
    await evaluate(`(() => {
      const section = document.createElement('section');
      section.className = 'test-keyword-section';
      section.innerHTML = '<h3>相关推荐</h3><p>sample</p>';
      const content = document.createElement('div');
      content.className = 'user-intro';
      content.textContent = '相关推荐';
      document.body.append(section, content);
    })()`);
    await delay(250);
    assert(await evaluate(`document.querySelector('.test-keyword-section').hasAttribute('data-tn-hide')`), 'New recommendation section not hidden');
    assert(await evaluate(`!document.querySelector('body > .user-intro').closest('[data-tn-hide]')`), 'User biography hidden by keyword');
    console.log(`${file}: settings, restore, observer checks passed`);
  }
  for (const [width, cols] of columnWidths) {
    const entries = [...cols];
    assert.equal(entries.length, files.length, `${width}px: missing page column measurements (${JSON.stringify(entries)})`);
    const widths = entries.map(([, value]) => value);
    assert.equal(Math.max(...widths) - Math.min(...widths), 0, `${width}px: page columns differ: ${JSON.stringify(entries)}`);
  }
  assert.equal(noNavWidths.size, files.length, `missing hidden-nav measurements: ${JSON.stringify([...noNavWidths])}`);
  const navValues = [...noNavWidths.values()];
  assert.equal(Math.max(...navValues) - Math.min(...navValues), 0, `hidden nav: page columns differ: ${JSON.stringify([...noNavWidths])}`);
  console.log('All offline layout checks passed.');
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch { /* Browser closes before replying. */ }
    ws.close();
  }
  browser.kill();
  await delay(300);
  assert(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('tieba-neat-check-'), 'Unexpected browser profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
