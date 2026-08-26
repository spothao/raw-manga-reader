async (page) => {
  await page.goto('http://localhost:4173/');
  await page.evaluate(() => {
    localStorage.setItem('dokiraw-settings', JSON.stringify({
      baseUrl: 'https://api.ilmu.ai/v1',
      apiKey: 'sk-test-key-123',
      model: 'glm-5.3',
      fallbackModel: 'ilmu-vision-v1.3',
      concurrency: 3,
      fontScale: 1.2,
      apiProxy: 'https://raw-manga-reader.spothao.workers.dev/proxy?url=',
      customProxy: 'https://raw-manga-reader.spothao.workers.dev/html?url=',
    }));
  });

  // --- export: capture the download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-settings'),
    page.waitForSelector('#btn-export-settings', { state: 'attached' }).then(() => page.click('#btn-export-settings')),
  ]).catch(() => [null]);
  let exportedJson = null;
  if (download) {
    const path = '/tmp/settings-export.json';
    await download.saveAs(path);
    const fs = await import('node:fs').catch(() => null);
    exportedJson = fs ? fs.readFileSync(path, 'utf8') : null;
  }
  const exportOk = exportedJson && exportedJson.includes('sk-test-key-123') && exportedJson.includes('"type": "dokiraw-reader-settings"');

  // --- import: feed a different settings file back in
  page.on('dialog', (d) => d.accept());
  await page.setInputFiles('#file-import-settings', '/tmp/settings-import.json');
  await page.waitForTimeout(500);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dokiraw-settings')));
  const formShowsImported = await page.evaluate(() => {
    const f = document.getElementById('settings-form');
    return f.apiKey.value === 'sk-imported-key-456' && f.targetLang.value === '繁體中文';
  });

  // --- bad file: should alert, not crash
  await page.setInputFiles('#file-import-settings', '/tmp/settings-bad.json');
  await page.waitForTimeout(300);
  const stillAlive = await page.evaluate(() => !!document.getElementById('settings-form'));

  return {
    exportCaptured: !!exportedJson,
    exportContainsKeyAndType: !!exportOk,
    importedApiKey: stored.apiKey,
    importedLang: stored.targetLang,
    importedFontScale: stored.fontScale,
    formShowsImported,
    survivesBadFile: stillAlive,
  };
}
