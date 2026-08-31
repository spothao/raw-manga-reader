async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      const dbs = await indexedDB.databases();
      for (const d of dbs) indexedDB.deleteDatabase(d.name);
    }
    localStorage.clear();
  }).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?v=v22c');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.reload(); // app boots with settings in place

  // --- Bug 1: open chapter with TRAILING SLASH directly (no manga page loaded first), then next must work
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-2/');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 15000 });
  await page.waitForTimeout(500);
  const beforeNav = await page.evaluate(() => ({
    nextDisabled: document.getElementById('btn-next-chapter').disabled,
    prevDisabled: document.getElementById('btn-prev-chapter').disabled,
  }));
  await page.click('#btn-next-chapter');
  await page.waitForTimeout(2000);
  const afterNext = await page.evaluate(() => ({
    progress: document.getElementById('reader-progress')?.textContent || '',
    imgs: document.querySelectorAll('.page img').length,
  }));
  // next from ch2 -> ch3 (pages ch3/page_0.jpg)
  const nextWorked = await page.evaluate(() => [...document.querySelectorAll('.page img')].some(i => i.src.includes('ch3/page_0')));

  // --- Bug 4: dense page side text confined within its page height (17 entries)
  await page.click('#btn-home');
  await page.fill('#url-input', 'https://dokiraw.space/manga/t/chapter-2-dense');
  await page.click('#btn-load');
  await page.waitForSelector('.bubble-badge', { timeout: 15000 });
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
      sideH: Math.round(sideR.height), pageH: Math.round(pageR.height),
    };
  });

  // --- Bugs 2+3: nav is sticky, page-width, contains all tools
  const navState = await page.evaluate(() => {
    const nav = document.querySelector('.chapter-nav');
    const r = nav.getBoundingClientRect();
    return {
      position: getComputedStyle(nav).position,
      width: Math.round(r.width),
      hasToolRow: !!nav.querySelector('.tool-row'),
      toolButtons: nav.querySelectorAll('.tool-row button').length,
      inViewport: r.top < innerHeight && r.bottom > 0,
    };
  });

  return { beforeNav, nextWorked, afterNextProgress: afterNext.progress, sideConfined, navState };
}
