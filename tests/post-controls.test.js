'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

// Contract under test (measured on the new desktop post page / forum page):
// - The post floating nav lives in #tn-post-nav and reuses the site's native icons
//   (a.back-btn > svg.back-icon > use#back_arrow_dark, button.back-top > svg.back-top-icon > use#back_top)
//   instead of text glyphs, because the wide CSS already styles those exact selectors site-wide.
// - Back-to-top starts hidden and only appears once the inner .pc-pb-box scroller leaves the top.
// - The forum sidebar/card/banner must stay hidden on wide layouts; the site tree is never rebuilt
//   and the native follow/check-in control is never cloned or re-implemented.
// - A single .tn-forum-follow button is inserted directly in .forum-operate, left of the native
//   follow-sign control. Unfollowed: it proxies the native follow click and hides the native button
//   so the action cannot fire twice. Followed: the native 签到 control stays untouched and the new
//   button only opens the native BarIntro cancel dialog.

const POST_FIXTURE = `<div class="pb-page-wrapper"><div class="pc-pb-box"><div class="container">
<div class="floating-buttons"><button class="back-btn"><svg class="back-icon"><use href="#back_arrow_dark"></use></svg></button><button class="back-top"><svg class="back-top-icon"><use href="#back_top"></use></svg></button></div>
<div class="center-content"><div class="pb-rich-text">正文</div></div>
<div class="right-nav-bar"><div class="right-area-wrapper"><div class="mt-20">
<section class="qrcode-login-card">登录</section><div class="enter-forum-wrapper"><div>
<div class="forum-info-warp"><a class="forum-info-left" href="/f?kw=test&amp;fr=pb">test吧</a></div>
<div class="enter-forum-content">简介</div><button class="follow-forum-btn">关注本吧</button>
</div></div><div class="copy-right-wrapper">版权</div></div></div></div>
</div></div></div>`;

const FORUM_FIXTURE = (signMarkup) => `<div class="frs-page-wrap"><div class="frs-page-container">
<div class="head-pic-area"><div class="forum-operate">${signMarkup}</div></div>
<div class="frs-right-sidebar"><div class="bar-wrap"></div></div>
</div></div>`;

// Same classes the native follow-sign carries, so the added control inherits the site's button
// styling without a second stylesheet of its own.
const SIGN_CLASS = 'button-wrapper operate-btn';

function postEnv(t, cfg) {
  const env = createEnv({ html: POST_FIXTURE, url: 'https://tieba.baidu.com/p/123', cfg });
  t.after(() => env.window.close());
  env.flush();
  return env;
}

// Read the script's injected stylesheet as rules so tests can match against real selectors instead
// of approximating the CSS text.
function cssRules(env) {
  const out = [];
  const sheet = env.doc.getElementById('tn-style')?.sheet;
  const walk = (list) => {
    for (const rule of list) {
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      else if (rule.selectorText) out.push(rule);
    }
  };
  if (sheet) walk(sheet.cssRules);
  return out;
}

function isHidden(env, el) {
  if (!el) return true;
  if (el.hidden) return true;
  if (el.style && el.style.display === 'none') return true;
  return cssRules(env).some((rule) => {
    if (rule.style.display !== 'none') return false;
    try {
      return el.matches(rule.selectorText);
    } catch {
      return false;
    }
  });
}

function useHref(use) {
  return (use.getAttribute('href') || use.getAttribute('xlink:href') || '').replace(/^url\(|\)$/g, '');
}

// True when the element or any ancestor is taken out of flow by the script. Sidebar children are
// covered by hiding the sidebar itself, so leaf selectors are not required for every card.
function isDisplayed(env, el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (isHidden(env, node)) return false;
  }
  return true;
}

function scrollTo(env, el, top) {
  el.scrollTop = top;
  el.dispatchEvent(new env.window.Event('scroll', { bubbles: true }));
}

function navOf(env) {
  return env.doc.getElementById('tn-post-nav');
}

