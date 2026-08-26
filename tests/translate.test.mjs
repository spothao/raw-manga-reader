import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROMPT, normalizeBaseUrl, parseTranslationJSON, validateBboxes, pickRenderMode, apiUrl,
} from '../js/translate.js';
import { estimateFontSize, Scheduler } from '../js/reader.js';

test('normalizeBaseUrl: appends /v1 when missing', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/v2'), 'https://api.example.com/v2');
  assert.equal(normalizeBaseUrl('https://api.example.com/openai/v1/'), 'https://api.example.com/openai/v1');
});

test('normalizeBaseUrl: verbatim mode with # suffix', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/custom/path#'), 'https://api.example.com/custom/path');
});

test('parseTranslationJSON: clean array', () => {
  const out = parseTranslationJSON('[{"bbox":[1,2,3,4],"original":"あ","translation":"啊"}]');
  assert.equal(out.length, 1);
});

test('parseTranslationJSON: fenced with chatter', () => {
  const out = parseTranslationJSON('Here is the result:\n```json\n[{"bbox":[0,0,10,10],"original":"x","translation":"y"}]\n```\nDone.');
  assert.equal(out.length, 1);
});

test('parseTranslationJSON: trailing comma repair', () => {
  const out = parseTranslationJSON('[{"bbox":[0,0,10,10],"original":"x","translation":"y"},]');
  assert.equal(out.length, 1);
});

test('parseTranslationJSON: null cases', () => {
  assert.equal(parseTranslationJSON('no json here'), null);
  assert.equal(parseTranslationJSON('{"not":"an array"}'), null);
  assert.equal(parseTranslationJSON(''), null);
  assert.equal(parseTranslationJSON(null), null);
});

test('validateBboxes: clamps and filters', () => {
  const raw = [
    { bbox: [10, 10, 100, 100], original: 'a', translation: '甲' },
    { bbox: [950, 950, 200, 200], original: 'b', translation: '乙' },   // clamped
    { bbox: [5, 5, 0, 50], original: 'c', translation: '丙' },          // zero w -> invalid
    { bbox: 'nope', original: 'd', translation: '丁' },                 // not array
    { original: 'e', translation: '戊' },                               // missing bbox
    { bbox: [1, 1, 10, 10], original: '', translation: '' },            // no text
  ];
  const { items, invalidCount, texts } = validateBboxes(raw);
  assert.equal(items.length, 2);
  assert.equal(invalidCount, 4);
  // texts keeps every entry with any text, even when bbox is invalid
  assert.equal(texts.length, 5);
  // clamped bbox stays in 0..1000
  const [x, y, w, h] = items[1].bbox;
  assert.ok(x + w <= 1000 && y + h <= 1000);
});

test('validateBboxes: empty input', () => {
  const { items, invalidCount } = validateBboxes([]);
  assert.equal(items.length, 0);
  assert.equal(invalidCount, 0);
});

test('pickRenderMode: thresholds', () => {
  assert.equal(pickRenderMode([], 0), 'raw');
  assert.equal(pickRenderMode([{ bbox: [0, 0, 1, 1] }], 0), 'overlay');
  // 1 valid, 1 invalid = 50% > 30% -> panel
  assert.equal(pickRenderMode([{ bbox: [0, 0, 1, 1] }], 1), 'panel');
  // 4 valid, 1 invalid = 20% <= 30% -> overlay
  assert.equal(pickRenderMode([
    { bbox: [0, 0, 1, 1] }, { bbox: [0, 0, 1, 1] },
    { bbox: [0, 0, 1, 1] }, { bbox: [0, 0, 1, 1] },
  ], 1), 'overlay');
});

test('apiUrl: direct when no proxy, prefix/template when proxy set', () => {
  assert.equal(apiUrl('https://api.ilmu.ai/v1', ''), 'https://api.ilmu.ai/v1/chat/completions');
  assert.equal(apiUrl('https://api.ilmu.ai', ''),
    'https://api.ilmu.ai/v1/chat/completions');
  const prefix = apiUrl('https://api.ilmu.ai/v1', 'https://relay.dev/proxy?url=');
  assert.equal(prefix, 'https://relay.dev/proxy?url=' + encodeURIComponent('https://api.ilmu.ai/v1/chat/completions'));
  const tpl = apiUrl('https://api.ilmu.ai/v1', 'https://relay.dev/?u={url}&x=1');
  assert.equal(tpl, 'https://relay.dev/?u=' + encodeURIComponent('https://api.ilmu.ai/v1/chat/completions') + '&x=1');
});

test('apiUrl: bare prefix missing ?url= gets it appended (leading/trailing spaces trimmed)', () => {
  const fixed = apiUrl('https://api.ilmu.ai/v1', 'https://relay.dev/proxy ');
  assert.equal(fixed, 'https://relay.dev/proxy?url=' + encodeURIComponent('https://api.ilmu.ai/v1/chat/completions'));
  const alreadyQ = apiUrl('https://api.ilmu.ai/v1', 'https://relay.dev/?x=1&url=');
  assert.equal(alreadyQ, 'https://relay.dev/?x=1&url=' + encodeURIComponent('https://api.ilmu.ai/v1/chat/completions'));
});

test('DEFAULT_PROMPT contains {LANG} placeholder', () => {
  assert.ok(DEFAULT_PROMPT.includes('{LANG}'));
});

test('estimateFontSize: sane bounds', () => {
  const small = estimateFontSize('短', 60, 30);
  const long = estimateFontSize('这是一段非常长的漫画对话文本需要放进气泡里', 60, 30);
  assert.ok(small >= 10 && small <= 24);
  assert.ok(long >= 10 && long <= 24);
  assert.ok(long <= small);
});

test('Scheduler: respects concurrency, lowest index first', async () => {
  const startOrder = [];
  let active = 0, maxActive = 0;
  const s = new Scheduler(2);
  const task = (i) => async () => {
    startOrder.push(i);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
  };
  await Promise.all([s.run(2, task(2)), s.run(0, task(0)), s.run(1, task(1)), s.run(3, task(3))]);
  assert.equal(maxActive, 2);
  // eager start: the first two enqueued (2, then 0) take the two slots immediately
  assert.deepEqual(startOrder.slice(0, 2).sort((a, b) => a - b), [0, 2]);
  // remaining tasks start in index order as slots free
  assert.deepEqual(startOrder.slice(2), [1, 3]);
});

test('Scheduler: dedupes same index', async () => {
  const s = new Scheduler(1);
  let calls = 0;
  const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 42; };
  const p1 = s.run(0, fn);
  const p2 = s.run(0, fn);
  assert.equal(await p1, 42);
  assert.equal(await p2, 42);
  assert.equal(calls, 1);
});
