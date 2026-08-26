// reader.js — long-strip reader with overlay rendering and background translation queue.

import { fetchHtmlViaProxy, imageProxyUrl } from './net.js';
import { parsePageImages } from './scraper.js';
import { translatePageImage } from './translate.js';
import { cacheGet, cacheSet } from './cache.js';

/** Priority queue running up to `concurrency` tasks at once, lowest index first. */
export class Scheduler {
  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, Math.min(6, concurrency));
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

/** Fit a font size to a box given text length. Pure. */
export function estimateFontSize(text, boxW, boxH, minPx = 10, maxPx = 24) {
  const len = Math.max(1, (text || '').length);
  const area = Math.max(1, boxW * boxH);
  let px = Math.sqrt(area / (len * 1.7));
  return Math.round(Math.min(maxPx, Math.max(minPx, px)));
}

/** Shrink an overlay box's font until its text fits inside (no clipping).
 * If still overflowing at minPx, grow the box (downward/upward) so the text
 * stays readable instead of spilling over neighbors. */
function fitTextToBox(box, minPx = 8) {
  for (let i = 0; i < 30; i++) {
    const overflowY = box.scrollHeight > box.clientHeight + 1;
    const overflowX = box.scrollWidth > box.clientWidth + 1;
    if (!overflowY && !overflowX) return;
    const fs = parseFloat(box.style.fontSize);
    if (fs <= minPx) break;
    box.style.fontSize = `${fs - 1}px`;
  }
  if (box.scrollHeight > box.clientHeight + 1) {
    const grow = box.scrollHeight - box.clientHeight;
    const top = parseFloat(box.style.top);
    const height = parseFloat(box.style.height);
    const parentH = box.parentElement.clientHeight;
    const growDown = top + height < 97;
    if (growDown) {
      box.style.height = `${height + grow / parentH * 100}%`;
    } else if (top > 3) {
      box.style.top = `${top - grow / parentH * 100}%`;
      box.style.height = `${height + grow / parentH * 100}%`;
    }
  }
}

/** Nudge boxes that collide after auto-fit: shift the later one sideways so
 * both stay readable. Runs once per page render. */
function resolveOverlaps(overlaysEl) {
  const boxes = [...overlaysEl.querySelectorAll('.overlay-box')];
  const rects = boxes.map((b) => b.getBoundingClientRect());
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
      const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
      if (ox <= 2 || oy <= 2) continue;
      const mover = boxes[j];
      const left = parseFloat(mover.style.left);
      const width = parseFloat(mover.style.width);
      const shift = (ox + 2) / mover.parentElement.clientWidth * 100;
      const newLeft = left - shift >= 0 ? left - shift : Math.min(left + shift, 100 - width);
      mover.style.left = `${newLeft}%`;
      const moved = mover.getBoundingClientRect();
      rects[j] = moved;
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
    return this.pages.length;
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
    } else {
      this.#renderOverlays(page, result);
      page.statusEl.hidden = true;
    }
    this.#renderProgress();
    this.completed.add(idx);
    this.onProgress(idx, this.pages.length);
  }

  #renderOverlays(page, result) {
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
        holdTimer = setTimeout(() => { holdTimer = null; this.#showTextPopup(item); }, 550);
      });
      const cancelHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
      box.addEventListener('pointerup', cancelHold);
      box.addEventListener('pointerleave', cancelHold);
      box.addEventListener('pointercancel', cancelHold);
      page.overlaysEl.appendChild(box);
    }
    // size after layout: estimate from real box size, apply user scale,
    // shrink until text fits, then nudge colliding boxes apart
    requestAnimationFrame(() => {
      const boxes = [...page.overlaysEl.children];
      result.items.forEach((item, i) => {
        const box = boxes[i];
        const base = estimateFontSize(item.translation, box.clientWidth, box.clientHeight);
        box.style.fontSize = `${Math.max(8, Math.round(base * scale))}px`;
      });
      requestAnimationFrame(() => {
        boxes.forEach((box) => fitTextToBox(box));
        requestAnimationFrame(() => resolveOverlaps(page.overlaysEl));
      });
    });
  }

  /** Full-text popup for a dialog (hold on an overlay). */
  #showTextPopup(item) {
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
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '点击任意处关闭';
    card.appendChild(hint);
    overlay.appendChild(card);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  /** Re-apply font scale to every rendered overlay (no re-translation). */
  rerenderOverlays() {
    for (const page of this.pages) {
      if (page.done && page.result?.renderMode === 'overlay') {
        this.#renderOverlays(page, page.result);
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
