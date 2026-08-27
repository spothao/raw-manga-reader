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
    const dbs = await indexedDB.databases();
    for (const d of dbs) indexedDB.deleteDatabase(d.name);
  }).catch(() => {});
  page.on('dialog', (d) => d.accept());
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=probe1');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'glm-5.3', fallbackModel: 'ilmu-vision-v1.3', concurrency: 2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
  });

  await page.click('#btn-preload');
  await page.fill('#preload-urls', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-189.2');
  await page.click('#btn-start-preload');

  // poll every 15s for up to 4.5 min; snapshot after each poll
  const snapshots = [];
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(15000);
    const snap = await page.evaluate(() => ({
      t: new Date().toLocaleTimeString(),
      line: document.querySelector('#preload-log div')?.textContent.slice(0, 100) || '',
      progress: document.getElementById('preload-progress').textContent,
      version: document.getElementById('app-version')?.textContent,
    }));
    snapshots.push(snap);
    if (snap.progress.includes('全部完成') || snap.progress.includes('停止')) break;
  }
  return snapshots;
}
