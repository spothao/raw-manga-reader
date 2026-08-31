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
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'ilmu-glm-5.1', concurrency: 2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
    localStorage.setItem('dokiraw-history', JSON.stringify([
      { url: 'https://x/1', title: '旧记录A', ts: 1 },
      { url: 'https://x/2', title: '旧记录B', ts: 2 },
    ]));
  }).catch(() => {});
  page.on('dialog', (d) => d.accept());
  // bump module version via page URL — but modules are ?v=2.3... use the index with version query appended
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=dbg3');
  await page.reload();

  // trailing-slash manga URL must now load
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn', { timeout: 60000 });
  const mangaLoaded = await page.evaluate(() => ({
    chapters: document.querySelectorAll('#chapter-grid .chapter-btn').length,
    title: document.getElementById('manga-title').textContent,
  }));

  // clear history button: visible with history, clears all after confirm
  await page.click('#btn-home');
  await page.waitForTimeout(300);
  const beforeClear = await page.evaluate(() => ({
    items: document.querySelectorAll('.history-item').length,
    clearBtnVisible: !document.getElementById('btn-clear-history').hidden,
  }));
  await page.click('#btn-clear-history'); // confirm auto-accepted
  await page.waitForTimeout(300);
  const afterClear = await page.evaluate(() => ({
    items: document.querySelectorAll('.history-item').length,
    clearBtnHidden: document.getElementById('btn-clear-history').hidden,
  }));

  return { mangaLoaded, beforeClear, afterClear };
}
