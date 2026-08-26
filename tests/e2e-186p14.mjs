async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-1">c1</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c/page_0.jpg"></body></html>`;
  const bubblesResp = await page.context().request.get('http://localhost:4173/tests/fixtures/bubbles14.json');
  const BUBBLES = await bubblesResp.json();
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
  await page.waitForTimeout(1000);

  return await page.evaluate(() => {
    const page0 = document.querySelector('.page');
    const boxes = [...page0.querySelectorAll('.overlay-box')];
    const rects = boxes.map(b => b.getBoundingClientRect());
    const clipped = boxes.filter(b => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).length;
    let overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
        const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
        if (ox > 2 && oy > 2) overlaps.push({ i, j, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
    const tooSmall = boxes.filter(b => parseFloat(b.style.fontSize) <= 8).length;
    const fonts = boxes.map(b => b.style.fontSize);
    return { bubbleCount: boxes.length, clipped, overlapCount: overlaps.length, overlaps, tooSmall, fonts };
  });
}