test('post nav: native back/back-top icons, not text arrows', (t) => {
  const env = postEnv(t);
  const nav = navOf(env);
  assert.ok(nav, 'post nav must exist on the post page');

  const back = nav.querySelector('a.back-btn');
  assert.ok(back, 'back control is a.back-btn');
  const backUse = back.querySelector('svg.back-icon use');
  assert.ok(backUse, 'back control must reuse the native back icon');
  assert.match(useHref(backUse), /#back_arrow_dark$/, 'native back arrow symbol');

  const top = nav.querySelector('button.back-top');
  assert.ok(top, 'back-to-top is button.back-top');
  const topUse = top.querySelector('svg.back-top-icon use');
  assert.ok(topUse, 'back-to-top must reuse the native back-top icon');
  assert.match(useHref(topUse), /#back_top$/, 'native back-top symbol');

  assert.doesNotMatch(nav.textContent || '', /[‹↑]/, 'no text glyphs in the nav');
  assert.equal(nav.querySelectorAll('a.back-btn').length, 1);
  assert.equal(nav.querySelectorAll('button.back-top').length, 1);

  // The old jump-to-forum management link is gone: following happens on the forum page itself.
  assert.equal(nav.querySelectorAll('.tn-forum-manage').length, 0, 'no forum-management jump link');
});

test('post nav: back link follows only the native current-forum link', async (t) => {
  const env = postEnv(t);
  const nav = navOf(env);
  const back = nav.querySelector('a.back-btn');
  assert.equal(back.href, 'https://tieba.baidu.com/f?kw=test&fr=pb');

  const link = env.doc.querySelector('.forum-info-left');
  link.href = 'https://example.com/f?kw=bad';
  env.flush();
  assert.equal(back.hasAttribute('href'), false, 'external URLs are not exposed');
  assert.equal(isHidden(env, back), true);

  link.href = '/f?kw=other';
  env.flush();
  assert.equal(back.href, 'https://tieba.baidu.com/f?kw=other');

  // Reused native links update on href mutation alone.
  link.setAttribute('href', '/f?kw=next');
  await wait(250);
  assert.equal(back.href, 'https://tieba.baidu.com/f?kw=next');

  // Below the sidebar breakpoint the native card is unmounted; the current forum name is still
  // available in the search bar and is the only honest target.
  env.doc.querySelector('.enter-forum-wrapper').remove();
  const top = env.doc.createElement('div');
  top.className = 'top-nav-bar';
  top.innerHTML = '<div class="frs-search-tag"><span class="forum-name-main">测试吧名</span></div>';
  env.doc.body.appendChild(top);
  env.flush();
  const url = new URL(back.href);
  assert.equal(url.pathname, '/f');
  assert.equal(url.searchParams.get('kw'), '测试吧名');
});

test('post nav: back-to-top appears only after the inner scroller moves, then hides on click', (t) => {
  const env = postEnv(t);
  const nav = navOf(env);
  const top = nav.querySelector('button.back-top');
  const box = env.doc.querySelector('.pc-pb-box');
  const calls = [];
  box.scrollTo = (options) => calls.push(['box', options && options.top]);
  env.window.scrollTo = (options) => calls.push(['window', options && options.top]);

  assert.equal(top.hidden, true, 'top is hidden while the post is at the top');

  scrollTo(env, box, 600);
  assert.equal(top.hidden, false, 'top appears once the post box scrolls');

  scrollTo(env, box, 0);
  assert.equal(top.hidden, true, 'top hides again at the top of the post');

  scrollTo(env, box, 900);
  assert.equal(top.hidden, false);
  env.click(top);
  assert.equal(top.hidden, true, 'clicking hides immediately, without waiting for a scroll event');
  assert.deepEqual(calls, [['box', 0], ['window', 0]], 'both scrollers are reset');

  // The listener is bound once: a later scroll still toggles a single state change.
  scrollTo(env, box, 500);
  assert.equal(top.hidden, false);
  scrollTo(env, box, 0);
  assert.equal(top.hidden, true);
});

test('post nav: replacing the scroll container rebinds and leaves the old one inert', (t) => {
  const env = postEnv(t);
  const top = navOf(env).querySelector('button.back-top');
  const oldBox = env.doc.querySelector('.pc-pb-box');
  const box = oldBox.cloneNode(true);
  oldBox.replaceWith(box);
  env.flush();

  scrollTo(env, box, 600);
  assert.equal(top.hidden, false, 'the new container drives the state');
  box.scrollTo = () => {};
  env.window.scrollTo = () => {};

  // A detached container must not keep a live listener.
  scrollTo(env, oldBox, 0);
  assert.equal(top.hidden, false, 'the old container no longer drives the nav');

  scrollTo(env, box, 0);
  assert.equal(top.hidden, true);
});

test('post nav: leaving the post removes the nav and the observer settles', async (t) => {
  let timers = 0;
  const env = createEnv({
    html: POST_FIXTURE,
    url: 'https://tieba.baidu.com/p/123',
    prepare({ window }) {
      const original = window.setTimeout.bind(window);
      window.setTimeout = (...args) => { timers += 1; return original(...args); };
    },
  });
  t.after(() => env.window.close());
  env.flush();
  await wait(700);
  const before = timers;
  await wait(700);
  assert.equal(timers, before, 'an idle post page must not re-arm its own timer');
  await wait(700);
  assert.equal(timers, before);

  const nav = navOf(env);
  assert.equal(env.doc.querySelectorAll('#tn-post-nav').length, 1, 'no duplicate nav');

  env.doc.querySelector('.pb-page-wrapper').remove();
  env.doc.body.innerHTML = '<div class="home-page-wrapper"></div>';
  env.flush();
  assert.equal(navOf(env), null, 'SPA route change drops the post nav');
  assert.equal(nav.isConnected, false);

  // Leaving schedules one ordinary pass for the new route; after it settles the page must go quiet.
  await wait(700);
  const settled = timers;
  await wait(700);
  assert.equal(timers, settled, 'the home page does not keep re-arming timers');
  await wait(700);
  assert.equal(timers, settled, 'still quiet in a second window');
});

test('post page: wide layout keeps the sidebar, card and banner hidden', (t) => {
  const env = postEnv(t, { wide: true });
  const rules = cssRules(env);
  assert.ok(rules.length, 'stylesheet is readable');

  const restoreContent = rules.filter((rule) => /display\s*:\s*contents/i.test(rule.style.display || rule.style.cssText));
  assert.deepEqual(
    restoreContent.map((r) => r.selectorText),
    [],
    'the sidebar is not released back into the flow with display:contents',
  );
  const reorder = rules.filter((rule) => /order\s*:\s*-1/i.test(rule.style.cssText || ''));
  assert.deepEqual(reorder.map((r) => r.selectorText), [], 'the forum card is not re-ordered into the post');

  const hides = (selector) => rules.some((rule) => {
    try {
      return rule.style.display === 'none' && env.doc.querySelector(selector)?.matches(rule.selectorText);
    } catch {
      return false;
    }
  });
  assert.equal(isDisplayed(env, env.doc.querySelector('.qrcode-login-card')), false, 'login card is not visible');
  assert.equal(isDisplayed(env, env.doc.querySelector('.copy-right-wrapper')), false, 'copyright banner is not visible');
  assert.equal(isDisplayed(env, env.doc.querySelector('.right-nav-bar')), false, 'post sidebar is hidden');

  // The native follow control is never cloned or moved out of its Vue tree.
  const follow = env.doc.querySelector('.follow-forum-btn');
  const parent = follow.parentNode;
  env.flush();
  env.flush();
  assert.equal(env.doc.querySelectorAll('.follow-forum-btn').length, 1);
  assert.equal(follow.parentNode, parent);
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 0, 'post page offers no account-action copy');

  // With no nav-scroll listener involved, the native floating buttons stay hidden only while the
  // nav exists, so disabling wide must not leave the site's own buttons suppressed.
  assert.ok(hides('.floating-buttons'), 'native floating buttons are suppressed while the nav is up');
});

test('post page: turning wide off keeps the nav but drops wide-only layout', (t) => {
  const env = postEnv(t, { wide: true });
  const nav = navOf(env);
  assert.ok(nav.style.getPropertyValue('--tn-post-nav-left'), 'wide layout positions the nav');
  assert.match(env.doc.getElementById('tn-style').textContent, /--tn-content/);

  env.saveSettings({ wide: false });
  env.flush();

  const css = env.doc.getElementById('tn-style').textContent;
  assert.doesNotMatch(css, /--tn-content:/, 'wide-only variables are gone');
  assert.doesNotMatch(css, /display\s*:\s*contents/i);

  // The floating nav is a post-page feature, not part of the wide layout: it must survive the
  // switch with a usable back link and its own inline offset cleared of wide-only positioning.
  const after = navOf(env);
  assert.ok(after, 'post nav stays available without wide layout');
  assert.equal(after.querySelector('a.back-btn').href, 'https://tieba.baidu.com/f?kw=test&fr=pb');
  assert.equal(after.querySelector('button.back-top').hidden, true);

  // With the nav still present the site's own floating strip stays suppressed, by contract.
  assert.equal(isDisplayed(env, env.doc.querySelector('.floating-buttons')), false,
    'native floating buttons remain covered by the post nav');
});

function forumEnv(t, { followed = false, wrapped = true, cancel } = {}) {
  const sign = `<button type="button" class="${SIGN_CLASS} follow-sign">${followed ? '签到' : '关注'}</button>`;
  const markup = wrapped ? `<span class="forum-operate-item">${sign}</span>` : sign;
  const calls = { sign: 0, dialog: 0, cancelFollow: 0, signIn: 0, followAndSign: 0 };
  const stateWrites = [];
  let followedNow = followed;
  const readFollowed = () => followedNow;
  const writeFollowed = (next) => { stateWrites.push(next); followedNow = next; };
  // The native page keeps two VMs: the operate VM around the follow/sign control and BarIntro in
  // the sidebar. The script only ever *reads* follow state and only ever calls the native cancel
  // dialog, so both fixtures expose the same state and no account method is ever invoked by it.
  const barVm = {
    $options: { name: 'BarIntro' },
    btnText: followed ? '签到' : '关注',
    isLoading: false,
    get isFollowedFrs() { return readFollowed(); },
    set isFollowedFrs(next) { writeFollowed(next); },
    handleOpenCancelDialog() {
      calls.dialog += 1;
      if (cancel) cancel();
    },
    handleFollowAndSign() { calls.followAndSign += 1; },
  };
  const opVm = {
    btnText: barVm.btnText,
    isLoading: false,
    get isFollowedFrs() { return readFollowed(); },
    set isFollowedFrs(next) { writeFollowed(next); },
    handleSign() { calls.signIn += 1; },
    handleCancelFollow() { calls.cancelFollow += 1; },
  };
  const env = createEnv({
    html: FORUM_FIXTURE(markup),
    url: 'https://tieba.baidu.com/f?kw=test',
    prepare({ window }) {
      const doc = window.document;
      doc.querySelector('.forum-operate').__vue__ = opVm;
      doc.querySelector('.bar-wrap').__vue__ = barVm;
      doc.querySelector('.follow-sign').addEventListener('click', () => { calls.sign += 1; });
    },
  });
  t.after(() => env.window.close());
  env.flush();
  return { env, calls, stateWrites, vm: barVm };
}

function followButton(env) {
  return env.doc.querySelector('.tn-forum-follow');
}

test('forum follow: unfollowed proxies the native follow once and hides the native button', (t) => {
  const { env, calls, stateWrites } = forumEnv(t, { followed: false });
  const op = env.doc.querySelector('.forum-operate');
  const sign = env.doc.querySelector('.follow-sign');
  const btn = followButton(env);

  assert.ok(btn, 'independent follow button exists');
  assert.equal(btn.parentElement, op, 'the button is a direct child of .forum-operate');
  assert.equal(btn.nextElementSibling, sign.parentElement, 'placed immediately left of the native control');
  assert.ok(btn.classList.contains('button-wrapper') && btn.classList.contains('operate-btn'),
    'reuses the native button classes so styling matches the check-in control');
  assert.equal(btn.classList.contains('follow-sign'), false, 'does not masquerade as the native control');
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 1);
  assert.equal(isDisplayed(env, sign), false, 'native follow is hidden to prevent a double action');
  assert.equal(calls.sign, 0, 'nothing is clicked on load');
  assert.equal(calls.dialog, 0);

  env.click(btn);
  assert.equal(calls.sign, 1, 'the native follow click runs exactly once');
  assert.equal(calls.dialog, 0, 'no cancel dialog while unfollowed');
  assert.deepEqual(stateWrites, [], 'the script never writes the site account state');

  // Repeated layout passes must not re-insert the button or re-arm the proxy: a clone that kept
  // .follow-sign, or an unconditional insertBefore, would multiply listeners and clicks here.
  for (let i = 0; i < 5; i += 1) env.flush();
  assert.equal(followButton(env), btn, 'the same proxy button survives repeated flushes');
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 1, 'exactly one proxy');
  assert.equal(env.doc.querySelectorAll('.follow-sign').length, 1, 'no cloned native control appears');

  env.click(btn);
  assert.equal(calls.sign, 2, 'one native click per proxy click, even after repeated flushes');
});

