// ==UserScript==
// @name         贴吧清爽宽屏 Tieba Neat
// @namespace    tieba-neat
// @version      0.2.1
// @description  新版百度贴吧：宽屏适配，屏蔽“最有料”“相关推荐”等栏目与广告，支持点选屏蔽任意元素
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

  /* ============================ 配置 ============================ */

  // 按类名屏蔽的已知模块（类名来自新版贴吧页面实测）
  const BLOCKS = [
    { id: 'hotTopic', name: '首页右栏「最有料热点」', sel: '.hot-topic-wrapper', on: true },
    { id: 'hotForum', name: '首页右栏「最有料吧」', sel: '.hot-forum-wrapper', on: true },
    { id: 'ads', name: '广告 / 下载 App 引导', on: true,
      sel: '.ad-banner-wrapper, .feed-ad-container, .feed-ad-placeholder, [data-key^="ad__"], .tb-ad-wrap, .native-ad-wrap, .brise-pb-ad, .dasense-ad, .ad-container, .app-download-box, .tb-bottom-banner' },
    { id: 'topExtras', name: '顶部推广图标（保留消息）', on: true,
      sel: '.top-nav-bar .menu-list:has(use[*|href*="message" i]) > :not(:has(use[*|href*="message" i]))' },
    { id: 'postSidebar', name: '帖子页右侧推荐栏', sel: '.pb-page-wrapper .right-nav-bar', on: true },
    { id: 'profileTools', name: '个人主页「常用功能」推广', sel: '.usercenter-page-wrapper .usual-function-wrapper', on: true },
    { id: 'profileSidebar', name: '个人主页右栏（简介 / 徽章）', sel: '.usercenter-content-wrapper > .right-nav-bar', on: false },
    { id: 'frsSidebar', name: '吧页右栏（吧信息 / 吧务 / 吧规）', sel: '.frs-right-sidebar', on: false },
    { id: 'leftNav', name: '左侧导航栏', sel: '.pc-main-page-layout .left-content, .pc-main-page-layout .collapse-btn', on: false },
  ];

  const DEFAULTS = {
    wide: true,
    pageWidth: '2560px', // 整体版心（原版 1920px）
    colWidth: '1200px', // 信息流 / 帖子正文列（原版首页 708px）
    mediaWidth: '820px', // 信息流卡片里的图片 / 视频
    blocks: Object.fromEntries(BLOCKS.map((b) => [b.id, b.on])),
    // 标题文字等于这些词的栏目会被整块隐藏
    keywords: ['最有料', '相关推荐', '猜你喜欢', '为你推荐', '大家都在看', '大家都在搜'],
    selectors: [],
  };

  function loadCfg() {
    const saved = GM_getValue('cfg', {});
    return { ...DEFAULTS, ...saved, blocks: { ...DEFAULTS.blocks, ...(saved.blocks || {}) } };
  }
  let cfg = loadCfg();
  const saveCfg = () => GM_setValue('cfg', cfg);

  const cssLen = (v, fallback) => (v && CSS.supports('width', v) ? v : fallback);
  const validSel = (s) => {
    try {
      document.createDocumentFragment().querySelector(s);
      return true;
    } catch {
      return false;
    }
  };

  /* ============================ 样式 ============================ */

  const BASE_CSS = `
html:not(.tn-reveal) [data-tn-hide] { display: none !important; }
html.tn-reveal [data-tn-hide] { outline: 2px dashed #f56c6c !important; opacity: .45 !important; }
`;

  function buildCss() {
    const out = [BASE_CSS];
    const b = cfg.blocks;
    const hideSels = BLOCKS.filter((x) => b[x.id]).map((x) => x.sel);
    // 两个「最有料」都关掉后首页右栏只剩版权信息，整列收起
    const homeRightGone = b.hotTopic && b.hotForum;
    if (homeRightGone) hideSels.push('.home-page-wrapper .right-nav-bar');
    hideSels.push(...cfg.selectors.filter(validSel));
    for (const s of hideSels) {
      out.push(`html:not(.tn-reveal) :is(${s}) { display: none !important; }`);
      out.push(`html.tn-reveal :is(${s}) { outline: 2px dashed #f56c6c !important; opacity: .45 !important; }`);
    }

    if (b.leftNav) {
      out.push(`.pc-main-page-layout .content-container .main-content { width: 100% !important; margin-left: 0 !important; }`);
    }

    if (cfg.wide) {
      // 侧栏宽度取自站点实测值；关闭后不占位。正文列统一使用 --tn-content，
      // 让四类页面在相同窗口下得到相同的正文宽度，窗口不足时一起收缩。
      const homeSide = homeRightGone ? '0px' : 'calc(316px + var(--tn-side-gap))';
      const frsSide = b.frsSidebar ? '0px' : 'calc(332px + var(--tn-side-gap))';
      const postSide = b.postSidebar ? '0px' : 'calc(316px + var(--tn-side-gap))';
      const profileSide = b.profileSidebar ? '0px' : 'calc(316px + var(--tn-side-gap))';
      const nav = b.leftNav ? '0px' : 'var(--tn-nav)';
      const navMedia = b.leftNav ? '' : `
@media (max-width: 1006px) { :root { --tn-nav: 211px; } }
@media (max-width: 900px) { :root { --tn-nav: 199px; } }`;
      out.push(`
:root {
  --tn-page: ${cssLen(cfg.pageWidth, '100vw')};
  --tn-col: ${cssLen(cfg.colWidth, '100%')};
  --tn-media: ${cssLen(cfg.mediaWidth, '100%')};
  --tn-gutter: clamp(16px, 3vw, 60px);
  --tn-nav: ${b.leftNav ? '0px' : '261px'};
  --tn-side-gap: 36px;
  --tn-scrollbar: 16px;
  /* 留出左侧导航、两侧留白和页面滚动条后，所有页面共用的正文列宽度。 */
  --tn-content: min(var(--tn-col), calc(min(100vw, var(--tn-page)) - ${nav} - var(--tn-gutter) - var(--tn-gutter) - var(--tn-scrollbar)));
}${navMedia}
.pc-main-page-layout .content-container { max-width: var(--tn-page) !important; }
.pc-main-page-layout .main-content { min-width: 0 !important; }
@media screen and (min-width: 1920px) {
  .top-nav-bar { width: min(100vw, var(--tn-page)) !important; }
}

/* 首页：侧栏放不下时换到正文下方，正文保持统一宽度。 */
.home-page-wrapper > .container {
  box-sizing: border-box !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: var(--tn-side-gap) !important;
  row-gap: 24px !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${homeSide} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  /* 该容器自身滚动，经典滚动条约占 16px；留白各减 8px 补偿，正文宽度才与其它页面一致。 */
  padding-inline: calc(var(--tn-gutter) - 8px) !important;
}
.home-page-wrapper .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-right: 0 !important;
}
.home-page-wrapper .right-nav-bar {
  flex: 0 0 316px !important;
  width: 316px !important;
  max-width: 100% !important;
}

/* 吧页 */
.frs-page-wrap .frs-page-container {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${frsSide} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-inline: var(--tn-gutter) !important;
}
.frs-page-wrap .frs-page-container .frs-main-container {
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: var(--tn-side-gap) !important;
  row-gap: 24px !important;
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
  margin-left: 0 !important;
}

/* 个人主页 */
.usercenter-page-wrapper > :is(.user-information-wrapper, .usercenter-content-wrapper) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${profileSide} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-inline: var(--tn-gutter) !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper {
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: var(--tn-side-gap) !important;
  row-gap: 24px !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper > .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
.usercenter-page-wrapper .usercenter-content-wrapper > .right-nav-bar {
  flex: 0 0 316px !important;
  width: 316px !important;
  max-width: 100% !important;
  margin-left: 0 !important;
}

/* 帖子页 */
.pb-page-wrapper .pc-pb-box > .container {
  box-sizing: border-box !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  justify-content: center !important;
  column-gap: var(--tn-side-gap) !important;
  row-gap: 24px !important;
  width: 100% !important;
  max-width: calc(var(--tn-content) + ${postSide} + var(--tn-gutter) + var(--tn-gutter)) !important;
  margin-inline: auto !important;
  padding-inline: var(--tn-gutter) !important;
}
.pb-page-wrapper .pc-pb-box > .container > .center-content {
  flex: 0 1 var(--tn-content) !important;
  width: var(--tn-content) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-inline: 0 !important;
}
.pb-page-wrapper .pc-pb-box > .container > .right-nav-bar {
  flex: 0 0 316px !important;
  width: 316px !important;
  max-width: 100% !important;
  margin-left: 0 !important;
}
.pb-page-wrapper .pc-pb-box > .container,
.pb-page-wrapper .pc-pb-title { min-width: 0 !important; }
.pb-page-wrapper .pc-pb-title { box-sizing: border-box !important; width: 100% !important; max-width: 100% !important; }
.thread-card .thread-image,
.pb-content-wrap .image-card-wrapper { max-width: min(100%, var(--tn-media)) !important; }
.pb-content-wrap :is(img:not(.emoji-img), video) { max-width: 100% !important; height: auto; }
`);
    }
    return out.join('\n');
  }

  let styleEl;
  function applyCss() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'tn-style';
    }
    const css = buildCss();
    // 相同内容不重写，避免样式节点的变动反复触发 MutationObserver。
    if (styleEl.textContent !== css) styleEl.textContent = css;
    // 站点会重写 <head>，保证样式一直在
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
  }

  /* ===================== 按标题文字屏蔽栏目 ===================== */

  // 页面骨架：向上找栏目容器时绝不越过 / 隐藏这些
  const LAYOUT = [
    'html', 'body', '.pc-main-page-layout', '.content-container', '.main-content', '.left-content',
    '.home-page-wrapper', '.home-page-wrapper > .container', '.center-content', '.thread-container',
    '.right-nav-bar', '.right-nav-wrapper', '.frs-page-wrap', '.frs-page-container', '.frs-main-container',
    '.left-container', '.frs-feed-list', '.feed-list-container', '.frs-right-sidebar', '.frs-sidebar',
    '.pb-page-wrapper', '.pc-pb-box', '.pc-pb-box > .container', '.pb-page-wrapper > .container',
    '.usercenter-page-wrapper', '.user-information-wrapper', '.usercenter-content-wrapper',
    '.usercenter-content-wrapper > .right-nav-bar', '.tab-content-wrapper', '.thread-list-wrapper',
  ].join(',');
  // 正文内容：隐藏范围里出现这些（且不在被隐藏块内部）就停止向上
  const PROTECT = LAYOUT + ',.top-nav-bar,.head-pic-area,.sticky-area,.pb-content-wrap,.pb-comment-item,.pb-title-wrap,.pc-pb-title,.pc-pb-reply-top';
  // 用户写的内容里出现同样的字不算栏目标题
  const USER_TEXT = '.pb-rich-text,.pb-text-wrapper,.pb-lzl-item,.thread-title,.thread-content,.pb-title,.rule-content,.intro-content,.user-intro,.user-information-wrapper,[contenteditable],#tn-root';
  const LIST_ITEM = '.thread-card-wrapper,.virtual-list-item,.pb-comment-item';
  const STATE_CLS = /^(active|avtive|hover|focus|selected|show|open|is-|has-|sf-|tn-)/;

  const norm = (s) => s.replace(/[\s>›»<«|·•:：\-—_/\\()（）[\]【】]/g, '').replace(/\d+$/, '');

  const stableClasses = (el) => [...el.classList].filter((c) => !STATE_CLS.test(c));

  // 与 node 同类的兄弟节点 → node 是列表中的一项（卡片 / 标签页），到此为止
  function hasSimilarSibling(node) {
    const cls = stableClasses(node);
    if (!cls.length) return false;
    return [...node.parentElement.children].some(
      (s) => s !== node && s.tagName === node.tagName && stableClasses(s).some((c) => cls.includes(c)),
    );
  }

  function findSection(titleEl) {
    // 已走过路径上的组件类名：兄弟节点里也有同样的组件（如卡片头部）→ 兄弟是同级栏目，到此为止
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

  /* ============================ 监听 ============================ */

  let timer = 0;
  function schedule() {
    if (!timer) timer = setTimeout(flush, 150);
  }
  function flush() {
    timer = 0;
    applyCss();
    scanKeywords();
  }

  applyCss();
  resetKeywords();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', flush);

  /* ============================ 点选屏蔽 ============================ */

  function cssPath(el) {
    const parts = [];
    for (let e = el, d = 0; e && e !== document.body && d < 5; e = e.parentElement, d++) {
      if (e.id && !/\d{3,}/.test(e.id) && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      const cls = stableClasses(e).filter((c) => !/\d{3,}/.test(c)).slice(0, 3);
      parts.unshift(e.tagName.toLowerCase() + cls.map((c) => `.${CSS.escape(c)}`).join(''));
      if (cls.length && document.querySelectorAll(parts.join(' > ')).length === 1) break;
    }
    return parts.join(' > ');
  }

  function startPicker() {
    closePanel();
    const box = document.createElement('div');
    const tip = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;background:rgba(64,158,255,.18);outline:2px solid #409eff;transition:all .05s';
    tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);max-width:80vw;padding:8px 14px;border-radius:8px;background:rgba(0,0,0,.82);color:#fff;font:13px/1.6 system-ui,sans-serif;pointer-events:none;word-break:break-all';
    document.documentElement.append(box, tip);
    const stack = [];
    let cur = null;

    const draw = () => {
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      tip.textContent = `点击屏蔽 · ↑ 选父元素 · ↓ 返回子元素 · Esc 退出\n${cssPath(cur)}`;
      tip.style.whiteSpace = 'pre-wrap';
    };
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== cur && el !== box && el !== tip) {
        cur = el;
        stack.length = 0;
        draw();
      }
    };
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const onClick = (e) => {
      swallow(e);
      if (!cur) return;
      const sel = prompt('将屏蔽匹配此 CSS 选择器的所有元素（可修改）：', cssPath(cur));
      stop();
      if (!sel) return;
      if (!validSel(sel.trim())) return alert('选择器无效');
      cfg.selectors.push(sel.trim());
      saveCfg();
      applyCss();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowUp' && cur?.parentElement && cur.parentElement !== document.documentElement) {
        stack.push(cur);
        cur = cur.parentElement;
        draw();
      } else if (e.key === 'ArrowDown' && stack.length) {
        cur = stack.pop();
        draw();
      } else return;
      swallow(e);
    };
    const evs = [['mousemove', onMove], ['click', onClick], ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['keydown', onKey]];
    evs.forEach(([t, f]) => window.addEventListener(t, f, true));
    function stop() {
      evs.forEach(([t, f]) => window.removeEventListener(t, f, true));
      box.remove();
      tip.remove();
    }
  }

  /* ============================ 设置面板 ============================ */

  const PANEL_CSS = `
#tn-root { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); font: 14px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; }
#tn-root .tn-box { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px 24px; border-radius: 14px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.2); }
#tn-root h2 { margin: 0 0 12px; font-size: 18px; }
#tn-root h3 { margin: 16px 0 6px; font-size: 13px; color: #8a8f99; font-weight: 500; }
#tn-root label { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }
#tn-root .tn-row { display: grid; grid-template-columns: 9em 1fr; align-items: center; gap: 8px; margin: 6px 0; }
#tn-root input[type=text], #tn-root textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid #dcdde0; border-radius: 6px; font: 13px/1.5 ui-monospace, Consolas, monospace; color: inherit; background: #fff; }
#tn-root textarea { min-height: 84px; resize: vertical; }
#tn-root textarea[data-k=keywords] { font-family: inherit; }
#tn-root .tn-hint { font-size: 12px; color: #8a8f99; }
#tn-root .tn-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
#tn-root button { padding: 6px 14px; border: 1px solid #dcdde0; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
#tn-root button:hover { border-color: #409eff; color: #409eff; }
#tn-root button.tn-primary { margin-left: auto; border-color: #4e6ef2; background: #4e6ef2; color: #fff; }
@media (prefers-color-scheme: dark) {
  #tn-root { color: #e6e8eb; }
  #tn-root .tn-box, #tn-root input[type=text], #tn-root textarea, #tn-root button:not(.tn-primary) { background: #1f2023; border-color: #3a3c41; }
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
  <h3>屏蔽模块</h3>
  ${BLOCKS.map((b) => `<label><input type="checkbox" data-block="${b.id}"> ${b.name}</label>`).join('')}
  <h3>按栏目标题屏蔽（每行一个）</h3>
  <textarea data-k="keywords"></textarea>
  <div class="tn-hint">页面上标题文字与之相同的栏目会整块隐藏。</div>
  <h3>自定义 CSS 选择器（每行一个）</h3>
  <textarea data-k="selectors" placeholder=".some-class"></textarea>
  <div class="tn-btns">
    <button data-act="pick">点选屏蔽元素</button>
    <button data-act="reveal">${document.documentElement.classList.contains('tn-reveal') ? '隐藏' : '显示'}被屏蔽的元素</button>
    <button data-act="reset">恢复默认</button>
    <button data-act="close">取消</button>
    <button data-act="save" class="tn-primary">保存</button>
  </div>
</div>`;
    const $ = (s) => root.querySelector(s);
    $('[data-k=wide]').checked = cfg.wide;
    for (const k of ['pageWidth', 'colWidth', 'mediaWidth']) $(`[data-k=${k}]`).value = cfg[k];
    $('[data-k=keywords]').value = cfg.keywords.join('\n');
    $('[data-k=selectors]').value = cfg.selectors.join('\n');
    root.querySelectorAll('[data-block]').forEach((i) => (i.checked = !!cfg.blocks[i.dataset.block]));

    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    root.addEventListener('click', (e) => {
      if (e.target === root) return closePanel();
      const act = e.target.dataset?.act;
      if (act === 'close') closePanel();
      else if (act === 'pick') startPicker();
      else if (act === 'reveal') {
        toggleReveal();
        closePanel();
      } else if (act === 'reset' && confirm('恢复全部默认设置？')) {
        cfg = structuredClone(DEFAULTS);
        commit();
      } else if (act === 'save') {
        const bad = lines($('[data-k=selectors]').value).filter((s) => !validSel(s));
        if (bad.length) return alert(`以下选择器无效：\n${bad.join('\n')}`);
        cfg.wide = $('[data-k=wide]').checked;
        for (const k of ['pageWidth', 'colWidth', 'mediaWidth']) cfg[k] = $(`[data-k=${k}]`).value.trim() || DEFAULTS[k];
        cfg.keywords = lines($('[data-k=keywords]').value);
        cfg.selectors = lines($('[data-k=selectors]').value);
        root.querySelectorAll('[data-block]').forEach((i) => (cfg.blocks[i.dataset.block] = i.checked));
        commit();
      }
    });
    document.documentElement.appendChild(root);
  }

  function commit() {
    saveCfg();
    closePanel();
    applyCss();
    resetKeywords();
    scanKeywords();
  }

  function toggleReveal() {
    document.documentElement.classList.toggle('tn-reveal');
  }

  GM_registerMenuCommand('⚙️ 设置', openPanel);
  GM_registerMenuCommand('🎯 点选屏蔽元素', startPicker);
  GM_registerMenuCommand('👁 显示 / 隐藏被屏蔽的元素', toggleReveal);
})();
