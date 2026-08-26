// scraper.js — parse dokiraw.space HTML. Pure functions (node-testable).

const SITE = 'dokiraw.space';

/** Classify a dokiraw URL.
 * @returns {{type:'manga'|'chapter'|'unknown', slug?:string, chapter?:string}} */
export function classifyUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { type: 'unknown' }; }
  if (!u.hostname.includes(SITE)) return { type: 'unknown' };
  const m = u.pathname.match(/^\/manga\/([^/]+)\/(chapter-[^/]+)\/?$/);
  if (m) return { type: 'chapter', slug: m[1], chapter: m[2] };
  const mm = u.pathname.match(/^\/manga\/([^/]+)\/?$/);
  if (mm) return { type: 'manga', slug: mm[1] };
  return { type: 'unknown' };
}

/** Extract chapter links from a manga page HTML. Newest-first order preserved.
 * @returns {Array<{href:string,label:string,num:number}>} */
export function parseChapterLinks(html) {
  const out = new Map();
  const re = /href="(https?:\/\/[^"]*?dokiraw\.space)?\/manga\/([^/"']+)\/(chapter-[^"'/#]+)\/?"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, base, slug, chapter] = m;
    const label = (m[4] || '').trim() || chapter;
    const href = base ? `${base}/manga/${slug}/${chapter}` : `/manga/${slug}/${chapter}`;
    if (!out.has(chapter)) {
      const num = parseFloat(chapter.replace(/^chapter-/, ''));
      out.set(chapter, { href, label, num: Number.isFinite(num) ? num : 0 });
    }
  }
  return [...out.values()];
}

/** Extract page image URLs from a chapter page HTML.
 * Prefers explicit page_N.<ext> images; falls back to all <img> excluding
 * site logos/cover art. */
export function parsePageImages(html) {
  const imgs = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[1]);

  const pages = imgs.filter((s) => /\/page_\d+\.(jpe?g|png|webp|gif)(\?|$)/i.test(s));
  if (pages.length > 0) return dedupe(pages);

  // fallback: anything that looks like chapter content, not UI chrome
  const content = imgs.filter((s) =>
    !/logo|cover\.j|\.svg|banner|avatar|icon/i.test(s) &&
    /^https?:\/\//.test(s));
  return dedupe(content);
}

/** Parse manga title from a manga page. */
export function parseMangaTitle(html) {
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return decode(h1[1].trim());
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t) return decode(t[1].replace(/\s*RAW.*$/i, '').trim());
  return '未知漫画';
}

function dedupe(arr) { return [...new Set(arr)]; }

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
