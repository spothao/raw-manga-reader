async (page) => {
  // mocked pipeline (same as e2e-mock) + peek-button behavior test
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>测试漫画 RAW</title></head><body>${PAD}<h1>测试漫画</h1><a href="/manga/test-manga/chapter-1">第1話</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/test/chapter_1/page_0.jpg"><img src="https://iphotomg.com/test/chapter_1/page_1.jpg"></body></html>`;
  let vlm = 0;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: target.includes('chapter-') ? CHAPTER_HTML : MANGA_HTML,
      });
    }
    if (url.startsWith('https://wsrv.nl/') || url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      vlm++;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([
          { bbox: [100, 150, 300, 120], original: 'こんにちは', translation: '你好，世界！' },
          { bbox: [500, 600, 250, 100], original: '逃げろ！', translation: '快逃！' },
        ]) } }] }),
      });
    }
    return route.continue();
  });

  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
    localStorage.removeItem('dokiraw-history');
  });
  await page.reload();
  await page.fill('#url-input', 'https://dokiraw.space/manga/test-manga');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForTimeout(600);

  const overlayHidden = () => page.evaluate(() => getComputedStyle(document.querySelector('.overlays')).display === 'none');

  // hold-to-peek
  const peek = page.locator('#btn-peek');
  await peek.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
  await page.waitForTimeout(150);
  const hiddenWhileHeld = await overlayHidden();
  await peek.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await page.waitForTimeout(150);
  const visibleAfterRelease = !(await overlayHidden());

  // full toggle still works
  await page.click('#btn-toggle-overlay');
  const hiddenAfterToggle = await overlayHidden();
  const toggleLabel = await page.textContent('#btn-toggle-overlay');
  // peek should NOT re-show while toggled off
  await peek.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
  await page.waitForTimeout(100);
  const stillHiddenWhileToggledOff = await overlayHidden();
  await peek.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await page.click('#btn-toggle-overlay');

  return { hiddenWhileHeld, visibleAfterRelease, hiddenAfterToggle, toggleLabel, stillHiddenWhileToggledOff };
}
