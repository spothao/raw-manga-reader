async (page) => {
  // resume live test: settings persist in localStorage; IndexedDB cache holds any done pages
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-settings') || '{}'));
  if (!state.apiProxy) throw new Error('settings lost: ' + JSON.stringify(state));

  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.page', { timeout: 60000 });
  // poll until first page translated or 150s
  const deadline = Date.now() + 150000;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await page.evaluate(() => ({
      overlayPages: [...document.querySelectorAll('.page')].filter(p => p.querySelector('.overlay-box')).length,
      panelPages: [...document.querySelectorAll('.panel-translations')].filter(p => !p.hidden).length,
      pages: document.querySelectorAll('.page').length,
      failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    }));
    if (snapshot.overlayPages + snapshot.panelPages > 0) break;
    await page.waitForTimeout(3000);
  }

  const result = await page.evaluate(() => ({
    pages: document.querySelectorAll('.page').length,
    imgsLoaded: [...document.querySelectorAll('.page img')].filter(i => i.complete && i.naturalWidth > 0).length,
    firstPageOverlays: [...document.querySelectorAll('.page')][0]
      ? [...document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')].map(e => e.textContent).slice(0, 4)
      : [],
    overlayBoxStyle: (() => { const b = document.querySelector('.overlay-box'); return b ? { left: b.style.left, top: b.style.top, w: b.style.width, h: b.style.height, bg: b.style.background.slice(0, 40), fs: b.style.fontSize } : null; })(),
    progress: document.getElementById('reader-progress').textContent,
    failed: [...document.querySelectorAll('.page-status')].filter(e => !e.hidden && e.textContent.includes('失败')).length,
    title: document.getElementById('reader-progress').textContent.split('·')[0].trim(),
  }));
  return { translated: snapshot, ...result };
}
