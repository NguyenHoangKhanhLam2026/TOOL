import { TOPICS, makeLocalScript } from '../topics.mjs';
import { db, getSettings, pickTopic, insertScript, log } from '../database/db.mjs';
import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { generateWithOllama } from './ollama.mjs';
import { assertDistinctFromHistory, validateScript } from './validator.mjs';
import { generateCaption } from './caption-service.mjs';
import fs from 'node:fs';

const SCRIPT_PROMPT = fs.readFileSync(new URL('../../packages/ai-engine/prompts/generate-script.md', import.meta.url), 'utf8');

function buildPrompt(topic, recent, settings, { autoTopic = false, previousTopics = [] } = {}) {
  const schema = {
    topic: autoTopic ? 'New, specific situation within the selected theme (Vietnamese)' : topic.title, category: topic.category, level: settings.level, title: 'Tiêu đề tiếng Việt ngắn',
    hook: 'Một câu mở đầu tiếng Việt', dialogues: [{ index: 1, vietnamese: '', english: '', term: '', meaningVi: '', noteVi: '', grammarNote: '' }],
    caption: '', hashtags: ['#HocTiengAnh'], thumbnailTitle: ''
  };
  const prompt = SCRIPT_PROMPT
    .replaceAll('{{topic}}', topic.title)
    .replaceAll('{{category}}', topic.category)
    .replaceAll('{{level}}', settings.level)
    .replaceAll('{{maxLineChars}}', String(settings.maxLineChars))
    .replaceAll('{{recent}}', recent.join(' | ') || 'chưa có')
    .replaceAll('{{schema}}', JSON.stringify(schema, null, 2));
  if (!autoTopic) return prompt;
  return `${prompt}\n\nAUTOMATIC TOPIC: Treat the selected topic as a broad seed. Invent a fresh, specific everyday situation under that theme and put that new situation in the JSON topic field. Avoid these previously used topic angles: ${previousTopics.slice(0, 50).join(' | ') || 'none'}. Do not simply reuse the broad seed title.`;
}

function parseJSON(text) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Provider không trả về JSON.');
  return JSON.parse(clean.slice(start, end + 1));
}

export async function createScript(topicId, { allowLocalTemplate = false } = {}) {
  const topic = topicId ? db.prepare('SELECT * FROM topics WHERE id=?').get(topicId) : pickTopic();
  if (!topic) throw new Error('Kh\u00f4ng c\u00f3 ch\u1ee7 \u0111\u1ec1 n\u00e0o \u0111\u1ec3 t\u1ea1o video.');
  const settings = getSettings();
  const historyRows = db.prepare('SELECT topic,dialogues_json FROM scripts ORDER BY created_at DESC').all();
  const history = historyRows.map((row) => JSON.parse(row.dialogues_json));
  const recent = history.flatMap((dialogues) => dialogues.map((dialogue) => dialogue.english)).slice(0, 30);
  const prompt = buildPrompt(topic, recent, settings, { autoTopic: !topicId, previousTopics: historyRows.map((row) => row.topic) });
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', (value) => generateWithChatGPT(value)]);
  providers.push(['ollama', (value) => generateWithOllama(value, settings)]);
  let script;
  let provider;
  const errors = [];
  for (const [name, call] of providers) {
    let repairPrompt = prompt;
    for (let attempt = 0; attempt < 3; attempt++) {
      let candidate;
      try {
        candidate = validateScript(parseJSON(await call(repairPrompt)), { maxLineChars: settings.maxLineChars });
        assertDistinctFromHistory(candidate, history);
        script = candidate;
        provider = name;
        break;
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
        log('WARN', 'AI_PROVIDER_FAILED', `${name} l\u1ea7n ${attempt + 1} kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c k\u1ecbch b\u1ea3n h\u1ee3p l\u1ec7: ${error.message}`);
        const rejected = candidate?.dialogues?.map((dialogue) => dialogue.english).join(' | ') || '';
        repairPrompt = `${prompt}\n\nKh\u00f4ng l\u1eb7p l\u1ea1i c\u00e1c c\u00e2u ti\u1ebfng Anh b\u1ecb lo\u1ea1i: ${rejected}\nH\u00e3y kh\u1eafc ph\u1ee5c l\u1ed7i n\u00e0y: ${error.message}\nTr\u1ea3 v\u1ec1 m\u1ed9t JSON h\u1ee3p l\u1ec7 c\u00f3 \u0111\u00fang ba c\u1eb7p c\u00e2u song ng\u1eef.`;
      }
    }
    if (script) break;
  }
  if (!script && allowLocalTemplate) {
    const candidate = validateScript(makeLocalScript(topic), { maxLineChars: settings.maxLineChars });
    script = assertDistinctFromHistory(candidate, history);
    provider = 'local-template';
  }
  if (!script) throw new Error(`Kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c k\u1ecbch b\u1ea3n m\u1edbi kh\u00f4ng tr\u00f9ng. H\u00e3y ki\u1ec3m tra k\u1ebft n\u1ed1i ChatGPT/Ollama r\u1ed3i th\u1eed l\u1ea1i. ${errors.join(' | ')}`);
  try {
    const caption = await generateCaption(script);
    script.caption = caption.caption;
    script.hashtags = caption.hashtags;
  } catch (error) {
    log('WARN', 'CAPTION_GENERATION_FALLBACK', `Caption generation failed: ${error.message}`);
  }
  const scriptId = insertScript(script, topic.id, provider);
  return { scriptId, provider, script };
}
export function providerStatus() {
  return {
    chatgptPlan: chatgptStatus(),
    ollama: { baseUrl: getSettings().ollamaBaseUrl, model: getSettings().ollamaModel, connected: null },
    topics: TOPICS.length,
    paidApiEnabled: false
  };
}
