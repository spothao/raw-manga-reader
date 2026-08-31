// app.js — entry point: view routing, URL loading, settings UI, history.

import { fetchHtmlViaProxy } from './net.js?v=2.3';
import { classifyUrl, parseChapterLinks, parseMangaTitle, parsePageImages } from './scraper.js?v=2.3';
import { Reader, preloadChapter } from './reader.js?v=2.3';
import { DEFAULT_PROMPT } from './translate.js?v=2.3';
import { loadSettings, saveSettings, resetSettings, loadHistory, addHistory, removeHistory } from './settings.js?v=2.3';
import { cacheClear, cacheCount } from './cache.js?v=2.3';

const $ = (id) => document.getElementById(id);

function clampNum(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const state = {
  settings: loadSettings(),
  chapters: [],       // sorted ascending
  manga: null,        // {title, url}
  currentChapterIdx: -1,
  reader: null,
};

/* ---------- view switching ---------- */
function show(viewId) {
  for (const v of ['view-home', 'view-manga', 'view-reader', 'view-preload']) {
    $(v).hidden = v !== viewId;
  }
  window.scrollTo(0, 0);
}

function showError(msg) {
  const el = $('error-banner');
  el.textContent = msg;
  el.hidden = false;
}
function clearError() { $('error-banner').hidden = true; }

/* ---------- loading ---------- */
async function loadUrl(rawUrl) {
  clearError();
  const info = classifyUrl(rawUrl.trim());
  if (info.type === 'unknown') {
    showError('无法识别该链接，请粘贴 dokiraw 漫画页或章节页 URL。');
    return;
  }
  $('btn-load').disabled = true;
  $('btn-load').textContent = '读取中…';
  try {
    if (info.type === 'manga') {
      await openManga(rawUrl.trim());
    } else {
      // chapter URL — need the manga page first for navigation
      const mangaUrl = `https://dokiraw.space/manga/${info.slug}`; // old domain still serves; new links point to .casa
      try {
        await openManga(mangaUrl, { silent: true });
      } catch { /* chapter nav may be unavailable; still read */ }
      await openChapterByHref(rawUrl.trim());
    }
  } catch (e) {
    showError(String(e.message || e));
  } finally {
    $('btn-load').disabled = false;
    $('btn-load').textContent = '读取';
  }
}

async function openManga(url, { silent = false } = {}) {
  const html = await fetchHtmlViaProxy(url, state.settings.customProxy);
  const title = parseMangaTitle(html);
  let chapters = parseChapterLinks(html);
  if (chapters.length === 0) throw new Error('未能解析章节列表（网站结构可能已变化）');
  chapters.sort((a, b) => a.num - b.num);
  state.manga = { title, url };
  state.chapters = chapters;
  addHistory({ url, title });
  renderChapterGrid();
  if (!silent) {
    $('manga-title').textContent = title;
    show('view-manga');
  }
}

function renderChapterGrid() {
  const grid = $('chapter-grid');
  grid.innerHTML = '';
  for (const ch of state.chapters) {
    const btn = document.createElement('button');
    btn.className = 'chapter-btn';
    btn.textContent = ch.label;
    btn.addEventListener('click', () => openChapterByHref(absolute(ch.href)));
    grid.appendChild(btn);
  }
}

function absolute(href) {
  return href.startsWith('http') ? href : `https://dokiraw.space${href}`; // relative links normalized to legacy domain
}

function normalizeChapterUrl(u) {
  return u
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/dokiraw\.(space|casa)/, '');
}

