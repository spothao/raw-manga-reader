async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  // 26-page chapter like real dokiraw
  const imgs = Array.from({ length: 26 }, (_, i) => `<img src="https://iphotomg.com/t/ch9/page_${i}.jpg">`).join('');
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}${imgs}</body></html>`;
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1></body></html>`;
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
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?v=p26');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=', concurrency: 2,
    }));
  });

  await page.click('#btn-preload');
  await page.fill('#preload-urls', 'https://dokiraw.space/manga/t/chapter-9');
  await page.click('#btn-start-preload');
  await page.waitForFunction(() => {
    const p = document.getElementById('preload-progress');
    return p.textContent.includes('全部完成') || p.textContent.includes('失败');
  }, null, { timeout: 90000 });

  return await page.evaluate((calls) => ({
    progress: document.getElementById('preload-progress').textContent,
    log: [...document.getElementById('preload-log').children].map(e => e.textContent.slice(0, 80)),
    vlmCalls: calls,
  }), vlmCalls);
}
