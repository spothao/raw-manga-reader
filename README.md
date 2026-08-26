# dokiraw 中文阅读器

Read raw Japanese manga from [dokiraw.space](https://dokiraw.space) with Chinese
dialog overlays, in a mobile browser. Pure static site (no build step) — designed
for GitHub Pages. Translation runs on your own OpenAI-compatible vision model
endpoint; nothing copyrighted is stored in the repo.

## Features

- Paste any dokiraw manga or chapter URL → chapter list → long-strip reader
- Chinese overlay boxes on speech bubbles (bbox from a vision model), with a
  numbered "panel mode" fallback when the model's boxes are too sloppy
- Background pre-translation (next pages translate while you read), IndexedDB
  cache — each page translates only once
- One-tap 🔄 retry for failed/stuck translations; hold 👁 to peek at the
  original art; A−/A+ live font sizing
- Settings export/import as JSON for device migration (includes API key)
- PWA: installable on your phone home screen, works offline once cached
- Settings: endpoint / API key / model / fallback model / 简体·繁体 / prompt /
  concurrency / custom CORS proxy / overlay opacity

## Deploy to GitHub Pages

### 1. Deploy the CORS/API relay Worker (required — ~5 min, free)

`api.ilmu.ai` and dokiraw's HTML don't send browser CORS headers, so the app
needs a tiny relay on your own Cloudflare account (free tier: 100k req/day):

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker → name it e.g. `dokiraw-relay`
2. Edit code → paste the contents of [`worker/api-proxy.js`](worker/api-proxy.js) → Deploy
3. Note the worker URL, e.g. `https://dokiraw-relay.yourname.workers.dev`

The worker is locked to `api.ilmu.ai` (API calls) and `dokiraw.space` (HTML
fetches) so it can't be abused as an open proxy.

### 2. Publish the reader

1. Create a new **public** GitHub repo, push this folder's contents to `main`.
2. Repo → Settings → Pages → Source: `Deploy from a branch` → `main` / `root` → Save.
3. Open `https://<user>.github.io/<repo>/` on your phone, then:
   - ⚙️ Settings →
     - API Base URL: `https://api.ilmu.ai/v1`
     - API Key: your key
     - Model: `glm-5.3` (fallback: `ilmu-vision-v1.3`)
     - API 中转: `https://dokiraw-relay.yourname.workers.dev/proxy?url=`
     - 自定义 CORS 代理: `https://dokiraw-relay.yourname.workers.dev/html?url=`
   - Paste a manga URL, e.g. `https://dokiraw.space/manga/xie-tohui-nonu-wang`
4. (Phone) Browser menu → "Add to Home Screen" to install as PWA.

The API key is stored only in your browser's localStorage and sent only to your
relay → `api.ilmu.ai`.

## Local development

```sh
npm test          # unit tests (node --test)
npx serve .       # static server on :3000
```

## Notes & limitations

- dokiraw HTML is fetched via your relay first (recommended), falling back to
  public CORS proxies (allorigins → codetabs → corsproxy.io) which are
  rate-limited and flaky. Manga page images load directly from the CDN
  (permissive CORS, no hotlink block), with wsrv.nl/image proxies as fallback.
- The overlay covers the original bubble with a color-sampled patch — readable,
  but not inpainted; original text is visible on tap (tooltip).
- If the site changes its HTML structure, only `js/scraper.js` needs updating.

## Layout

```
index.html          app shell (home / chapters / reader / settings)
css/style.css
js/app.js           entry: routing, wiring, history
js/scraper.js       dokiraw HTML parsing (pure, unit-tested)
js/net.js           CORS-proxy chain + wsrv.nl image proxy
js/translate.js     VLM client, prompt, JSON repair, bbox validation (pure, unit-tested)
js/cache.js         IndexedDB translation cache
js/reader.js        reader UI, overlay rendering, translation scheduler
js/settings.js      settings + history (localStorage)
sw.js               PWA service worker (network-first shell)
tests/              node --test units + Playwright mocked E2E script
docs/spec.md        design spec
```
