async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // emulate a phone: iPhone UA, touch
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
    const dbs = await indexedDB.databases();
    for (const d of dbs) indexedDB.deleteDatabase(d.name);
  });
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=debug1');

  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.page', { timeout: 60000 });

  // wait up to 3 min, capture failures + their hidden error titles
  const deadline = Date.now() + 180000;
  let snap;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => ({
      pages: document.querySelectorAll('.page').length,
      done: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box') || p.querySelector('.panel-translations:not([hidden])')).length,
      failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
      failReasons: [...document.querySelectorAll('.page-status')]
        .filter(e => !e.hidden && e.textContent.includes('失败'))
        .map(e => e.title.slice(0, 150)),
      imgs: [...document.querySelectorAll('.page img')].filter(i => i.complete && i.naturalWidth > 0).length,
    }));
    if (snap.failed > 0) break;
    if (snap.done >= 3) break;
    await page.waitForTimeout(5000);
  }
  return snap;
}