test('forum follow: followed keeps native 签到 intact and only opens the cancel dialog', (t) => {
  const { env, calls, stateWrites, vm } = forumEnv(t, { followed: true });
  const sign = env.doc.querySelector('.follow-sign');
  const btn = followButton(env);
  assert.ok(btn, 'independent unfollow button exists');
  const parent = sign.parentNode;
  assert.equal(isDisplayed(env, sign), true, 'native check-in control stays visible');
  assert.equal(sign.textContent, '签到');
  assert.equal(sign.parentNode, parent, 'native control is not moved or cloned');
  assert.equal(calls.sign, 0, 'sign-in is never triggered automatically');
  assert.equal(calls.signIn, 0, 'the operate VM is not asked to sign in');

  for (let i = 0; i < 5; i += 1) env.flush();
  assert.equal(followButton(env), btn, 'the same button survives repeated flushes');
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 1, 'exactly one control');
  assert.equal(env.doc.querySelectorAll('.follow-sign').length, 1, 'native control is never cloned');
  assert.equal(isDisplayed(env, sign), true, 'repeated flushes keep 签到 visible');

  env.click(btn);
  assert.equal(calls.dialog, 1, 'only the native cancel dialog opens');
  env.click(btn);
  assert.equal(calls.dialog, 2, 'one dialog per click, no stacked listeners');
  assert.equal(calls.sign, 0, 'the new button never clicks 签到');
  assert.equal(calls.cancelFollow, 0, 'the cancel result callback is not invoked directly');
  assert.equal(calls.signIn, 0, 'no undocumented account API is called');
  assert.equal(calls.followAndSign, 0, 'the follow-and-sign path is never taken on click');
  assert.deepEqual(stateWrites, [], 'opening a dialog must not write the followed state');

  // The site owns the state: when BarIntro flips it, the button label follows.
  const before = btn.textContent;
  vm.isFollowedFrs = false;
  env.flush();
  const after = followButton(env).textContent;
  assert.notEqual(after, before, 'state changes are reflected from the site VM, not guessed');
  assert.equal(calls.sign, 0, 'reflecting state never clicks the native control');
});

