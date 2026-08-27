async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"></body></html>`;
  const resp = await page.context().request.get('http://localhost:4173/tests/fixtures/ch192-dense.json');
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
      const dbs = await indexedDB.databases();
      for (const d of dbs) indexedDB.deleteDatabase(d.name);
    }
  }).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?v=side');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const d of dbs) indexedDB.deleteDatabase(d.name);
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.waitForTimeout(300);
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.bubble-badge', { timeout: 10000 });
  await page.waitForTimeout(1200);
  // 1. consistent page width: art + side column on every page
  const layout = await page.evaluate(() => {
    const pageEl = document.querySelector('.page');
    const img = pageEl.querySelector('img');
    const side = pageEl.querySelector('.side-text');
    const art = img.getBoundingClientRect();
    const sideR = side.getBoundingClientRect();
    return {
      pageW: Math.round(pageEl.getBoundingClientRect().width),
      artW: Math.round(art.width),
      artEndsAt: Math.round(art.right - pageEl.getBoundingClientRect().left),
      sideStartsAt: Math.round(sideR.left - pageEl.getBoundingClientRect().left),
      sideW: Math.round(sideR.width),
    };
  });

  // 2. badges spread across the art (not stacked at one point)
  const badgeSpread = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.bubble-badge')].map(b => b.getBoundingClientRect());
    const xs = rects.map(r => Math.round(r.x)), ys = rects.map(r => Math.round(r.y));
    return {
      count: rects.length,
      visible: rects.filter(r => r.width > 0 && r.height > 0).length,
      distinctPositions: new Set(rects.map(r => `${Math.round(r.x)},${Math.round(r.y)}`)).size,
      xRange: [Math.min(...xs), Math.max(...xs)],
    };
  });

  // 3. badge click -> side entry flashes; side entry click -> badge flashes
  await page.evaluate(() => document.querySelectorAll('.bubble-badge')[3].click());
  await page.waitForTimeout(200);
  const entryFlashed = await page.evaluate(() => !!document.querySelector('.side-entry.flash-row'));
  await page.evaluate(() => document.querySelector('.side-entry.flash-row')?.classList.remove('flash-row'));
  await page.evaluate(() => document.querySelectorAll('.side-entry')[5].click());
  await page.waitForTimeout(200);
  const badgeFlashed = await page.evaluate(() => !!document.querySelector('.bubble-badge.flash'));

  // 4. retranslate refreshes side panel (single side-text after re-run)
  await page.click('#btn-retranslate');
  await page.waitForTimeout(3000);
  const afterRetranslate = await page.evaluate(() => ({
    sideTexts: document.querySelectorAll('.side-text').length,
    sideEntries: document.querySelectorAll('.side-entry').length,
    badges: document.querySelectorAll('.bubble-badge').length,
    sideMode: document.querySelector('.page').classList.contains('side-mode'),
  }));

  return { layout, badgeSpread, entryFlashed, badgeFlashed, afterRetranslate };
}
