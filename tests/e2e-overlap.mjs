async (page) => {
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>测试漫画</title></head><body>${PAD}<h1>测试漫画</h1><a href="/manga/test-manga/chapter-1">第1話</a></body></html>`;
  // two deliberately overlapping bubbles + one long dialog
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/test/chapter_1/page_0.jpg"><img src="https://iphotomg.com/test/chapter_1/page_1.jpg"></body></html>`;
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy')) {
      const m = url.match(/url=([^&]+)/) || url.match(/quest=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : url;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: target.includes('chapter-') ? CHAPTER_HTML : MANGA_HTML });
    }
    if (url.startsWith('https://wsrv.nl/') || url.includes('iphotomg.com')) {
      return route.fulfill({ contentType: 'image/png', path: '/Users/chunho.lo/Documents/Github/dokiraw-reader/tests/fixtures/test-page.png' });
    }
    if (url.includes('/chat/completions')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([
          { bbox: [100, 100, 400, 300], original: '短い', translation: '上层气泡' },
          { bbox: [250, 200, 400, 300], original: '重なってる', translation: '重叠气泡（被压在下面）' },
          { bbox: [500, 600, 300, 150], original: 'とても長い会話文がここに続きます…', translation: '这是一段非常长的对话文本，在小气泡里会被压缩得很小，需要按住查看全文才能舒适阅读。' },
        ]) } }] }),
      });
    }
    return route.continue();
  });

  await page.goto('http://localhost:4173/');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'http://mock.test/v1', apiKey: 'k', model: 'm',
      customProxy: 'http://mock.test/p?url=',
    }));
  });
  await page.fill('#url-input', 'https://dokiraw.space/manga/test-manga');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForTimeout(500);

  const boxes = await page.$$('.overlay-box');
  // verify boxes 1&2 actually overlap in the DOM
  const overlap = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')];
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return { overlapped: x > 0 && y > 0, zA: getComputedStyle(a).zIndex, zB: getComputedStyle(b).zIndex };
  });

  // tap the overlapped (second) box -> raised + outline + z-index 10
  await boxes[1].click();
  const raised = await page.evaluate(() => {
    const b = document.querySelectorAll('.page')[0].querySelectorAll('.overlay-box')[1];
    return { cls: b.classList.contains('raised'), z: getComputedStyle(b).zIndex };
  });

  // hold the long-dialog box -> popup shows full text
  const longBox = boxes[2];
  await longBox.dispatchEvent('pointerdown', { pointerId: 1 });
  await page.waitForTimeout(800);
  const popup = await page.evaluate(() => {
    const p = document.querySelector('.text-popup');
    return p ? { cn: p.querySelector('.cn').textContent.slice(0, 20), hasJp: !!p.querySelector('.jp') } : null;
  });
  await page.evaluate(() => document.querySelector('.text-popup')?.click());
  const popupClosed = await page.evaluate(() => !document.querySelector('.text-popup'));

  // short tap must NOT open popup (hold timer cancelled)
  await longBox.dispatchEvent('pointerdown', { pointerId: 2 });
  await page.waitForTimeout(150);
  await longBox.dispatchEvent('pointerup', { pointerId: 2 });
  await page.waitForTimeout(700);
  const noPopupOnTap = await page.evaluate(() => !document.querySelector('.text-popup'));

  return { overlap, raised, popup, popupClosed, noPopupOnTap };
}
