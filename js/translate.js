// translate.js — VLM client + strict-JSON parsing + bbox validation (pure parts node-testable).

export const DEFAULT_PROMPT = `You are a professional Japanese-to-{LANG} manga translator. Look at this manga page image.

Find every speech bubble, narration box, and caption containing Japanese text.

Return ONLY a valid JSON array (no markdown, no commentary) in exactly this format:
[{"bbox": [x, y, w, h], "original": "Japanese text", "translation": "{LANG} translation"}]

Rules:
- bbox uses normalized coordinates from 0 to 1000 relative to image dimensions. [x, y] is the TOP-LEFT corner of the bubble, w and h its width and height.
- The bbox must cover the ENTIRE bubble area, not just the text inside.
- translation must be natural, fluent {LANG} manga dialog. Keep it concise so it fits the bubble.
- Order items in Japanese reading order (top-to-bottom, right-to-left).
- Sound effects (onomatopoeia) are optional — include them only if clearly readable.
- If the page contains no text at all, return [].`;

/** Build the request URL for a chat/completions call, routing through the
 * user's API relay when configured. Relay format: prefix + encoded URL, or a
 * template containing {url}. A bare prefix lacking "?url=" gets it appended. */
export function apiUrl(baseUrl, apiProxy) {
  const target = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  if (!apiProxy) return target;
  let prefix = apiProxy.trim();
  if (!prefix.includes('{url}')) {
    if (!/[?&](url|u|q)=$/.test(prefix)) {
      prefix += (prefix.includes('?') ? '&' : '?') + 'url=';
    }
  }
  return prefix.includes('{url}')
    ? prefix.replace('{url}', encodeURIComponent(target))
    : prefix + encodeURIComponent(target);
}
export function normalizeBaseUrl(raw) {
  if (!raw) return '';
  let u = raw.trim().replace(/\/+$/, '');
  if (u.endsWith('#')) return u.slice(0, -1); // verbatim mode
  if (!/\/v\d+$/.test(u)) u += '/v1';
  return u;
}

/** Extract a JSON array from a model response that may contain fences or chatter. */
export function parseTranslationJSON(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  // strip code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // slice from first '[' to last ']'
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + 1);
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : null;
  } catch {
    // last-ditch repair: remove trailing commas, smart quotes
    const repaired = s
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    try {
      const arr = JSON.parse(repaired);
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }
}

/** Validate + clamp bboxes to 0..1000. Returns {items, invalidCount, texts}.
 * An item is invalid if bbox is missing/non-array/wrong length, or w/h <= 0.
 * `texts` carries every raw item that has text, regardless of bbox validity —
 * used by panel-mode rendering as a safety net. */
export function validateBboxes(rawItems) {
  const items = [];
  const texts = [];
  let invalidCount = 0;
  for (const it of rawItems || []) {
    if (!it || typeof it !== 'object') { invalidCount++; continue; }
    const bb = Array.isArray(it.bbox) ? it.bbox : null;
    const original = typeof it.original === 'string' ? it.original : '';
    const translation = typeof it.translation === 'string' ? it.translation : '';
    if (original || translation) texts.push({ original, translation: translation || original });
    if (!bb || bb.length !== 4 || bb.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      invalidCount++;
      continue;
    }
    let [x, y, w, h] = bb;
    if (w <= 0 || h <= 0) { invalidCount++; continue; } // degenerate box
    x = clamp(x, 0, 1000); y = clamp(y, 0, 1000);
    w = clamp(w, 1, 1000 - x); h = clamp(h, 1, 1000 - y);
    if (!original && !translation) { invalidCount++; continue; }
    items.push({ bbox: [x, y, w, h], original, translation: translation || original });
  }
  return { items, invalidCount, texts };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** Decide render mode for a page. */
export function pickRenderMode(items, invalidCount) {
  const total = items.length + invalidCount;
  if (total === 0) return 'raw';            // no text found
  if (invalidCount / total > 0.3) return 'panel';
  return 'overlay';
}

/**
 * Translate one page image via an OpenAI-compatible vision endpoint.
 * @param {{imageUrl:string}} page
 * @param {object} settings {baseUrl, apiKey, model, fallbackModel, promptTemplate, targetLang}
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{items:Array, invalidCount:number, renderMode:string, model:string}>}
 */
export async function translatePageImage(page, settings, fetchImpl = fetch, imageFetcher) {
  const getImage = imageFetcher || (async (url) => {
    const { imageToDataUrl } = await import('./net.js');
    return imageToDataUrl(url);
  });
  const dataUrl = await getImage(page.imageUrl);

  const prompt = (settings.promptTemplate || DEFAULT_PROMPT)
    .replaceAll('{LANG}', settings.targetLang || '简体中文');

  const models = [settings.model, settings.fallbackModel].filter(Boolean);
  if (!settings.baseUrl || !models.length) throw new Error('未配置 API 地址或模型');

  let lastErr = null;
  for (const model of models) {
    try {
      const body = {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        temperature: 0.1,
        max_tokens: 4096,
      };
      const res = await fetchImpl(apiUrl(settings.baseUrl, settings.apiProxy), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.map((c) => c.text || '').join('') : '';
      const arr = parseTranslationJSON(text);
      if (arr === null) throw new Error('模型未返回 JSON 数组');
      const { items, invalidCount, texts } = validateBboxes(arr);
      return { items, invalidCount, texts, renderMode: pickRenderMode(items, invalidCount), model };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('翻译失败');
}
