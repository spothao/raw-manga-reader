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
- Chapter export to `.cbz` for offline reading
- PWA: installable on your phone home screen, works offline once cached
- Settings: endpoint / API key / model / fallback model / 简体·繁体 / prompt /
  concurrency / custom CORS proxy / overlay opacity

## Deploy to GitHub Pages

1. Create a new **public** GitHub repo, push this folder's contents to `main`.
2. Repo → Settings → Pages → Source: `Deploy from a branch` → `main` / `root` → Save.
3. Open `https://<user>.github.io/<repo>/` on your phone, then:
   - ⚙️ Settings → fill API Base URL, API Key, Model (e.g. `glm-5.3`,
     fallback `ilmu-vision-v1.3`). Base URL auto-appends `/v1` if missing.
   - Paste a manga URL, e.g. `https://dokiraw.space/manga/xie-tohui-nonu-wang`.
4. (Phone) Browser menu → "Add to Home Screen" to install as PWA.

The API key is stored only in your browser's localStorage and sent only to your
configured endpoint.

## Local development

```sh
npm test          # unit tests (node --test)
npx serve .       # static server on :3000
```

## Notes & limitations

- dokiraw HTML is fetched via public CORS proxies (allorigins → codetabs →
  corsproxy.io, then your custom proxy). If all fail, set a custom proxy in
  settings. Manga images load via wsrv.nl (CORS + hotlink bypass + export support).
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
js/export.js        CBZ export (canvas compositing + JSZip)
js/settings.js      settings + history (localStorage)
sw.js               PWA service worker (network-first shell)
tests/              node --test units + Playwright mocked E2E script
docs/spec.md        design spec
```
