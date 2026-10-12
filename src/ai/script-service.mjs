import { TOPICS, makeLocalScript } from '../topics.mjs';
import { db, getSettings, pickTopic, insertScript, log } from '../database/db.mjs';
import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { generateWithOllama } from './ollama.mjs';
import { assertDistinctFromRecent, validateScript } from './validator.mjs';
import fs from 'node:fs';

const SCRIPT_PROMPT = fs.readFileSync(new URL('../../packages/ai-engine/prompts/generate-script.md', import.meta.url), 'utf8');

function buildPrompt(topic, recent, settings) {
  const schema = {
    topic: topic.title, category: topic.category, level: settings.level, title: 'Tiêu đề tiếng Việt ngắn',
    hook: 'Một câu mở đầu tiếng Việt', dialogues: [{ index: 1, vietnamese: '', english: '', term: '', meaningVi: '', noteVi: '', grammarNote: '' }],
    caption: '', hashtags: ['#HocTiengAnh'], thumbnailTitle: ''
  };
  return SCRIPT_PROMPT
    .replaceAll('{{topic}}', topic.title)
    .replaceAll('{{category}}', topic.category)
    .replaceAll('{{level}}', settings.level)
    .replaceAll('{{maxLineChars}}', String(settings.maxLineChars))
    .replaceAll('{{recent}}', recent.join(' | ') || 'chưa có')
    .replaceAll('{{schema}}', JSON.stringify(schema, null, 2));
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
  if (!topic) throw new Error('Không tìm thấy chủ đề.');
  const settings = getSettings();
  const recent = db.prepare('SELECT dialogues_json FROM scripts ORDER BY created_at DESC LIMIT 30').all()
    .flatMap((row) => JSON.parse(row.dialogues_json).map((d) => d.english)).slice(0, 30);
  const prompt = buildPrompt(topic, recent, settings);
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', (value) => generateWithChatGPT(value)]);
  providers.push(['ollama', (value) => generateWithOllama(value, settings)]);
  let script;
  let provider;
  const errors = [];
  for (const [name, call] of providers) {
    let repairPrompt = prompt;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        script = assertDistinctFromRecent(validateScript(parseJSON(await call(repairPrompt)), { maxLineChars: settings.maxLineChars }), recent);
        provider = name;
        break;
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
        log('WARN', 'AI_PROVIDER_FAILED', `${name} lần ${attempt + 1} không tạo được kịch bản hợp lệ: ${error.message}`);
        repairPrompt = `${prompt}\n\nSửa lại JSON. Lỗi cần khắc phục: ${error.message}. Trả về đúng JSON object, vẫn đúng 3 cặp câu.`;
      }
    }
    if (script) break;
  }
  if (!script && allowLocalTemplate) {
    script = assertDistinctFromRecent(validateScript(makeLocalScript(topic), { maxLineChars: settings.maxLineChars }), recent);
    provider = 'local-template';
  }
  if (!script) throw new Error(`Không có AI provider khả dụng. Kết nối ChatGPT plan hoặc khởi động Ollama. ${errors.join(' | ')}`);
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
