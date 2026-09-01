// reader.js — long-strip reader with overlay rendering and background translation queue.

import { fetchHtmlViaProxy, imageProxyUrl } from './net.js?v=2.8';
import { parsePageImages } from './scraper.js';
import { translatePageImage } from './translate.js';
import { cacheGet, cacheSet } from './cache.js';

/** Translate one page by URL without any rendering (headless, for preload).
 * Checks cache first; returns true when the page ends up translated. */
export async function translatePageHeadless(imageUrl, settings) {
  const { cacheGet, cacheSet } = await import('./cache.js?v=2.8');
  const key = imageUrl;
  if (await cacheGet(key).catch(() => undefined)) return { cached: true };
  const result = await translatePageImage({ imageUrl }, settings);
  await cacheSet(key, result).catch(() => {});
  return { cached: false, result };
}

/** Preload one chapter URL: fetch HTML, parse pages, translate all headlessly.
 * Reports progress via onProgress(done, total). One retry per failed page. */
export async function preloadChapter(chapterUrl, settings, onProgress, isCancelled) {
  const { fetchHtmlViaProxy } = await import('./net.js?v=2.8');
  const { parsePageImages } = await import('./scraper.js?v=2.8');
  const html = await fetchHtmlViaProxy(chapterUrl, settings.customProxy);
  const imageUrls = parsePageImages(html);
  if (imageUrls.length === 0) throw new Error('未能解析出页面图片');
  let translated = 0;
  let cachedCount = 0;
  const failures = [];
  let doneCount = 0;
  const queue = [...imageUrls];
  const workers = Array.from({ length: Math.max(1, Math.min(10, Number(settings.concurrency) || 2)) }, async () => {
    while (queue.length) {
      if (isCancelled?.()) return;
      const url = queue.shift();
      const attempt = async () => {
        const { cached } = await translatePageHeadless(url, settings);
        if (cached) cachedCount++; else translated++;
      };
      try {
        await attempt();
      } catch (e) {
        try {
          await attempt();
        } catch (e2) {
          failures.push({ url, error: String(e2.message || e2) });
        }
      }
      doneCount++;
      onProgress?.(doneCount, imageUrls.length, url);
    }
  });
  await Promise.all(workers);
  return { total: imageUrls.length, translated, cachedCount, failures };
}
/** Dense-page heuristic: pages with many boxes or heavy area coverage are
 * narration/list layouts where in-art overlays always collide. Those get the
 * side-panel treatment (numbered badges + translations beside the art). */
export function isDensePage(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  let coverage = 0;
  for (const it of items) {
    const [x, y, w, h] = it.bbox;
    coverage += (w / 1000) * (h / 1000);
  }
  return items.length >= 12 || coverage > 0.35;
}

/** Priority queue running up to `concurrency` tasks at once, lowest index first. */
export class Scheduler {
  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, Math.min(10, concurrency));
    this.active = 0;
    this.tasks = new Map(); // index -> () => Promise
  }

  run(index, fn) {
    if (this.tasks.has(index)) return this.tasks.get(index).promise;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.tasks.set(index, { fn, promise, resolve, reject });
    this.#pump();
    return promise;
  }

  has(index) { return this.tasks.has(index); }

  #pump() {
    const pending = [...this.tasks.entries()]
      .filter(([, t]) => !t.started)
      .sort((a, b) => a[0] - b[0]);
    while (this.active < this.concurrency && pending.length) {
      const [idx, task] = pending.shift();
      task.started = true;
      this.active++;
      task.fn()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.tasks.delete(idx);
          this.#pump();
        });
    }
  }
}

/** Tiered manga font sizing: short punchy lines get big type, long narration
 * gets small type — mirroring professional manga lettering contrast.
 * Returns px, bounded by the box's geometric capacity. */
export function estimateFontSize(text, boxW, boxH, minPx = 10, maxPx = 24) {
  const len = Math.max(1, (text || '').length);
  const area = Math.max(1, boxW * boxH);
  const capacity = Math.sqrt(area / (len * 1.6));
  let tier;
  if (len <= 4) tier = 1.35;
  else if (len <= 10) tier = 1.0;
  else if (len <= 18) tier = 0.82;
  else tier = 0.68;
  return Math.round(Math.min(maxPx, Math.max(minPx, capacity * tier)));
}

