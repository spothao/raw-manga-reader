async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-3">c3</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c3/page_2.jpg"></body></html>`;
  const resp = await page.context().request.get('http://localhost:4173/tests/fixtures/bubbles-ch3p2.json');
  const BUBBLES = await resp.json();
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
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(BUBBLES) } }] }),
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
    }
  }).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto('about:blank');
  await page.goto('http://localhost:4173/?v=ch3p2', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.fill('#url-input', 'https://dokiraw.space/manga/t');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const page0 = document.querySelector('.page');
    const boxes = [...page0.querySelectorAll('.overlay-box')];
    const rects = boxes.map(b => b.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
        const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
        if (ox > 2 && oy > 2) overlaps++;
      }
    }
    const textFits = (box) => {
      const range = document.createRange();
      range.selectNodeContents(box);
      const t = range.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return t.height <= b.height + 1 && t.width <= b.width + 1;
    };
    return {
      count: boxes.length,
      overlaps,
      aspects: rects.map(r => (r.width / r.height).toFixed(2)),
      clipped: boxes.filter(b => !textFits(b)).length,
      fonts: boxes.map(b => b.style.fontSize),
    };
  });
}
