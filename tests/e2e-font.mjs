async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://spothao.github.io/raw-manga-reader/');
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto('https://spothao.github.io/raw-manga-reader/?v=font3');
  await page.fill('#url-input', 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1');
  await page.click('#btn-load');
  await page.waitForSelector('.overlay-box', { timeout: 60000 });
  await page.waitForTimeout(1000);

  const fontSizes = () => page.evaluate(() =>
    [...document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')].map(b => b.style.fontSize));

  const before = await fontSizes();
  await page.click('#btn-font-smaller');
  await page.click('#btn-font-smaller');
  await page.waitForTimeout(400);
  const afterSmaller = await fontSizes();
  await page.click('#btn-font-bigger');
  await page.click('#btn-font-bigger');
  await page.click('#btn-font-bigger');
  await page.waitForTimeout(400);
  const afterBigger = await fontSizes();

  const settingsScale = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-settings')).fontScale);
  const overflowCheck = await page.evaluate(() =>
    [...document.querySelectorAll('.overlay-box')].filter(b => b.scrollHeight > b.clientHeight + 1).length);

  return { before, afterSmaller, afterBigger, persistedScale: settingsScale, overflowingBoxes: overflowCheck };
}
