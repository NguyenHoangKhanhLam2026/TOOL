export const BRAND_HASHTAG = '#sinhradenoitienganh';

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;

export function ensureBrandHashtag(hashtags) {
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

export function formatCaption(caption, hashtags) {
  const body = String(caption || '').replace(/\r\n?/g, '\n').trim();
  const embedded = body.match(HASHTAG_PATTERN) || [];
  const cleanBody = captionSections(body.replace(HASHTAG_PATTERN, ' ').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  const tags = ensureBrandHashtag([...(Array.isArray(hashtags) ? hashtags : []), ...embedded]);
  return cleanBody ? `${cleanBody}\n\n${tags.join(' ')}` : tags.join(' ');
}
