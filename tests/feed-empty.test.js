'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, waitFor, wait } = require('./helpers/harness');

const FEED_FIXTURE = `<!doctype html><html><head></head><body>
<div class="home-page-wrapper">
  <div class="container">
    <div class="center-content">
      <div class="thread-container"></div>
    </div>
  </div>
</div>
</body></html>`;

const recommended = (from, count = 1) => Array.from({ length: count }, (_, i) => ({
  id: from + i,
  title: `r${from + i}`,
  businessInfo: { forum_is_liked: '0' },
}));
const followed = (from, count = 1) => Array.from({ length: count }, (_, i) => ({
  id: from + i,
  title: `f${from + i}`,
  businessInfo: { forum_is_liked: '1' },
}));

// Mimics the site feed component: loadMore() appends the next synthetic page to feedList.
function feedEnv({ feedMode = 'follow', feedList, batches = [], hasMore = true } = {}) {
  const record = { loadCalls: 0, batches: batches.slice(), hasMore };
  const env = createEnv({
    html: FEED_FIXTURE,
    cfg: { feedMode },
    prepare({ window }) {
      const host = window.document.querySelector('.home-page-wrapper .thread-container');
      const vm = {
        feedList,
        hasMore: record.hasMore,
        loadMoreLoading: false,
        initLoading: false,
        $watch() { return () => {}; },
        loadMore() {
          record.loadCalls += 1;
          const page = record.batches.length ? record.batches.shift() : [];
          vm.feedList = vm.feedList.concat(page);
        },
      };
      host.__vue__ = vm;
      record.vm = vm;
    },
  });
  env.record = record;
  env.prompt = () => env.doc.getElementById('tn-feed-empty');
  return env;
}

test('empty-feed: exhausted auto-load shows the hint even with no further DOM mutations', async (t) => {
  const env = feedEnv({
    feedMode: 'follow',
    feedList: recommended(1, 2),
    batches: [recommended(10, 1), recommended(20, 1), recommended(30, 1), recommended(40, 1), recommended(50, 1)],
  });
  t.after(() => env.window.close());
  env.flush();
  await wait(2000);

  // Three consecutive batches without a follow item trip FEED_STALL_LIMIT and stop loading.
  assert.ok(env.record.loadCalls <= 3, `expected <=3 loadMore calls, got ${env.record.loadCalls}`);
  assert.ok(env.prompt(), 'empty hint should be present once auto-loading gives up');
  assert.equal(env.prompt().textContent, '暂无关注内容');
});

test('empty-feed: reaching the load ceiling stops loading and keeps a non-empty list', async (t) => {
  // Occasional followed batches reset the stall counter while the list stays below FEED_ITEM_MIN,
  // so FEED_MAX_LOADS is what stops the loop. The list is never empty, so no hint should appear.
  const batches = [];
  for (let i = 0; i < 16; i++) {
    batches.push([0, 3, 6, 9, 12].includes(i) ? followed(500 + i) : recommended(900 + i));
  }
  const env = feedEnv({ feedMode: 'follow', feedList: recommended(1), batches });
  t.after(() => env.window.close());
  env.flush();
  await waitFor(() => env.record.loadCalls >= 16, { timeout: 12000, label: 'load ceiling' });
  await wait(800);
  assert.equal(env.record.loadCalls, 16, 'loading must stop at FEED_MAX_LOADS');
  assert.ok(env.record.vm.feedList.length > 0, 'list keeps the followed items found so far');
  assert.equal(env.prompt(), null, 'a non-empty list must not show the empty hint');
});

test('empty-feed: switching back to "all" restores the list and removes the hint', async (t) => {
  const env = feedEnv({ feedMode: 'follow', feedList: recommended(1, 2), batches: [recommended(10, 1)] });
  t.after(() => env.window.close());
  env.flush();
  await waitFor(() => env.prompt(), { timeout: 4000, label: 'empty hint' });
  assert.equal(env.store.cfg.feedMode, 'follow');

  env.saveSettings({ feedMode: 'all' });
  assert.equal(env.store.cfg.feedMode, 'all');
  assert.equal(env.prompt(), null, 'hint should be gone in "all" mode');
  assert.ok(env.record.vm.feedList.length >= 2, `list should be restored, got ${env.record.vm.feedList.length}`);
  const ids = env.record.vm.feedList.map((item) => item.id);
  for (const id of [1, 2, 10]) assert.ok(ids.includes(id), `restored list should contain item ${id}`);
});

test('empty-feed: switching to "all" cancels pending auto-load retries', async (t) => {
  const env = feedEnv({
    feedMode: 'follow',
    feedList: recommended(1, 2),
    batches: [recommended(10, 1), recommended(20, 1), recommended(30, 1), recommended(40, 1)],
  });
  t.after(() => env.window.close());
  env.flush();
  await waitFor(() => env.record.loadCalls >= 1, { timeout: 4000, label: 'first auto-load' });

  env.saveSettings({ feedMode: 'all' });
  assert.equal(env.store.cfg.feedMode, 'all');
  assert.equal(env.prompt(), null, 'no hint in "all" mode');
  const callsAtSwitch = env.record.loadCalls;
  const listAtSwitch = env.record.vm.feedList.length;
  await wait(1500);
  assert.equal(env.record.loadCalls, callsAtSwitch, 'no retry after switching back to "all"');
  assert.equal(env.record.vm.feedList.length, listAtSwitch, 'the list must stay stable');
});
