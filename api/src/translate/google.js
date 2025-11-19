const { ensureFetch } = require('../utils/http');

const GOOGLE_TRANSLATE_ENDPOINT =
  process.env.GOOGLE_TRANSLATE_ENDPOINT ||
  'https://translation.googleapis.com/language/translate/v2';
const GOOGLE_TRANSLATE_API_KEY =
  (process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const GOOGLE_SOURCE_LANG = (process.env.GOOGLE_TRANSLATE_SOURCE_LANG || 'ko').trim();
const GOOGLE_TARGET_LANG = (process.env.GOOGLE_TRANSLATE_TARGET_LANG || 'en').trim();

function containsKorean(text) {
  if (!text) return false;
  return /[ㄱ-ㅎ가-힣]/.test(text);
}

async function translatePromptToEnglishIfNeeded(text) {
  const original = (text || '').trim();
  if (!original) return original;

  if (!containsKorean(original)) return original;
  if (!GOOGLE_TRANSLATE_API_KEY) return original;

  ensureFetch();

  const params = new URLSearchParams();
  params.append('q', original);
  params.append('target', GOOGLE_TARGET_LANG || 'en');
  if (GOOGLE_SOURCE_LANG) params.append('source', GOOGLE_SOURCE_LANG);
  params.append('format', 'text');
  params.append('key', GOOGLE_TRANSLATE_API_KEY);

  let resp;
  try {
    resp = await fetch(GOOGLE_TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: params.toString(),
    });
  } catch (err) {
    console.error('Google translation request failed', err);
    return original;
  }

  if (!resp.ok) {
    try {
      const body = await resp.text();
      console.error(
        'Google translation HTTP error',
        resp.status,
        resp.statusText,
        body
      );
    } catch {
      console.error(
        'Google translation HTTP error',
        resp.status,
        resp.statusText
      );
    }
    return original;
  }

  try {
    const data = await resp.json();
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (typeof translated === 'string' && translated.trim()) {
      return translated.trim();
    }
  } catch (err) {
    console.error('Google translation parse error', err);
  }

  return original;
}

module.exports = {
  translatePromptToEnglishIfNeeded,
};

