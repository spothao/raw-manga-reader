// net.js — CORS proxy chain for HTML fetching + image proxy helpers.

const PROXY_BUILDERS = (custom) => {
  const list = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ];
  if (custom) list.push((u) => custom.includes('{url}')
    ? custom.replace('{url}', encodeURIComponent(u))
    : custom + encodeURIComponent(u));
  return list;
};

/**
 * Fetch a cross-origin URL's text through a chain of CORS proxies.
 * @returns {Promise<string>} response text
 */
export async function fetchHtmlViaProxy(url, customProxy = '') {
  const errors = [];
  for (const build of PROXY_BUILDERS(customProxy)) {
    const proxied = build(url);
    try {
      const res = await fetch(proxied, { redirect: 'follow' });
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

/**
 * Wrap an image URL with wsrv.nl image proxy (adds CORS headers + optional downscale).
 * @param {string} url direct image URL
 * @param {number} [width=1280] max width in px (0 = original)
 */
export function imageProxyUrl(url, width = 1280) {
  let u = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
  if (width > 0) u += `&w=${width}`;
  u += '&output=jpg&q=88&n=-1';
  return u;
}

/** Fetch an image through the proxy and return a data URL (base64). */
export async function imageToDataUrl(url, width = 1280) {
  const res = await fetch(imageProxyUrl(url, width));
  if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size > 12 * 1024 * 1024) throw new Error('image too large');
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('FileReader failed'));
    fr.readAsDataURL(blob);
  });
}
