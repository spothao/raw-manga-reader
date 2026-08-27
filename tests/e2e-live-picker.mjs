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
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=livetest');

  // real settings via relay (mock key is fine for network-path testing; 401 would show as HTTP 401 not 404)
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
  await page.fill('#preload-urls', 'https://dokiraw.space/manga/xie-tohui-nonu-wang');
  await page.click('#btn-load-chapters');

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

  await page.waitForTimeout(20000);
  const state = await page.evaluate(() => ({
    pickerHidden: document.getElementById('chapter-picker').hidden,
    pickerContent: document.getElementById('chapter-picker').textContent.slice(0, 80),
    checkboxes: document.querySelectorAll('#chapter-picker input[type=checkbox]').length,
    progress: document.getElementById('preload-progress').textContent,
    settingsProxy: JSON.parse(localStorage.getItem('dokiraw-settings')).customProxy,
  }));
  return { state, consoleErrors: errors.slice(0, 5) };
}