/** Shrink an overlay box's font until its text fits inside (no clipping).
 * If still overflowing at minPx, grow the box around its center (both axes,
 * keeping a roughly vertical rectangle) staying inside the page bounds.
 * Growth is skipped when it would collide with a sibling box. */
function fitTextToBox(box, minPx = 8, siblings = []) {
  const measure = () => {
    const range = document.createRange();
    range.selectNodeContents(box);
    const t = range.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { overH: t.height - b.height, overW: t.width - b.width };
  };
  for (let i = 0; i < 30; i++) {
    const { overH, overW } = measure();
    if (overH <= 1 && overW <= 1) return;
    const fs = parseFloat(box.style.fontSize);
    if (fs <= minPx) break;
    box.style.fontSize = `${fs - 1}px`;
  }
  let { overH, overW } = measure();
  if (overH <= 1 && overW <= 1) return;
  const parent = box.parentElement;
  const parentW = parent.clientWidth || 1;
  const parentH = parent.clientHeight || 1;
  const left = parseFloat(box.style.left);
  const top = parseFloat(box.style.top);
  const width = parseFloat(box.style.width);
  const height = parseFloat(box.style.height);
  // vertical-rl text: extra columns spill sideways, long columns spill down
  const growH = Math.max(0, overH / parentH * 100 + 1);
  const growW = Math.max(0, overW / parentW * 100 + 1);
  const roomBelow = Math.max(0, 100 - (top + height));
  const roomAbove = Math.max(0, top);
  const gDown = Math.min(growH, roomBelow);
  const gUp = Math.min(growH - gDown, roomAbove);
  const roomLeft = Math.max(0, left);
  const roomRight = Math.max(0, 100 - (left + width));
  const gLeft = Math.min(growW, roomLeft);
  const gRight = Math.min(growW - gLeft, roomRight);
  if (siblings.length) {
    const art = parent.getBoundingClientRect();
    const nextLeft = left - gLeft;
    const nextTop = top - gUp;
    const nextW = width + gLeft + gRight;
    const nextH = height + gDown + gUp;
    const candidate = {
      left: art.left + nextLeft / 100 * parentW,
      top: art.top + nextTop / 100 * parentH,
      right: art.left + (nextLeft / 100 * parentW) + nextW / 100 * parentW,
      bottom: art.top + (nextTop / 100 * parentH) + nextH / 100 * parentH,
    };
    if (wouldCollide(candidate, siblings, box)) return;
  }
  box.style.top = `${top - gUp}%`;
  box.style.height = `${height + gDown + gUp}%`;
  box.style.left = `${left - gLeft}%`;
  box.style.width = `${width + gLeft + gRight}%`;
}

/** True if a candidate rect would overlap any sibling box (beyond tolerance). */
function wouldCollide(rect, siblings, self) {
  for (const sib of siblings) {
    if (sib === self) continue;
    const r = sib.getBoundingClientRect();
    const ox = Math.min(rect.right, r.right) - Math.max(rect.left, r.left);
    const oy = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
    if (ox > 4 && oy > 4) return true;
  }
  return false;
}

/** Reshape a box into a manga-style vertical rectangle: clamp its width so
 * the box is always taller than wide (aspect <= 0.75), anchored to its right
 * edge where vertical text begins. Skips growth that would hit a sibling. */
