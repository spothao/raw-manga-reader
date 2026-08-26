// export.js — composite translated pages to canvas and download as CBZ.

import { imageProxyUrl } from './net.js';
import { estimateFontSize } from './reader.js';

const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

function loadJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('JSZip 加载失败（需网络）'));
    document.head.appendChild(s);
  });
}

function loadImage(originalUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    let fallbackIdx = 0;
    img.onerror = () => {
      if (fallbackIdx < 2) {
        img.src = imageProxyUrl(originalUrl, 0, fallbackIdx++);
        return;
      }
      reject(new Error(`图片加载失败: ${originalUrl}`));
    };
    img.src = originalUrl;
  });
}

/** Wrap text into lines that fit maxWidth at the given font size. */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw one page + translation overlays onto a canvas; returns the canvas. */
export async function compositePage(page, patchOpacity) {
  const img = await loadImage(page.imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const result = page.result;
  if (!result || result.renderMode !== 'overlay') return canvas;

  for (const item of result.items) {
    const [nx, ny, nw, nh] = item.bbox;
    const x = (nx / 1000) * canvas.width;
    const y = (ny / 1000) * canvas.height;
    const w = (nw / 1000) * canvas.width;
    const h = (nh / 1000) * canvas.height;

    // sample patch color from bubble center
    let patch = 'rgba(255,255,255,0.92)';
    try {
      const d = ctx.getImageData(Math.floor(x + w / 2), Math.floor(y + h / 2), 1, 1).data;
      patch = `rgba(${d[0]},${d[1]},${d[2]},${patchOpacity})`;
    } catch { /* tainted (shouldn't happen with wsrv) */ }

    ctx.fillStyle = patch;
    ctx.fillRect(x, y, w, h);

    const fs = estimateFontSize(item.translation, w, h, Math.round(canvas.width / 90), Math.round(canvas.width / 28));
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, item.translation, w * 0.92);
    const lh = fs * 1.25;
    const startY = y + h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, x + w / 2, startY + i * lh));
  }
  return canvas;
}

/** Export the whole chapter as a .cbz download. */
export async function exportChapter(reader, filenameBase) {
  const JSZip = await loadJsZip();
  await reader.ensureAllTranslated();

  const zip = new JSZip();
  const patchOpacity = Number(reader.settings.patchOpacity) || 0.92;
  for (let i = 0; i < reader.pages.length; i++) {
    const page = reader.pages[i];
    const canvas = await compositePage(page, patchOpacity);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    zip.file(`page_${String(i).padStart(3, '0')}.jpg`, blob);
  }

  const out = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out);
  a.download = `${filenameBase}.cbz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