async function openChapterByHref(href) {
  const target = normalizeChapterUrl(href);
  let idx = state.chapters.findIndex((c) => normalizeChapterUrl(absolute(c.href)) === target);
  if (idx === -1) {
    // chapter not in the loaded list — (re)load its manga page so prev/next work
    const slug = target.match(/\/manga\/([^/]+)\/chapter-/)?.[1];
    if (slug) {
      try {
        await openManga(`https://dokiraw.space/manga/${slug}`, { silent: true });
        idx = state.chapters.findIndex((c) => normalizeChapterUrl(absolute(c.href)) === target);
      } catch { /* nav stays disabled; chapter still opens below */ }
    }
  }
  state.currentChapterIdx = idx;
  const hasNav = idx >= 0 && state.chapters.length > 0;
  $('btn-prev-chapter').disabled = !hasNav || idx <= 0;
  $('btn-next-chapter').disabled = !hasNav || idx >= state.chapters.length - 1;
  const label = hasNav ? state.chapters[idx].label : '';
  document.body.classList.remove('body-overlay-off');
  state.reader?.setOverlayVisible?.(true);
  $('btn-toggle-overlay').textContent = '隐藏译文';
  show('view-reader');
  $('reader-error').hidden = true;
  $('pages').innerHTML = '<div class="page-status" style="position:static;display:block;text-align:center;padding:40px">章节加载中…</div>';

  if (!state.reader) {
    state.reader = new Reader($('pages'), $('reader-progress'), state.settings);
  }
  try {
    await state.reader.openChapter(target, `${state.manga?.title || ''} ${label}`.trim());
    addHistory({ url: target, title: `${state.manga?.title || ''} ${label}`.trim() });
  } catch (e) {
    $('pages').innerHTML = '';
    const el = $('reader-error');
    el.textContent = String(e.message || e);
    el.hidden = false;
  }
}

/* ---------- history ---------- */
function renderHistory() {
  const list = loadHistory();
  const el = $('history-list');
  el.innerHTML = '';
  if (!list.length) return;
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = '最近阅读';
  el.appendChild(h);
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'history-item';
    const span = document.createElement('span');
    span.textContent = item.title || item.url;
    row.appendChild(span);
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeHistory(item.url);
renderHistory();
applyPageDim();
    });
    row.appendChild(x);
    row.addEventListener('click', () => loadUrl(item.url));
    el.appendChild(row);
  }
}

/* ---------- settings ---------- */
function openSettings() {
  const s = state.settings;
  const f = $('settings-form');
  f.baseUrl.value = s.baseUrl;
  f.apiKey.value = s.apiKey;
  f.model.value = s.model;
  f.fallbackModel.value = s.fallbackModel;
  f.targetLang.value = s.targetLang;
  f.concurrency.value = s.concurrency;
  f.customProxy.value = s.customProxy;
  f.apiProxy.value = s.apiProxy;
  f.patchOpacity.value = s.patchOpacity;
  f.fontScale.value = s.fontScale ?? 1;
  f.pageDim.value = s.pageDim ?? 1;
  f.promptTemplate.value = s.promptTemplate || DEFAULT_PROMPT;
  cacheCount().then((n) => {
    $('btn-clear-cache').textContent = `清除翻译缓存（${n} 页）`;
  }).catch(() => {});
  $('settings-dialog').showModal();
}

function applyPageDim() {
  document.documentElement.style.setProperty('--page-dim', String(state.settings.pageDim ?? 1));
}

function saveSettingsFromForm() {
  const f = $('settings-form');
  const prompt = f.promptTemplate.value.trim();
  saveSettings({
    baseUrl: f.baseUrl.value.trim(),
    apiKey: f.apiKey.value.trim(),
    model: f.model.value.trim(),
    fallbackModel: f.fallbackModel.value.trim(),
    targetLang: f.targetLang.value,
    concurrency: Math.round(clampNum(f.concurrency.value, 1, 10, 2)),
    customProxy: f.customProxy.value.trim(),
    apiProxy: f.apiProxy.value.trim(),
    patchOpacity: clampNum(f.patchOpacity.value, 0.5, 1, 0.92),
    fontScale: clampNum(f.fontScale.value, 0.5, 1.8, 1),
    pageDim: clampNum(f.pageDim.value, 0.5, 1, 1),
    promptTemplate: prompt === DEFAULT_PROMPT ? '' : prompt,
  });
  state.settings = loadSettings();
  applyPageDim();
  if (state.reader) {
    state.reader.settings = state.settings;
    state.reader.rerenderOverlays();
  }
}

