import { generateWithChatGPT } from '../ai/chatgpt-plan.mjs';
import { TOPIC_GROUPS } from './catalog.mjs';
import {
  THINGS_NARRATION_SENTENCE_MAX, THINGS_NARRATION_SENTENCE_MIN,
  THINGS_NARRATION_WORD_MAX, THINGS_NARRATION_WORD_MIN,
  validateThingsYouDidntKnowCandidate, validateThingsYouDidntKnowScript
} from './content-validator.mjs';

export const THINGS_YOU_DIDNT_KNOW_OPENINGS = Object.freeze([
  'surprising-number', 'curious-question', 'imagine-scenario', 'myth-versus-fact', 'quick-quiz',
  'short-twist', 'meet-the-place', 'guess-prompt', 'life-comparison', 'verifiable-claim'
]);
export const THINGS_YOU_DIDNT_KNOW_INTERACTIONS = Object.freeze([
  'agree-disagree', 'knowledge-check', 'ab-poll', 'personal-experience', 'guess-quiz',
  'tag-a-friend', 'share-your-country', 'rate-one-to-ten'
]);

function parseJson(value, stage) {
  const source = String(value || '').trim().replace(/^\x60\x60\x60(?:json)?\s*/iu, '').replace(/\s*\x60\x60\x60$/u, '');
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw Object.assign(new Error(`ChatGPT trả về JSON không hợp lệ ở bước ${stage}.`), { code: 'TYDK_INVALID_JSON' }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`ChatGPT cần trả về một object JSON ở bước ${stage}.`);
  return parsed;
}

function topicText(themeId, requestedTheme) {
  return TOPIC_GROUPS.find((item) => item.id === themeId)?.name || requestedTheme || 'Daily life';
}

export async function generateThingsYouDidntKnowCandidate({ country, themeId = null, theme = null, exclusions = [], validationHint = '' }) {
  const topic = topicText(themeId, theme);
  const prompt = [
    'Return one JSON object only. Propose one unusual but low-risk, verifiable everyday-life fact about ' + country.name + ' (' + country.continent + ') in the topic group "' + topic + '".',
    'This app ChatGPT Plan adapter does not provide web search. Do not claim independent verification and never invent a quote, URL, organization, article title, or citation.',
    'Give likely source URLs only if you know a credible public page that directly supports the claim; the application fetches pages, but a person must review them.',
    'Avoid politics, religion, war, violence, disasters, medical/financial/legal advice, stereotypes, and claims about one country framed as universal.',
    'Required fields: factKey is a stable English key of 2–8 words; factText is one complete, nuanced English sentence of at least 8 words; supportingEvidence is a specific sentence stating what a credible source must establish; sources is an array with 1–3 credible public HTTPS pages and exact page titles you know. Never return schema placeholders or an empty field.',
    'Return exactly these keys: country, continent, theme, factKey, factText, supportingEvidence, sources. Each source object must contain url and title; publisher and evidence may be included only when known.',
    validationHint ? 'The previous answer was rejected by the field validator: ' + validationHint + ' Return a new, complete candidate that satisfies every required field.' : '',
    'Do not use any fact equivalent to these prior claims: ' + (exclusions.slice(0, 100).join(' | ') || 'none')
  ].join('\n');
  const parsed = parseJson(await generateWithChatGPT(prompt), 'chọn fact');
  const candidate = validateThingsYouDidntKnowCandidate(parsed, { country, theme: topic });
  return { ...candidate, themeId: themeId || null };
}

