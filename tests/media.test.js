'use strict';

// jsdom has no layout engine, so width behaviour is asserted on the generated CSS text plus the
// selector that actually controls the player's box. Real geometry was verified in a live browser;
// these tests pin the rules so the regression cannot silently come back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/harness');

const POST_FIXTURE = `<!doctype html><html><head></head><body>
<div class="pb-page-wrapper">
  <div class="pc-pb-box">
    <div class="container">
      <div class="center-content">
        <div class="pb-content-wrap">
          <div class="image-text">
            <div><div class="art-video-player"><video class="art-video"></video></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const styleText = (env) => env.doc.getElementById('tn-style')?.textContent || '';

test('media: the video wrapper is capped by --tn-media, not only the player', async (t) => {
  const env = createEnv({ html: POST_FIXTURE, cfg: { mediaWidth: '820px' } });
  t.after(() => env.window.close());
  env.flush();

  const css = styleText(env);
  assert.match(css, /--tn-media:\s*820px/, 'custom media width must reach the variable');
  assert.match(
    css,
    /\.pb-page-wrapper \.image-text > div:has\(> \.art-video-player\)\s*\{[^}]*max-width:\s*min\(100%, var\(--tn-media\)\)/,
    'the unnamed player wrapper must be capped, otherwise it stays full width',
  );
  // The player must keep filling its (now capped) wrapper so the aspect ratio is preserved.
  assert.match(css, /\.art-video-player[^{]*\{[^}]*width:\s*100% !important/);
});

test('media: width cap follows the setting and is restorable', async (t) => {
  const env = createEnv({ html: POST_FIXTURE });
  t.after(() => env.window.close());
  env.flush();
  assert.match(styleText(env), /--tn-media:\s*820px/, 'default media width');

  env.saveSettings({ mediaWidth: '400px' });
  assert.equal(env.store.cfg.mediaWidth, '400px');
  assert.match(styleText(env), /--tn-media:\s*400px/);
  assert.match(styleText(env), /max-width:\s*min\(100%, var\(--tn-media\)\)/);

  env.saveSettings({ mediaWidth: '820px' });
  assert.equal(env.store.cfg.mediaWidth, '820px');
  assert.match(styleText(env), /--tn-media:\s*820px/, 'restoring the setting must restore the rule');
});

test('media: an invalid media width falls back instead of dropping the cap', async (t) => {
  const env = createEnv({ html: POST_FIXTURE, cfg: { mediaWidth: 'nonsense' } });
  t.after(() => env.window.close());
  env.flush();
  assert.match(styleText(env), /--tn-media:\s*100%/, 'invalid value falls back to 100%');
  assert.match(styleText(env), /:has\(> \.art-video-player\)/, 'the wrapper cap must still be emitted');
});

test('media: image rules remain independent of the video wrapper cap', async (t) => {
  const env = createEnv({ html: POST_FIXTURE, cfg: { mediaWidth: '400px' } });
  t.after(() => env.window.close());
  env.flush();
  const css = styleText(env);
  assert.match(css, /\.pb-content-wrap :is\(img:not\(\.emoji-img\), video\) \{ max-width: 100% !important; height: auto; \}/);
  assert.match(css, /\.thread-card \.thread-image,[\s\S]*?max-width: min\(100%, var\(--tn-media\)\)/);
});
