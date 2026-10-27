import { normalizeHashtags } from './content-validator.mjs';

export function normalizeMotPhutVoLeDelivery({ caption = '', hashtags = [] } = {}) {
  const cleanCaption = String(caption || '').normalize('NFC').trim().slice(0, 2200);
  const cleanHashtags = normalizeHashtags(Array.isArray(hashtags) ? hashtags : []);
  return Object.freeze({ caption: cleanCaption, hashtags: cleanHashtags, text: [cleanCaption, cleanHashtags.join(' ')].filter(Boolean).join('\n') });
}

export function updateMotPhutVoLeCaption(content, caption, hashtags = content?.hashtags || []) {
  return { ...content, ...normalizeMotPhutVoLeDelivery({ caption, hashtags }) };
}
