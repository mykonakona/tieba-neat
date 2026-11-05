'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, wait } = require('./helpers/harness');

const HOME_FIXTURE = `<!doctype html><html><head></head><body>
<div class="home-page-wrapper">
  <div class="container">
    <div class="center-content">
      <div class="thread-container">
        <div class="thread-card-wrapper"><div class="thread-content"><div class="thread-title">正常帖子标题</div></div></div>
        <div class="feed-reco-module">
          <div class="module-header"><span class="module-title">占位栏目标题</span></div>
          <div class="module-list"><div class="thread-card-wrapper"><div class="thread-title">推荐帖子</div></div></div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const POST_FIXTURE = `<!doctype html><html><head></head><body>
<div class="pb-page-wrapper">
  <div class="pb-content-wrap">
    <div class="pc-pb-box">
      <div class="container">
        <div class="center-content">
          <div class="pb-title-wrap"><h1 class="pb-title">帖子标题</h1></div>
          <div class="pb-rich-text"><p>相关推荐</p><p>正文内容</p></div>
          <div class="pb-comment-item"><div class="pb-rich-text"><p>相关推荐</p></div></div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const PROFILE_FIXTURE = `<!doctype html><html><head></head><body>
<div class="usercenter-page-wrapper">
  <div class="user-information-wrapper">
    <div class="user-top-info-wrapper">
      <div class="user-intro">相关推荐</div>
    </div>
  </div>
</div>
</body></html>`;

const hiddenBy = (doc, el) => {
  const host = el.closest('[data-tn-hide]');
  return host ? host.getAttribute('data-tn-hide') : null;
};

test('keywords: reused text node updated to a keyword title is hidden', async (t) => {
  const env = createEnv({ html: HOME_FIXTURE });
  t.after(() => env.window.close());
  env.flush();

  const module = env.doc.querySelector('.feed-reco-module');
  const titleText = env.doc.querySelector('.module-title').firstChild;
  assert.equal(hiddenBy(env.doc, module), null, 'placeholder title is not a keyword');

  // The site recycles the same text node and rewrites it into a recommendation title.
  titleText.data = '相关推荐';
  await wait(400);

  assert.ok(hiddenBy(env.doc, module), 'recycled text node should be rescanned after its data changes');
  assert.equal(env.doc.querySelector('.module-title').textContent, '相关推荐');
});

test('keywords: a section hidden by its title is revealed when the title stops matching', async (t) => {
  const env = createEnv({ html: HOME_FIXTURE });
  t.after(() => env.window.close());
  env.flush();

  const module = env.doc.querySelector('.feed-reco-module');
  const titleText = env.doc.querySelector('.module-title').firstChild;

  // 1) ordinary column -> recommendation title: hidden
  titleText.data = '为你推荐';
  await wait(400);
  assert.equal(hiddenBy(env.doc, module), '标题:为你推荐', 'keyword title hides the section');

  // 2) the site reuses the same node for an ordinary column title: must be visible again
  titleText.data = '普通栏目标题';
  await wait(500);
  assert.equal(module.hasAttribute('data-tn-hide'), false, 'section must be revealed when the title stops matching');
  assert.equal(titleText.data, '普通栏目标题');

  // 3) and hiding still works when the same node turns back into a keyword title
  titleText.data = '猜你喜欢';
  await wait(500);
  assert.equal(hiddenBy(env.doc, module), '标题:猜你喜欢', 're-hiding after a revert must still work');
});

test('keywords: reveal/re-hide cycles do not loop or touch user text', async (t) => {
  const env = createEnv({ html: HOME_FIXTURE });
  t.after(() => env.window.close());
  env.flush();

  const module = env.doc.querySelector('.feed-reco-module');
  const titleText = env.doc.querySelector('.module-title').firstChild;
  const body = env.doc.querySelector('.thread-title');

  // Count mutations after the script has settled, then flip the title repeatedly.
  await wait(400);
  const counts = { total: 0 };
  const observer = new env.window.MutationObserver((records) => { counts.total += records.length; });
  observer.observe(env.doc.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });

  for (const label of ['相关推荐', '普通栏目', '相关推荐', '普通栏目']) {
    titleText.data = label;
    await wait(400);
  }
  observer.disconnect();

  // 4 text edits plus at most one attribute change per hide/reveal; no runaway self-triggering.
  assert.ok(counts.total <= 20, `unexpected mutation churn: ${counts.total}`);
  assert.equal(module.hasAttribute('data-tn-hide'), false, 'ends revealed after the last revert');
  assert.equal(body.closest('[data-tn-hide]'), null, 'user/post titles must never be hidden');
});

test('keywords: post body, comments and profile intro containing keywords stay visible', async () => {
  for (const [name, html, selectors] of [
    ['post', POST_FIXTURE, ['.pb-rich-text', '.pb-comment-item', '.pb-content-wrap', '.pb-title']],
    ['profile', PROFILE_FIXTURE, ['.user-intro', '.user-information-wrapper']],
  ]) {
    const env = createEnv({ html });
    try {
      env.flush();
      await wait(300);
      for (const sel of selectors) {
        const el = env.doc.querySelector(sel);
        assert.ok(el, `${name}: missing fixture element ${sel}`);
        assert.equal(hiddenBy(env.doc, el), null, `${name}: ${sel} must not be hidden`);
        assert.ok(!el.hasAttribute('data-tn-hide'), `${name}: ${sel} itself must not be marked`);
      }
    } finally {
      env.window.close();
    }
  }
});