test('forum follow: cancelled dialog or missing VM keeps state without signing in', async (t) => {
  const cancelled = forumEnv(t, { followed: true, cancel: () => { /* user dismisses the dialog */ } });
  const btn = followButton(cancelled.env);
  cancelled.env.click(btn);
  assert.equal(cancelled.calls.dialog, 1);
  assert.equal(cancelled.calls.cancelFollow, 0);
  assert.equal(cancelled.calls.sign, 0);
  assert.deepEqual(cancelled.stateWrites, []);
  cancelled.env.flush();
  assert.equal(followButton(cancelled.env).textContent, btn.textContent, 'dismissing keeps the button state');
  cancelled.env.window.close();

  // Without any native follow VM the click must be a harmless no-op, never a fabricated action.
  const bare = createEnv({ html: FORUM_FIXTURE(`<button type="button" class="${SIGN_CLASS} follow-sign">签到</button>`), url: 'https://tieba.baidu.com/f?kw=test' });
  t.after(() => bare.window.close());
  const op = bare.doc.querySelector('.forum-operate');
  let sign = 0;
  bare.doc.querySelector('.follow-sign').addEventListener('click', () => { sign += 1; });
  bare.flush();
  const bareBtn = followButton(bare);
  assert.ok(bareBtn, 'the native page action is still surfaced');
  assert.equal(bareBtn.disabled, true, 'an unrecognised VM leaves the proxy inert');
  assert.equal(bareBtn.hidden, true, 'no dead button is shown');
  bare.click(bareBtn);
  assert.equal(sign, 0, 'no sign-in click without the native dialog API');
  assert.equal(isDisplayed(bare, op.querySelector('.follow-sign')), true,
    'the native control is left alone when the script cannot drive it');
});

