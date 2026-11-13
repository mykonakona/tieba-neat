'use strict';

// The back controls of the new desktop layout have a fixed destination, not a history step:
// - a forum-list (吧页) back button always returns to the Tieba home page;
// - the site's post floating back button returns to the post's own forum list (/f?kw=...),
//   falling back to home when no valid forum is known;
// - the script's own post nav is a real anchor (<a href>), so ctrl/middle-click and new-tab keep
//   working and the browser self-navigates;
// - every other .back-btn (dialogs, article content, profile .router-back) is left alone.
// Browser history itself is untouched: the script does not wrap pushState/replaceState and never
// sends the user "back" to a previously visited post.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

const FRS_FIXTURE = `<!doctype html><html><head></head><body>
<div class="frs-page-wrap">
  <div class="frs-page-container">
    <div class="floating-buttons"><button class="back-btn">返回</button></div>
    <div class="head-pic-area"><div class="forum-info">吧资料</div></div>
  </div>
</div>
</body></html>`;

function postFixture(forumHref = '/f?kw=test&amp;fr=pb', extra = '') {
  return `<!doctype html><html><head></head><body>
<div class="pb-page-wrapper"><div class="pc-pb-box"><div class="container">
  <div class="center-content"><div class="pb-rich-text">正文</div></div>
  <div class="floating-buttons"><button class="back-btn">返回</button></div>
  <div class="right-nav-bar"><div class="enter-forum-wrapper">
    ${forumHref ? `<a class="forum-info-left" href="${forumHref}">test吧</a>` : ''}
  </div></div>
</div></div></div>
${extra}
</body></html>`;
}

const HOME = 'https://tieba.baidu.com/';

function envFor(html, url, options = {}) {
  return createEnv({ html, url, captureNavigation: true, ...options });
}

// Dispatch a real click and report what the page did with it.
async function clickBack(env, selector) {
  const el = env.doc.querySelector(selector);
  assert.ok(el, `missing element: ${selector}`);
  const event = new env.window.MouseEvent('click', { bubbles: true, cancelable: true });
  const before = env.navigations.length;
  el.dispatchEvent(event);
  await wait(40);
  return {
    prevented: event.defaultPrevented,
    destination: env.navigations.length > before ? env.lastNavigation() : '',
  };
}

test('navigation: forum-list back always returns home, never a previous post', async (t) => {
  const env = envFor(FRS_FIXTURE, HOME);
  t.after(() => env.window.close());
  env.flush();

  // Original regression: home -> forum -> post -> forum must not step back into the post.
  env.pushState('/f?kw=test');
  env.pushState('/p/100');
  env.pushState('/f?kw=test');
  const original = await clickBack(env, '.frs-page-container > .floating-buttons > .back-btn');
  assert.equal(original.destination, HOME);
  assert.equal(env.calls.back, 0);

  // Cross-forum history and forward/back traversals must not change that destination either.
  env.pushState('/f?kw=other');
  env.pushState('/p/200');
  env.traverse('https://tieba.baidu.com/f?kw=other');
  env.traverse('https://tieba.baidu.com/f?kw=test');

  const result = await clickBack(env, '.frs-page-container > .floating-buttons > .back-btn');
  assert.equal(result.destination, HOME, 'forum page back goes home');
  assert.equal(result.prevented, true);
  assert.equal(env.calls.back, 0, 'the browser history is not used');
});

test('navigation: post floating back returns the current forum list', async (t) => {
  const env = envFor(postFixture(), 'https://tieba.baidu.com/p/123');
  t.after(() => env.window.close());
  env.flush();

  // A peer post or another forum in history is not the parent of the current post.
  env.pushState('/f?kw=other');
  env.pushState('/p/456');
  env.pushState('/p/123');
  const result = await clickBack(env, '.pc-pb-box > .container > .floating-buttons > .back-btn');
  assert.equal(result.destination, 'https://tieba.baidu.com/f?kw=test&fr=pb');
  assert.equal(result.prevented, true);
  assert.equal(env.calls.back, 0);

  // A native back click also reads the new forum immediately, before the observer flushes.
  env.pushState('/p/789');
  env.doc.querySelector('.forum-info-left').setAttribute('href', '/f?kw=next');
  const next = await clickBack(env, '.pc-pb-box > .container > .floating-buttons > .back-btn');
  assert.equal(next.destination, 'https://tieba.baidu.com/f?kw=next');
});

