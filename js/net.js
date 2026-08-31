// net.js — CORS proxy chain for HTML fetching + image proxy helpers.

const PROXY_BUILDERS = (custom) => {
  const list = [];
  // user's own relay first — public proxies are rate-limited and flaky
  if (custom) {
    let prefix = custom.trim();
    if (!prefix.includes('{url}') && !/[?&](url|u|q)=$/.test(prefix)) {
      prefix += (prefix.includes('?') ? '&' : '?') + 'url=';
    }
    list.push((u) => prefix.includes('{url}')
      ? prefix.replace('{url}', encodeURIComponent(u))
      : prefix + encodeURIComponent(u));
  }
  list.push(
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  );
  return list;
};

/**
 * Fetch a cross-origin URL's text through a chain of CORS proxies.
 * @returns {Promise<string>} response text
 */
export async function fetchHtmlViaProxy(rawUrl, customProxy = '') {
  const url = rawUrl.replace(/\/+$/, '');
  const errors = [];
  for (const build of PROXY_BUILDERS(customProxy)) {
    const proxied = build(url);
    try {
      const res = await fetchTimeout(proxied, { redirect: 'follow' }, 45000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text && text.length > 200) return text;
      throw new Error(`suspiciously short response (${text.length} bytes)`);
    } catch (e) {
      errors.push(`${new URL(proxied).host}: ${e.message}`);
    }
  }
  throw new Error(`所有代理均失败:\n${errors.join('\n')}`);
}

const IMAGE_PROXY_HOSTS = ['https://wsrv.nl', 'https://images.weserv.nl'];

/**
 * Wrap an image URL with the wsrv.nl image proxy (adds CORS headers + optional downscale).
 * @param {string} url direct image URL
 * @param {number} [width=1280] max width in px (0 = original)
 * @param {number} [hostIdx=0] index into IMAGE_PROXY_HOSTS (fallback uses 1)
 */
export function imageProxyUrl(url, width = 1280, hostIdx = 0) {
  const host = IMAGE_PROXY_HOSTS[Math.min(hostIdx, IMAGE_PROXY_HOSTS.length - 1)];
  let u = `${host}/?url=${encodeURIComponent(url)}`;
  if (width > 0) u += `&w=${width}`;
  u += '&output=jpg&q=88&n=-1';
  return u;
}

/** Fetch with timeout so a stalled request can never hang the pipeline. */
function fetchTimeout(url, opts = {}, ms = 90000) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`请求超时 (${Math.round(ms / 1000)}s): ${url.slice(0, 60)}`)), ms)),
  ]);
}

/** Fetch an image as a data URL (base64). Tries the CDN directly first
 * (dokiraw's image host sends permissive CORS headers), then falls back to
 * image proxies for hosts that block direct browser access. */
export async function imageToDataUrl(url, width = 1280) {
  const attempts = [
    () => fetchTimeout(url),
    () => fetchTimeout(imageProxyUrl(url, width, 0)),
    () => fetchTimeout(imageProxyUrl(url, width, 1)),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > 12 * 1024 * 1024) throw new Error('image too large');
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('FileReader failed'));
        fr.readAsDataURL(blob);
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('image fetch failed');
}