/* ---------- wiring ---------- */
$('btn-load').addEventListener('click', () => loadUrl($('url-input').value));
$('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadUrl($('url-input').value);
});
$('btn-home').addEventListener('click', () => { renderHistory(); show('view-home'); });
// ---------- batch preload ----------
const preloadState = { running: false, cancel: false };

$('btn-preload').addEventListener('click', () => show('view-preload'));
$('btn-back-home').addEventListener('click', () => { renderHistory(); show('view-home'); });

function collectPreloadUrls() {
  return $('preload-urls').value
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/dokiraw\.(space|casa)\/manga\/.+\/chapter-/.test(s));
}

$('btn-start-preload').addEventListener('click', async () => {
  if (preloadState.running) return;
  const urls = collectPreloadUrls();
  if (urls.length === 0) {
    alert('没有可预载的章节：请粘贴章节链接，或先「载入章节」并勾选');
    return;
  }
  preloadState.running = true;
  preloadState.cancel = false;
  $('btn-start-preload').disabled = true;
  const log = $('preload-log');
  const progress = $('preload-progress');
  log.hidden = false;
  progress.hidden = false;
  log.innerHTML = '';
  const suspendedNote = document.createElement('div');
  const onVis = () => {
    suspendedNote.textContent = document.hidden
      ? '⚠️ 页面已进入后台，翻译被系统暂停。回到前台自动继续。'
      : '';
  };
  document.addEventListener('visibilitychange', onVis);
  progress.parentNode.insertBefore(suspendedNote, progress);

  const line = (html, cls = '') => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  let okCount = 0;
  const wakelock = { sentinel: null };
  try {
    wakelock.sentinel = await navigator.wakeLock?.request('screen');
  } catch {}
  for (let c = 0; c < urls.length; c++) {
    if (preloadState.cancel) break;
    const url = urls[c];
    const entry = line(`【${c + 1}/${urls.length}】${url}`, 'running');
    try {
      const summary = await preloadChapter(url, state.settings, (done, total) => {
        entry.textContent = `【${c + 1}/${urls.length}】${url} — ${done}/${total} 页`;
      }, () => preloadState.cancel);
      if (summary.failures.length === 0) okCount++;
      entry.className = summary.failures.length ? 'fail' : 'ok';
      entry.textContent = `【${c + 1}/${urls.length}】${url} — 完成：翻译 ${summary.translated}，缓存 ${summary.cachedCount}，失败 ${summary.failures.length}/${summary.total}`;
      const label = url.match(/chapter-[^/]+$/)?.[0] || url;
      addHistory({ url, title: `${state.manga?.title || ''} ${label}`.trim() });
    } catch (e) {
      entry.className = 'fail';
      entry.textContent = `【${c + 1}/${urls.length}】${url} — 失败：${e.message || e}`;
    }
    progress.textContent = `总进度：${c + 1}/${urls.length} 章${preloadState.cancel ? '（已停止）' : ''}`;
  }
  try { wakelock.sentinel?.release(); } catch {}
  document.removeEventListener('visibilitychange', onVis);
  suspendedNote.textContent = '';

  progress.textContent = preloadState.cancel
    ? `已停止。完成 ${okCount} 章。`
    : `全部完成 ✓（${okCount}/${urls.length} 章）`;
  preloadState.running = false;
  $('btn-start-preload').disabled = false;
  renderHistory();
});

$('btn-stop-preload').addEventListener('click', () => {
  preloadState.cancel = true;
  $('preload-progress').textContent = '正在停止…（当前页完成后暂停）';
});

$('btn-settings').addEventListener('click', openSettings);
$('btn-close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-form').addEventListener('submit', () => saveSettingsFromForm());
$('btn-reset-settings').addEventListener('click', () => {
  resetSettings();
  state.settings = loadSettings();
  openSettings();
});
$('btn-clear-cache').addEventListener('click', async () => {
  await cacheClear();
  $('btn-clear-cache').textContent = '缓存已清除';
});