test('navigation: post back falls back to home without forum data, and to the search tag when the card is unmounted', async (t) => {
  const bare = envFor(postFixture(''), 'https://tieba.baidu.com/p/123');
  t.after(() => bare.window.close());
  bare.flush();
  const home = await clickBack(bare, '.pc-pb-box > .container > .floating-buttons > .back-btn');
  assert.equal(home.destination, HOME, 'no forum link and no name tag means home');

  const tagged = envFor(postFixture(''), 'https://tieba.baidu.com/p/123');
  t.after(() => tagged.window.close());
  const top = tagged.doc.createElement('div');
  top.className = 'top-nav-bar';
  top.innerHTML = '<div class="frs-search-tag"><span class="forum-name-main">测试吧名</span></div>';
  tagged.doc.body.appendChild(top);
  tagged.flush();
  const viaTag = await clickBack(tagged, '.pc-pb-box > .container > .floating-buttons > .back-btn');
  assert.equal(viaTag.destination, `https://tieba.baidu.com/f?kw=${encodeURIComponent('测试吧名')}`);
});

test('navigation: an external or non-forum href is never followed', async (t) => {
  for (const href of ['https://example.com/f?kw=bad', '/p/999', '/f?fr=pb']) {
    const env = envFor(postFixture(href), 'https://tieba.baidu.com/p/123');
    t.after(() => env.window.close());
    env.flush();
    const result = await clickBack(env, '.pc-pb-box > .container > .floating-buttons > .back-btn');
    assert.equal(result.destination, HOME, `${href} is rejected in favour of home`);
  }
});

test('navigation: the post nav stays a native anchor and is never force-navigated', async (t) => {
  const env = envFor(postFixture(), 'https://tieba.baidu.com/p/123');
  t.after(() => env.window.close());
  env.flush();

  const anchor = env.doc.querySelector('#tn-post-nav a');
  assert.equal(anchor.href, 'https://tieba.baidu.com/f?kw=test&fr=pb');

  const event = new env.window.MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  await wait(40);
  assert.equal(event.defaultPrevented, false, 'the browser handles the link itself');
  assert.deepEqual(env.navigations, [], 'no forced location change');
  assert.equal(env.calls.back, 0, 'no history traversal');
  assert.equal(anchor.href, 'https://tieba.baidu.com/f?kw=test&fr=pb', 'href is kept for new-tab semantics');
});

test('navigation: post nav refreshes its href from the live frame before an SPA forum switch flushes', async (t) => {
  const env = envFor(postFixture(), 'https://tieba.baidu.com/p/123');
  t.after(() => env.window.close());
  env.flush();

  const anchor = env.doc.querySelector('#tn-post-nav a');
  assert.equal(anchor.getAttribute('href'), 'https://tieba.baidu.com/f?kw=test&fr=pb');

  // SPA switch to another forum's post: the native link already points at the new forum, but the
  // script's 150 ms pass has not run yet.
  env.traverse('https://tieba.baidu.com/p/999');
  const link = env.doc.querySelector('.forum-info-left');
  link.setAttribute('href', '/f?kw=next');
  assert.equal(anchor.getAttribute('href'), 'https://tieba.baidu.com/f?kw=test&fr=pb', 'stale until click');

  const event = new env.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  anchor.dispatchEvent(event);
  await wait(40);
  assert.equal(anchor.getAttribute('href'), 'https://tieba.baidu.com/f?kw=next', 'click refreshes to the current forum');
  assert.equal(event.defaultPrevented, false, 'the refreshed anchor still self-navigates');
  assert.deepEqual(env.navigations, [], 'refresh only rewrites href, never navigates');
});

test('navigation: post nav drops a stale target and blocks the click when no forum is known', async (t) => {
  const env = envFor(postFixture(), 'https://tieba.baidu.com/p/123');
  t.after(() => env.window.close());
  env.flush();

  const anchor = env.doc.querySelector('#tn-post-nav a');
  env.doc.querySelector('.enter-forum-wrapper').remove();
  const event = new env.window.MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  await wait(40);

  assert.equal(anchor.hasAttribute('href'), false, 'the old forum target is removed');
  assert.equal(event.defaultPrevented, true, 'the now-dead anchor does not navigate');
  assert.deepEqual(env.navigations, []);
  assert.equal(env.calls.back, 0);
});

