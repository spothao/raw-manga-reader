async (page) => {
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>测试漫画 RAW - Dokiraw</title></head><body>${PAD}<h1>测试漫画</h1><a href="/manga/test-manga/chapter-2">第2話</a><a href="/manga/test-manga/chapter-1">第1話</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://dokiraw.space/public/assets/images/logo-dokiraw.svg"><img src="https://iphotomg.com/test-manga/chapter_1/page_0.jpg"><img src="https://iphotomg.com/test-manga/chapter_1/page_1.jpg"><img src="https://iphotomg.com/test-manga/chapter_1/page_2.jpg"></body></html>`;
  let vlmCalls = 0;

  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      if (target.includes('/manga/test-manga/chapter-')) {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: CHAPTER_HTML });
      }
      if (target.includes('/manga/test-manga')) {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: MANGA_HTML });
      }
      return route.fulfill({ status: 404, body: 'unknown ' + target });
    }
    if (url.startsWith('https://wsrv.nl/')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      vlmCalls++;
      let content;
      if (vlmCalls === 2) {
        // mostly-invalid bboxes -> panel fallback
        content = JSON.stringify([
          { bbox: 'garbage', original: 'こんにちは', translation: '你好' },
          { original: '逃げろ！', translation: '快逃！' },
        ]);
      } else {
        content = JSON.stringify([
          { bbox: [100, 150, 300, 120], original: 'こんにちは', translation: '你好，世界！' },
          { bbox: [500, 600, 250, 100], original: '逃げろ！', translation: '快逃！' },
        ]);
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
    }
    return route.continue();
  });

  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock-vlm.test/v1', apiKey: 'sk-test', model: 'mock-model',
    }));
    localStorage.removeItem('dokiraw-history');
  });
  await page.reload();

  await page.fill('#url-input', 'https://dokiraw.space/manga/test-manga');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn', { timeout: 5000 });
  const chapterCount = await page.locator('#chapter-grid .chapter-btn').count();
  const title = await page.textContent('#manga-title');

  await page.click('#chapter-grid .chapter-btn:first-child');
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.page').length === 3, null, { timeout: 5000 });
  await page.waitForTimeout(1500);

  const overlays = await page.$$eval('.overlay-box', els => els.map(e => e.textContent));
  const overlayPages = await page.evaluate(() => [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length);
  const panels = await page.evaluate(() => [...document.querySelectorAll('.panel-translations')].filter(p => !p.hidden).length);
  const panelText = await page.evaluate(() => { const el = document.querySelector('.panel-translations:not([hidden])'); return el ? el.textContent.trim().slice(0, 60) : null; });
  const progress = await page.textContent('#reader-progress');
  const failed = await page.evaluate(() => [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-history') || '[]'));

  return { chapterCount, title, overlayPages, overlayCount: overlays.length, firstOverlay: overlays[0], panels, panelText, progress, failed, vlmCalls, historyCount: history.length };
}
