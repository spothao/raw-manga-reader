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
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=livetest2');
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
  await page.fill('#preload-urls', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-4');
  await page.click('#btn-start-preload');

  // poll: watch chapter line progress; stop when chapter done or 5 min
  const deadline = Date.now() + 300000;
  let snap;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => {
      const lines = [...document.getElementById('preload-log').children].map(e => e.textContent);
      return {
        progress: document.getElementById('preload-progress').textContent,
        lines: lines.map(l => l.slice(0, 90)),
        done: document.getElementById('preload-progress').textContent.includes('全部完成') || document.getElementById('preload-progress').textContent.includes('失败'),
      };
    });
    if (snap.done) break;
    await page.waitForTimeout(8000);
  }
  return snap;
}
