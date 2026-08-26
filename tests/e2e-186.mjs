async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>186.2</title></head><body>${PAD}<h1>186.2</h1><a href="/manga/t/chapter-186.2">186.2</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"></body></html>`;
  // real bubble layout from chapter-186.2 page 0 (7 tight bubbles) with realistic-length CN translations
  const BUBBLES = [
    { bbox: [420, 15, 160, 70], original: 'キャッ', translation: '呀！' },
    { bbox: [740, 295, 110, 70], original: '陛下ぁー!!', translation: '陛下啊——！！' },
    { bbox: [790, 380, 80, 90], original: '取り押さえよ！', translation: '把他们统统拿下！' },
    { bbox: [700, 380, 80, 90], original: '敵は四人！', translation: '敌人有四个！' },
    { bbox: [810, 480, 90, 60], original: 'どれです!!?', translation: '在哪里！？' },
    { bbox: [130, 310, 80, 110], original: 'あの者と！', translation: '抓住那个人！' },
    { bbox: [40, 430, 80, 110], original: 'その右の…', translation: '还有他右边的……' },
  ];
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
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(BUBBLES) } }] }),
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
  await page.fill('#url-input', 'https://dokiraw.space/manga/t');
  await page.click('#btn-load');
  await page.waitForSelector('#chapter-grid .chapter-btn');
  await page.click('#chapter-grid .chapter-btn');
  await page.waitForSelector('.overlay-box', { timeout: 10000 });
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const page0 = document.querySelector('.page');
    const img = page0.querySelector('img');
    const imgR = img.getBoundingClientRect();
    const boxes = [...page0.querySelectorAll('.overlay-box')];
    const rects = boxes.map(b => b.getBoundingClientRect());
    // any text still clipped after auto-fit?
    const clipped = boxes.filter(b => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).length;
    // actual rendered overlaps between boxes (text areas colliding)
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
        const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
        if (ox > 2 && oy > 2) overlaps++;
      }
    }
    const fonts = boxes.map(b => b.style.fontSize);
    return { bubbleCount: boxes.length, clipped, overlaps, fonts, imgH: Math.round(imgR.height) };
  });
  return result;
}
