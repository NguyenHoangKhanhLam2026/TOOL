import { ENGLISH_SHADOWING_REFERENCE_SAMPLES, ENGLISH_SHADOWING_HASHTAG } from './catalog.mjs';
import { resolveEnglishShadowingDeliveryStyle } from './delivery.mjs';

const sampleDirections = ENGLISH_SHADOWING_REFERENCE_SAMPLES.map(({ id, topic, captionTitle, caption, hashtags }) =>
  `- ${id} — ${captionTitle}: ${topic}. Caption idea: ${caption} Suggested tags: ${hashtags.join(' ')}`
).join('\n');

export function buildEnglishShadowingPrompt({ topic = '', recentTitles = [] } = {}) {
  const requestedTopic = String(topic || '').trim();
  const recent = [...new Set((Array.isArray(recentTitles) ? recentTitles : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))].slice(0, 20);

  return [
    'Create one original EnglishShadowing lesson for a short vertical spoken-English shadowing video.',
    '',
    'The four reference videos are examples of lesson structure, spoken delivery, and pacing. Their topics are examples only, not a topic whitelist:',
    sampleDirections,
    '',
    'Follow the reference method, not their exact topics or sentences. Choose a fresh idea from the full range of everyday life, work, study, travel, money, relationships, technology, communication, health, hobbies, culture, or other useful real-world subjects. Do not limit new lessons to the four reference topics. Share one practical or relatable idea as a coherent spoken passage. Let the final sentence complete the thought naturally; add a takeaway only when it fits. For interview content, connect a concrete action to a measurable result. For workplace language, model polite natural phrasing. For wellness or mindset topics, keep claims moderate and practical.',
    'The on-screen lesson is English-only. Do not create Vietnamese translations, dialogue turns, vocabulary cards, scene directions, or stage labels.',
    `Write a fresh lesson of 55-80 spoken words in 4-7 natural sentences. Make it sound like one person sharing a useful thought or a believable everyday moment with another person. Use concrete details and natural spoken phrasing; contractions are welcome when they fit. Let each sentence lead into the next. Vary sentence length and use a short sentence when the idea calls for one. Do not force a hook, a contrast beat, or a motivational closing line. Remove filler, repeated conclusions, formal wording, and sentences added only to hit a word target. Let punctuation support natural phrasing without artificial pauses. Choose deliveryStyle to fit the topic: calm for practical wellness, uplifting for mindset and curiosity, measured for career or business advice, conversational for phone and workplace language.`,
    'The video displays the complete lesson text at once and highlights one spoken word at a time. Keep the title short enough for a single line when practical.',
    'Write a social caption of 2–4 concise sentences that summarizes the lesson without repeating the full script. Include relevant topic hashtags and the exact brand hashtag ' + ENGLISH_SHADOWING_HASHTAG + '. Never use #PaperEnglishShadowing.',
    'Return only one valid JSON object with these fields: title, topic, scriptText, caption, hashtags, deliveryStyle. deliveryStyle must be exactly one of: calm, uplifting, measured, conversational. Do not wrap the JSON in markdown.',
    requestedTopic ? `Requested topic: ${requestedTopic}` : 'Choose a fresh topic within one of the reference families.',
    recent.length ? `Avoid repeating these recent titles or near-identical angles: ${recent.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
}

export function parseEnglishShadowingCandidate(value) {
  const raw = String(value || '').trim();
  const unwrapped = raw.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  let candidate;
  try { candidate = JSON.parse(unwrapped); }
  catch { throw new Error('EnglishShadowing: AI không trả về JSON hợp lệ.'); }

  const title = String(candidate.title || '').trim();
  const topic = String(candidate.topic || '').trim();
  const scriptText = String(candidate.scriptText || '').replace(/\s+/gu, ' ').trim();
  const caption = String(candidate.caption || '').trim();
  const hashtags = Array.isArray(candidate.hashtags)
    ? candidate.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const words = scriptText.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/gu) || [];

  if (!title || title.length > 72) throw new Error('EnglishShadowing: tiêu đề phải có từ 1 đến 72 ký tự.');
  if (!topic || topic.length > 160) throw new Error('EnglishShadowing: chủ đề phải có từ 1 đến 160 ký tự.');
  if (words.length < 55 || words.length > 80) throw new Error(`EnglishShadowing: lời đọc có ${words.length} từ; cần từ 55 đến 80 từ theo độ dài mẫu.`);
  if (!caption || caption.length > 1200) throw new Error('EnglishShadowing: caption đang trống hoặc quá dài.');
  if (!hashtags.some((tag) => ['#easyenglishshadowing', '#englishshadowing', '#paperenglishshadowing'].includes(tag.toLowerCase()))) hashtags.push(ENGLISH_SHADOWING_HASHTAG);
  const normalizedHashtags = [...new Set(hashtags.map((tag) => ['#paperenglishshadowing', '#englishshadowing'].includes(tag.toLowerCase()) ? ENGLISH_SHADOWING_HASHTAG : tag))];

  const deliveryStyle = resolveEnglishShadowingDeliveryStyle(candidate.deliveryStyle, { title, topic, scriptText });
  return { title, topic, scriptText, caption, hashtags: normalizedHashtags, deliveryStyle };
}