export async function generateThingsYouDidntKnowScript({ candidate, country, themeId, recentFormats = [] }) {
  const lastOpening = Number(recentFormats.filter((item) => item.kind === 'opening').at(-1)?.index ?? -1);
  const lastInteraction = Number(recentFormats.filter((item) => item.kind === 'interaction').at(-1)?.index ?? -1);
  const openingIndex = (lastOpening + 1) % THINGS_YOU_DIDNT_KNOW_OPENINGS.length;
  const interactionIndex = (lastInteraction + 1) % THINGS_YOU_DIDNT_KNOW_INTERACTIONS.length;
  const opening = THINGS_YOU_DIDNT_KNOW_OPENINGS[openingIndex];
  const interaction = THINGS_YOU_DIDNT_KNOW_INTERACTIONS[interactionIndex];
  const prompt = [
    'Return exactly one JSON object, with no Markdown or text outside JSON. Write an English Facebook Reel script for the Things You Didn\'t Know channel.',
    'Use only the supplied fact; do not add names, dates, numbers, explanations, or cultural generalizations that are not supported by it.',
    'Fact metadata is provisional because this request has no web-search tool. Keep source URLs exactly as provided and do not claim independent verification.',
    'Sources are application-managed evidence. Preserve the supplied source array if returning it; the application will attach the validated source array to the final script.',
    'Country: ' + country.name + '. Continent: ' + country.continent + '. Topic group: ' + candidate.theme + '. Opening style: ' + opening + '. Interaction style: ' + interaction + '.',
    'Fact key: ' + candidate.factKey + '. Fact text: ' + candidate.factText + '. Evidence target: ' + candidate.supportingEvidence + '. Source candidates: ' + JSON.stringify(candidate.sources),
    'Requirements: narration and imageBody must be exactly the same prose so word highlights follow Kokoro timing.',
    'Write the narration to be spoken aloud in a calm, conversational voice, not like a written article being read to the end.',
    'Give each sentence one clear idea that can be spoken in one breath. Put a period where a speaker would naturally pause; use commas only for short lists or brief asides. Avoid semicolons, parentheses, stacked clauses, and long comma chains.',
    'Vary sentence length slightly. Do not repeat the same fact in different words, pad the script, or add a generic CTA. The interaction style applies to the caption; ask a spoken question only when it naturally follows from the fact.',
    'Choose the narration length based on how much the supplied fact can support: aim for 50–65 words when useful context is supported, use 40–49 only when the fact is inherently simple, and use 66–80 only when those details make the fact clearer. Never add filler to reach a target.',
    `Narration/imageBody: ${THINGS_NARRATION_WORD_MIN}–${THINGS_NARRATION_WORD_MAX} English words counted by whitespace, ${THINGS_NARRATION_SENTENCE_MIN}–${THINGS_NARRATION_SENTENCE_MAX} short natural spoken sentences, at most 520 characters, no hashtags, emoji, bullets, or stage directions.`,
    'Caption: 70–90 words, storytelling tone, ends with one interactionQuestion of no more than 10 words, at most two question marks, no emoji. Aim for 75–82 words to leave a margin above the minimum; include the final interactionQuestion in the count.',
    'The video title must be concise: at most 5 words, one line, and at most 40 characters. Prefer 2–4 short words. Do not add a subtitle or line break.',
    'Exactly 10 unique relevant hashtags; first exactly #ThingsYouDidntKnow.',
    'Thumbnail headline 4–6 words, curiosity without revealing the full answer, with 2–3 exact highlight words contained in it.',
    'Use one story, gentle curiosity, and no clickbait. Avoid recent format choices: ' + (recentFormats.slice(-16).map((item) => item.kind + ':' + item.index).join(', ') || 'none'),
    'JSON schema: ' + JSON.stringify({
      country: country.name, continent: country.continent, theme: candidate.theme, factKey: candidate.factKey, factText: candidate.factText,
      title: '2-5 short words, one line, at most 40 characters', hook: 'opening hook', narration: `${THINGS_NARRATION_WORD_MIN}-${THINGS_NARRATION_WORD_MAX} spoken words in ${THINGS_NARRATION_SENTENCE_MIN}-${THINGS_NARRATION_SENTENCE_MAX} short sentences`, caption: '70-90 words ending with interaction question',
      interactionQuestion: 'short question', hashtags: ['#ThingsYouDidntKnow', '...9 more'], imageTitle: 'on-screen title',
      imageBody: 'exact same prose as narration', illustrationBrief: '2-3 visual motifs, no text or identifiable people',
      thumbnailHeadline: '4-6 words', thumbnailHighlights: ['word', 'word'], sources: candidate.sources,
      voiceStyle: 'warm, curious, conversational'
    })
  ].join('\n');
  let script;
  const corrections = [];
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let parsed;
    try {
      parsed = parseJson(await generateWithChatGPT([...prompt, ...corrections].filter(Boolean).join('\n\n')), 'viết kịch bản');
    } catch (error) {
      if (error.code !== 'TYDK_INVALID_JSON' || attempt === maxAttempts - 1) throw error;
      const correction = 'The previous answer was not valid JSON. Return exactly one complete JSON object matching the requested schema, with no Markdown or text outside it.';
      if (!corrections.includes(correction)) corrections.push(correction);
      continue;
    }
    try {
      script = validateThingsYouDidntKnowScript({
        ...parsed,
        country: country.name,
        continent: country.continent,
        theme: candidate.theme,
        factKey: candidate.factKey,
        factText: candidate.factText,
        sources: candidate.sources
      }, { candidate, country });
      break;
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      const correction = scriptCorrection(error);
      if (!correction) throw error;
      if (!corrections.includes(correction)) corrections.push(correction);
    }
  }
  return { ...script,
    openingStyleIndex: openingIndex, interactionStyleIndex: interactionIndex,
    openingStyle: opening, interactionStyle: interaction, themeId: themeId || 'daily-life' };
}

