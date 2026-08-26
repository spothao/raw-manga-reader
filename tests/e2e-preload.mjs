async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1></body></html>`;
  const chHtml = (n) => `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/ch${n}/page_0.jpg"><img src="https://iphotomg.com/t/ch${n}/page_1.jpg"></body></html>`;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      const ch = target.match(/chapter-(\d+)/);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: ch ? chHtml(Number(ch[1])) : MANGA_HTML });
    }
    if (url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
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
  }).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?v=preload');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=', concurrency: 2,
    }));
  });

  // open preload view via top bar ⚡
  await page.click('#btn-preload');
  const viewVisible = await page.evaluate(() => !document.getElementById('view-preload').hidden);  // reset state: reload page, re-open preload view
  await page.goto('http://localhost:4173/?v=preload2');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=', concurrency: 2,
    }));
  });
  await page.click('#btn-preload');

  // invalid input rejected
  await page.fill('#preload-urls', 'not a url');
  await page.click('#btn-start-preload');
  await page.waitForTimeout(300);
  const alertShown = await page.evaluate(() => !document.getElementById('preload-log').hidden);

  // real run: 3 chapters
  await page.fill('#preload-urls', [
    'https://dokiraw.space/manga/t/chapter-1',
    'https://dokiraw.space/manga/t/chapter-2',
    'https://dokiraw.space/manga/t/chapter-3',
  ].join('\n'));
  await page.click('#btn-start-preload');
  await page.waitForFunction(() => {
    const p = document.getElementById('preload-progress');
    return p.textContent.includes('全部完成');
  }, null, { timeout: 60000 });

  const result = await page.evaluate(() => ({
    progress: document.getElementById('preload-progress').textContent,
    logLines: [...document.getElementById('preload-log').children].map(e => ({ cls: e.className, text: e.textContent.slice(0, 70) })),
  }));

  // verify cache entries: reader should instantly show overlays when opening chapter-2
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-2');
  await page.click('#btn-load');
  await page.waitForSelector('.overlay-box', { timeout: 15000 });
  const instantOverlays = await page.evaluate(() => document.querySelectorAll('.overlay-box').length);
  const noTranslateCall = await page.evaluate(() => !document.querySelector('.page-status'));

  return { viewVisible, invalidRejected: !alertShown, ...result, instantOverlays, noTranslateCall };
}
