'use strict';

// Regressions for the title-based hiding path:
//  - protected user content must never hide, and must not re-arm the settle timer forever
//  - a title element that is itself the hidden section must be revertible
//  - a replaced title element inside a reused section must revert
//  - <img alt/title> titles must be recognised (not judged by textContent)
//  - a block with several keyword titles must stay hidden while any of them matches
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

const wrap = (inner) => `<!doctype html><html><head></head><body>
<div class="home-page-wrapper"><div class="thread-container">${inner}</div></div>
</body></html>`;

const hiddenBy = (el) => {
  const host = el?.closest('[data-tn-hide]');
  return host ? host.getAttribute('data-tn-hide') : null;
};

// Counts how often the script schedules its deferred layout pass.
function countTimers(env) {
  const counts = {};
  const original = env.window.setTimeout;
  env.window.setTimeout = function patched(fn, ...args) {
    const name = (typeof fn === 'function' && fn.name) || 'anonymous';
    counts[name] = (counts[name] || 0) + 1;
    return original.call(this, fn, ...args);
  };
  return counts;
}

test('keywords: a keyword image inside protected user text never hides and never loops', async (t) => {
  const env = createEnv({ html: wrap('<div class="thread-content"><img alt="相关推荐"></div>') });
  t.after(() => env.window.close());
  const counts = countTimers(env);
  env.flush();

  await wait(800);
  const firstWindow = { ...counts };
  await wait(800);
  const secondWindow = { ...counts };

  assert.equal(env.doc.querySelector('[data-tn-hide]'), null, 'protected user content must not be hidden');
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(total(firstWindow) <= 3, `idle page should barely schedule, saw ${total(firstWindow)}`);
  assert.deepEqual(secondWindow, firstWindow, 'a second idle window must not schedule any more timers');
});

test('keywords: a title element that is the section itself is revertible', async (t) => {
  const env = createEnv({ html: wrap('<span id="single">相关推荐</span>') });
  t.after(() => env.window.close());
  env.flush();

  const el = env.doc.querySelector('#single');
  assert.equal(el.getAttribute('data-tn-hide'), '标题:相关推荐', 'keyword title hides its own section');

  el.firstChild.data = '普通栏目';
  await wait(500);
  assert.equal(el.getAttribute('data-tn-hide'), null, 'section must be revealed when its own text stops matching');
});

test('keywords: a replaced title element inside a reused section is reverted', async (t) => {
  const html = wrap('<section id="module"><div><span id="title">相关推荐</span></div><div>合成内容</div></section>');
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();

  const section = env.doc.querySelector('#module');
  assert.equal(section.getAttribute('data-tn-hide'), '标题:相关推荐');

  // The site swaps in a fresh title element but keeps the section node.
  const replacement = env.doc.createElement('span');
  replacement.textContent = '普通栏目';
  env.doc.querySelector('#title').replaceWith(replacement);
  await wait(500);

  assert.equal(section.getAttribute('data-tn-hide'), null, 'replaced title must be re-evaluated, not just disconnected owners');
});

// Images carry their title in alt/title, never in text, so an alt/title edit is invisible to the
// childList/characterData and class observers. These cases therefore wait for the page to go fully
// idle FIRST and only then touch the attribute, and they never call flush()/resize themselves: a
// lingering settle pass must not be what makes them pass.
const idle = () => wait(1400);

test('keywords: an image title is recognised for hiding and for reverting', async (t) => {
  const html = wrap('<div id="module"><div class="hdr"><img id="icon" alt="普通栏目"></div><div>内容</div></div>');
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();
  await idle();

  const section = env.doc.querySelector('#module');
  const icon = env.doc.querySelector('#icon');
  assert.equal(section.hasAttribute('data-tn-hide'), false, 'an ordinary img alt must not hide anything');

  icon.alt = '相关推荐';
  await wait(800);
  assert.equal(section.getAttribute('data-tn-hide'), '标题:相关推荐', 'img alt change must hide its section without a manual flush');

  icon.alt = '普通栏目';
  await wait(800);
  assert.equal(section.getAttribute('data-tn-hide'), null, 'img alt change must revert the hide without a manual flush');
});

test('keywords: an image title falls back to title when alt is absent', async (t) => {
  const html = wrap('<div id="module"><div class="hdr"><img id="icon" title="普通栏目"></div><div>内容</div></div>');
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();
  await idle();

  const section = env.doc.querySelector('#module');
  const icon = env.doc.querySelector('#icon');

  icon.title = '相关推荐';
  await wait(800);
  assert.equal(section.getAttribute('data-tn-hide'), '标题:相关推荐', 'img title must hide when alt is empty');

  icon.title = '普通栏目';
  await wait(800);
  assert.equal(section.getAttribute('data-tn-hide'), null, 'img title must revert when alt is empty');
});

test('keywords: a title moved into another section no longer pins its old section', async (t) => {
  const html = wrap(`<section id="a"><span id="t">相关推荐</span><div>内容A</div></section>
    <section id="b"><div>内容B</div></section>`);
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();

  const a = env.doc.querySelector('#a');
  assert.equal(a.getAttribute('data-tn-hide'), '标题:相关推荐');

  // The tracked title is still connected, but it now belongs to section B.
  env.doc.querySelector('#b').append(env.doc.querySelector('#t'));
  await wait(800);
  assert.equal(a.hasAttribute('data-tn-hide'), false, 'a title that left the section must not keep it hidden');
});

test('keywords: a block with several keyword titles stays hidden until all stop matching', async (t) => {
  const html = wrap(`<section id="module">
    <span id="a">相关推荐</span><span id="b">猜你喜欢</span><div>内容</div>
  </section>`);
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();

  const section = env.doc.querySelector('#module');
  assert.ok(section.hasAttribute('data-tn-hide'), 'multi-keyword block is hidden');

  env.doc.querySelector('#a').firstChild.data = '普通栏目A';
  await wait(500);
  assert.ok(section.hasAttribute('data-tn-hide'), 'still hidden while another title matches');

  env.doc.querySelector('#b').firstChild.data = '普通栏目B';
  await wait(500);
  assert.equal(section.hasAttribute('data-tn-hide'), false, 'revealed once no title matches');
});

test('keywords: hide/reveal churn stays bounded on an otherwise idle page', async (t) => {
  const html = wrap('<div id="module"><span id="title">占位栏目</span><div>内容</div></div>');
  const env = createEnv({ html });
  t.after(() => env.window.close());
  env.flush();
  await wait(300);

  const title = env.doc.querySelector('#title').firstChild;
  for (const label of ['相关推荐', '普通栏目', '相关推荐', '普通栏目']) {
    title.data = label;
    await wait(350);
  }

  const counts = countTimers(env);
  await wait(1200);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(total <= 3, `a settled page must not keep scheduling timers, saw ${total}`);
  assert.equal(env.doc.querySelector('#module').hasAttribute('data-tn-hide'), false);
});
