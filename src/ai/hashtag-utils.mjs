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

export function formatCaption(caption, hashtags) {
  const body = String(caption || '').trim();
  const embedded = body.match(HASHTAG_PATTERN) || [];
  const cleanBody = body.replace(HASHTAG_PATTERN, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const tags = ensureBrandHashtag([...(Array.isArray(hashtags) ? hashtags : []), ...embedded]);
  return cleanBody ? `${cleanBody}\n\n${tags.join(' ')}` : tags.join(' ');
}