function enforceVerticalShape(box, siblings = []) {
  const parent = box.parentElement;
  if (!parent) return;
  const parentW = parent.clientWidth || 1;
  const parentH = parent.clientHeight || 1;
  const left = parseFloat(box.style.left);
  const top = parseFloat(box.style.top);
  const width = parseFloat(box.style.width);
  const height = parseFloat(box.style.height);
  const boxW = box.clientWidth;
  const boxH = box.clientHeight;
  if (boxH > boxW * 1.33) return;
  const maxW = Math.max(Math.round(boxH * 0.75), Math.round(parseFloat(box.style.fontSize) || 12) * 2);
  if (boxW <= maxW) return;
  const newWPx = Math.min(boxW, maxW);
  const fs = parseFloat(box.style.fontSize) || 12;
  const charsPerColumn = Math.max(1, Math.floor(boxH / (fs * 1.3)));
  const columns = Math.ceil((box.textContent || '').length / charsPerColumn);
  const neededW = Math.max(newWPx, columns * fs * 1.15 + fs * 0.8);
  const newW = Math.min(boxW, Math.round(neededW));
  const newHPx = Math.round(newW / 0.75);
  let newH = Math.max(boxH, Math.min(newHPx, parentH * 0.95));
  const newLeftPct = left + (boxW - newW) / parentW * 100;
  let newTopPct = top - (newH - boxH) / parentH * 100 / 2;
  newTopPct = Math.max(0, Math.min(newTopPct, 100 - newH / parentH * 100));
  const nextLeft = Math.max(0, Math.min(newLeftPct, 100 - newW / parentW * 100));
  if (siblings.length) {
    const art = box.parentElement.getBoundingClientRect();
    const candidate = {
      left: art.left + nextLeft / 100 * parentW,
      top: art.top + newTopPct / 100 * parentH,
      right: art.left + (nextLeft / 100 * parentW) + newW,
      bottom: art.top + (newTopPct / 100 * parentH) + newH,
    };
    if (wouldCollide(candidate, siblings, box)) return;
  }
  box.style.left = `${nextLeft}%`;
  box.style.width = `${newW / parentW * 100}%`;
  box.style.top = `${newTopPct}%`;
  box.style.height = `${newH / parentH * 100}%`;
}

/** Shrink a box whose vertical text occupies only a fraction of its width:
 * clamp the box width to the computed column count, keeping the box's right
 * edge anchored (vertical text starts at the right). */
function shrinkBoxToText(box) {
  const text = box.textContent || '';
  if (!text) return;
  const parent = box.parentElement;
  if (!parent) return;
  const fs = parseFloat(box.style.fontSize) || 12;
  const boxW = box.clientWidth;
  const boxH = box.clientHeight;
  const charsPerColumn = Math.max(1, Math.floor(boxH / (fs * 1.3)));
  const columns = Math.ceil(text.length / charsPerColumn);
  const textW = columns * fs * 1.15;
  if (boxW <= textW * 1.35) return;
  const newW = Math.min(boxW, Math.ceil(textW + fs * 0.8));
  const parentW = parent.clientWidth || 1;
  const leftPct = parseFloat(box.style.left);
  const newLeftPct = leftPct + (boxW - newW) / parentW * 100;
  box.style.left = `${Math.max(0, Math.min(newLeftPct, 100 - newW / parentW * 100))}%`;
  box.style.width = `${newW / parentW * 100}%`;
}
function resolveOverlaps(overlaysEl) {
  const boxes = [...overlaysEl.querySelectorAll('.overlay-box')];
  const rects = boxes.map((b) => b.getBoundingClientRect());
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
      const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
      if (ox <= 2 || oy <= 2) continue;
      const mover = boxes[j];
      const parent = mover.parentElement;
      const left = parseFloat(mover.style.left);
      const width = parseFloat(mover.style.width);
      const top = parseFloat(mover.style.top);
      const height = parseFloat(mover.style.height);
      const shiftXPct = (ox + 2) / parent.clientWidth * 100;
      let newLeft = left - shiftXPct >= 0 ? left - shiftXPct : left + shiftXPct;
      if (newLeft >= 0 && newLeft <= 100 - width) {
        mover.style.left = `${newLeft}%`;
      } else {
        const shiftYPct = (oy + 2) / parent.clientHeight * 100;
        const newTop = top + height + shiftYPct <= 100 ? top + shiftYPct : Math.max(0, top - shiftYPct);
        mover.style.top = `${newTop}%`;
      }
      rects[j] = mover.getBoundingClientRect();
    }
  }
}

export class Reader {
  /**
   * @param {HTMLElement} pagesEl container for page elements
   * @param {HTMLElement} progressEl
   * @param {object} settings live settings object
   * @param {(pageIdx:number,total:number)=>void} [onProgress]
   */
  constructor(pagesEl, progressEl, settings, onProgress) {
    this.pagesEl = pagesEl;
    this.progressEl = progressEl;
    this.settings = settings;
    this.onProgress = onProgress || (() => {});
    this.pages = [];        // [{imageUrl, el, imgEl, overlaysEl, statusEl, panelEl, done}]
    this.chapter = null;    // {url, title}
    this.scheduler = new Scheduler(settings.concurrency);
    this.observer = null;
    this.lookahead = 4;
    this.overlayVisible = true;
    this.completed = new Set();
  }

