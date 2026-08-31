import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, parseChapterLinks, parsePageImages, parseMangaTitle } from '../js/scraper.js';

const CHAPTER_HTML = `
<html><body>
<img src="https://dokiraw.space/public/assets/images/logo-dokiraw.svg">
<img src="https://admin.mangarawad.wtf/storage/images/xie-tohui-nonu-wang/cover.jpg">
<img src="https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_0.jpg">
<img src="https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_1.jpg">
<img src="https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_1.jpg">
<img src="https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_2.png">
</body></html>`;

const MANGA_HTML = `
<html><head><title>血と灰の女王 RAW - Dokiraw</title></head><body>
<h1>血と灰の女王</h1>
<a href="https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-224.1">第224.1話</a>
<a href="/manga/xie-tohui-nonu-wang/chapter-2">第2話</a>
<a href="/manga/xie-tohui-nonu-wang/chapter-1">第1話</a>
<a href="/manga/xie-tohui-nonu-wang/chapter-1">第1話 (dup)</a>
<a href="/manga/xie-tohui-nonu-wang">目次</a>
<a href="/search/manga?genre=SF">SF</a>
</body></html>`;

test('classifyUrl: manga page', () => {
  assert.deepEqual(classifyUrl('https://dokiraw.space/manga/xie-tohui-nonu-wang'),
    { type: 'manga', slug: 'xie-tohui-nonu-wang' });
});

test('classifyUrl: chapter page (with and without trailing slash)', () => {
  assert.deepEqual(classifyUrl('https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1'),
    { type: 'chapter', slug: 'xie-tohui-nonu-wang', chapter: 'chapter-1' });
  assert.deepEqual(classifyUrl('https://dokiraw.space/manga/foo-bar/chapter-223.2/'),
    { type: 'chapter', slug: 'foo-bar', chapter: 'chapter-223.2' });
});

test('classifyUrl: non-dokiraw / garbage', () => {
  assert.equal(classifyUrl('https://example.com/manga/foo').type, 'unknown');
  assert.equal(classifyUrl('not a url').type, 'unknown');
  assert.equal(classifyUrl('https://dokiraw.space/search/manga').type, 'unknown');
});

test('parseChapterLinks: extracts, dedupes, parses nums', () => {
  const links = parseChapterLinks(MANGA_HTML);
  assert.equal(links.length, 3);
  assert.ok(links.some((l) => l.num === 224.1));
  assert.ok(links.some((l) => l.num === 2));
  assert.ok(links.some((l) => l.num === 1));
  // relative href made absolute path
  assert.equal(links.find((l) => l.num === 1).href, '/manga/xie-tohui-nonu-wang/chapter-1');
});

test('parseChapterLinks: dokiraw.casa domain (site migrated domains)', () => {
  const html = `<a href=https://dokiraw.casa/manga/foo-bar/chapter-5>第5話</a>`;
  const links = parseChapterLinks(html);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://dokiraw.casa/manga/foo-bar/chapter-5');
  assert.equal(links[0].num, 5);
});

test('parsePageImages: page_N images only, deduped, in order', () => {
  const imgs = parsePageImages(CHAPTER_HTML);
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0], 'https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_0.jpg');
  assert.equal(imgs[2], 'https://iphotomg.com/xie-tohui-nonu-wang/chapter_1/page_2.png');
});

test('parsePageImages: fallback when no page_N pattern', () => {
  const html = `<img src="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/b.webp"><img src="https://x/logo.svg">`;
  const imgs = parsePageImages(html);
  assert.equal(imgs.length, 2);
});

test('parseMangaTitle: prefers h1, decodes entities', () => {
  assert.equal(parseMangaTitle(MANGA_HTML), '血と灰の女王');
  assert.equal(parseMangaTitle('<title>Foo &amp; Bar RAW - Dokiraw</title><body></body>'), 'Foo & Bar');
});

const UNQUOTED_MANGA_HTML = `
<html><body>
<link href=https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1 rel=next>
<a href=https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1><span>第1話</span></a>
<a href=https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-2>第2話</a>
</body></html>`;

const UNQUOTED_CHAPTER_HTML = `
<html><body>
<img alt=Dokiraw src=https://dokiraw.space/public/assets/images/logo-dokiraw.svg>
<img alt="Page 0" data-cdn=https://iphotomg.com/test/chapter_1/page_0.jpg data-original=https://iphotomg.com/test/chapter_1/page_0.jpg src=https://iphotomg.com/test/chapter_1/page_0.jpg>
<img alt="Page 1" src=https://iphotomg.com/test/chapter_1/page_1.jpg>
</body></html>`;

test('parseChapterLinks: unquoted href attributes (proxy-serialized HTML)', () => {
  const links = parseChapterLinks(UNQUOTED_MANGA_HTML);
  assert.equal(links.length, 2);
  assert.ok(links.some((l) => l.num === 1));
  assert.ok(links.some((l) => l.num === 2));
  assert.equal(links.find((l) => l.num === 1).href, 'https://dokiraw.space/manga/xie-tohui-nonu-wang/chapter-1');
});

test('parsePageImages: unquoted src attributes', () => {
  const imgs = parsePageImages(UNQUOTED_CHAPTER_HTML);
  assert.equal(imgs.length, 2);
  assert.equal(imgs[0], 'https://iphotomg.com/test/chapter_1/page_0.jpg');
});