test('forum follow: hidden sticky header retains native size rules without identity classes', (t) => {
  const { env } = forumEnv(t);
  const style = env.doc.createElement('style');
  style.textContent = '.follow-sign { min-width:60px; height:29px; padding:0 8px; box-sizing:border-box; width:max-content; }';
  env.doc.head.appendChild(style);
  env.doc.querySelector('.head-pic-area').style.display = 'none';
  env.flush();
  const button = followButton(env);
  assert.equal(button.style.width, 'max-content');
  assert.equal(button.style.minWidth, '60px');
  assert.equal(button.style.height, '29px');
  assert.equal(button.style.padding, '0px 8px');
  assert.equal(button.classList.contains('follow-sign'), false);
});

// Followed state needs 16px side padding for the longer “取消关注” label; unfollowed must go back to
// the native side padding (8px here) instead of dropping the inline value and collapsing to 0.
test('forum follow: side padding switches with followed state and restores the native value', (t) => {
  const { env, vm } = forumEnv(t, { followed: true });
  const style = env.doc.createElement('style');
  style.textContent = '.follow-sign { padding:0 8px; height:29px; min-width:60px; box-sizing:border-box; }';
  env.doc.head.appendChild(style);
  env.flush();

  const btn = followButton(env);
  assert.equal(btn.style.paddingLeft, '16px', 'followed: left breathing room');
  assert.equal(btn.style.paddingRight, '16px', 'followed: right breathing room');
  assert.equal(btn.style.paddingTop, '0px', 'vertical padding stays native');

  vm.isFollowedFrs = false;
  env.flush();
  assert.equal(btn.style.paddingLeft, '8px', 'unfollowed restores the native side padding');
  assert.equal(btn.style.paddingRight, '8px');

  // Repeated passes must not accumulate padding or flip it back to 16px while unfollowed.
  for (let i = 0; i < 3; i += 1) env.flush();
  assert.equal(btn.style.paddingLeft, '8px');
  assert.equal(btn.style.paddingRight, '8px');

  vm.isFollowedFrs = true;
  env.flush();
  assert.equal(btn.style.paddingLeft, '16px', 're-following widens the padding again');
  assert.equal(btn.style.paddingRight, '16px');
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 1, 'padding cycles never duplicate the button');
});

