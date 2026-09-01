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
      const dbs = await indexedDB.databases();
      for (const d of dbs) indexedDB.deleteDatabase(d.name);
    }
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'ilmu-glm-5.1', concurrency: 2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
  }).catch(() => {});
  page.on('dialog', (d) => d.accept());
  const imgErrors = [];
  page.on('requestfailed', (r) => {
    if (r.url().includes('iphotomg') || r.url().includes('wsrv')) imgErrors.push(r.url().slice(0, 80) + ' :: ' + r.failure()?.errorText);
  });
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=imgdbg');
  await page.reload();

  // full user flow: manga URL -> chapters -> open chapter 1 -> images load?
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn', { timeout: 60000 });
  await page.click('#chapter-grid .chapter-btn:first-child');
  await page.waitForSelector('.page img', { timeout: 30000 });
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.page img')];
    return {
      pages: imgs.length,
      loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      imgSrc: imgs[0]?.src?.slice(0, 60),
      progress: document.getElementById('reader-progress')?.textContent,
      nextDisabled: document.getElementById('btn-next-chapter')?.disabled,
      version: document.getElementById('app-version')?.textContent,
    };
  });

  // next chapter
  await page.click('#btn-next-chapter');
  await page.waitForTimeout(6000);
  const afterNext = await page.evaluate(() => ({
    progress: document.getElementById('reader-progress')?.textContent || '',
    imgs: document.querySelectorAll('.page img').length,
    loaded: [...document.querySelectorAll('.page img')].filter(i => i.complete && i.naturalWidth > 0).length,
  }));
  return { state, afterNext, imgErrors: imgErrors.slice(0, 5) };
}
