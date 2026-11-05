'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

const FRS_FIXTURE = `<!doctype html><html><head></head><body>
<div class="frs-page-wrap">
  <div class="frs-page-container">
    <div class="floating-buttons"><button class="back-btn">返回</button></div>
  </div>
</div>
</body></html>`;

// The back button either calls history.back() (stubbed, counted) or, when no same-site entry is
// usable, navigates to the home page. jsdom reports that navigation as "not implemented", so a
// new navigation error is how the fallback is observed. A different start URL keeps the fallback
// distinguishable from the current page.
const START = 'https://tieba.baidu.com/f?kw=test';

async function clickBack(env) {
  const errorsBefore = env.navigationCount();
  const backsBefore = env.calls.back;
  env.click('.back-btn');
  await wait(60);
  if (env.navigationCount() > errorsBefore) return 'home';
  if (env.calls.back > backsBefore) return 'back';
  return 'none';
}

function navEnv() {
  return createEnv({ html: FRS_FIXTURE, url: START });
}

test('navigation: SPA forward after back still uses history.back()', async (t) => {
  const env = navEnv();
  t.after(() => env.window.close());
  env.flush();

  env.pushState('/p/100');
  env.pushState('/p/200');
  assert.equal(await clickBack(env), 'back', 'internal pushes allow going back');

  env.traverse('https://tieba.baidu.com/p/100');
  assert.equal(await clickBack(env), 'back', 'one entry behind us is still internal');

  // Forward moves back to /p/200, which still has an internal entry behind it.
  env.traverse('https://tieba.baidu.com/p/200');
  assert.equal(await clickBack(env), 'back', 'forward must not erase the same-site history behind us');
});

test('navigation: returning to the first entry falls back to the home page', async (t) => {
  const env = navEnv();
  t.after(() => env.window.close());
  env.flush();
  env.pushState('/p/100');
  env.traverse(START);
  assert.equal(await clickBack(env), 'home', 'nothing internal is behind the first entry');
});

test('navigation: back, forward and repeated traversal keep the internal position', async (t) => {
  const env = navEnv();
  t.after(() => env.window.close());
  env.flush();
  env.pushState('/f?kw=a');
  env.pushState('/p/100');
  env.pushState('/p/200');

  env.traverse('https://tieba.baidu.com/p/100');
  env.traverse('https://tieba.baidu.com/f?kw=a');
  assert.equal(await clickBack(env), 'back', 'still has an internal entry behind');

  env.traverse('https://tieba.baidu.com/p/100');
  env.traverse('https://tieba.baidu.com/p/200');
  assert.equal(await clickBack(env), 'back', 'forward twice must not reset the internal position');

  env.traverse('https://tieba.baidu.com/p/100');
  env.traverse('https://tieba.baidu.com/f?kw=a');
  env.traverse(START);
  assert.equal(await clickBack(env), 'home', 'back at the first entry must fall back to home');
});

test('navigation: a replaceState does not add a history entry', async (t) => {
  const env = navEnv();
  t.after(() => env.window.close());
  env.flush();
  env.pushState('/p/100');
  env.replaceState('/p/100?pn=2');
  env.traverse('https://tieba.baidu.com/p/100?pn=2');
  assert.equal(await clickBack(env), 'back', 'replaced URLs stay the same internal entry');
});

test('navigation: the script never rewrites the site history state', async (t) => {
  const env = navEnv();
  t.after(() => env.window.close());
  env.flush();
  const state = { siteKey: 'keep-me', nested: { n: 1 } };
  env.pushState('/p/100', state);
  assert.deepEqual(
    JSON.parse(JSON.stringify(env.window.history.state)),
    JSON.parse(JSON.stringify(state)),
    'pushState state must be stored unchanged',
  );
  env.replaceState('/p/100?pn=2', { siteKey: 'still-mine' });
  assert.deepEqual(JSON.parse(JSON.stringify(env.window.history.state)), { siteKey: 'still-mine' });
});