test('navigation appearance: light background fixes native and post arrow contrast together', (t) => {
  const env = postEnv(t);
  const rule = cssRules(env).find(r => r.selectorText.includes('html.tn-light-bg #tn-post-nav .back-icon'));
  assert.ok(rule);
  assert.match(rule.selectorText, /\.frs-page-wrap/);
  assert.match(rule.style.filter, /brightness\(0\)/);
  const css = env.doc.querySelector('#tn-style').textContent;
  assert.match(css, /\.tn-forum-follow\) > \.forum-info \{ width: auto !important; min-width: 0/);
});

test('forum follow: works when the native control is a direct child of .forum-operate', (t) => {
  const { env, calls } = forumEnv(t, { followed: false, wrapped: false });
  const op = env.doc.querySelector('.forum-operate');
  const sign = env.doc.querySelector('.follow-sign');
  const btn = followButton(env);
  assert.ok(btn);
  assert.equal(btn.parentElement, op);
  assert.equal(btn.nextElementSibling, sign, 'inserted directly before the native button');
  env.click(btn);
  assert.equal(calls.sign, 1);
  env.flush();
  assert.equal(env.doc.querySelectorAll('.tn-forum-follow').length, 1);
});

// Measurements from the site's own floating column: back is 40x40 with a 19px icon at sticky
// top:20px (global 80px under the 60px header), back-to-top is 40x40 with a 23px icon at
// calc(100vh - 115px) inside the post scrollport. The post nav must reproduce those two anchors
// as separate absolutely-positioned slots, not as a flex stack.
function ruleFor(env, test) {
  return cssRules(env).find(rule => {
    try {
      return rule.selectorText.split(',').some(part => test(part.trim()));
    } catch {
      return false;
    }
  });
}

