async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"><img src="https://iphotomg.com/t/c/page_1.jpg"><img src="https://iphotomg.com/t/c/page_2.jpg"></body></html>`;
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
  await page.goto('http://localhost:4173/?v=fixednav');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const navVisibleAt = async (scrollY) => {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const nav = document.querySelector('.chapter-nav');
      const r = nav.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0 && r.height > 0;
    });
  };
  const top = await navVisibleAt(0);
  const middle = await navVisibleAt(600);
  const nearEnd = await navVisibleAt(1200);

  // horizontal scroll: nav transform follows art column
  await page.evaluate(() => window.scrollTo(200, 0));
  await page.waitForTimeout(300);
  const horiz = await page.evaluate(() => {
    const nav = document.querySelector('.chapter-nav');
    const img = document.querySelector('.page img');
    return {
      navTransform: nav.style.transform,
      navLeft: Math.round(nav.getBoundingClientRect().left),
      artLeft: Math.round(img.getBoundingClientRect().left),
    };
  });

  const position = await page.evaluate(() => getComputedStyle(document.querySelector('.chapter-nav')).position);
  return { position, visibleTop: top, visibleMiddle: middle, visibleNearEnd: nearEnd, horiz };
}
