/**
 * Content-only narration profiles measured from the four sample videos.
 * Rates are private synthesis values; the user chooses only the voice.
 */
export const ENGLISH_SHADOWING_DELIVERY_STYLES = Object.freeze({
  balanced: Object.freeze({
    targetWordsPerMinute: 130.2, modelRate: 0.8, sentencePauseSeconds: 0.54,
    tone: 'clear and friendly', direction: 'Speak clearly with a relaxed, even delivery.'
  }),
  calm: Object.freeze({
    targetWordsPerMinute: 130.2, modelRate: 0.8, sentencePauseSeconds: 0.54,
    tone: 'warm and reassuring', direction: 'Keep the advice gentle, grounded, and easy to follow.'
  }),
  uplifting: Object.freeze({
    targetWordsPerMinute: 130.2, modelRate: 0.8, sentencePauseSeconds: 0.54,
    tone: 'bright and encouraging', direction: 'Sound hopeful and lively, with a light lift on positive ideas.'
  }),
  measured: Object.freeze({
    targetWordsPerMinute: 130.2, modelRate: 0.8, sentencePauseSeconds: 0.54,
    tone: 'composed and credible', direction: 'Deliver the reasoning deliberately and let results land clearly.'
  }),
  conversational: Object.freeze({
    targetWordsPerMinute: 130.2, modelRate: 0.8, sentencePauseSeconds: 0.54,
    tone: 'natural and considerate', direction: 'Keep it polite and responsive, like a real workplace conversation.'
  })
});

const KNOWN_STYLES = new Set(Object.keys(ENGLISH_SHADOWING_DELIVERY_STYLES));

export const ENGLISH_SHADOWING_NARRATION_VERSION = 'spoken-flow-v2';

// Existing scripts without a narration version keep their original segmented
// synthesis and fixed-pace render path.
const SENTENCE_RATES = Object.freeze({
  balanced: Object.freeze({ 'opening-question': 0.8, 'opening-hook': 0.8, explanation: 0.8, 'connected-list': 0.82, contrast: 0.78, 'punchy-emphasis': 0.78, 'closing-takeaway': 0.77 }),
  calm: Object.freeze({ 'opening-question': 0.78, 'opening-hook': 0.78, explanation: 0.8, 'connected-list': 0.82, contrast: 0.78, 'punchy-emphasis': 0.78, 'closing-takeaway': 0.77 }),
  uplifting: Object.freeze({ 'opening-question': 0.82, 'opening-hook': 0.84, explanation: 0.8, 'connected-list': 0.84, contrast: 0.83, 'punchy-emphasis': 0.84, 'closing-takeaway': 0.78 }),
  measured: Object.freeze({ 'opening-question': 0.78, 'opening-hook': 0.79, explanation: 0.8, 'connected-list': 0.82, contrast: 0.78, 'punchy-emphasis': 0.78, 'closing-takeaway': 0.77 }),
  conversational: Object.freeze({ 'opening-question': 0.83, 'opening-hook': 0.84, explanation: 0.8, 'connected-list': 0.84, contrast: 0.82, 'punchy-emphasis': 0.83, 'closing-takeaway': 0.78 })
});

const INTENT_PAUSE_OFFSETS = Object.freeze({
  balanced: Object.freeze({ 'opening-question': 0, 'opening-hook': -0.06, explanation: 0, 'connected-list': 0.03, contrast: 0.08, 'punchy-emphasis': 0.04, 'closing-takeaway': 0.1 }),
  calm: Object.freeze({ 'opening-question': 0.02, 'opening-hook': -0.07, explanation: 0, 'connected-list': 0.03, contrast: 0.05, 'punchy-emphasis': 0.02, 'closing-takeaway': 0.12 }),
  uplifting: Object.freeze({ 'opening-question': 0.01, 'opening-hook': -0.06, explanation: 0, 'connected-list': 0.03, contrast: 0.07, 'punchy-emphasis': 0.02, 'closing-takeaway': 0.1 }),
  measured: Object.freeze({ 'opening-question': 0.02, 'opening-hook': -0.04, explanation: 0.01, 'connected-list': 0.03, contrast: 0.1, 'punchy-emphasis': 0.03, 'closing-takeaway': 0.12 }),
  conversational: Object.freeze({ 'opening-question': 0.03, 'opening-hook': -0.06, explanation: -0.01, 'connected-list': 0.02, contrast: 0.05, 'punchy-emphasis': 0.03, 'closing-takeaway': 0.08 })
});