  /** Open a chapter: fetch HTML, parse pages, render, kick off translation. */
  async openChapter(chapterUrl, chapterTitle = '') {
    this.destroy();
    this.chapter = { url: chapterUrl, title: chapterTitle };
    this.scheduler = new Scheduler(this.settings.concurrency);
    this.completed.clear();

    const html = await fetchHtmlViaProxy(chapterUrl, this.settings.customProxy);
    const imageUrls = parsePageImages(html);
    if (imageUrls.length === 0) throw new Error('未能从章节页面解析出图片（网站结构可能已变化）');

    this.pages = imageUrls.map((imageUrl) => this.#buildPage(imageUrl));
    this.#renderProgress();

    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.#requestAround(Number(e.target.dataset.idx));
      }
    }, { rootMargin: '150% 0px' });

    for (const p of this.pages) this.observer.observe(p.el);
    this.#requestAround(0);
    // preloaded chapters: render every cached page immediately (no API calls)
    // so the whole chapter shows translations, not just the first viewport+lookahead
    this.#applyAllCached();
    return this.pages.length;
  }

  async #applyAllCached() {
    const { cacheGet } = await import('./cache.js?v=2.8');
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      if (page.done) continue;
      try {
        const cached = await cacheGet(page.imageUrl);
        if (cached) this.#applyResult(i, cached);
      } catch { /* cache read failure — page will translate on approach */ }
    }
  }

  #buildPage(imageUrl) {
    const tpl = document.getElementById('page-template');
    const frag = tpl.content.cloneNode(true);
    const el = frag.querySelector('.page');
    el.dataset.idx = this.pages.length;
    const imgEl = frag.querySelector('img');
    imgEl.src = imageUrl; // CDN allows direct CORS access; no proxy needed
    let fallbackIdx = 0;
    imgEl.addEventListener('error', () => {
      if (fallbackIdx < 2) {
        imgEl.src = imageProxyUrl(imageUrl, 0, fallbackIdx++);
      }
    });

    const statusEl = frag.querySelector('.page-status');
    statusEl.textContent = '⏳ 翻译中…';
    statusEl.hidden = false;
    statusEl.title = '点击重新翻译';
    const idx = this.pages.length;
    statusEl.addEventListener('click', () => {
      if (statusEl.textContent.includes('失败')) {
        alert(`翻译失败原因:\n\n${statusEl.title}\n\n点确定后自动重试。请检查 ⚙️ 设置中的 API 地址、密钥与中转 URL 是否填写正确。`);
      }
      this.#translate(idx, { force: true });
    });

    this.pagesEl.appendChild(frag);
    const pageObj = {
      imageUrl, el, imgEl,
      overlaysEl: el.querySelector('.overlays'),
      statusEl,
      panelEl: el.querySelector('.panel-translations'),
      done: false,
    };
    imgEl.addEventListener('load', () => {
      if (pageObj.done && pageObj.result?.renderMode === 'overlay') {
        this.#renderOverlays(pageObj, pageObj.result);
      }
    });
    return pageObj;
  }

  #requestAround(idx) {
    for (let i = idx; i <= Math.min(idx + this.lookahead, this.pages.length - 1); i++) {
      this.#translate(i);
    }
  }

  /** Dialog from the nearest completed earlier page, in reading order.
   * Skipped when that page has no usable text or fell back to panel mode. */
  #priorDialog(idx) {
    for (let i = idx - 1; i >= 0; i--) {
      const prev = this.pages[i];
      if (!prev?.done || !prev.result) continue;
      const entries = prev.result.texts?.length ? prev.result.texts : prev.result.items;
      if (entries.length) return entries;
      return [];
    }
    return [];
  }

  async #translate(idx, { force = false } = {}) {
    const page = this.pages[idx];
    if (!page || page.done) return;
    if (this.scheduler.has(idx) && !force) return;

    page.statusEl.hidden = false;
    page.statusEl.textContent = '⏳ 翻译中…';

    const key = this.#cacheKey(page.imageUrl);
    if (!force) {
      const cached = await cacheGet(key).catch(() => undefined);
      if (cached) { this.#applyResult(idx, cached); return; }
    }

    try {
      const context = this.#priorDialog(idx);
      const result = await this.scheduler.run(idx, () =>
        translatePageImage({ imageUrl: page.imageUrl }, this.settings, undefined, undefined, context));
      await cacheSet(key, result).catch(() => {});
      this.#applyResult(idx, result);
    } catch (e) {
      page.statusEl.textContent = '⚠️ 翻译失败';
      page.statusEl.title = String(e.message || e);
      console.error('translate failed', idx, e);
    }
  }

  #applyResult(idx, result) {
    const page = this.pages[idx];
    if (!page) return;
    page.done = true;
    page.result = result;

    if (result.renderMode === 'panel') {
      this.#renderPanel(page, result);
      page.statusEl.hidden = true;
    } else if (result.renderMode === 'raw' || result.items.length === 0) {
      page.statusEl.hidden = true; // no text on page
    } else if (isDensePage(result.items)) {
      this.#renderSidePanel(page, result);
      page.statusEl.hidden = true;
    } else {
      this.#renderOverlays(page, result);
      page.statusEl.hidden = true;
    }
    this.#renderProgress();
    this.completed.add(idx);
    this.onProgress(idx, this.pages.length);
  }

  #renderOverlays(page, result) {
    const idx = this.pages.indexOf(page);
    page.overlaysEl.innerHTML = '';
    const opacity = Number(this.settings.patchOpacity) || 0.92;
    const scale = Number(this.settings.fontScale) || 1;
    for (const item of result.items) {
      const [x, y, w, h] = item.bbox;
      const box = document.createElement('div');
      box.className = 'overlay-box';
      box.style.left = `${x / 10}%`;
      box.style.top = `${y / 10}%`;
      box.style.width = `${w / 10}%`;
      box.style.height = `${h / 10}%`;
      box.style.background = this.#samplePatch(page.imgEl, x + w / 2, y + h / 2, opacity);
      box.textContent = item.translation;
      box.title = item.original;
      box.addEventListener('click', (ev) => {
        ev.stopPropagation();
        box.classList.add('raised');
      });
      let holdTimer = null;
      box.addEventListener('pointerdown', (ev) => {
        holdTimer = setTimeout(() => { holdTimer = null; this.#showTextPopup(item, idx); }, 550);
      });
      const cancelHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
      box.addEventListener('pointerup', cancelHold);
      box.addEventListener('pointerleave', cancelHold);
      box.addEventListener('pointercancel', cancelHold);
      page.overlaysEl.appendChild(box);
    }
    // size after layout: font sized so text fills the bubble naturally,
    // then clamp the box to the text and nudge collisions apart
    requestAnimationFrame(() => {
      const boxes = [...page.overlaysEl.children];
      result.items.forEach((item, i) => {
        const box = boxes[i];
        const chars = Math.max(1, item.translation.length);
        const bubbleArea = box.clientWidth * box.clientHeight;
        const areaFit = Math.sqrt(bubbleArea / (chars * 1.6));
        const boxFit = estimateFontSize(item.translation, box.clientWidth, box.clientHeight);
        const chosen = Math.min(areaFit, boxFit, 30) * scale;
        box.style.fontSize = `${Math.max(8, Math.round(chosen))}px`;
      });
      requestAnimationFrame(() => {
        boxes.forEach((box) => { enforceVerticalShape(box, boxes); shrinkBoxToText(box); fitTextToBox(box, 8, boxes); });
        requestAnimationFrame(() => {
          boxes.forEach((box) => fitTextToBox(box, 8, boxes));
          resolveOverlaps(page.overlaysEl);
        });
      });
    });
  }

  /** Dense-page layout: numbered badges on the art, translations in a fixed
   * column beside the art. Badge ↔ entry clicks cross-highlight each other. */
  #renderSidePanel(page, result) {
    page.el.classList.add('side-mode');
    page.el.querySelector('.side-text')?.remove();
    page.overlaysEl.innerHTML = '';

    const positioned = result.items.filter((it) => Array.isArray(it.bbox));
    const entries = positioned.length ? positioned : (result.texts || []);
    if (!entries.length) return;

    const badges = [];
    entries.forEach((item, i) => {
      const badge = document.createElement('div');
      badge.className = 'bubble-badge';
      const [x, y, w, h] = item.bbox || [500, 500, 0, 0];
      badge.style.left = `${(x + w / 2) / 10}%`;
      badge.style.top = `${(y + h / 2) / 10}%`;
      badge.textContent = String(i + 1);
      badge.addEventListener('click', () => {
        this.sideEls?.get(page)?.[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        this.sideEls?.get(page)?.[i]?.classList.add('flash-row');
        setTimeout(() => this.sideEls?.get(page)?.[i]?.classList.remove('flash-row'), 1200);
      });
      page.overlaysEl.appendChild(badge);
      badges.push(badge);
    });

    const side = document.createElement('div');
    side.className = 'side-text';
    const hint = document.createElement('div');
    hint.className = 'side-hint';
    hint.textContent = '→ 译文列表 · 点序号定位气泡';
    side.appendChild(hint);
    if (!this.sideEls) this.sideEls = new Map();
    const els = [];
    entries.forEach((item, i) => {
      const entry = document.createElement('div');
      entry.className = 'side-entry';
      const num = document.createElement('span');
      num.className = 'side-num';
      num.textContent = `${i + 1}`;
      const cn = document.createElement('div');
      cn.className = 'cn';
      cn.textContent = item.translation;
      entry.append(num, cn);
      entry.addEventListener('click', () => {
        badges[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
        badges[i]?.classList.add('flash');
        setTimeout(() => badges[i]?.classList.remove('flash'), 1300);
      });
      side.appendChild(entry);
      els.push(entry);
    });
    this.sideEls.set(page, els);
    page.el.appendChild(side);
  }

  /** Full-text popup for a dialog (hold on an overlay). */
  #showTextPopup(item, pageIdx) {
    const overlay = document.createElement('div');
    overlay.className = 'text-popup';
    const card = document.createElement('div');
    card.className = 'card';
    const cn = document.createElement('div');
    cn.className = 'cn';
    cn.textContent = item.translation;
    card.appendChild(cn);
    if (item.original && item.original !== item.translation) {
      const jp = document.createElement('div');
      jp.className = 'jp';
      jp.textContent = item.original;
      card.appendChild(jp);
    }
    const actions = document.createElement('div');
    actions.className = 'popup-actions';
    const flagBtn = document.createElement('button');
    flagBtn.type = 'button';
    flagBtn.textContent = '翻译不准，标记重译';
    flagBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (Number.isInteger(pageIdx) && this.pages[pageIdx]) {
        this.#flagPage(pageIdx);
      }
      overlay.remove();
    });
    actions.appendChild(flagBtn);
    card.appendChild(actions);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '点击任意处关闭';
    card.appendChild(hint);
    overlay.appendChild(card);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  #flagKey(imageUrl) { return `dokiraw-flag:${imageUrl}`; }

  #flagPage(idx) {
    const page = this.pages[idx];
    if (!page) return;
    localStorage.setItem(this.#flagKey(page.imageUrl), '1');
    page.statusEl.hidden = false;
    page.statusEl.textContent = '⚑ 已标记';
    page.statusEl.title = '该页已标记为翻译不准；♻️ 重译将优先处理';
  }

  isPageFlagged(imageUrl) {
    return !!localStorage.getItem(this.#flagKey(imageUrl));
  }

  clearFlag(imageUrl) {
    localStorage.removeItem(this.#flagKey(imageUrl));
  }

  /** Re-apply font scale to every rendered overlay (no re-translation). */
  rerenderOverlays() {
    for (const page of this.pages) {
      if (page.done && page.result?.renderMode === 'overlay') {
        if (isDensePage(page.result.items)) {
          this.#renderSidePanel(page, page.result);
        } else {
          this.#renderOverlays(page, page.result);
        }
      }
    }
  }

  adjustFontScale(delta) {
    const next = Math.round(Math.min(1.8, Math.max(0.5, (Number(this.settings.fontScale) || 1) + delta)) * 100) / 100;
    this.settings.fontScale = next;
    return next;
  }

  #renderPanel(page, result) {
    page.panelEl.hidden = false;
    page.panelEl.innerHTML = '';
    const entries = (result.texts && result.texts.length ? result.texts : result.items);
    const ol = document.createElement('ol');
    for (const item of entries) {
      const li = document.createElement('li');
      const cn = document.createElement('div');
      cn.textContent = item.translation;
      li.appendChild(cn);
      if (item.original) {
        const jp = document.createElement('div');
        jp.className = 'jp';
        jp.textContent = item.original;
        li.appendChild(jp);
      }
      ol.appendChild(li);
    }
    page.panelEl.appendChild(ol);
  }

  /** Sample average color around a normalized point (0..1000) for patch blending. */
  #samplePatch(imgEl, nx, ny, opacity) {
    try {
      if (!imgEl.naturalWidth) return `rgba(255,255,255,${opacity})`;
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(imgEl, 0, 0, 8, 8);
      const px = Math.min(7, Math.max(0, Math.floor((nx / 1000) * 8)));
      const py = Math.min(7, Math.max(0, Math.floor((ny / 1000) * 8)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      return `rgba(${d[0]},${d[1]},${d[2]},${opacity})`;
    } catch {
      return `rgba(255,255,255,${opacity})`;
    }
  }

  #renderProgress() {
    const done = this.pages.filter((p) => p.done).length;
    if (this.progressEl && this.pages.length) {
      this.progressEl.textContent = `${this.chapter?.title || ''} · ${done}/${this.pages.length} 页已翻译`;
    }
  }

  setOverlayVisible(visible) {
    this.overlayVisible = visible;
    document.body.classList.toggle('body-overlay-off', !visible);
  }

  /** Queue translation for every page in the chapter (pre-load whole chapter).
   * Already-done pages are skipped; the scheduler still enforces concurrency. */
  translateAll() {
    let queued = 0;
    for (let i = 0; i < this.pages.length; i++) {
      if (this.pages[i].done) continue;
      this.#translate(i);
      queued++;
    }
    return { queued, total: this.pages.length };
  }

  /** Clear cached translations for this chapter's pages and re-translate all.
   * Flagged (marked inaccurate) pages are cleared and re-queued first. */
  async retranslateChapter() {
    const { cacheDelete } = await import('./cache.js?v=2.8');
    const flagged = [];
    const rest = [];
    this.pages.forEach((p, i) => {
      (this.isPageFlagged(p.imageUrl) ? flagged : rest).push(i);
    });
    const order = [...flagged, ...rest];
    await Promise.all(this.pages.map((p) => cacheDelete(p.imageUrl).catch(() => {})));
    this.scheduler = new Scheduler(this.settings.concurrency);
    for (const p of this.pages) {
      p.done = false;
      p.result = undefined;
      p.overlaysEl.innerHTML = '';
      p.el.classList.remove('side-mode');
      p.el.querySelector('.side-text')?.remove();
      p.panelEl.hidden = true;
      p.panelEl.innerHTML = '';
    }
    this.pages.forEach((p) => this.clearFlag(p.imageUrl));
    let queued = 0;
    for (const i of order) {
      this.#translate(i, { force: true });
      queued++;
    }
    return { queued, flagged: flagged.length };
  }

  /** Retry every page that is not done (failed or stuck). */
  retryIncomplete() {
    let retried = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      if (page.done) continue;
      if (this.scheduler.has(i)) continue;
      page.statusEl.hidden = false;
      page.statusEl.textContent = '⏳ 翻译中…';
      this.#translate(i, { force: true });
      retried++;
    }
    return retried;
  }

  /** Ensure all pages are translated (for export). Resolves when complete. */
  async ensureAllTranslated() {
    const promises = this.pages.map((_, i) => new Promise((resolve) => {
      const check = () => {
        if (this.pages[i].done) resolve();
      };
      this.#translate(i).then(check, check);
      check();
    }));
    await Promise.all(promises);
    // wait for any still-queued
    while (this.pages.some((p) => !p.done)) {
      await new Promise((r) => setTimeout(r, 300));
      if (this.pages.every((p) => p.done || p.statusEl.textContent.includes('失败'))) {
        const failed = this.pages.filter((p) => !p.done);
        if (failed.length) throw new Error(`${failed.length} 页翻译失败，请重试失败页后再导出`);
      }
    }
  }

  #cacheKey(imageUrl) { return imageUrl; }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    this.pagesEl.innerHTML = '';
    this.pages = [];
  }
}
