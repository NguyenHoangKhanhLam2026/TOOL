export const BRAND_HASHTAG = '#sinhradenoitienganh';
export const CHINESE_BRAND_HASHTAG = '#conotiengtrung';

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;

export function ensureBrandHashtag(hashtags, contentLanguage = 'en') {
  if (contentLanguage === 'zh') {
    const unique = [];
    const seen = new Set([CHINESE_BRAND_HASHTAG]);
    const forbidden = new Set(['#tiengtrungchammachac', BRAND_HASHTAG]);
    const irrelevantEnglish = /^(english|learnenglish|tienganh|hoctienganh|englishlearning|englishvocabulary)/i;
    for (const value of Array.isArray(hashtags) ? hashtags : []) {
      const tag = String(value || '').trim();
      const key = tag.toLocaleLowerCase('vi');
      if (!/^#[\p{L}\p{N}_]+$/u.test(tag) || forbidden.has(key) || irrelevantEnglish.test(key.slice(1)) || seen.has(key)) continue;
      seen.add(key);
      unique.push(tag);
      if (unique.length === 4) break;
    }
    const fallbacks = ['#hoctiengtrung', '#tiengtrunggiaotiep', '#pinyin', '#tuvungtiengtrung'];
    for (const tag of fallbacks) {
      if (unique.length === 4) break;
      if (!seen.has(tag)) { seen.add(tag); unique.push(tag); }
    }
    return [...unique, CHINESE_BRAND_HASHTAG];
  }
  const unique = [];
  const seen = new Set();
  for (const value of Array.isArray(hashtags) ? hashtags : []) {
    const tag = String(value || '').trim();
    const key = tag.toLowerCase();
    if (!tag || key === BRAND_HASHTAG || seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }
  return [...unique, BRAND_HASHTAG];
}

function captionSections(value) {
  const paragraphs = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length >= 3) {
    return [paragraphs[0], paragraphs.slice(1, -1).join(' '), paragraphs.at(-1)].join('\n\n');
  }

  const sentences = paragraphs.join(' ').split(/(?<=[.!?])\s+|(?<=[.!?]["'”’»])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length >= 3) {
    return [sentences[0], sentences.slice(1, -1).join(' '), sentences.at(-1)].join('\n\n');
  }
  return paragraphs.join('\n\n');
}

export function formatCaption(caption, hashtags, contentLanguage = 'en') {
  const body = String(caption || '').replace(/\r\n?/g, '\n').trim();
  const embedded = body.match(HASHTAG_PATTERN) || [];
  const cleanBody = captionSections(body.replace(HASHTAG_PATTERN, ' ').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  const tags = ensureBrandHashtag([...(Array.isArray(hashtags) ? hashtags : []), ...embedded], contentLanguage);
  return cleanBody ? `${cleanBody}\n\n${tags.join(' ')}` : tags.join(' ');
}
