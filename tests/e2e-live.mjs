async (page) => {
  await page.unroute('**/*').catch(() => {});
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
    const dbs = await indexedDB.databases();
    for (const d of dbs) indexedDB.deleteDatabase(d.name);
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'glm-5.3',
      fallbackModel: 'ilmu-vision-v1.3',
      concurrency: 2,
      apiProxy: 'http://localhost:8787/proxy?url=',
      customProxy: 'http://localhost:8787/html?url=',
    }));
    localStorage.removeItem('dokiraw-history');
  });
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
  } catch {}
  await page.reload();
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn', { timeout: 30000 });
  const chapterCount = await page.locator('#chapter-grid .chapter-btn').count();
  const title = await page.textContent('#manga-title');

  await page.click('#chapter-grid .chapter-btn:first-child'); // chapter 1 (grid sorted ascending)
  await page.waitForSelector('.page', { timeout: 30000 });
  // wait for first page to translate with real API
  await page.waitForSelector('.overlay-box, .panel-translations:not([hidden])', { timeout: 120000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => ({
    pages: document.querySelectorAll('.page').length,
    overlayPages: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
    panelPages: [...document.querySelectorAll('.panel-translations')].filter(p => !p.hidden).length,
    firstOverlays: [...document.querySelectorAll('.page')][0] ? [...document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')].slice(0, 3).map(e => e.textContent) : [],
    imgsLoaded: [...document.querySelectorAll('.page img')].filter(i => i.complete && i.naturalWidth > 0).length,
    failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    progress: document.getElementById('reader-progress').textContent,
  }));
  return { chapterCount, title, ...result };
}