test('navigation: other back buttons and the profile router-back are not intercepted', async (t) => {
  const html = `<!doctype html><html><head></head><body>
<div class="frs-page-wrap"><div class="frs-page-container">
  <div class="floating-buttons"><button class="back-btn">返回</button></div>
  <div class="article-content"><button class="back-btn">正文内返回</button></div>
</div></div>
<div class="dialog-wrapper"><button class="back-btn">弹窗关闭</button></div>
<div class="usercenter-page-wrapper"><div class="router-back-wrapper"><button class="router-back">个人页返回</button></div></div>
</body></html>`;
  const env = envFor(html, 'https://tieba.baidu.com/f?kw=test');
  t.after(() => env.window.close());
  env.flush();

  const content = await clickBack(env, '.article-content .back-btn');
  assert.equal(content.prevented, false);
  assert.equal(content.destination, '');

  const dialog = await clickBack(env, '.dialog-wrapper .back-btn');
  assert.equal(dialog.prevented, false);
  assert.equal(dialog.destination, '');

  const profile = await clickBack(env, '.router-back');
  assert.equal(profile.prevented, false);
  assert.equal(profile.destination, '');
  assert.deepEqual(env.navigations, [], 'none of them triggered a script navigation');
  assert.equal(env.calls.back, 0);
});

test('navigation: only the two native floating back buttons are intercepted', async (t) => {
  // A .back-btn outside .floating-buttons, and a .floating-buttons back button outside the two
  // page containers, must keep their own behaviour.
  const html = `<!doctype html><html><head></head><body>
<div class="frs-page-wrap">
  <div class="frs-page-container">
    <div class="head-pic-area"><button class="back-btn">吧页内页按钮</button></div>
    <div class="floating-buttons"><button class="back-btn" id="real-back">吧页浮钮</button></div>
  </div>
  <div class="floating-buttons"><button class="back-btn" id="decoy-back">容器外浮钮</button></div>
</div>
</body></html>`;
  const env = envFor(html, 'https://tieba.baidu.com/f?kw=test');
  t.after(() => env.window.close());
  env.flush();

  const nested = await clickBack(env, '.head-pic-area .back-btn');
  assert.equal(nested.prevented, false, 'a nested back button is not a navigation control');
  assert.equal(nested.destination, '');

  const direct = await clickBack(env, '#decoy-back');
  assert.equal(direct.prevented, false, 'only .frs-page-container > .floating-buttons counts');
  assert.equal(direct.destination, '');

  const real = await clickBack(env, '#real-back');
  assert.equal(real.destination, HOME);
});

test('navigation: browser history and its state are never wrapped or rewritten', async (t) => {
  let nativePush;
  let nativeReplace;
  const env = envFor(FRS_FIXTURE, 'https://tieba.baidu.com/f?kw=test', {
    prepare({ window }) {
      nativePush = window.history.pushState;
      nativeReplace = window.history.replaceState;
    },
  });
  t.after(() => env.window.close());
  env.flush();

  assert.equal(env.window.history.pushState, nativePush, 'pushState is not wrapped by the script');
  assert.equal(env.window.history.replaceState, nativeReplace, 'replaceState is not wrapped');

  const state = { siteKey: 'keep-me', nested: { n: 1 } };
  env.pushState('/p/100', state);
  assert.deepEqual(JSON.parse(JSON.stringify(env.window.history.state)), state);
  env.replaceState('/p/100?pn=2', { siteKey: 'still-mine' });
  assert.deepEqual(JSON.parse(JSON.stringify(env.window.history.state)), { siteKey: 'still-mine' });
  assert.equal(env.window.location.pathname, '/p/100');

  // The back button must not consume those entries: it goes home, history stays where it was.
  const result = await clickBack(env, '.frs-page-container > .floating-buttons > .back-btn');
  assert.equal(result.destination, HOME);
  assert.equal(env.calls.back, 0, 'history.back() is never called');
  assert.deepEqual(JSON.parse(JSON.stringify(env.window.history.state)), { siteKey: 'still-mine' });
});