function rect(_env, el, { top = 0, left = 0, width = 0, height = 0 } = {}) {
  el.getBoundingClientRect = () => ({
    top, left, width, height, right: left + width, bottom: top + height, x: left, y: top,
  });
}

// The wide block's --tn-fab override for the post nav, or undefined when wide is off.
function fabRuleIn(env) {
  return cssRules(env).find(rule => (
    /#tn-post-nav/.test(rule.selectorText) && /var\(--tn-fab\)/.test(rule.style.width || '')
  ));
}

test('post nav: full-height layer with separate native back and back-to-top anchors', (t) => {
  const env = postEnv(t, { wide: true });

  const layer = ruleFor(env, s => s === '#tn-post-nav');
  assert.ok(layer, '#tn-post-nav rule exists');
  assert.equal(layer.style.position, 'fixed');
  assert.equal(layer.style.top, '0px');
  assert.equal(layer.style.bottom, '0px');
  assert.equal(layer.style.getPropertyValue('gap'), '', 'anchors are absolute, not a flex gap');

  for (const selector of ['#tn-post-nav .tn-post-back', '#tn-post-nav .back-top']) {
    const rule = ruleFor(env, s => s === selector);
    assert.ok(rule, `${selector} is positioned on its own`);
    assert.equal(rule.style.position, '', 'the shared child rule owns position:absolute');
    assert.ok(rule.style.top, `${selector} sets its own top anchor`);
  }

  const childRule = ruleFor(env, s => s.startsWith('#tn-post-nav :is('));
  assert.ok(childRule);
  assert.equal(childRule.style.position, 'absolute');

  const backTop = ruleFor(env, s => s === '#tn-post-nav .tn-post-back').style.top;
  assert.match(backTop, /var\(--tn-post-top, 80px\)/, 'back falls back to the site\'s 60px header + 20px');

  const lowerTop = ruleFor(env, s => s === '#tn-post-nav .back-top').style.top;
  // Without JS the fallback is the usual boxTop 60 + (100vh - 115) = 100vh - 55; the JS pass below
  // sets the exact boxTop-relative value.
  assert.match(lowerTop, /100vh - 55px/, 'back-to-top fallback assumes the 60px scrollport top');
});

