# dokiraw 中文阅读器 — Design Spec

Date: 2026-08-26
Status: Approved (user approved in chat; build authorized with live smoke test)

## Goal

A static GitHub Pages site (PWA) that lets a Chinese-speaking user read any raw
Japanese manga on `dokiraw.space` (e.g. `https://dokiraw.space/manga/xie-tohui-nonu-wang`)
in a mobile browser, with dialog translated to Chinese via an OpenAI-compatible
vision model, plus offline chapter export. Nothing copyrighted is stored in the repo.

## Constraints

- Pure static site: HTML + CSS + vanilla JS (ES modules). No build step, no framework.
- Deployable to GitHub Pages as-is.
- Translation runs on a user-configured OpenAI-compatible endpoint
  (`/v1/chat/completions`) with a vision-capable model. Models in use:
  `glm-5.3` (fallback vision: `ilmu-vision-v1.3`). API key lives in
  localStorage only — never in the repo.
- Mobile-first UI (long-strip reader).

## Components

| Module | Job |
|---|---|
| `js/scraper.js` | Extract chapter list and page image URLs from dokiraw HTML |
| `js/translate.js` | OpenAI-compatible VLM client, prompt, strict-JSON parsing + repair |
| `js/cache.js` | IndexedDB store of translation JSON keyed by image URL hash |
| `js/reader.js` | Long-strip reader, overlay rendering, background pre-translation queue |
| `js/export.js` | Composite page + overlay → CBZ (zip) download |
| `js/settings.js` | Endpoint / key / model / prompt / style editing (localStorage) |

## Data flow

1. User pastes any dokiraw URL (manga page or chapter page).
2. HTML fetched via CORS-proxy fallback chain:
   `api.allorigins.win/raw` → `api.codetabs.com/v1/proxy` → `corsproxy.io`
   → user-configured custom proxy.
   - Manga page → parse chapter links (`/manga/<slug>/chapter-N`).
   - Chapter page → parse `<img src="https://iphotomg.com/.../page_N.jpg">` list.
3. Images load via `wsrv.nl` image proxy (adds CORS headers, defeats hotlink checks,
   enables canvas export).
4. Each untranslated page enters a translation queue (concurrency 2):
   image (as data URL) → chat completion with grounding prompt →
   `[{bbox:[x,y,w,h], original, translation}]`, bbox normalized to 0–1000.
5. Reader renders image + absolutely-positioned Chinese text boxes over each bubble.
   Patch background color is sampled from the image via canvas for blending.
6. Pre-fetch: while reading page N, pages N+1..N+4 translate in background.
7. Translations cached in IndexedDB — second read is instant.

## Overlay fallback

Two render modes per page, auto-selected + manually toggleable:
- **Overlay mode** (default): Chinese boxes over bubbles.
- **Panel mode**: if >30% of boxes are invalid (out-of-range, zero-area), the page
  falls back to a numbered translation list below the image.

## Settings (localStorage)

Base URL, API key, model name, 简体/繁体, editable prompt template, concurrency,
custom CORS proxy, overlay style (font size, patch opacity), reading history, bookmarks.

## Export

"Export chapter" composites each page + overlays onto canvas → zips to CBZ →
downloads to phone. Nothing copyrighted touches the repo.

## Error handling

- Proxy failure → next in chain → visible retry button.
- API 401/429/5xx → exponential backoff + queue pause.
- Malformed JSON → one repair retry → panel mode for that page.
- Site markup change → scraper is one isolated module.

## Testing

- `node --test` unit tests for pure functions (scraper regexes, JSON repair, bbox validation).
- Playwright smoke test against local server with mocked VLM endpoint.
- Live smoke test with real endpoint (user-provided key; key is rotated afterwards).
