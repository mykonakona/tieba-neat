'use strict';

// The site toggles the left nav by flipping classes deep inside the layout while a CSS transition
// moves it; the final frame emits no mutation. A flush that runs mid-transition would record an
// intermediate geometry and nothing would re-measure afterwards. jsdom has no layout engine, so
// these tests observe the script's *decision* to re-check: it must schedule a later pass when the
// nav class changes, and it must not loop when nothing moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

const PROFILE_FIXTURE = `<!doctype html><html><head></head><body>
<div class="pc-main-page-layout">
  <div class="content-container">
    <div class="left-content"><button class="collapse-btn">nav</button></div>
    <div class="main-content">
      <div class="usercenter-page-wrapper">
        <div class="top-nav-bar">
          <div class="home-left">logo</div>
          <div class="search-mid">search</div>
          <div class="right-menu">menu</div>
        </div>
        <div class="usercenter-content-wrapper">
          <div class="center-content">content</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const countMutations = (env, ms) => new Promise((resolve) => {
  let total = 0;
  const observer = new env.window.MutationObserver((records) => { total += records.length; });
  observer.observe(env.doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  setTimeout(() => { observer.disconnect(); resolve(total); }, ms);
});

test('settle: a descendant nav class change triggers a later layout pass', async (t) => {
  const env = createEnv({ html: PROFILE_FIXTURE });
  t.after(() => env.window.close());
  env.flush();
  await wait(300);

  const root = env.doc.documentElement;
  // A leftover inline search offset is only cleared by a layout pass. Pre-setting it makes the
  // next pass observable even without a layout engine (jsdom reports zero-size boxes).
  root.style.setProperty('--tn-search-shift', '5px');
  assert.equal(root.style.getPropertyValue('--tn-search-shift'), '5px');

  const nav = env.doc.querySelector('.left-content');
  // Collapse the nav the way the site does: flip a class on a descendant only.
  nav.classList.add('is-collapsed');
  await wait(800);

  assert.equal(
    root.style.getPropertyValue('--tn-search-shift'),
    '',
    'a descendant nav class change must still lead to a layout pass',
  );
});

test('settle: repeated nav class flips stay bounded (no self-trigger loop)', async (t) => {
  const env = createEnv({ html: PROFILE_FIXTURE });
  t.after(() => env.window.close());
  env.flush();
  await wait(400);

  const nav = env.doc.querySelector('.left-content');
  const churn = countMutations(env, 1500);
  // Nothing changes for 1.5s: the script must be quiet.
  const idle = await churn;
  assert.ok(idle <= 4, `idle page should not mutate itself, saw ${idle}`);

  for (const cls of ['is-collapsed', 'is-animating', 'is-expanded']) {
    nav.classList.add(cls);
    await wait(250);
    nav.classList.remove(cls);
    await wait(250);
  }
  // Still settles afterwards without a permanent observer storm.
  const after = await countMutations(env, 1000);
  assert.ok(after <= 12, `post-toggle churn should stop, saw ${after}`);
});

test('settle: toggling the nav twice re-measures each time', async (t) => {
  const env = createEnv({ html: PROFILE_FIXTURE });
  t.after(() => env.window.close());
  env.flush();
  await wait(300);

  const nav = env.doc.querySelector('.left-content');
  const passes = [];
  const original = env.doc.documentElement.classList.toggle.bind(env.doc.documentElement.classList);
  // Count class writes as a proxy for "the script ran a layout pass".
  env.doc.documentElement.classList.toggle = function patched(token, force) {
    if (token === 'tn-top-center') passes.push(force);
    return original(token, force);
  };

  nav.classList.add('is-collapsed');
  await wait(600);
  nav.classList.remove('is-collapsed');
  await wait(600);

  env.doc.documentElement.classList.toggle = original;
  assert.ok(passes.length >= 2, `each toggle should re-measure, saw ${passes.length} pass(es)`);
});
