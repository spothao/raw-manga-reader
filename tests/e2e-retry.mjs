async (page) => {
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>测试漫画</title></head><body>${PAD}<h1>测试漫画</h1><a href="/manga/test-manga/chapter-1">第1話</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/test/chapter_1/page_0.jpg"><img src="https://iphotomg.com/test/chapter_1/page_1.jpg"><img src="https://iphotomg.com/test/chapter_1/page_2.jpg"></body></html>`;
  let failFirst = true;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? CHAPTER_HTML : MANGA_HTML });
    }
    if (url.startsWith('https://wsrv.nl/') || url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      if (failFirst) {
        failFirst = false;
        return route.fulfill({ status: 500, body: 'mock server error' });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([
          { bbox: [100, 150, 300, 120], original: 'こんにちは', translation: '你好！' },
        ]) } }] }),
      });
    }
    return route.continue();
  });

  await page.goto('http://localhost:4173/');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.fill('#url-input', 'https://dokiraw.space/manga/test-manga');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  // first VLM call fails -> that page shows 翻译失败
  await page.waitForFunction(() => [...document.querySelectorAll('.page-status')].some(e => !e.hidden && e.textContent.includes('失败')), null, { timeout: 15000 });

  const before = await page.evaluate(() => ({
    failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    done: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
    hasExport: !!document.getElementById('btn-export'),
    hasRetry: !!document.getElementById('btn-retry'),
    hasPeek: !!document.getElementById('btn-peek'),
  }));

  // tap retry -> failed page re-queues and now succeeds
  await page.click('#btn-retry');
  await page.waitForFunction(() => [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length === 0
    && [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length >= 1, null, { timeout: 15000 });

  const after = await page.evaluate(() => ({
    failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    overlays: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
    progress: document.getElementById('reader-progress').textContent,
  }));

  return { before, after };
}
