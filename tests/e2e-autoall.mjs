async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const imgs = Array.from({ length: 8 }, (_, i) => `<img src="https://iphotomg.com/t/c/page_${i}.jpg">`).join('');
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}${imgs}</body></html>`;
  let vlmCalls = 0;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? CHAPTER_HTML : MANGA_HTML });
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
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?v=autoall');
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      const dbs = await indexedDB.databases();
      for (const d of dbs) indexedDB.deleteDatabase(d.name);
    }
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.reload();
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
  await page.click('#btn-load');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.page img', { timeout: 15000 });

  // no scrolling: all pages should translate automatically
  await page.waitForFunction(() => {
    const done = [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length;
    return done >= 8;
  }, null, { timeout: 30000 });

  const result = await page.evaluate(() => ({
    translatedPages: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
    totalPages: document.querySelectorAll('.page').length,
    progress: document.getElementById('reader-progress').textContent,
    toolsInBar: [...document.querySelectorAll('.chapter-nav .tool-row button')].map(b => b.textContent.trim()),
    concurrencyFieldInSettings: !!document.querySelector('#settings-form [name=concurrency]'),
  }));
  return { ...result, vlmCalls };
}
