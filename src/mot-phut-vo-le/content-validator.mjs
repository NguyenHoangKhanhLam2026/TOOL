import crypto from 'node:crypto';

export const MOT_PHUT_VO_LE_REQUIRED_FIELDS = Object.freeze([
  'title', 'topic', 'category', 'subcategory', 'angle', 'scriptText', 'caption', 'hashtags', 'deliveryStyle', 'contentType', 'language'
]);
export const MOT_PHUT_VO_LE_SCRIPT_WORD_MIN = 55;
export const MOT_PHUT_VO_LE_SCRIPT_WORD_MAX = 80;

export function countMotPhutVoLeScriptWords(value) {
  return String(value ?? '').normalize('NFC').trim().split(/\s+/u).filter(Boolean).length;
}

function cleanText(value, label, { min = 1, max = 4000 } = {}) {
  if (typeof value !== 'string') throw new Error(`Trường ${label} phải là văn bản.`);
  const text = value.normalize('NFC').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '');
  if (text.length < min || text.length > max) throw new Error(`Trường ${label} phải dài từ ${min} đến ${max} ký tự.`);
  return text;
}

export function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const source = String(value ?? '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON phải là một object.');
    return parsed;
  } catch (error) {
    throw new Error(`ChatGPT trả về JSON không hợp lệ: ${error.message}`);
  }
}

export function validateMotPhutVoLeContent(value) {
  const parsed = parseJsonObject(value);
  const title = cleanText(parsed.title, 'title', { max: 180 });
  const content = {
    title,
    thumbnailHighlight: normalizeThumbnailHighlight(title, parsed.thumbnailHighlight),
    topic: cleanText(parsed.topic, 'topic', { max: 180 }),
    category: cleanText(parsed.category, 'category', { max: 100 }),
    subcategory: cleanText(parsed.subcategory, 'subcategory', { max: 120 }),
    angle: cleanText(parsed.angle, 'angle', { max: 240 }),
    scriptText: cleanText(parsed.scriptText, 'scriptText', { min: 80, max: 2400 }),
    caption: cleanText(parsed.caption, 'caption', { max: 800 }),
    hashtags: normalizeHashtags(parsed.hashtags),
    deliveryStyle: normalizeDeliveryStyle(parsed.deliveryStyle),
    contentType: cleanText(parsed.contentType || 'explanation', 'contentType', { max: 60 }),
    language: String(parsed.language || '').toLowerCase()
  };

  if (content.language !== 'vi') throw new Error('Nội dung Một Phút Vỡ Lẽ phải có language="vi".');
  if (/[^\p{L}\p{M}\p{N}\p{P}\p{Z}\p{S}]/u.test(content.scriptText)) throw new Error('Kịch bản chứa ký tự điều khiển không hợp lệ.');
  if (/[A-Za-z]{4,}/u.test(content.scriptText) && !/[ăâđêôơư]/iu.test(content.scriptText)) {
    throw new Error('Kịch bản có vẻ không phải tiếng Việt có dấu.');
  }
  const scriptWordCount = countMotPhutVoLeScriptWords(content.scriptText);
  if (scriptWordCount < MOT_PHUT_VO_LE_SCRIPT_WORD_MIN || scriptWordCount > MOT_PHUT_VO_LE_SCRIPT_WORD_MAX) {
    const error = new Error(`Kịch bản MPVL phải có từ ${MOT_PHUT_VO_LE_SCRIPT_WORD_MIN} đến ${MOT_PHUT_VO_LE_SCRIPT_WORD_MAX} từ (hiện có ${scriptWordCount}).`);
    error.code = 'MOT_PHUT_VO_LE_WORD_COUNT';
    error.wordCount = scriptWordCount;
    throw error;
  }
  content.summary = cleanText(String(parsed.summary || content.scriptText.slice(0, 360)), 'summary', { max: 600 });
  content.contentHash = hashContent(content.scriptText);
  content.titleKey = normalizeTitle(content.title);
  return Object.freeze(content);
}

function normalizeThumbnailHighlight(title, value) {
  const selected = String(value ?? '').normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  if (selected.length !== 1) return '';
  const normalizeWord = (word) => String(word).normalize('NFC').toLocaleLowerCase('vi-VN').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  const wanted = normalizeWord(selected[0]);
  const titleWords = new Set(String(title).match(/[\p{L}\p{M}\p{N}]+/gu)?.map(normalizeWord) || []);
  return wanted && titleWords.has(wanted) ? selected[0] : '';
}

export function normalizeHashtags(value) {
  if (!Array.isArray(value)) throw new Error('Trường hashtags phải là một mảng.');
  const tags = [...new Set(value.map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => `#${item.replace(/^#+/u, '').replace(/[^\p{L}\p{N}_]/gu, '')}`)
    .filter((item) => item.length > 1 && !['#easyenglishshadowing', '#papershadowing', '#paperenglishshadowing', '#conotiengtrung'].includes(item.toLocaleLowerCase('en-US'))))];
  const brand = tags.find((item) => item.toLocaleLowerCase('en-US') === '#motphutvole');
  const withBrand = [...tags.filter((item) => item.toLocaleLowerCase('en-US') !== '#motphutvole'), brand || '#MotPhutVoLe'];
  return withBrand.slice(-5);
}

export function normalizeDeliveryStyle(value) {
  const source = String(value || '').normalize('NFC').trim().toLocaleLowerCase('vi-VN');
  if (['adaptive', 'natural', 'curious', 'warm', 'storytelling', 'gentle', 'expressive'].includes(source)) return source;
  if (/tò mò|khám phá|curious|explor/iu.test(source)) return 'curious';
  if (/trầm ấm|ấm áp|warm/iu.test(source)) return 'warm';
  if (/kể chuyện|story/iu.test(source)) return 'storytelling';
  if (/nhẹ nhàng|gentle/iu.test(source)) return 'gentle';
  if (/truyền cảm|express/iu.test(source)) return 'expressive';
  return 'natural';
}

export function normalizeTitle(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('vi-VN')
    .replace(/[“”"'‘’`]/gu, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

export function hashContent(value) {
  return crypto.createHash('sha256').update(String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim()).digest('hex');
}