function scriptCorrection(error) {
  const detail = String(error.message || error);
  switch (error.code) {
    case 'TYDK_TITLE_LENGTH':
      return `The previous title failed validation: ${detail}. Rewrite only the title as one short line with at most 5 words and 40 characters. Keep the subject and preserve every other field.`;
    case 'TYDK_NARRATION_LENGTH':
    case 'TYDK_NARRATION_SENTENCE_COUNT':
      return `The previous narration failed validation: ${detail}. Rewrite only narration and identical imageBody to satisfy ${THINGS_NARRATION_WORD_MIN}–${THINGS_NARRATION_WORD_MAX} whitespace-separated words, ${THINGS_NARRATION_SENTENCE_MIN}–${THINGS_NARRATION_SENTENCE_MAX} short spoken sentences, and at most 520 characters. Preserve the supplied fact and do not add unsupported details.`;
    case 'TYDK_CAPTION_LENGTH':
      {
        const count = Number(error.wordCount) || 0;
        const adjustment = count < 75 ? `add at least ${75 - count} counted word${75 - count === 1 ? '' : 's'}` : `remove at least ${count - 82} counted word${count - 82 === 1 ? '' : 's'}`;
        return `The previous caption failed validation: ${detail}. Rewrite only caption to contain 75–82 words by the same English word counting used in validation (hard limit 70–90), counting its final interactionQuestion. It currently has ${count}; ${adjustment} to reach the target. Add or remove only concise, fact-supported wording before the existing final question; do not change narration, sources, or other fields.`;
      }
    case 'TYDK_CAPTION_INTERACTION':
      return `The previous caption failed validation: ${detail}. Rewrite caption and interactionQuestion together. Make interactionQuestion a natural question of at most 10 words, and make caption end with that exact question, including punctuation. Keep the caption at 75–82 words and add no unsupported claims.`;
    case 'TYDK_CAPTION_FORMAT':
      return `The previous caption failed validation: ${detail}. Rewrite only caption to have no emoji and at most two question marks, keep 75–82 words, and end with the exact interactionQuestion.`;
    case 'TYDK_REQUIRED_SCRIPT_FIELDS':
      return `The previous JSON omitted required fields: ${(error.fields || []).join(', ')}. Fill only those fields with concise, fact-consistent values and preserve all valid fields.`;
    case 'TYDK_NARRATION_IMAGE_MISMATCH':
    case 'TYDK_IMAGE_BODY_FORMAT':
      return `The previous narration/imageBody failed validation: ${detail}. Rewrite narration and imageBody as exactly identical clean prose, within ${THINGS_NARRATION_WORD_MIN}–${THINGS_NARRATION_WORD_MAX} words and ${THINGS_NARRATION_SENTENCE_MIN}–${THINGS_NARRATION_SENTENCE_MAX} sentences. Remove hashtags, emoji, and bullets.`;
    case 'TYDK_HASHTAGS':
      return `The previous hashtags failed validation: ${detail}. Rewrite only hashtags as exactly 10 unique relevant hashtags; the first must be exactly #ThingsYouDidntKnow.`;
    case 'TYDK_THUMBNAIL_FIELDS':
      return `The previous thumbnail fields failed validation: ${detail}. Rewrite only thumbnailHeadline to 4–6 words and thumbnailHighlights to 2–3 exact individual words appearing in that headline.`;
    default:
      return '';
  }
}
