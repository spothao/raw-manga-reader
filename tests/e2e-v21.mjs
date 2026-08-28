async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"></body></html>`;
  // mixed-length translations to exercise font tiers
  const BUBBLES = [
    { bbox: [600, 60, 200, 260], original: '去死!!', translation: '去死!!' },
    { bbox: [350, 100, 200, 220], original: '你到底是什么人', translation: '你到底是什么人？' },
    { bbox: [60, 380, 260, 240], original: '这是一个非常漫长的故事', translation: '这是一个非常漫长的故事的开头部分，很久很久以前' },
  ];
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
  await page.goto('http://localhost:4173/?v=v21');
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
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForTimeout(1200);

  // #3 tiered fonts + #4 manga font applied
  const typography = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.page .overlay-box')];
    return {
      fonts: boxes.map(b => b.style.fontSize),
      fontFamily: getComputedStyle(boxes[0]).fontFamily.slice(0, 40),
      fontLoaded: document.fonts.check('16px "LXGW WenKai"'),
    };
  });

  // #6 flag flow: hold box -> popup -> mark inaccurate
  const box = await page.$$('.page .overlay-box');
  await box[1].dispatchEvent('pointerdown', { pointerId: 1 });
  await page.waitForTimeout(800);
  const popupShown = await page.evaluate(() => !!document.querySelector('.text-popup .popup-actions'));
  await page.evaluate(() => document.querySelector('.text-popup .popup-actions button').click());
  await page.waitForTimeout(300);
  const flagState = await page.evaluate(() => ({
    statusText: document.querySelector('.page-status')?.textContent,
    flagCount: Object.keys(localStorage).filter(k => k.startsWith('dokiraw-flag:')).length,
  }));

  // ♻️ retranslate: alert mentions the flagged page; flags cleared
  await page.click('#btn-retranslate');
  await page.waitForTimeout(2500);
  const afterRetrans = await page.evaluate(() => ({
    flagCount: Object.keys(localStorage).filter(k => k.startsWith('dokiraw-flag:')).length,
    overlays: document.querySelectorAll('.page .overlay-box').length,
  }));

  // #9 dim: set pageDim 0.6 in settings form -> filter applied to img
  await page.click('#btn-settings');
  await page.evaluate(() => { document.getElementById('settings-form').pageDim.value = '0.6'; });
  await page.click('#settings-form button[type="submit"]');
  const dim = await page.evaluate(() => {
    const img = document.querySelector('.page img');
    return { cssVar: getComputedStyle(img).getPropertyValue('--page-dim') || document.documentElement.style.getPropertyValue('--page-dim'), filter: getComputedStyle(img).filter };
  });

  return { typography, popupShown, flagState, afterRetrans, dim };
}
