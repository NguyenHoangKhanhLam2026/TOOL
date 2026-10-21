import { ENGLISH_SHADOWING_HASHTAG, normalizeEnglishShadowingHashtags } from './catalog.mjs';

const TAG_PATTERN = /#[\p{L}\p{N}_]+/gu;

/**
 * Format only EnglishShadowing captions. The shared EN/ZH formatter remains
 * responsible for its existing brand tags and copy rules.
 */
export function formatEnglishShadowingCaption(caption = '', hashtags = []) {
  const source = String(caption || '').trim();
  const inlineTags = source.match(TAG_PATTERN) || [];
  const body = source.replace(TAG_PATTERN, '').replace(/[ \t]{2,}/gu, ' ').replace(/\s+([,.!?;:])/gu, '$1').trim();
  const tags = normalizeEnglishShadowingHashtags([
    ...inlineTags,
    ...(Array.isArray(hashtags) ? hashtags : [])
  ]).filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag));
  if (!tags.some((tag) => tag.toLowerCase() === ENGLISH_SHADOWING_HASHTAG.toLowerCase())) tags.push(ENGLISH_SHADOWING_HASHTAG);
  const uniqueTags = [...new Map(tags.map((tag) => [tag.toLowerCase(), tag])).values()];
  return [body, uniqueTags.join(' ')].filter(Boolean).join('\n\n');
}

export function normalizeEnglishShadowingCaptionData(caption = '', hashtags = []) {
  const formatted = formatEnglishShadowingCaption(caption, hashtags);
  const tags = formatted.match(TAG_PATTERN) || [ENGLISH_SHADOWING_HASHTAG];
  const body = formatted.replace(TAG_PATTERN, '').trim();
  return { caption: body, hashtags: tags, captionText: formatted };
}