$('btn-first-chapter').addEventListener('click', () => {
  const first = state.chapters.find((c) => c.num >= 1) || state.chapters[0];
  if (first) openChapterByHref(absolute(first.href));
});

$('btn-prev-chapter').addEventListener('click', () => {
  const i = state.currentChapterIdx - 1;
  if (i >= 0 && i < state.chapters.length) openChapterByHref(absolute(state.chapters[i].href));
});
$('btn-next-chapter').addEventListener('click', () => {
  const i = state.currentChapterIdx + 1;
  if (i >= 0 && i < state.chapters.length) openChapterByHref(absolute(state.chapters[i].href));
});

$('btn-toggle-overlay').addEventListener('click', () => {
  if (!state.reader) return;
  const visible = !state.reader.overlayVisible;
  state.reader.setOverlayVisible(visible);
  $('btn-toggle-overlay').textContent = visible ? '隐藏译文' : '显示译文';
});

$('btn-font-smaller').addEventListener('click', () => adjustFont(-0.1));
$('btn-font-bigger').addEventListener('click', () => adjustFont(0.1));

function adjustFont(delta) {
  if (!state.reader) return;
  const scale = state.reader.adjustFontScale(delta);
  saveSettings({ fontScale: scale });
  state.settings.fontScale = scale;
  state.reader.rerenderOverlays();
}

// hold-to-peek: hide overlays while the 👁 button is held down
const peekBtn = $('btn-peek');
peekBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  peekBtn.setPointerCapture?.(e.pointerId);
  if (state.reader?.overlayVisible) document.body.classList.add('body-overlay-off');
});
for (const ev of ['pointerup', 'pointercancel']) {
  peekBtn.addEventListener(ev, () => {
    if (state.reader?.overlayVisible) document.body.classList.remove('body-overlay-off');
  });
}
peekBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// settings migration: export (includes API key) / import JSON
$('btn-export-settings').addEventListener('click', () => {
  const payload = {
    type: 'dokiraw-reader-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dokiraw-reader-settings.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
});

$('file-import-settings').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = parsed?.settings && parsed.type === 'dokiraw-reader-settings'
      ? parsed.settings
      : parsed;
    const merged = { ...loadSettings(), ...imported };
    saveSettings(merged);
    state.settings = loadSettings();
    if (state.reader) {
      state.reader.settings = state.settings;
      state.reader.rerenderOverlays();
    }
    openSettings();
    alert('设置导入成功 ✓');
  } catch (err) {
    alert(`导入失败: 文件不是有效的设置 JSON (${err.message || err})`);
  }
});

$('btn-translate-all').addEventListener('click', () => {
  if (!state.reader) return;
  const { queued, total } = state.reader.translateAll();
  if (queued === 0) {
    alert(`本章 ${total} 页已全部翻译完成 ✓`);
  } else {
    alert(`已开始预翻译整章：${queued}/${total} 页排队中（并发 ${state.settings.concurrency}），进度见顶部进度条。可离开页面但建议保持前台。`);
  }
});

$('btn-retranslate').addEventListener('click', async () => {
  if (!state.reader) return;
  if (!confirm('重译整章：将清除本章缓存并重新翻译全部页面（消耗 API 调用）。继续？')) return;
  const { queued, flagged } = await state.reader.retranslateChapter();
  alert(`已开始重译整章（${queued} 页排队${flagged ? `，其中 ${flagged} 页为已标记的不准页面，优先处理` : ''}）`);
});

$('btn-retry').addEventListener('click', async () => {
  if (!state.reader) return;
  const btn = $('btn-retry');
  btn.disabled = true;
  const n = state.reader.retryIncomplete();
  btn.disabled = false;
  if (n === 0) {
    alert('没有需要重试的页面（未翻译的页仍在队列中，或全部已完成）');
  }
});

renderHistory();

// PWA service worker
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// expose for tests/debug
window.__app = { state, loadUrl };
