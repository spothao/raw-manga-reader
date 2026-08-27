async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = (bubblesFile) => `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/${bubblesFile}/page_0.jpg"></body></html>`;
  const routeFor = (file) => async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? CHAPTER_HTML(file) : MANGA_HTML });
    }
    if (url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      const resp = await page.context().request.get(`http://localhost:4173/tests/fixtures/${file}.json`);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(await resp.json()) } }] }) });
    }
    return route.continue();
  };

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

  const check = async (file) => {
    await page.unroute('**/*').catch(() => {});
    await page.route('**/*', routeFor(file));
    await page.goto(`http://localhost:4173/?v=${file}`);
    await page.evaluate(() => {
      localStorage.setItem('dokiraw-settings', JSON.stringify({
        baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
        customProxy: 'http://mock.test/p?url=',
      }));
      const dbs = indexedDB;
    });
    await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-1');
    await page.click('#btn-load');
    await page.waitForSelector('.page .overlay-box, .page .bubble-badge', { timeout: 10000 });
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
      const pageEl = document.querySelector('.page');
      const badges = [...pageEl.querySelectorAll('.bubble-badge')];
      const boxes = [...pageEl.querySelectorAll('.overlay-box')];
      const side = pageEl.querySelector('.side-text');
      let overlaps = 0;
      const rects = boxes.map(b => b.getBoundingClientRect());
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
        mode: pageEl.classList.contains('side-mode') ? 'side' : 'overlay',
        badges: badges.length,
        sideEntries: side ? side.querySelectorAll('.side-entry').length : 0,
        overlayBoxes: boxes.length,
        verticalShapes: boxes.length ? boxes.map(b => { const r = b.getBoundingClientRect(); return r.height > r.width; }) : [],
        overlaps,
        clipped: boxes.filter(b => !textFits(b)).length,
      };
    });
  };

  const dense = await check('ch192-dense');
  const sparse = await check('ch192-sparse');
  return { dense, sparse };
}