export function inferEnglishShadowingDeliveryStyle({ title = '', topic = '', scriptText = '' } = {}) {
  const text = `${title} ${topic} ${scriptText}`.toLowerCase();
  if (/phone|caller|call |confirmation|instructions|speaks? too fast|workplace communication|polite phrasing/u.test(text)) return 'conversational';
  if (/candidate|interview|resume|churn|retention|revenue|business strategy|product team|career|professional/u.test(text)) return 'measured';
  if (/wellness|health|healthy|habits?|sleep|nutrition|movement|restful|wholesome/u.test(text)) return 'calm';
  if (/\bage\b|dreams?|joy|curios|learning|mindset|young at heart|life.{0,20}lighter/u.test(text)) return 'uplifting';
  return 'balanced';
}

export function resolveEnglishShadowingDeliveryStyle(value, content = {}) {
  const requested = String(value || '').trim().toLowerCase();
  const inferred = inferEnglishShadowingDeliveryStyle(content);
  if (inferred !== 'balanced') return inferred;
  return KNOWN_STYLES.has(requested) ? requested : inferEnglishShadowingDeliveryStyle(content);
}

export function getEnglishShadowingDeliveryProfile(style, content = {}) {
  const id = resolveEnglishShadowingDeliveryStyle(style, content);
  const baseline = ENGLISH_SHADOWING_DELIVERY_STYLES.balanced;
  return Object.freeze({ id, ...(ENGLISH_SHADOWING_DELIVERY_STYLES[id] || baseline) });
}

function sentencePause(sentence, style, intent) {
  const base = ENGLISH_SHADOWING_DELIVERY_STYLES[style].sentencePauseSeconds;
  const intentOffset = INTENT_PAUSE_OFFSETS[style]?.[intent] || 0;
  const trimmed = String(sentence).trim();
  const punctuationAdjustment = /\?$/u.test(trimmed) ? 0.08
    : /!$/u.test(trimmed) ? 0.04
      : /[:;]$/u.test(trimmed) ? -0.12
        : 0;
  return Math.round(Math.max(0.35, Math.min(0.9, base + punctuationAdjustment + intentOffset)) * 100) / 100;
}

function sentenceIntent(sentence, index, total) {
  const trimmed = String(sentence).trim();
  if (index === 0) return /\?$/u.test(trimmed) ? 'opening-question' : 'opening-hook';
  if (index === total - 1) return 'closing-takeaway';
  if (/\b(but|instead|yet|rather|although|however)\b/iu.test(trimmed)) return 'contrast';
  if ((trimmed.match(/[,;]/gu) || []).length >= 2) return 'connected-list';
  if (trimmed.split(/\s+/u).length <= 7 || /!$/u.test(trimmed)) return 'punchy-emphasis';
  return 'explanation';
}

export function buildEnglishShadowingSentencePlan(sentences, style = 'balanced') {
  const selectedStyle = resolveEnglishShadowingDeliveryStyle(style);
  const delivery = ENGLISH_SHADOWING_DELIVERY_STYLES[selectedStyle];
  const normalized = (Array.isArray(sentences) ? sentences : [])
    .map((sentence) => String(sentence || '').trim())
    .filter(Boolean);
  return normalized.map((text, order) => {
    const intent = sentenceIntent(text, order, normalized.length);
    const nativeModelRate = SENTENCE_RATES[selectedStyle]?.[intent] ?? delivery.modelRate;
    return {
      segmentId: `shadowing-sentence-${order + 1}`,
      order,
      language: 'en',
      text,
      speechText: text,
      deliveryStyle: selectedStyle,
      tone: delivery.tone,
      narrationDirection: delivery.direction,
      targetWordsPerMinute: delivery.targetWordsPerMinute,
      nativeModelRate,
      rate: nativeModelRate,
      sentenceIntent: intent,
      pauseAfterSeconds: order < normalized.length - 1 ? sentencePause(text, selectedStyle, intent) : 0
    };
  });
}

export function buildEnglishShadowingNarrationSegment(text, style = 'balanced') {
  const selectedStyle = resolveEnglishShadowingDeliveryStyle(style);
  const delivery = ENGLISH_SHADOWING_DELIVERY_STYLES[selectedStyle];
  const speechText = String(text || '').replace(/\s+/gu, ' ').trim();
  return {
    segmentId: 'shadowing-spoken-flow-v2',
    order: 0,
    language: 'en',
    text: speechText,
    speechText,
    narrationVersion: ENGLISH_SHADOWING_NARRATION_VERSION,
    paceMode: 'source',
    deliveryStyle: selectedStyle,
    tone: delivery.tone,
    narrationDirection: delivery.direction,
    nativeModelRate: delivery.modelRate,
    rate: delivery.modelRate,
    pauseAfterSeconds: 0
  };
}

export function usesEnglishShadowingSpokenFlow(script) {
  return Array.isArray(script?.speechSegments)
    && script.speechSegments.some((segment) => segment?.narrationVersion === ENGLISH_SHADOWING_NARRATION_VERSION);
}

