async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const PAD = '<!-- ' + 'padding '.repeat(20) + ' -->';
  const MANGA_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>${PAD}<h1>t</h1><a href="/manga/t/chapter-3">c3</a></body></html>`;
  const CHAPTER_HTML = `<!DOCTYPE html><html><body>${PAD}<img src="https://iphotomg.com/t/c3/page_0.jpg"></body></html>`;
  const resp = await page.context().request.get('http://localhost:4173/tests/fixtures/bubbles-ch3.json');
  const BUBBLES = await resp.json();
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
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const page0 = document.querySelector('.page');
    const boxes = [...page0.querySelectorAll('.overlay-box')];
    const orig = [
      { w: 340, h: 180 }, { w: 220, h: 110 }, { w: 260, h: 130 }, { w: 300, h: 120 }, { w: 400, h: 180 },
    ];
    const imgW = page0.querySelector('img').clientWidth;
    const imgH = page0.querySelector('img').clientHeight;
    return boxes.map((b, i) => {
      const r = b.getBoundingClientRect();
      const before = orig[i] || { w: 0, h: 0 };
      const beforePx = { w: Math.round(before.w / 1000 * imgW), h: Math.round(before.h / 1000 * imgH) };
      return {
        text: b.textContent.slice(0, 12),
        beforePx: `${beforePx.w}x${beforePx.h}`,
        afterPx: `${Math.round(r.width)}x${Math.round(r.height)}`,
        shrunk: r.width < beforePx.w - 5 || r.height < beforePx.h - 5,
        fontPx: b.style.fontSize,
        clipped: b.scrollHeight > b.clientHeight + 1,
        inBounds: r.left >= -2 && r.top >= -2,
      };
    });
  });
}
