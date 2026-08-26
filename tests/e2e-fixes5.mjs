async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"><img src="https://iphotomg.com/t/c/page_1.jpg"><img src="https://iphotomg.com/t/c/page_2.jpg"><img src="https://iphotomg.com/t/c/page_3.jpg"><img src="https://iphotomg.com/t/c/page_4.jpg"></body></html>`;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? CHAPTER_HTML : MANGA_HTML });
    }
    if (url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([
          { bbox: [100, 150, 300, 120], original: 'こんにちは', translation: '你好！' },
        ]) } }] }),
      });
    }
    return route.continue();
  });

  await page.goto('http://localhost:4173/');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=', concurrency: 8,
    }));
  });

  // --- 1. close button exists; 2. focus lands on it (not the URL textbox)
  await page.click('#btn-settings');
  const focusOnClose = await page.evaluate(() => document.activeElement?.id === 'btn-close-settings');
  const hasClose = await page.evaluate(() => !!document.getElementById('btn-close-settings'));
  // dialog closes on ✕ without saving
  await page.click('#btn-close-settings');
  const closed = await page.evaluate(() => !document.getElementById('settings-dialog').open);

  // --- 3. sliders replaced by number inputs
  await page.click('#btn-settings');
  const fieldTypes = await page.evaluate(() => {
    const f = document.getElementById('settings-form');
    return { opacity: f.patchOpacity.type, fontScale: f.fontScale.type, concurrency: f.concurrency.type };
  });

  // --- 4. concurrency 8 (>6) saves fine
  await page.evaluate(() => {
    const f = document.getElementById('settings-form');
    f.concurrency.value = '8';
    f.patchOpacity.value = '0.9';
    f.fontScale.value = '1.3';
  });
  await page.click('#settings-form button[type="submit"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-settings')));
  const dialogAfterSave = await page.evaluate(() => !document.getElementById('settings-dialog').open);

  // --- 5. ⚡ translate-all queues every page
  await page.fill('#url-input', 'https://dokiraw.space/manga/t');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.page', { timeout: 10000 });

  page.on('dialog', (d) => d.accept());
  const hasTranslateAll = await page.evaluate(() => !!document.getElementById('btn-translate-all'));
  await page.click('#btn-translate-all');
  // wait for all 5 pages to finish translating
  await page.waitForFunction(() => [...document.querySelectorAll('.page')]
    .filter(p => p.querySelector('.overlay-box') || p.querySelector('.panel-translations:not([hidden])')).length === 5, null, { timeout: 30000 });
  const progress = await page.evaluate(() => document.getElementById('reader-progress').textContent);

  return {
    hasClose, focusOnClose, closedWithoutSave: closed,
    fieldTypes,
    concurrency8Saved: saved.concurrency, fontScaleSaved: saved.fontScale, dialogAfterSave,
    hasTranslateAll, progress,
  };
}
