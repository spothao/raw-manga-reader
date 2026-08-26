// app.js — entry point: view routing, URL loading, settings UI, history.

import { fetchHtmlViaProxy } from './net.js';
import { classifyUrl, parseChapterLinks, parseMangaTitle, parsePageImages } from './scraper.js';
import { Reader } from './reader.js';
import { exportChapter } from './export.js';
import { DEFAULT_PROMPT } from './translate.js';
import { loadSettings, saveSettings, resetSettings, loadHistory, addHistory, removeHistory } from './settings.js';
import { cacheClear, cacheCount } from './cache.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: loadSettings(),
  chapters: [],       // sorted ascending
  manga: null,        // {title, url}
  currentChapterIdx: -1,
  reader: null,
};

/* ---------- view switching ---------- */
function show(viewId) {
  for (const v of ['view-home', 'view-manga', 'view-reader']) {
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
    showError('无法识别该链接，请粘贴 dokiraw.space 的漫画页或章节页 URL。');
    return;
  }
  $('btn-load').disabled = true;
  $('btn-load').textContent = '读取中…';
  try {
    if (info.type === 'manga') {
      await openManga(rawUrl.trim());
    } else {
      // chapter URL — need the manga page first for navigation
      const mangaUrl = `https://dokiraw.space/manga/${info.slug}`;
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
  return href.startsWith('http') ? href : `https://dokiraw.space${href}`;
}

async function openChapterByHref(href) {
  const idx = state.chapters.findIndex((c) => absolute(c.href) === href);
  if (idx >= 0) {
    state.currentChapterIdx = idx;
    $('btn-prev-chapter').disabled = idx <= 0;
    $('btn-next-chapter').disabled = idx >= state.chapters.length - 1;
  }
  const label = idx >= 0 ? state.chapters[idx].label : '';
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
    const n = await state.reader.openChapter(href, `${state.manga?.title || ''} ${label}`.trim());
    addHistory({ url: href, title: `${state.manga?.title || ''} ${label}`.trim() });
    void n;
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
  f.promptTemplate.value = s.promptTemplate || DEFAULT_PROMPT;
  cacheCount().then((n) => {
    $('btn-clear-cache').textContent = `清除翻译缓存（${n} 页）`;
  }).catch(() => {});
  $('settings-dialog').showModal();
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
    concurrency: Number(f.concurrency.value) || 2,
    customProxy: f.customProxy.value.trim(),
    apiProxy: f.apiProxy.value.trim(),
    patchOpacity: Number(f.patchOpacity.value),
    fontScale: Number(f.fontScale.value) || 1,
    promptTemplate: prompt === DEFAULT_PROMPT ? '' : prompt,
  });
  state.settings = loadSettings();
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
$('btn-settings').addEventListener('click', openSettings);
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
  if (i >= 0) openChapterByHref(absolute(state.chapters[i].href));
});
$('btn-next-chapter').addEventListener('click', () => {
  const i = state.currentChapterIdx + 1;
  if (i < state.chapters.length) openChapterByHref(absolute(state.chapters[i].href));
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

$('btn-export').addEventListener('click', async () => {
  if (!state.reader) return;
  const btn = $('btn-export');
  btn.textContent = '⏳';
  try {
    const base = (state.manga?.title || 'manga') + (state.chapters[state.currentChapterIdx]?.label || '');
    await exportChapter(state.reader, base.replace(/[\\/:*?"<>|]/g, '_'));
  } catch (e) {
    alert(`导出失败: ${e.message || e}`);
  } finally {
    btn.textContent = '⬇️';
  }
});

renderHistory();

// PWA service worker
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// expose for tests/debug
window.__app = { state, loadUrl };
