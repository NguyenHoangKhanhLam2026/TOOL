import { TOPICS, makeLocalScript } from '../topics.mjs';
import { db, getSettings, pickTopic, insertScript, log } from '../database/db.mjs';
import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { assertDistinctFromHistory, validateScript } from './validator.mjs';
import { generateCaption } from './caption-service.mjs';
import { assertChineseReviewResponse, buildChineseReviewPrompt } from './chinese-quality.mjs';
import fs from 'node:fs';

const SCRIPT_PROMPT = fs.readFileSync(new URL('../../packages/ai-engine/prompts/generate-script.md', import.meta.url), 'utf8');

const CHINESE_PRESENTATION_STYLES = ['inline-meaning', 'dialogue-cards', 'numbered-scenario', 'inline-keyphrase'];

function chineseLessonCount(presentationStyle) {
  if (presentationStyle === 'numbered-scenario') return 3;
  if (presentationStyle === 'dialogue-cards') return 2;
  return 1;
}

function buildPrompt(topic, recent, settings, { autoTopic = false, previousTopics = [], contentLanguage = 'en', presentationStyle = 'inline-meaning' } = {}) {
  if (contentLanguage === 'zh') {
    const lessonCount = chineseLessonCount(presentationStyle);
    const schema = {
      topic: topic.title, category: topic.category, level: settings.level,
      title: 'Tiêu đề ngắn bằng tiếng Việt', hook: 'Mở đầu tiếng Việt tự nhiên',
      presentationStyle,
      lessons: Array.from({ length: lessonCount }, (_, index) => ({
        index: index + 1,
        chinese: 'Một câu tự nhiên bằng chữ Hán giản thể, không kèm Pinyin',
        pinyin: 'Pinyin có dấu thanh cho toàn bộ câu',
        vietnamese: 'Bản dịch tiếng Việt tự nhiên', term: 'Cụm chữ Hán trọng tâm được chép nguyên văn từ câu',
        termPinyin: 'Pinyin có dấu thanh của cụm trọng tâm', meaningVi: 'Nghĩa tiếng Việt ngắn',
        noteVi: 'Giải thích cách dùng bằng tiếng Việt', grammarNote: 'Ghi chú ngữ pháp tiếng Việt ngắn', scene: 'Bối cảnh đời thường cụ thể'
      })),
      scenes: [{ description: 'Mô tả ngắn bối cảnh hình ảnh bằng tiếng Việt' }],
      thumbnailTitle: 'Tiêu đề thumbnail tiếng Việt'
    };
    const styleInstructions = {
      'dialogue-cards': 'Create exactly two consecutive turns in one short, natural everyday conversation. Turn 1 is a concise Vietnamese question or request with its faithful Simplified Chinese translation; turn 2 is a natural Vietnamese reply with its faithful Chinese translation. Keep each Chinese sentence at most 12 Hanzi. Do not add vocabulary explanations; the video supplies repeat pauses.',
      'numbered-scenario': 'Create exactly three consecutive, natural beats in one practical everyday scenario. Each beat has one Vietnamese line of at most 6 words, one Chinese sentence of at most 5 Hanzi, one key phrase copied from that sentence, and a very short Vietnamese meaning/use note. Keep meaningVi plus noteVi to at most 4 Vietnamese words total and leave grammarNote empty. The video repeats each Chinese line twice, so make every beat very brief.',
      'inline-meaning': 'Create exactly one practical spoken sentence. Keep the Vietnamese source to at most 12 words and the Chinese translation to one sentence of at most 16 Hanzi. The Vietnamese source is shown in a card; the Chinese translation is a direct text line below it, without a filled Chinese card. Include one accurate, concise explanation of the key phrase.',
      'inline-keyphrase': 'Create exactly one practical spoken sentence. Keep the Vietnamese source to at most 12 words and the Chinese translation to one sentence of at most 16 Hanzi. The Vietnamese source is shown in a card; the Chinese translation is a direct text line below it, without a filled Chinese card. Choose one memorable key phrase that appears exactly in the sentence and explain it briefly; do not add spoken word-tracking or highlight instructions.'
    }[presentationStyle];
    return `Create a practical Vietnamese–Simplified Chinese learning video for a beginner. Return valid JSON only, matching this schema: ${JSON.stringify(schema)}\n` +
      `Presentation style: ${presentationStyle}. ${styleInstructions}\n` +
      `Requirements: return exactly ${lessonCount} items in lessons. Each lessons[].chinese value must be a single short spoken sentence, with no newline or second sentence; obey the Hanzi limit for its presentation style. Use natural Simplified Chinese only and never insert Pinyin there. Provide standard Hanyu Pinyin for every full Chinese sentence and key phrase, mark lexical tones, allow unmarked neutral tones, and count syllables with the normal 儿化 exception where 儿 joins the preceding syllable. Make every Vietnamese translation faithful, and explain only verified meanings and usage within the style word limits. Write Chinese as natural spoken dialogue, not a textbook definition. Use punctuation that matches sentence intent, including a question mark for genuine questions. Never put Pinyin, pronunciation notes, bracketed stage directions, or voice instructions inside text to be spoken. Do not include any follow, subscribe, or follow-the-channel call to action in the title, hook, spoken content, or caption. The video must end when the final lesson speech ends. Do not generate English learning content, Japanese, Traditional Chinese, or invented facts. Provide 2–4 relevant scene descriptions in Vietnamese. Keep title, hook, explanation, and thumbnail text in Vietnamese.\n` +
      `Avoid Chinese phrases and lesson angles similar to these saved Chinese lessons: ${recent.join(' | ') || 'none'}.` +
      (autoTopic ? `\nTreat the selected topic as a broad seed and invent a fresh specific situation. Avoid previous angles: ${previousTopics.slice(0, 50).join(' | ') || 'none'}.` : '');
  }
  if (contentLanguage === 'ja') {
    const languageName = contentLanguage === 'ja' ? 'Japanese' : 'Simplified Chinese';
    const field = contentLanguage === 'ja' ? 'japanese' : 'chinese';
    const schema = { topic: topic.title, category: topic.category, level: settings.level, title: 'Vietnamese title', hook: 'Vietnamese hook', dialogues: [1, 2, 3].map((index) => ({ index, vietnamese: '', [field]: '', term: '', meaningVi: '', noteVi: '', grammarNote: '' })), caption: '', hashtags: [], thumbnailTitle: '' };
    return `Create a practical beginner-friendly Vietnamese–${languageName} speaking lesson about the selected everyday topic. Reply with valid JSON only. Use natural spoken ${languageName} in the ${field} field and never put English in it.\n` +
      `Schema: ${JSON.stringify(schema)}\n` +
      `Requirements: exactly three dialogues indexed 1, 2, 3; every Vietnamese dialogue line has 7–10 Vietnamese words; every ${field} value is one natural spoken sentence; term is a useful ${languageName} phrase copied exactly from that sentence; meaningVi and noteVi explain it in Vietnamese; do not put romanization in the ${field} field.\n` +
      `Do not reuse recent ${languageName} lines or phrases: ${recent.join(' | ') || 'none'}.` +
      (autoTopic ? `\nTreat the selected topic as a broad seed and invent a fresh specific situation. Avoid: ${previousTopics.slice(0, 50).join(' | ') || 'none'}.` : '');
  }
  const schema = {
    topic: autoTopic ? 'New, specific situation within the selected theme (Vietnamese)' : topic.title, category: topic.category, level: settings.level, title: 'Tiêu đề tiếng Việt ngắn',
    hook: 'Một câu mở đầu tiếng Việt', dialogues: [1, 2, 3].map((index) => ({ index, vietnamese: '', english: '', term: '', meaningVi: '', noteVi: '', grammarNote: '' })),
    caption: '', hashtags: ['#HocTiengAnh'], thumbnailTitle: ''
  };
  const prompt = SCRIPT_PROMPT
    .replaceAll('{{topic}}', topic.title)
    .replaceAll('{{category}}', topic.category)
    .replaceAll('{{level}}', settings.level)
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

export async function reviewChineseScript(script) {
  assertChineseReviewResponse(await generateWithChatGPT(buildChineseReviewPrompt(script)));
  log('INFO', 'ZH_SCRIPT_QA_PASSED', `Kịch bản và caption tiếng Trung đã qua kiểm tra nội dung, dịch nghĩa và Pinyin.`);
  return script;
}

export async function createScript(topicId, { allowLocalTemplate = false, contentLanguage = 'en', presentationStyle = null } = {}) {
  const topic = topicId ? db.prepare('SELECT * FROM topics WHERE id=?').get(topicId) : pickTopic();
  if (!topic) throw new Error('Kh\u00f4ng c\u00f3 ch\u1ee7 \u0111\u1ec1 n\u00e0o \u0111\u1ec3 t\u1ea1o video.');
  const settings = getSettings();
  const historyRows = db.prepare('SELECT topic,dialogues_json,speech_segments_json,content_language FROM scripts ORDER BY created_at DESC').all();
  const savedChineseStyles = historyRows
    .filter((row) => row.content_language === 'zh')
    .map((row) => JSON.parse(row.dialogues_json || '[]')[0]?.presentationStyle)
    .filter((style) => CHINESE_PRESENTATION_STYLES.includes(style));
  const latestSavedChineseStyle = savedChineseStyles[0] || null;
  const latestSavedStyleIndex = CHINESE_PRESENTATION_STYLES.indexOf(latestSavedChineseStyle);
  const nextChineseStyle = latestSavedStyleIndex < 0
    ? CHINESE_PRESENTATION_STYLES[0]
    : CHINESE_PRESENTATION_STYLES[(latestSavedStyleIndex + 1) % CHINESE_PRESENTATION_STYLES.length];
  const selectedChineseStyle = contentLanguage === 'zh'
    ? (CHINESE_PRESENTATION_STYLES.includes(presentationStyle) ? presentationStyle : nextChineseStyle)
    : null;
  const history = historyRows.map((row) => ({
    dialogues: JSON.parse(row.dialogues_json),
    speechSegments: JSON.parse(row.speech_segments_json || '[]'),
    contentLanguage: row.content_language || 'en'
  }));
  const targetField = contentLanguage === 'ja' ? 'japanese' : contentLanguage === 'zh' ? 'chinese' : 'english';
  const recent = contentLanguage === 'en' ? history.flatMap((item) => [
    ...item.dialogues.flatMap((dialogue) => [dialogue.english, ...(dialogue.turns || []).filter((turn) => /^(en|english)(?:-|$)/i.test(turn.language || '')).map((turn) => turn.text)]),
    ...item.speechSegments.filter((segment) => /^(en|english)(?:-|$)/i.test(segment.language || '')).map((segment) => segment.text)
  ]).filter(Boolean).slice(0, 30) : history.flatMap((item) => item.dialogues.map((dialogue) => dialogue[targetField]).filter(Boolean)).slice(0, 30);
  const prompt = buildPrompt(topic, recent, settings, { autoTopic: !topicId, previousTopics: historyRows.map((row) => row.topic), contentLanguage, presentationStyle: selectedChineseStyle || undefined });
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', (value) => generateWithChatGPT(value)]);
  let script;
  let provider;
  const errors = [];
  for (const [name, call] of providers) {
    let repairPrompt = prompt;
    for (let attempt = 0; attempt < 3; attempt++) {
      let candidate;
      try {
        candidate = validateScript(parseJSON(await call(repairPrompt)), { contentLanguage });
        assertDistinctFromHistory(candidate, history);
        if (contentLanguage === 'zh') {
          const caption = await generateCaption(candidate);
          candidate.caption = caption.caption;
          candidate.hashtags = caption.hashtags;
          await reviewChineseScript(candidate);
        }
        script = candidate;
        provider = name;
        break;
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
        log('WARN', 'AI_PROVIDER_FAILED', `${name} l\u1ea7n ${attempt + 1} kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c k\u1ecbch b\u1ea3n h\u1ee3p l\u1ec7: ${error.message}`);
        const rejected = [
          ...(candidate?.lessons || candidate?.dialogues || []).flatMap((dialogue) => [dialogue[targetField], dialogue.chinese, ...(dialogue.turns || []).map((turn) => turn.text)]),
          ...(candidate?.speechSegments || candidate?.audioSegments || []).map((segment) => segment.text)
        ].filter(Boolean).join(' | ');
        const outputShape = contentLanguage === 'zh'
          ? `Return exactly ${chineseLessonCount(selectedChineseStyle)} items in lessons, with presentationStyle set to ${selectedChineseStyle}.`
          : 'Return valid JSON with exactly three items in dialogues, indexed 1, 2, 3. Never add a fourth item.';
        repairPrompt = `${prompt}\n\nDo not repeat rejected ${contentLanguage === 'en' ? 'English' : contentLanguage === 'ja' ? 'Japanese' : 'Chinese'} lines: ${rejected}\nFix this validation error: ${error.message}\n${outputShape}`;
      }
    }
    if (script) break;
  }
  if (!script && allowLocalTemplate && contentLanguage === 'en') {
    const candidate = validateScript(makeLocalScript(topic), { contentLanguage });
    script = assertDistinctFromHistory(candidate, history);
    provider = 'local-template';
  }
  if (!script) throw new Error(`Kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c k\u1ecbch b\u1ea3n m\u1edbi kh\u00f4ng tr\u00f9ng. H\u00e3y ki\u1ec3m tra k\u1ebft n\u1ed1i ChatGPT Plan r\u1ed3i th\u1eed l\u1ea1i. ${errors.join(' | ')}`);
  if (contentLanguage !== 'zh') {
    try {
      const caption = await generateCaption(script);
      script.caption = caption.caption;
      script.hashtags = caption.hashtags;
    } catch (error) {
      log('WARN', 'CAPTION_GENERATION_FALLBACK', `Caption generation failed: ${error.message}`);
    }
  }
  const scriptId = insertScript(script, topic.id, provider);
  return { scriptId, provider, script };
}
export function providerStatus() {
  return {
    chatgptPlan: chatgptStatus(),
    topics: TOPICS.length,
    paidApiEnabled: false
  };
}
