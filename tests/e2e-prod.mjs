async (page) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone width
  await page.goto('https://spothao.github.io/raw-manga-reader/');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'glm-5.3',
      fallbackModel: 'ilmu-vision-v1.3',
      concurrency: 2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
    localStorage.removeItem('dokiraw-history');
  });
  await page.reload();

  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn', { timeout: 60000 });
  const chapterCount = await page.locator('#chapter-grid .chapter-btn').count();
  const title = await page.textContent('#manga-title');

  await page.click('#chapter-grid .chapter-btn:first-child');
  await page.waitForSelector('.page', { timeout: 60000 });

  const deadline = Date.now() + 180000;
  let snap;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => ({
      overlayPages: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
      panelPages: [...document.querySelectorAll('.panel-translations')].filter(p => !p.hidden).length,
      pages: document.querySelectorAll('.page').length,
      imgs: [...document.querySelectorAll('.page img')].filter(i => i.complete && i.naturalWidth > 0).length,
      failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    }));
    if (snap.overlayPages + snap.panelPages >= 2) break;
    await page.waitForTimeout(4000);
  }

  const firstOverlays = await page.evaluate(() =>
    [...document.querySelectorAll('.page')][0]
      ? [...document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')].map(e => e.textContent).slice(0, 3)
      : []);
  const progress = await page.textContent('#reader-progress');
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-history') || '[]').length);

  return { chapterCount, title, ...snap, firstOverlays, progress, history };
}
