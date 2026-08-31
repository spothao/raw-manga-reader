async (page) => {
  // run after the v22d navigation settled: re-run the whole scenario fresh
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">第1話</a><a href="/manga/t/chapter-2">第2話</a><a href="/manga/t/chapter-3">第3話</a></body></html>`;
  const chHtml = (n, dense) => {
    const imgs = dense
      ? '<img src="https://iphotomg.com/t/c/page_0.jpg">'
      : Array.from({ length: 2 }, (_, i) => `<img src="https://iphotomg.com/t/ch${n}/page_${i}.jpg">`).join('');
    return `<!DOCTYPE html><html><body>${PAD}${imgs}</body></html>`;
  };
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      if (target.includes('chapter-2-dense')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: chHtml(0, true) });
      const ch = target.match(/chapter-(\d+)/);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: ch ? chHtml(Number(ch[1]), false) : MANGA_HTML });
    }
    if (url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      const bubbles = Array.from({ length: 17 }, (_, i) => ({
        bbox: [(i * 55) % 880, (i * 60) % 900 + 20, 110, 50],
        original: `セリフ${i}`,
        translation: `这是第${i + 1}条比较长的对话译文内容示例文字`,
      }));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(bubbles) } }] }),
      });
    }
    return route.continue();
  });

  // ensure fresh app: settings + cleared caches, then reload
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto('http://localhost:4173/?v=v22e', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });

  page.on('dialog', (d) => d.accept());

  // Bug 1: direct chapter URL with trailing slash, then 下一话
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-2/');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 15000 });
  await page.waitForTimeout(400);
  const beforeNav = await page.evaluate(() => ({
    nextDisabled: document.getElementById('btn-next-chapter').disabled,
  }));
  await page.click('#btn-next-chapter');
  await page.waitForTimeout(2500);
  const nextWorked = await page.evaluate(() =>
    [...document.querySelectorAll('.page img')].some(i => i.src.includes('ch3/page_0')));

  // Bug 4: dense side text confined
  await page.click('#btn-home');
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-2-dense');
  await page.click('#btn-load');
  await page.waitForSelector('.bubble-badge', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const sideConfined = await page.evaluate(() => {
    const pageEl = document.querySelector('.page');
    const side = pageEl.querySelector('.side-text');
    const pageR = pageEl.getBoundingClientRect();
    const sideR = side.getBoundingClientRect();
    return {
      entries: side.querySelectorAll('.side-entry').length,
      scrollable: side.scrollHeight >= side.clientHeight,
      withinPage: sideR.bottom <= pageR.bottom + 1,
    };
  });

  // Bugs 2+3: sticky page-width nav with tools
  const navState = await page.evaluate(() => {
    const nav = document.querySelector('.chapter-nav');
    const r = nav.getBoundingClientRect();
    return {
      position: getComputedStyle(nav).position,
      width: Math.round(r.width),
      toolButtons: nav.querySelectorAll('.tool-row button').length,
      inViewport: r.top < innerHeight && r.bottom > 0,
    };
  });

  return { beforeNav, nextWorked, sideConfined, navState };
}