test('post nav: sizes follow --tn-fab when wide, with 40px and 19/23px fallbacks', (t) => {
  const wide = postEnv(t, { wide: true });
  // The base rule keeps a 40px fallback; the wide block re-sizes the buttons from the site's
  // --tn-fab via a more specific child selector (the layer only sets its own width).
  const fabRule = cssRules(wide).find(rule => (
    /#tn-post-nav\s+:is\(/.test(rule.selectorText)
    && /var\(--tn-fab\)/.test(rule.style.getPropertyValue('width'))
    && /var\(--tn-fab\)/.test(rule.style.getPropertyValue('height'))
  ));
  assert.ok(fabRule, 'wide sizing comes from --tn-fab, the same token as the site floating buttons');
  const fabLayer = cssRules(wide).find(rule => (
    rule.selectorText === '#tn-post-nav' && /var\(--tn-fab\)/.test(rule.style.width || '')
  ));
  assert.ok(fabLayer, 'the full-height layer is as wide as one fab button');

  const wideIconRule = cssRules(wide).find(rule => (
    /#tn-post-nav/.test(rule.selectorText) && /70%/.test(rule.style.width || '')
  ));
  assert.ok(wideIconRule, 'wide keeps the site\'s 70% icon ratio for the post nav too');

  const narrow = postEnv(t, { wide: false });
  assert.equal(fabRuleIn(narrow), undefined, 'without wide the --tn-fab override is not emitted');
  const narrowIcon = ruleFor(narrow, s => s === '#tn-post-nav .back-icon');
  assert.equal(narrowIcon.style.width, '19px', 'fallback back icon size matches the native control');
  assert.equal(narrowIcon.style.height, '19px');
  const narrowTop = ruleFor(narrow, s => s === '#tn-post-nav .back-top-icon');
  assert.equal(narrowTop.style.width, '23px', 'fallback back-top icon size matches the native control');
  assert.equal(narrowTop.style.height, '23px');
});

test('post nav: JS mirrors both native anchors from the live scroll container and stays idempotent', (t) => {
  const env = postEnv(t, { wide: true });
  const nav = navOf(env);
  const box = env.doc.querySelector('.pc-pb-box');
  const content = env.doc.querySelector('.center-content');
  assert.equal(env.window.innerHeight, 768);

  rect(env, box, { top: 60, left: 200, width: 800, height: 700 });
  rect(env, content, { top: 80, left: 220, width: 760, height: 600 });
  env.flush();

  assert.equal(nav.style.getPropertyValue('--tn-post-top'), '80px', 'back sits 20px below the scrollport top');
  assert.equal(nav.style.getPropertyValue('--tn-post-lower'), `${60 + 768 - 115}px`,
    'back-to-top uses the post page\'s calc(100vh - 115px) inside the scrollport');

  const before = {
    top: nav.style.getPropertyValue('--tn-post-top'),
    lower: nav.style.getPropertyValue('--tn-post-lower'),
    left: nav.style.getPropertyValue('--tn-post-nav-left'),
  };
  for (let i = 0; i < 5; i += 1) env.flush();
  assert.deepEqual({
    top: nav.style.getPropertyValue('--tn-post-top'),
    lower: nav.style.getPropertyValue('--tn-post-lower'),
    left: nav.style.getPropertyValue('--tn-post-nav-left'),
  }, before, 'repeated passes write the same anchors and nothing else');

  // A moved/emulated scrollport must re-anchor both buttons without recreating the nav.
  rect(env, box, { top: 120, left: 200, width: 800, height: 700 });
  env.flush();
  assert.equal(navOf(env), nav, 'the same nav element is reused');
  assert.equal(nav.style.getPropertyValue('--tn-post-top'), '140px');
  assert.equal(nav.style.getPropertyValue('--tn-post-lower'), `${120 + 768 - 115}px`);

  // Replacing the container re-anchors from the replacement, not the stale node.
  const replacement = box.cloneNode(true);
  rect(env, replacement, { top: 40, left: 240, width: 800, height: 700 });
  box.replaceWith(replacement);
  env.flush();
  assert.equal(nav.style.getPropertyValue('--tn-post-top'), '60px');
  assert.equal(nav.style.getPropertyValue('--tn-post-lower'), `${40 + 768 - 115}px`);
});
