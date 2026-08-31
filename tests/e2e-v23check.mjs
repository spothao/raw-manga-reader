async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  }).catch(() => {});
  page.on('dialog', (d) => d.accept());
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=v23check');
  const version = await page.evaluate(() => document.getElementById('app-version')?.textContent);
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-192');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const state1 = await page.evaluate(() => ({
    chapters: window.__app?.state?.chapters?.length || 0,
    nextDisabled: document.getElementById('btn-next-chapter').disabled,
    idx: window.__app?.state?.currentChapterIdx,
  }));
  await page.click('#btn-next-chapter');
  await page.waitForTimeout(6000);
  const state2 = await page.evaluate(() => ({
    progress: document.getElementById('reader-progress')?.textContent || '',
    imgs: document.querySelectorAll('.page img').length,
    anyLoaded: [...document.querySelectorAll('.page img')].some(i => i.complete && i.naturalWidth > 0),
  }));
  return { version, state1, state2 };
}
