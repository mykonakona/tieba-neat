// ==UserScript==
// @name         贴吧清爽宽屏 Tieba Neat
// @namespace    tieba-neat
// @version      0.6.1
// @description  仅适用于新版贴吧桌面布局：宽屏居中、统一背景与文字配色，隐藏广告和推荐栏目，可切换首页关注 / 推荐
// @author       mykonakona
// @match        *://tieba.baidu.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // SPA route changes do not update document.referrer, so count same-document pushes to
  // know whether history.back() still stays inside Tieba.
  let internalNav = 0;
  try {
    const pushState = history.pushState;
    history.pushState = function (...args) {
      const before = location.href;
      const ret = Reflect.apply(pushState, this, args);
      if (location.href !== before) internalNav++;
      return ret;
    };
    window.addEventListener('popstate', () => {
      if (internalNav > 0) internalNav--;
    });
  } catch { /* History API unavailable */ }

  const BLOCKS = [
    { id: 'rightSidebar', name: '右侧栏（首页 / 吧页 / 个人页 / 帖子页）', on: true,
      sel: '.home-page-wrapper .right-nav-bar, .frs-right-sidebar, .usercenter-content-wrapper > .right-nav-bar, .pb-page-wrapper .right-nav-bar' },
    { id: 'ads', name: '广告 / 下载 App 引导', on: true,
      sel: '.ad-banner-wrapper, .feed-ad-container, .feed-ad-placeholder, [data-key^="ad__"], .tb-ad-wrap, .native-ad-wrap, .brise-pb-ad, .dasense-ad, .ad-container, .app-download-box, .tb-bottom-banner' },
    { id: 'topExtras', name: '顶部推广图标（保留消息）', on: true,
      sel: '.top-nav-bar :is(.menu-item, [class*="menu-item"]):not(:has(use[*|href*="message" i], use[*|href*="feedback" i], use[*|href*="back_old" i])), .top-nav-bar .menu-list:has(use[*|href*="message" i]) > :not(:has(use[*|href*="message" i], use[*|href*="feedback" i], use[*|href*="back_old" i]))' },
    { id: 'profileTools', name: '个人主页「常用功能」推广', sel: '.usercenter-page-wrapper .usual-function-wrapper', on: true },
    { id: 'leftNav', name: '左侧导航栏', sel: '.pc-main-page-layout .left-content, .pc-main-page-layout .collapse-btn', on: false },
  ];

  const CONFIG_VERSION = 13;

  const DEFAULTS = {
    version: CONFIG_VERSION,
    wide: true,
    pageWidth: '2560px',
    colWidth: '1320px',
    mediaWidth: '820px',
    blocks: Object.fromEntries(BLOCKS.map((b) => [b.id, b.on])),
    keywords: ['最有料', '相关推荐', '猜你喜欢', '为你推荐', '大家都在看', '大家都在搜'],
    bgOn: true,
    bgColor: '#f2f3f5',
    feedMode: 'all',
  };

  function loadCfg() {
    const saved = GM_getValue('cfg', {});
    const out = { ...DEFAULTS, ...saved, blocks: { ...DEFAULTS.blocks, ...(saved.blocks || {}) } };
    if (!saved.version || saved.version < 7) {
      for (const k of ['homeSidebar', 'hotTopic', 'hotForum', 'frsSidebar', 'profileSidebar', 'postSidebar']) delete out.blocks[k];
      out.blocks.rightSidebar = true;
      if (!saved.colWidth || saved.colWidth === '1200px') out.colWidth = DEFAULTS.colWidth;
    }
    if (!saved.version || saved.version < 9) {
      out.bgOn = true;
      if (!saved.bgColor || /^auto$/i.test(saved.bgColor)) out.bgColor = DEFAULTS.bgColor;
    }
    if (!saved.version || saved.version < 10) {
      if (/^#(e7e9ec|202124)$/i.test(out.bgColor || '')) out.bgColor = DEFAULTS.bgColor;
    }
    if (!saved.version || saved.version < 11) {
      out.blocks = { ...DEFAULTS.blocks, leftNav: !!(saved.blocks && saved.blocks.leftNav) };
      out.keywords = DEFAULTS.keywords;
      delete out.selectors;
    }
    if (!saved.version || saved.version < 13) {
      const follow = saved.feedFollowed;
      const rec = saved.feedRecommended;
      out.feedMode = follow === true && rec === false ? 'follow'
        : follow === false && rec === true ? 'recommended'
          : 'all';
    }
    delete out.feedFollowed;
    delete out.feedRecommended;
    if (saved.version !== CONFIG_VERSION) {
      out.version = CONFIG_VERSION;
      GM_setValue('cfg', out);
    }
    return out;
  }
  let cfg = loadCfg();
  const cssLen = (v, fallback) => (v && CSS.supports('width', v) ? v : fallback);
  const saveCfg = () => GM_setValue('cfg', cfg);

  const isDarkTheme = () => !!document.documentElement?.classList.contains('darkmode')
    || !!document.querySelector('.pc-main-page-layout.dark-layout');
  function bgColor() {
    const raw = (cfg.bgColor || '').trim();
    if (!raw || /^auto$/i.test(raw)) return isDarkTheme() ? '#0d0e10' : '#f2f3f5';
    return CSS.supports('color', raw) ? raw : '';
  }
  let colorCtx;
  function isDarkColor(c) {
    if (!c) return false;
    try {
      colorCtx ||= document.createElement('canvas').getContext('2d');
      colorCtx.fillStyle = '#000000';
      colorCtx.fillStyle = c;
      const v = String(colorCtx.fillStyle);
      let r, g, b, a = 1;
      if (v[0] === '#') {
        r = parseInt(v.slice(1, 3), 16); g = parseInt(v.slice(3, 5), 16); b = parseInt(v.slice(5, 7), 16);
      } else {
        const m = v.match(/([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
        if (!m) return false;
        [r, g, b] = m.slice(1, 4).map(Number);
        if (m[4] != null) a = Number(m[4]);
      }
      if (a < 1) { r = r * a + 255 * (1 - a); g = g * a + 255 * (1 - a); b = b * a + 255 * (1 - a); }
      const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.25;
    } catch {
      return false;
    }
  }

  const BASE_CSS = `
[data-tn-hide] { display: none !important; }
.top-nav-bar .home-icon { display: none !important; }
.top-nav-bar .home-icon-min { display: block !important; width: 34px !important; height: 34px !important; }
.top-nav-bar .tb-home { width: 34px !important; }
.top-nav-bar .search-mid { max-width: min(800px, 55vw) !important; }
html.tn-top-center .top-nav-bar .search-mid { transform: translateX(var(--tn-search-shift, 0px)); }
#tn-feed-empty { padding: 48px 0; text-align: center; font-size: 14px; color: var(--cos-color-text-minor, #848691); }
`;

  function buildCss() {
    const out = [BASE_CSS];
    const b = cfg.blocks;
    const hideSels = BLOCKS.filter((x) => b[x.id]).map((x) => x.sel);
    for (const s of hideSels) {
      out.push(`:is(${s}) { display: none !important; }`);
    }

    if (b.leftNav) {
      out.push(`.pc-main-page-layout .content-container .main-content { width: 100% !important; margin-left: 0 !important; }`);
    }

    if (cfg.wide) {
      const sidebarsShown = !b.rightSidebar;
      const slot = sidebarsShown ? 'calc(332px + var(--tn-side-gap))' : '0px';
      const nav = b.leftNav ? '0px' : 'var(--tn-nav)';
      const navMedia = b.leftNav ? '' : `
@media (max-width: 1006px) { :root { --tn-nav: 211px; } }
@media (max-width: 900px) { :root { --tn-nav: 199px; } }`;
      out.push(`
:root {
  --tn-page: ${cssLen(cfg.pageWidth, '100vw')};
  --tn-col: ${cssLen(cfg.colWidth, '100%')};
  --tn-media: ${cssLen(cfg.mediaWidth, '100%')};
  --tn-gutter: clamp(40px, 2.2vw, 44px);
  --tn-fab: calc(var(--tn-gutter) - 4px);
  --tn-nav: ${b.leftNav ? '0px' : '261px'};
  --tn-side-gap: 36px;
  --tn-scrollbar: 16px;
  --tn-content: min(var(--tn-col), calc(min(100vw, var(--tn-page)) - ${nav} - var(--tn-gutter) - var(--tn-gutter) - var(--tn-scrollbar)));
}${navMedia}
.pc-main-page-layout .content-container { max-width: var(--tn-page) !important; }
.pc-main-page-layout .main-content { min-width: 0 !important; }
@media screen and (min-width: 1920px) {
  .top-nav-bar { width: min(100vw, var(--tn-page)) !important; }
}
${b.leftNav ? '' : `
.pc-main-page-layout .content-container .left-content { box-sizing: border-box !important; flex: 0 0 var(--tn-nav) !important; width: var(--tn-nav) !important; }
.pc-main-page-layout .content-container .main-content { flex: 1 1 0% !important; margin-left: 0 !important; width: auto !important; }
`}

.frs-page-wrap,
.usercenter-page-wrapper,
.pb-page-wrapper {
  width: min(100%, calc(var(--tn-content) + ${slot} + var(--tn-gutter) + var(--tn-gutter))) !important;
  margin-inline: auto !important;
}
html.tn-screen-center :is(.home-page-wrapper > .container, .frs-page-wrap, .usercenter-page-wrapper, .pb-page-wrapper) {
  position: relative !important;
  left: calc(var(--tn-nav) / -2) !important;
}
.pc-main-page-layout .content-container .left-content { z-index: 9 !important; }

.home-page-wrapper > .container {
  box-sizing: border-box !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: 0 !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${slot} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-top: 20px !important;
  padding-inline: var(--tn-gutter) !important;
}
.home-page-wrapper .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-right: 0 !important;
}
.home-page-wrapper .center-content .thread-container { margin-top: 0 !important; }
.home-page-wrapper .thread-title,
.frs-feed-list .thread-title,
.usercenter-content-wrapper .thread-title { font-size: 15px !important; }
.home-page-wrapper .right-nav-bar {
  flex: 0 0 332px !important;
  width: 332px !important;
  max-width: 100% !important;
  margin-left: var(--tn-side-gap) !important;
}

.frs-page-wrap .frs-page-container {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${slot} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-top: 20px !important;
  padding-inline: var(--tn-gutter) !important;
}
.frs-page-wrap .frs-page-container :is(.head-pic-area, .forum-head-container) {
  width: var(--tn-content) !important;
  max-width: 100% !important;
}
.frs-page-wrap .frs-page-container .head-pic-area { padding-top: 0 !important; }
.frs-page-container.tn-centered :is(.head-pic-area, .forum-head-container),
.usercenter-page-wrapper.tn-centered .user-top-info-wrapper { margin-inline: auto !important; }
.frs-page-wrap .frs-page-container .frs-main-container {
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: 0 !important;
}
.frs-page-wrap .frs-page-container .frs-main-container .left-container {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
.frs-page-wrap .frs-page-container .frs-main-container .frs-right-sidebar {
  flex: 0 0 332px !important;
  width: 332px !important;
  max-width: 100% !important;
  margin-left: var(--tn-side-gap) !important;
}

.usercenter-page-wrapper > :is(.user-information-wrapper, .usercenter-content-wrapper) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${slot} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-inline: var(--tn-gutter) !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper {
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: 0 !important;
}
.usercenter-page-wrapper .user-information-wrapper { margin-top: 20px !important; }
.usercenter-page-wrapper .user-information-wrapper .user-top-info-wrapper {
  width: var(--tn-content) !important;
  max-width: 100% !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper > .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper > .right-nav-bar {
  flex: 0 0 332px !important;
  width: 332px !important;
  max-width: 100% !important;
  margin-left: var(--tn-side-gap) !important;
}

.pb-page-wrapper .pc-pb-box > .container {
  box-sizing: border-box !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: 0 !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${slot} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-inline: var(--tn-gutter) !important;
}
.pb-page-wrapper .pc-pb-box > .container > .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-inline: 0 !important;
  padding-top: 20px !important;
}
.pb-page-wrapper .pc-pb-title .pb-title { font-size: 15px !important; line-height: 1.45 !important; }
.pb-page-wrapper .pc-pb-box > .container > .right-nav-bar {
  flex: 0 0 332px !important;
  width: 332px !important;
  max-width: 100% !important;
  margin-left: var(--tn-side-gap) !important;
}
.pb-page-wrapper .pc-pb-box > .container { min-width: 0 !important; }
:is(.pb-title-wrap, .pc-pb-title) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin-inline: 0 !important;
}
.pb-page-wrapper .image-text :is(.art-video-player, video) {
  width: 100% !important;
  max-width: 100% !important;
}
.thread-card .thread-image,
.pb-content-wrap .image-card-wrapper { max-width: min(100%, var(--tn-media)) !important; }
.pb-content-wrap :is(img:not(.emoji-img), video) { max-width: 100% !important; height: auto; }

.frs-page-wrap .floating-buttons,
.home-page-wrapper .floating-buttons,
.pc-pb-box > .container .floating-buttons {
  left: 2px !important;
  width: var(--tn-fab) !important;
}
:is(.frs-page-wrap, .home-page-wrapper, .pc-pb-box > .container) .floating-buttons :is(.back-btn, .back-top) {
  width: var(--tn-fab) !important;
  height: var(--tn-fab) !important;
}
:is(.frs-page-wrap, .home-page-wrapper, .pc-pb-box > .container) .floating-buttons :is(.back-icon, .icon, .icon-back-top, .back-top-icon) {
  width: 70% !important;
  height: 70% !important;
}
.usercenter-page-wrapper .router-back-wrapper { width: var(--tn-fab) !important; }
.usercenter-page-wrapper .router-back-wrapper :is(.router-back, .back-top) {
  width: var(--tn-fab) !important;
  height: var(--tn-fab) !important;
}
:is(.frs-page-wrap, .home-page-wrapper, .pc-pb-box > .container) .floating-buttons :is(.back-btn, .back-top),
.usercenter-page-wrapper .router-back-wrapper :is(.router-back, .back-top) {
  background: transparent !important;
  box-shadow: none !important;
  border: 0 !important;
  border-radius: 50% !important;
  transition: background-color .15s ease;
}
:is(.frs-page-wrap, .home-page-wrapper, .pc-pb-box > .container) .floating-buttons :is(.back-btn, .back-top):hover,
.usercenter-page-wrapper .router-back-wrapper :is(.router-back, .back-top):hover {
  background: rgba(0, 0, 0, .07) !important;
}
html.tn-dark-bg :is(.frs-page-wrap, .home-page-wrapper, .pc-pb-box > .container) .floating-buttons :is(.back-btn, .back-top):hover,
html.tn-dark-bg .usercenter-page-wrapper .router-back-wrapper :is(.router-back, .back-top):hover {
  background: rgba(255, 255, 255, .16) !important;
}
.usercenter-page-wrapper .router-back-wrapper .back-top { left: 0 !important; }
.usercenter-page-wrapper .router-back-wrapper :is(.icon, .back-top-icon) {
  width: 70% !important;
  height: 70% !important;
}
html.tn-home-back .home-page-wrapper .floating-buttons {
  position: fixed !important;
  top: auto !important;
  bottom: 22px !important;
  left: var(--tn-home-back-left) !important;
}
html.tn-home-back .home-page-wrapper .floating-buttons .back-top {
  position: static !important;
  top: auto !important;
}
html.tn-back-fixed .usercenter-page-wrapper .router-back-wrapper {
  left: var(--tn-back-left) !important;
}
html.tn-reply-fixed .pb-page-wrapper .fixed-bottom {
  left: var(--tn-reply-left) !important;
  right: auto !important;
  width: var(--tn-content) !important;
  max-width: 100% !important;
  margin-left: 0 !important;
}
`);
    }
    if (cfg.bgOn) {
      const color = bgColor();
      if (color) {
        out.push(`
:root {
  --tn-bg: ${color};
  --cos-color-bg: ${color} !important;
  --cos-color-bg-page: ${color} !important;
  --cos-color-bg-raised: ${color} !important;
  --cos-color-bg-card: ${color} !important;
  --cos-color-bg-dialog: ${color} !important;
  --cos-color-bg-tiny: ${color} !important;
}
html, body, .pc-main-page-layout, .content-container, .main-content,
.top-bar-wrapper, .top-nav-bar,
.top-nav-bar :is(.search-mid, .search-bar, .tb-input, input),
.pc-main-page-layout .left-content,
.home-page-wrapper, .home-page-wrapper > .container, .home-page-wrapper .thread-container,
.home-page-wrapper .center-content,
.frs-page-wrap, .frs-page-container, .frs-main-container,
.frs-page-container :is(.head-pic-area, .forum-head-container, .left-container),
.frs-feed-list, .feed-list-container, .sticky-area,
.usercenter-page-wrapper, .user-information-wrapper, .user-top-info-wrapper,
.usercenter-content-wrapper, .usercenter-content-wrapper > .center-content,
.tab-content-wrapper, .thread-list-wrapper,
.pb-page-wrapper, .pc-pb-box, .pc-pb-box > .container,
.pc-pb-box > .container > .center-content, .pb-content-wrap,
.pc-pb-title, .pc-pb-reply-top, .card-tab, .card-tab-wrapper, .pb-comment-item, .pb-rich-text,
.pb-page-wrapper :is(.fixed-bottom, .pc-pb-reply),
.pc-pb-box input, .pc-pb-box textarea,
.thread-card-wrapper, .thread-card, .thread-content, .virtual-list-item,
.center-content section, .thread-container section, .usercenter-content-wrapper section,
.right-nav-bar, .right-nav-wrapper, .right-area-wrapper, .frs-right-sidebar, .frs-sidebar,
.right-nav-bar section, .right-area-wrapper section, .frs-sidebar section,
.qrcode-login-card, .hot-topic-wrapper, .bar-wrap, .forum-card-wrapper {
  background-color: var(--tn-bg) !important;
}
html.tn-dark-bg :is(.head-name, .user-name, .author-name) { color: hsla(0,0%,100%,.8) !important; }
html.tn-light-bg :is(.head-name, .user-name, .author-name) { color: #000311 !important; }
html.tn-dark-bg body {
  color: hsla(0,0%,100%,.8) !important;
  --cos-color-text: hsla(0,0%,100%,.8) !important;
  --cos-color-text-tiny: hsla(0,0%,100%,.6) !important;
  --cos-color-text-minor: hsla(0,0%,100%,.50196) !important;
  --cos-color-text-slim: hsla(0,0%,100%,.50196) !important;
  --cos-color-text-slimer: hsla(0,0%,100%,.4) !important;
  --cos-color-text-primary: #7da0ff !important;
  --cos-color-text-link: #7da0ff !important;
}
html.tn-light-bg body {
  color: #000311 !important;
  --cos-color-text: #000311 !important;
  --cos-color-text-tiny: #50525c !important;
  --cos-color-text-minor: #848691 !important;
  --cos-color-text-slim: #a9abb4 !important;
  --cos-color-text-slimer: #b7b9c1 !important;
  --cos-color-text-primary: #4070ff !important;
  --cos-color-text-link: #304cbf !important;
}
`);
      }
    }
    return out.join('\n');
  }

  let styleEl;
  function applyCss() {
    const root = document.documentElement;
    if (!root) return;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'tn-style';
    }
    const css = buildCss();
    const bg = cfg.bgOn ? bgColor() : '';
    const darkBg = !!bg && isDarkColor(bg);
    root.classList.toggle('tn-dark-bg', darkBg);
    root.classList.toggle('tn-light-bg', !!bg && !darkBg);
    if (styleEl.textContent !== css) styleEl.textContent = css;
    if (!styleEl.isConnected) (document.head || root).appendChild(styleEl);
  }

  const LAYOUT = [
    'html', 'body', '.pc-main-page-layout', '.content-container', '.main-content', '.left-content',
    '.home-page-wrapper', '.home-page-wrapper > .container', '.center-content', '.thread-container',
    '.right-nav-bar', '.right-nav-wrapper', '.frs-page-wrap', '.frs-page-container', '.frs-main-container',
    '.left-container', '.frs-feed-list', '.feed-list-container', '.frs-right-sidebar', '.frs-sidebar',
    '.pb-page-wrapper', '.pc-pb-box', '.pc-pb-box > .container', '.pb-page-wrapper > .container',
    '.usercenter-page-wrapper', '.user-information-wrapper', '.usercenter-content-wrapper',
    '.usercenter-content-wrapper > .right-nav-bar', '.tab-content-wrapper', '.thread-list-wrapper',
  ].join(',');
  const PROTECT = LAYOUT + ',.top-nav-bar,.head-pic-area,.sticky-area,.pb-content-wrap,.pb-comment-item,.pb-title-wrap,.pc-pb-title,.pc-pb-reply-top';
  const USER_TEXT = '.pb-rich-text,.pb-text-wrapper,.pb-lzl-item,.thread-title,.thread-content,.pb-title,.rule-content,.intro-content,.user-intro,.user-information-wrapper,[contenteditable],#tn-root';
  const LIST_ITEM = '.thread-card-wrapper,.virtual-list-item,.pb-comment-item';
  const STATE_CLS = /^(active|avtive|hover|focus|selected|show|open|is-|has-|sf-|tn-)/;

  const norm = (s) => s.replace(/[\s>›»<«|·•:：\-—_/\\()（）[\]【】]/g, '').replace(/\d+$/, '');

  const stableClasses = (el) => [...el.classList].filter((c) => !STATE_CLS.test(c));

  function hasSimilarSibling(node) {
    const cls = stableClasses(node);
    if (!cls.length) return false;
    return [...node.parentElement.children].some(
      (s) => s !== node && s.tagName === node.tagName && stableClasses(s).some((c) => cls.includes(c)),
    );
  }

  function findSection(titleEl) {
    const pathSigs = new Set();
    const addSigs = (el) => stableClasses(el).forEach((c) => pathSigs.add(`${el.tagName.toLowerCase()}.${CSS.escape(c)}`));

    let node = titleEl;
    for (let depth = 0; depth < 12; depth++) {
      addSigs(node);
      const p = node.parentElement;
      if (!p || p.matches(LAYOUT)) break;
      if ([...p.querySelectorAll(PROTECT)].some((e) => !node.contains(e))) break;
      if (hasSimilarSibling(node)) break;
      const sibs = [...p.children].filter((s) => s !== node);
      const sigSel = [...pathSigs].join(',');
      if (sigSel && sibs.some((s) => s.matches(sigSel) || s.querySelector(sigSel))) break;
      if (sibs.filter((s) => s.matches(LIST_ITEM) || s.querySelector(LIST_ITEM)).length >= 2) break;
      node = p;
    }
    if (node.matches(PROTECT) || node.querySelector(PROTECT)) return null;
    return node;
  }

  let kwSet = new Set();
  let seen = new WeakSet();
  function resetKeywords() {
    kwSet = new Set(cfg.keywords.map(norm).filter(Boolean));
    seen = new WeakSet();
    document.querySelectorAll('[data-tn-hide^="标题"]').forEach((e) => e.removeAttribute('data-tn-hide'));
  }

  function hideByTitle(el, kw) {
    if (!el || el.closest(USER_TEXT) || el.closest('[data-tn-hide]')) return;
    const sec = findSection(el);
    if (sec) sec.setAttribute('data-tn-hide', `标题:${kw}`);
  }

  function scanKeywords() {
    if (!kwSet.size || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.hasAttribute('data-tn-hide') || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SVG)$/i.test(n.tagName) || n.id === 'tn-root') {
            return NodeFilter.FILTER_REJECT;
          }
          return n.tagName === 'IMG' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return n.data.length <= 24 && !seen.has(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const hits = [];
    for (let n; (n = walker.nextNode()); ) {
      if (n.nodeType === 3) {
        seen.add(n);
        const t = norm(n.data);
        if (kwSet.has(t)) hits.push([n.parentElement, t]);
      } else {
        const t = norm(n.alt || n.title || '');
        if (kwSet.has(t)) hits.push([n, t]);
      }
    }
    for (const [el, kw] of hits) hideByTitle(el, kw);
  }

  let timer = 0;
  function schedule() {
    if (!timer) timer = setTimeout(flush, 150);
  }

  const FEED_ITEM_MIN = 6;
  const FEED_MAX_LOADS = 16;
  const FEED_STALL_LIMIT = 3;
  const FEED_CALL_GAP = 300;
  const FEED_RETRY_MS = 300;
  let feedRetryTimer = 0;
  const feedKeyMap = new WeakMap();
  let feedKeySeq = 0;
  const feedKey = (item) => {
    if (!item || typeof item !== 'object') return '';
    if (item.id != null) return `i${item.id}`;
    if (item.tid != null) return `t${item.tid}`;
    if (!feedKeyMap.has(item)) feedKeyMap.set(item, `o${++feedKeySeq}`);
    return feedKeyMap.get(item);
  };
  const isFollowedItem = (item) => {
    const b = item?.businessInfo;
    if (!b) return false;
    if (b.forum_is_liked != null) return String(b.forum_is_liked) === '1';
    return b.forum_is_liked_mock === true || b.forum_is_liked_mock === 1;
  };
  const isRecommendedItem = (item) => {
    const b = item?.businessInfo;
    if (!b) return false;
    if (b.forum_is_liked != null) return String(b.forum_is_liked) === '0';
    return b.forum_is_liked_mock === false || b.forum_is_liked_mock === 0;
  };
  const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
  let feedState = { vm: null, master: [], seen: new Set(), filtered: false, mode: '', loads: 0, last: 0, stall: 0, pending: null, unwatch: null };

  function feedVm() {
    let vm = document.querySelector('.home-page-wrapper .thread-container')?.__vue__;
    for (let i = 0; vm && i < 6; i++, vm = vm.$parent) {
      if (Array.isArray(vm.feedList)) return vm;
    }
    return null;
  }

  function syncFeedFilter() {
    const vm = feedVm();
    if (!vm) return null;
    if (feedState.vm !== vm) {
      if (feedState.unwatch) {
        try { feedState.unwatch(); } catch { /* component already torn down */ }
      }
      feedState = { vm, master: [], seen: new Set(), filtered: false, mode: cfg.feedMode, loads: 0, last: 0, stall: 0, pending: null, unwatch: null };
      if (typeof vm.$watch === 'function') {
        try {
          feedState.unwatch = vm.$watch('feedList', () => { syncFeedFilter(); }, { deep: false });
        } catch { /* ignore */ }
      }
    }
    if (feedState.mode !== cfg.feedMode) {
      feedState.mode = cfg.feedMode;
      feedState.loads = 0;
      feedState.last = 0;
      feedState.stall = 0;
      feedState.pending = null;
    }
    const list = Array.isArray(vm.feedList) ? vm.feedList : [];
    if (feedState.filtered) {
      for (const item of list) {
        const key = feedKey(item);
        if (feedState.seen.has(key)) continue;
        feedState.seen.add(key);
        feedState.master.push(item);
      }
    } else {
      feedState.master = list.slice();
      feedState.seen = new Set(list.map(feedKey));
    }
    let desired = null;
    if (cfg.feedMode === 'follow') desired = feedState.master.filter(isFollowedItem);
    else if (cfg.feedMode === 'recommended') desired = feedState.master.filter(isRecommendedItem);
    else if (feedState.filtered) desired = feedState.master.slice();
    if (desired && !sameList(list, desired)) {
      try { vm.feedList = desired; } catch { return vm; }
    }
    feedState.filtered = cfg.feedMode !== 'all';
    return vm;
  }

  function queueFeedRetry() {
    if (feedRetryTimer) return;
    feedRetryTimer = setTimeout(() => {
      feedRetryTimer = 0;
      syncFeedLoad(syncFeedFilter());
    }, FEED_RETRY_MS);
  }

  function syncFeedLoad(vm) {
    const filtering = cfg.feedMode === 'follow' || cfg.feedMode === 'recommended';
    if (!vm || !filtering) {
      clearTimeout(feedRetryTimer);
      feedRetryTimer = 0;
      feedState.loads = 0;
      feedState.stall = 0;
      feedState.pending = null;
      return;
    }
    // A finished load that added no matching item means the next batch is unlikely to help.
    if (feedState.pending != null && !vm.loadMoreLoading && !vm.initLoading) {
      const len = Array.isArray(vm.feedList) ? vm.feedList.length : 0;
      if (len > feedState.pending) feedState.stall = 0;
      else feedState.stall++;
      feedState.pending = null;
    }
    if (!Array.isArray(vm.feedList) || vm.feedList.length >= FEED_ITEM_MIN) {
      clearTimeout(feedRetryTimer);
      feedRetryTimer = 0;
      feedState.loads = 0;
      feedState.stall = 0;
      feedState.pending = null;
      return;
    }
    if (feedState.loads >= FEED_MAX_LOADS || feedState.stall >= FEED_STALL_LIMIT) {
      clearTimeout(feedRetryTimer);
      feedRetryTimer = 0;
      return;
    }
    if (vm.hasMore === false || vm.feedLoadMoreError || typeof vm.loadMore !== 'function') {
      clearTimeout(feedRetryTimer);
      feedRetryTimer = 0;
      return;
    }
    const now = Date.now();
    if (vm.loadMoreLoading || vm.initLoading || now - feedState.last < FEED_CALL_GAP) {
      queueFeedRetry();
      return;
    }
    feedState.loads++;
    feedState.last = now;
    feedState.pending = vm.feedList.length;
    try { vm.loadMore(); } catch { /* site internals changed */ }
    queueFeedRetry();
  }

  function syncFeedEmpty(vm) {
    const host = document.querySelector('.home-page-wrapper .center-content');
    const old = document.getElementById('tn-feed-empty');
    const filtering = cfg.feedMode === 'follow' || cfg.feedMode === 'recommended';
    const list = vm && Array.isArray(vm.feedList) ? vm.feedList : [];
    const stalled = !!vm && (feedState.stall >= FEED_STALL_LIMIT || feedState.loads >= FEED_MAX_LOADS
      || vm.hasMore === false || !!vm.feedLoadMoreError);
    const show = !!host && !!vm && filtering && !list.length && stalled && !vm.loadMoreLoading && !vm.initLoading;
    if (!show) {
      if (old) old.remove();
      return;
    }
    if (old) return;
    const el = document.createElement('div');
    el.id = 'tn-feed-empty';
    el.textContent = cfg.feedMode === 'follow' ? '暂无关注内容' : '暂无推荐内容';
    host.appendChild(el);
  }
  function syncScreenCenter() {
    const root = document.documentElement;
    const nav = document.querySelector('.pc-main-page-layout .left-content');
    const content = document.querySelector('.home-page-wrapper .center-content, .frs-feed-list, .usercenter-content-wrapper > .center-content, .pc-pb-box > .container > .center-content');
    const side = document.querySelector('.home-page-wrapper .right-nav-bar, .frs-right-sidebar, .usercenter-content-wrapper > .right-nav-bar, .pb-page-wrapper .right-nav-bar');
    const sideShown = side && side.getClientRects().length > 0 && getComputedStyle(side).display !== 'none';
    if (!cfg.wide || !nav || !content || nav.offsetWidth < 40 || getComputedStyle(nav).display === 'none' || sideShown) {
      root.classList.remove('tn-screen-center');
      return;
    }
    const vw = document.documentElement.clientWidth;
    const navWidth = parseFloat(getComputedStyle(root).getPropertyValue('--tn-nav')) || nav.offsetWidth;
    const centeredLeft = (vw - content.getBoundingClientRect().width) / 2;
    root.classList.toggle('tn-screen-center', centeredLeft >= navWidth + 12);
  }
  function syncTopNav() {
    const root = document.documentElement;
    const top = document.querySelector('.top-nav-bar');
    const logo = top?.querySelector('.home-left');
    const search = top?.querySelector('.search-mid');
    const menu = top?.querySelector('.right-menu');
    const frame = document.querySelector('.frs-page-wrap, .home-page-wrapper > .container, .usercenter-page-wrapper, .pb-page-wrapper');
    if (!top || !logo || !search || !menu || !frame) {
      root.classList.remove('tn-top-center');
      root.style.removeProperty('--tn-search-shift');
      return;
    }
    const current = parseFloat(getComputedStyle(root).getPropertyValue('--tn-search-shift')) || 0;
    const sr = search.getBoundingClientRect();
    const searchCenter = sr.left + sr.width / 2 - current;
    const fr = frame.getBoundingClientRect();
    const target = fr.left + fr.width / 2;
    const half = sr.width / 2;
    const fits = target - half >= logo.getBoundingClientRect().right + 12
      && target + half <= menu.getBoundingClientRect().left - 12;
    root.classList.toggle('tn-top-center', fits);
    if (fits) root.style.setProperty('--tn-search-shift', `${Math.round((target - searchCenter) * 10) / 10}px`);
    else root.style.removeProperty('--tn-search-shift');
  }
  function syncCenteredHeaders() {
    const mark = (hostSel, frameSel, contentSel) => {
      const host = document.querySelector(hostSel);
      const frame = document.querySelector(frameSel);
      const content = document.querySelector(contentSel);
      if (!host || !frame || !content) return;
      const pad = parseFloat(getComputedStyle(frame).paddingLeft) || 0;
      const base = frame.getBoundingClientRect().left + pad;
      const delta = content.getBoundingClientRect().left - base;
      host.classList.toggle('tn-centered', Math.abs(delta) > 2);
    };
    mark('.frs-page-container', '.frs-page-container', '.frs-feed-list');
    mark('.usercenter-page-wrapper', '.usercenter-content-wrapper', '.usercenter-content-wrapper > .center-content');
  }
  function syncUserBack() {
    const root = document.documentElement;
    const frame = document.querySelector('.usercenter-page-wrapper');
    const wrap = frame?.querySelector('.router-back-wrapper');
    const content = frame?.querySelector('.user-information-wrapper .user-top-info-wrapper');
    const width = wrap?.getBoundingClientRect().width || 0;
    if (!cfg.wide || !frame || !wrap || !content || !width || !wrap.getClientRects().length
      || ![...wrap.children].some((c) => c.getClientRects().length)) {
      if (root.classList.contains('tn-back-fixed')) root.classList.remove('tn-back-fixed');
      if (root.style.getPropertyValue('--tn-back-left')) root.style.removeProperty('--tn-back-left');
      return;
    }
    const target = `${Math.round(content.getBoundingClientRect().left - width - 2)}px`;
    if (root.style.getPropertyValue('--tn-back-left') !== target) root.style.setProperty('--tn-back-left', target);
    if (!root.classList.contains('tn-back-fixed')) root.classList.add('tn-back-fixed');
  }
  function syncHomeBack() {
    const root = document.documentElement;
    const wrap = document.querySelector('.home-page-wrapper');
    const strip = wrap?.querySelector('.floating-buttons');
    const content = wrap?.querySelector('.center-content');
    const btn = strip?.querySelector('.back-top');
    const fab = strip?.getBoundingClientRect().width || 0;
    if (!cfg.wide || !strip || !content || !btn || !fab || !btn.getClientRects().length) {
      if (root.classList.contains('tn-home-back')) root.classList.remove('tn-home-back');
      if (root.style.getPropertyValue('--tn-home-back-left')) root.style.removeProperty('--tn-home-back-left');
      return;
    }
    const target = `${Math.round(content.getBoundingClientRect().left - fab - 2)}px`;
    if (root.style.getPropertyValue('--tn-home-back-left') !== target) root.style.setProperty('--tn-home-back-left', target);
    if (!root.classList.contains('tn-home-back')) root.classList.add('tn-home-back');
  }
  function syncReplyBar() {
    const root = document.documentElement;
    const bar = document.querySelector('.pb-page-wrapper .fixed-bottom');
    const content = document.querySelector('.pc-pb-box > .container > .center-content');
    const left = content?.getBoundingClientRect().left;
    if (!cfg.wide || !bar || !content || left == null || !bar.getClientRects().length) {
      if (root.classList.contains('tn-reply-fixed')) root.classList.remove('tn-reply-fixed');
      if (root.style.getPropertyValue('--tn-reply-left')) root.style.removeProperty('--tn-reply-left');
      return;
    }
    const target = `${Math.round(left)}px`;
    if (root.style.getPropertyValue('--tn-reply-left') !== target) root.style.setProperty('--tn-reply-left', target);
    if (!root.classList.contains('tn-reply-fixed')) root.classList.add('tn-reply-fixed');
  }
  function flush() {
    timer = 0;
    if (!document.documentElement) return;
    applyCss();
    const feed = syncFeedFilter();
    syncFeedLoad(feed);
    syncFeedEmpty(feed);
    syncScreenCenter();
    syncTopNav();
    syncCenteredHeaders();
    syncUserBack();
    syncHomeBack();
    syncReplyBar();
    scanKeywords();
  }

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    applyCss();
    resetKeywords();
    const root = document.documentElement;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
    new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.documentElement) {
    boot();
  } else {
    // document-start can run before <html> exists; boot once the root is available.
    function whenRoot() {
      if (!document.documentElement) return;
      rootWatch.disconnect();
      document.removeEventListener('readystatechange', whenRoot);
      boot();
    }
    const rootWatch = new MutationObserver(whenRoot);
    try {
      rootWatch.observe(document, { childList: true, subtree: true });
    } catch { /* fall back to readystatechange */ }
    document.addEventListener('readystatechange', whenRoot);
  }

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  document.addEventListener('DOMContentLoaded', flush);
  window.addEventListener('resize', () => { clearTimeout(timer); timer = 0; flush(); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.back-btn');
    if (!btn || btn.closest('#tn-root')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let canBack = false;
    try {
      const sameSiteRef = !!document.referrer && new URL(document.referrer).origin === location.origin;
      canBack = history.length > 1 && (sameSiteRef || internalNav > 0);
    } catch { /* ignore */ }
    if (canBack) history.back();
    else location.href = 'https://tieba.baidu.com/';
  }, true);

  const PANEL_CSS = `
#tn-root { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); font: 14px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; }
#tn-root .tn-box { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px 24px; border-radius: 14px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.2); }
#tn-root h2 { margin: 0 0 12px; font-size: 18px; }
#tn-root h3 { margin: 16px 0 6px; font-size: 13px; color: #8a8f99; font-weight: 500; }
#tn-root label { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }
#tn-root .tn-row { display: grid; grid-template-columns: 9em 1fr; align-items: center; gap: 8px; margin: 6px 0; }
#tn-root input[type=text], #tn-root select { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid #dcdde0; border-radius: 6px; font: 13px/1.5 ui-monospace, Consolas, monospace; color: inherit; background: #fff; }
#tn-root .tn-hint { font-size: 12px; color: #8a8f99; }
#tn-root .tn-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
#tn-root button { padding: 6px 14px; border: 1px solid #dcdde0; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
#tn-root button:hover { border-color: #409eff; color: #409eff; }
#tn-root button.tn-primary { margin-left: auto; border-color: #4e6ef2; background: #4e6ef2; color: #fff; }
@media (prefers-color-scheme: dark) {
  #tn-root { color: #e6e8eb; }
  #tn-root .tn-box, #tn-root input[type=text], #tn-root select, #tn-root button:not(.tn-primary) { background: #1f2023; border-color: #3a3c41; }
}
`;

  function closePanel() {
    document.getElementById('tn-root')?.remove();
  }

  function openPanel() {
    closePanel();
    const root = document.createElement('div');
    root.id = 'tn-root';
    root.innerHTML = `<style>${PANEL_CSS}</style>
<div class="tn-box">
  <h2>贴吧清爽宽屏 设置</h2>
  <h3>宽屏</h3>
  <label><input type="checkbox" data-k="wide"> 启用宽屏布局</label>
  <div class="tn-row"><span>页面最大宽度</span><input type="text" data-k="pageWidth" placeholder="2560px"></div>
  <div class="tn-row"><span>正文列最大宽度</span><input type="text" data-k="colWidth" placeholder="1200px"></div>
  <div class="tn-row"><span>图片 / 视频最大宽度</span><input type="text" data-k="mediaWidth" placeholder="820px"></div>
  <div class="tn-hint">可填 px / vw / %，例如 1600px、90vw。保存后即时生效，正文随窗口宽度收缩。</div>
  <h3>外观</h3>
  <label><input type="checkbox" data-k="bgOn"> 使用自定义页面背景</label>
  <div class="tn-row"><span>预设颜色</span><select data-k="bgColor">
    <option value="#ffffff">白色</option>
    <option value="#f2f3f5">灰色（默认）</option>
    <option value="#efe8dc">米色</option>
    <option value="#000000">黑色</option>
    <option value="auto">auto（跟随浅 / 深色）</option>
  </select></div>
  <div class="tn-row"><span>颜色代码</span><input type="text" data-k="bgCustom" placeholder="可选，例如 #dfe3e8"></div>
  <div class="tn-hint">填了有效颜色代码就以它为准，留空则使用上面的预设。auto 跟随站点浅色 / 深色模式；背景为深色时文字自动变浅。</div>
  <h3>布局</h3>
  <label><input type="checkbox" data-k="leftNav"> 屏蔽左侧导航栏</label>
  <h3>帖子列表</h3>
  <div class="tn-row"><span>显示内容</span><select data-k="feedMode">
    <option value="all">关注 + 推荐</option>
    <option value="follow">只看关注</option>
    <option value="recommended">只看推荐</option>
  </select></div>
  <div class="tn-hint">只看关注 / 只看推荐时会自动补载同类帖子，避免列表只剩一条；切换回来不会丢失另一类。</div>
  <div class="tn-btns">
    <button data-act="reset">恢复默认</button>
    <button data-act="close">取消</button>
    <button data-act="save" class="tn-primary">保存</button>
  </div>
</div>`;
    const $ = (s) => root.querySelector(s);
    $('[data-k=wide]').checked = cfg.wide;
    $('[data-k=bgOn]').checked = cfg.bgOn;
    const BG_PRESETS = ['#ffffff', '#f2f3f5', '#efe8dc', '#000000', 'auto'];
    const isPreset = BG_PRESETS.includes(cfg.bgColor);
    $('[data-k=bgColor]').value = isPreset ? cfg.bgColor : '#f2f3f5';
    $('[data-k=bgCustom]').value = isPreset ? '' : cfg.bgColor;
    for (const k of ['pageWidth', 'colWidth', 'mediaWidth']) $(`[data-k=${k}]`).value = cfg[k];
    $('[data-k=leftNav]').checked = !!cfg.blocks.leftNav;
    $('[data-k=feedMode]').value = cfg.feedMode || 'all';
    root.addEventListener('click', (e) => {
      if (e.target === root) return closePanel();
      const act = e.target.dataset?.act;
      if (act === 'close') closePanel();
      else if (act === 'reset' && confirm('恢复全部默认设置？')) {
        cfg = structuredClone(DEFAULTS);
        commit();
      } else if (act === 'save') {
        const preset = $('[data-k=bgColor]').value;
        const custom = $('[data-k=bgCustom]').value.trim();
        const bgRaw = custom || preset;
        if (!/^auto$/i.test(bgRaw) && !CSS.supports('color', bgRaw)) return alert(`背景颜色无效：\n${bgRaw}`);
        cfg.wide = $('[data-k=wide]').checked;
        cfg.bgOn = $('[data-k=bgOn]').checked;
        cfg.bgColor = bgRaw;
        for (const k of ['pageWidth', 'colWidth', 'mediaWidth']) cfg[k] = $(`[data-k=${k}]`).value.trim() || DEFAULTS[k];
        cfg.blocks.leftNav = $('[data-k=leftNav]').checked;
        const feedMode = $('[data-k=feedMode]').value;
        cfg.feedMode = ['all', 'follow', 'recommended'].includes(feedMode) ? feedMode : 'all';
        commit();
      }
    });
    document.documentElement.appendChild(root);
  }

  function commit() {
    saveCfg();
    closePanel();
    resetKeywords();
    flush();
  }

  GM_registerMenuCommand('⚙️ 设置', openPanel);
})();
