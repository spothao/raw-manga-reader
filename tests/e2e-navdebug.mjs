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
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=navdebug');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-7cd39fbb6e245db704ff39cd346f0acca61ea52f20c541cd',
      model: 'glm-5.3', fallbackModel: 'ilmu-vision-v1.3', concurrency: 2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
  });

  // exact user flow: paste a chapter URL (like from preload history), open, click next
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-192');
  await page.click('#btn-load');
  await page.waitForSelector('.page img', { timeout: 60000 });
  await page.waitForTimeout(1000);

  const state1 = await page.evaluate(() => ({
    nextDisabled: document.getElementById('btn-next-chapter').disabled,
    prevDisabled: document.getElementById('btn-prev-chapter').disabled,
    chaptersLoaded: window.__app?.state?.chapters?.length || 0,
    currentIdx: window.__app?.state?.currentChapterIdx,
  }));
  console.log('state after open:', JSON.stringify(state1));

  // capture any console error on click
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 150)));

  await page.click('#btn-next-chapter');
  await page.waitForTimeout(8000);

  const state2 = await page.evaluate(() => ({
    progress: document.getElementById('reader-progress')?.textContent || '',
    firstImg: document.querySelector('.page img')?.src?.slice(-30) || '',
    currentIdx: window.__app?.state?.currentChapterIdx,
  }));
  console.log('state after next click:', JSON.stringify(state2));
  console.log('errors:', errors.slice(0, 5));

  return { state1, state2, errors: errors.slice(0, 5) };
}
