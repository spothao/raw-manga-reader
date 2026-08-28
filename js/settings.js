// settings.js — persisted settings + reading history (localStorage).

export const DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  model: 'glm-5.3',
  fallbackModel: 'ilmu-vision-v1.3',
  targetLang: '简体中文',
  concurrency: 2,
  customProxy: '',
  apiProxy: '',
  fontScale: 1,
  pageDim: 1,
  patchOpacity: 0.92,
  promptTemplate: '',   // empty = DEFAULT_PROMPT
};

const KEY = 'dokiraw-settings';
const HISTORY_KEY = 'dokiraw-history';

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...s };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...s }));
}

export function resetSettings() {
  localStorage.removeItem(KEY);
}

/** @typedef {{url:string,title:string,ts:number}} HistoryEntry */

export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

export function addHistory(entry) {
  const list = loadHistory().filter((e) => e.url !== entry.url);
  list.unshift({ ts: Date.now(), ...entry });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
}

export function removeHistory(url) {
  const list = loadHistory().filter((e) => e.url !== url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}
