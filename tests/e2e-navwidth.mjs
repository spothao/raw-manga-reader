async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">第1話</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"></body></html>`;
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
  await page.goto('http://localhost:4173/?v=navw');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.reload();
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 15000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const nav = document.querySelector('.chapter-nav');
    const row1 = nav.querySelector('.nav-row');
    const img = document.querySelector('.page img');
    const navR = row1.getBoundingClientRect();
    const imgR = img.getBoundingClientRect();
    return {
      navWidth: Math.round(navR.width),
      artWidth: Math.round(imgR.width),
      matchesArt: Math.abs(navR.width - imgR.width) <= 2,
      navLeft: Math.round(navR.left),
      artLeft: Math.round(imgR.left),
      aligned: Math.abs(navR.left - imgR.left) <= 2,
      toolRowWidth: Math.round(nav.querySelector('.tool-row').getBoundingClientRect().width),
    };
  });
}
