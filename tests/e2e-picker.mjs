async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>测试漫画</title></head><body>${PAD}<h1>测试漫画</h1><a href="/manga/t/chapter-1">第1話</a><a href="/manga/t/chapter-2">第2話</a><a href="/manga/t/chapter-3">第3話</a></body></html>`;
  const chHtml = (n) => `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/ch${n}/page_0.jpg"><img src="https://iphotomg.com/t/ch${n}/page_1.jpg"></body></html>`;
  let vlmCalls = 0;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? chHtml(target.match(/chapter-(\d+)/)[1]) : MANGA_HTML });
    }
    if (url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      vlmCalls++;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([
          { bbox: [100, 150, 300, 120], original: 'こんにちは', translation: '你好！' },
        ]) } }] }),
      });
    }
    return route.continue();
  });

  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      const dbs = await indexedDB.databases();
      for (const d of dbs) indexedDB.deleteDatabase(d.name);
    }
    localStorage.removeItem('dokiraw-history');
  }).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 40)); d.accept(); });
  await page.goto('http://localhost:4173/?v=picker');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=', concurrency: 2,
    }));
  });

  // 1. manga URL -> chapter picker
  await page.click('#btn-preload');
  await page.fill('#preload-urls', 'https://dokiraw.space/manga/t');
  await page.click('#btn-load-chapters');
  await page.waitForSelector('#chapter-picker input[type=checkbox]', { timeout: 10000 });
  const chapterCount = await page.evaluate(() => document.querySelectorAll('#chapter-picker input[type=checkbox]').length);

  // select ch1 + ch3 (dispatch change so the start button enables)
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#chapter-picker input[type=checkbox]')];
    boxes[0].checked = true;
    boxes[2].checked = true;
    boxes.forEach((b) => b.dispatchEvent(new Event('change', { bubbles: true })));
  });
  await page.waitForTimeout(200);
  const startEnabled = await page.evaluate(() => !document.getElementById('btn-start-preload').disabled);
  await page.click('#btn-start-preload');
  await page.waitForFunction(() => document.getElementById('preload-progress').textContent.includes('全部完成'), null, { timeout: 30000 });
  const preloadResult = await page.evaluate(() => document.getElementById('preload-progress').textContent);

  // 2. preloaded chapters now in home history
  await page.click('#btn-back-home');
  const historyItems = await page.evaluate(() => [...document.querySelectorAll('.history-item span:first-child')].map(e => e.textContent));

  // 3. ♻️ retranslate whole chapter in reader
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.overlay-box', { timeout: 15000 });
  const callsBefore = vlmCalls;
  await page.click('#btn-retranslate'); // confirm auto-accepted
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.querySelectorAll('.overlay-box').length >= 2, null, { timeout: 30000 });
  const retranslated = vlmCalls - callsBefore;

  return {
    chapterCount, startEnabled, preloadResult, historyItems,
    retranslateCalls: retranslated,
    confirmDialogShown: dialogs.some(m => m.includes('重译')),
  };
}
