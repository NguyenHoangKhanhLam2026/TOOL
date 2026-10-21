import { TOPICS } from '../topics.mjs';
import { db, getSettings, pickTopic, insertScript, log } from '../database/db.mjs';
import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { validateScript } from './validator.mjs';
import { generateCaption } from './caption-service.mjs';
import { assertChineseReviewResponse, buildChineseReviewPrompt } from './chinese-quality.mjs';
import { assertEnglishReviewResponse, buildEnglishReviewPrompt } from './english-quality.mjs';
import fs from 'node:fs';

const SCRIPT_PROMPT = fs.readFileSync(new URL('../../packages/ai-engine/prompts/generate-script.md', import.meta.url), 'utf8');

const CHINESE_PRESENTATION_STYLES = ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase'];
const ENGLISH_PRESENTATION_STYLES = ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase'];
const ENGLISH_ROTATION_STYLES = ['legacy', ...ENGLISH_PRESENTATION_STYLES];

function chineseLessonCount(presentationStyle) {
  if (presentationStyle === 'numbered-scenario') return 3;
  if (presentationStyle === 'dialogue-cards') return 2;
  return 1;
}

function buildPrompt(topic, recent, settings, { autoTopic = false, previousTopics = [], contentLanguage = 'en', presentationStyle = null } = {}) {
  const modelChoosesTopic = autoTopic && ['en', 'zh'].includes(contentLanguage);
  const promptTopic = modelChoosesTopic ? 'Chủ đề mới, cụ thể do ChatGPT Plan tự chọn' : topic.title;
  const promptCategory = modelChoosesTopic ? 'Nhóm chủ đề do ChatGPT Plan tự chọn' : topic.category;
  const openTopicInstruction = modelChoosesTopic
    ? '\nChoose a fresh, specific topic from your broad real-world knowledge. Do not select from or limit yourself to any fixed local topic list. Put the actual topic in the JSON topic field and a matching category in category. Avoid these previously used topic angles: ' + (previousTopics.slice(0, 50).join(' | ') || 'none') + '.'
    : '';
  if (contentLanguage === 'en' && ENGLISH_PRESENTATION_STYLES.includes(presentationStyle)) {
    const dialogueCount = presentationStyle === 'inline-meaning' || presentationStyle === 'inline-keyphrase' ? 1 : 3;
    const schema = {
      topic: promptTopic, category: promptCategory, level: settings.level,
      title: 'Tiêu đề tiếng Việt ngắn, đúng nội dung bài học', hook: 'Một câu mở đầu tiếng Việt tự nhiên',
      presentationStyle,
      dialogues: Array.from({ length: dialogueCount }, (_, index) => ({
        index: index + 1,
        vietnamese: 'Một câu tiếng Việt tự nhiên, đúng tình huống',
        english: 'Bản dịch tiếng Anh tự nhiên như người bản xứ',
        ...(presentationStyle === 'numbered-scenario' ? { term: 'Cụm từ nguyên văn trong câu tiếng Anh', meaningVi: 'Nghĩa tiếng Việt ngắn, chính xác' } : {}),
        ...(presentationStyle === 'inline-meaning' || presentationStyle === 'inline-keyphrase' ? {
          vocabularyCards: [
            { sourceVi: 'Cụm từ nguyên văn thứ nhất trong câu tiếng Việt', term: 'Cụm từ nguyên văn tương ứng trong câu tiếng Anh', meaningVi: 'Giải thích ngắn bằng tiếng Việt' },
            { sourceVi: 'Cụm từ nguyên văn thứ hai trong câu tiếng Việt', term: 'Cụm từ nguyên văn tương ứng trong câu tiếng Anh', meaningVi: 'Giải thích ngắn bằng tiếng Việt' }
          ]
        } : {})
      })),
      caption: 'Caption tiếng Việt phù hợp với bài học', hashtags: ['#HocTiengAnh'], thumbnailTitle: 'Tiêu đề thumbnail tiếng Việt'
    };
    const instructions = {
      'dialogue-cards': 'Tạo đúng 3 lượt hội thoại liên tiếp trong cùng một tình huống đời thường. Mỗi lượt là một câu tiếng Việt và bản dịch tiếng Anh tương ứng; lời Việt được đọc trước, sau đó mới hiện và đọc lời Anh. Câu hỏi và câu đáp phải nối nghĩa tự nhiên. Không thêm cụm từ, phần giải thích hay nội dung thừa vào từng lượt.',
      'numbered-scenario': 'Tạo đúng 3 nhịp liên tiếp trong một tình huống đời thường, có nguyên nhân và diễn tiến rõ. Mỗi nhịp gồm một câu tiếng Việt, một câu Anh ngắn tương đương, một term dài 1–5 từ được chép nguyên văn từ câu Anh và meaningVi là lời giải thích cách dùng tự nhiên bằng tiếng Việt (5–16 từ). Khi dựng, từng nhịp lần lượt hiện số thứ tự, câu Việt, câu Anh rồi một thẻ giải thích; không thêm câu thứ hai hoặc chỉ dẫn sân khấu.',
      'inline-meaning': 'Tạo đúng một câu tiếng Việt và một câu Anh tương đương, đủ ngữ cảnh, để dạy một điểm ngữ pháp hữu ích. Thêm đúng 2 vocabularyCards. Mỗi sourceVi là cụm tiếng Việt ngắn (1–8 từ) được chép nguyên văn từ câu Việt; term là cụm liên tục tương ứng (1–5 từ) được chép nguyên văn từ câu Anh; meaningVi là giải thích ngữ pháp/cách dùng bằng tiếng Việt (8–24 từ), không chỉ dịch lại cụm từ. Chọn hai phần bổ trợ nhau, không lặp nghĩa.',
      'inline-keyphrase': 'Tạo đúng một câu tiếng Việt và một câu Anh tương đương, tự nhiên trong một tình huống cụ thể. Thêm đúng 2 vocabularyCards. Mỗi sourceVi là cụm tiếng Việt ngắn (1–8 từ) được chép nguyên văn từ câu Việt; term là cụm tự nhiên tương ứng (1–5 từ) được chép nguyên văn từ câu Anh; meaningVi là lời giải thích nghĩa/cách dùng rõ bằng tiếng Việt (8–24 từ). Ưu tiên collocation hoặc cách nói người bản xứ thường dùng; hai thẻ không được giải thích trùng nhau.'
    }[presentationStyle];
    return `Create a polished beginner-friendly Vietnamese–English lesson video. Return valid JSON only, matching this schema: ${JSON.stringify(schema)}\n` +
      `Presentation style: ${presentationStyle}. ${instructions}\n` +
      `Requirements: exactly ${dialogueCount} dialogue item(s), with sequential index values. Every Vietnamese line must be one clear, natural sentence of 5–14 words. Every English line must be one faithful, conversational sentence of 5–18 words; use correct articles, tense, prepositions, and idiom, without literal translation. For each numbered-scenario term and every vocabularyCards[].term, verify that the exact phrase appears as a whole phrase in its English sentence. For every inline vocabulary card, sourceVi must occur exactly in its Vietnamese sentence and term must occur exactly in its English sentence. Explanations must match the phrase and context, never invent a grammar rule; inline explanations should teach one useful point in a complete, concise sentence. Keep the voice script limited to lesson lines and phrase explanations; do not put stage directions, pronunciation notes, headings, or calls to follow/subscribe in speech. Use short punctuation that supports natural TTS pauses. Do not repeat previous English/Vietnamese lesson lines or phrase choices: ${recent.join(' | ') || 'none'}.\n` +
      `Write title, hook, caption, explanations, and thumbnail text in Vietnamese. Do not add a follow or subscribe call to action inside generated lesson content. Avoid these previously used topic angles: ${previousTopics.slice(0, 50).join(' | ') || 'none'}.` +
      openTopicInstruction;
  }
  if (contentLanguage === 'zh') {
    const lessonCount = chineseLessonCount(presentationStyle);
    const schema = {
      topic: promptTopic, category: promptCategory, level: settings.level,
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
      'dialogue-cards': 'Create exactly two consecutive turns in one short, natural everyday conversation. Turn 1 is a concise Vietnamese question or request with its faithful Simplified Chinese translation; turn 2 is a natural Vietnamese reply with its faithful Chinese translation. Keep each Chinese sentence at most 12 Hanzi. For each turn, fill term, termPinyin, meaningVi, and noteVi: choose one useful key phrase copied exactly from that Chinese sentence, give its standard Pinyin, a concise Vietnamese meaning, and a brief usage note. Do not add extra dialogue or a separate grammar explanation. The spoken order for each turn is Vietnamese source, full Chinese sentence, its full Chinese repetition, key phrase in Chinese, then the Vietnamese phrase meaning. Scene descriptions must cover all of this speech, including phrase practice after the second reply; the last scene and script must end only after the final Vietnamese phrase meaning is read.',
      'numbered-scenario': 'Create exactly three consecutive, natural beats in one practical everyday scenario. Each beat has one Vietnamese line of at most 6 words, one Chinese sentence of at most 5 Hanzi, one key phrase copied from that sentence, and a very short Vietnamese meaning/use note. Keep meaningVi plus noteVi to at most 4 Vietnamese words total and leave grammarNote empty. The video repeats each Chinese line twice, so make every beat very brief. Give each lesson a concise Vietnamese scene description for that beat; it must not imply that the beat ends after the full Chinese sentence, since the Chinese key phrase and Vietnamese meaning/use note are spoken afterward. The final beat and video end only after its Chinese phrase and Vietnamese meaning/use note are spoken.',
      'inline-meaning': 'Create exactly one practical spoken sentence. Keep the Vietnamese source to at most 12 words and the Chinese translation to one sentence of at most 16 Hanzi. The Vietnamese source is shown in a card; the Chinese translation is a direct text line below it, without a filled Chinese card. Include one accurate, concise explanation of the key phrase.',
      'inline-keyphrase': 'Create exactly one practical spoken sentence. Keep the Vietnamese source to at most 12 words and the Chinese translation to one sentence of at most 16 Hanzi. The Vietnamese source is shown in a card; the Chinese translation is a direct text line below it, without a filled Chinese card. Choose one memorable key phrase that appears exactly in the sentence and explain it briefly; do not add spoken word-tracking or highlight instructions.'
    }[presentationStyle];
    return `Create a practical Vietnamese–Simplified Chinese learning video for a beginner. Return valid JSON only, matching this schema: ${JSON.stringify(schema)}\n` +
      `Presentation style: ${presentationStyle}. ${styleInstructions}\n` +
      `Requirements: return exactly ${lessonCount} items in lessons. Each lessons[].chinese value must be a single short spoken sentence, with no newline or second sentence; obey the Hanzi limit for its presentation style. Use natural Simplified Chinese only and never insert Pinyin there. Provide standard Hanyu Pinyin for every full Chinese sentence and key phrase, mark lexical tones, and allow unmarked neutral tones. Follow standard Pinyin word spacing: write syllables in one lexical word together, separate different words with spaces, and use hyphens only where standard orthography requires them (including established four-syllable idioms); never split each Hanzi into a separate word. Count syllables with the normal 儿化 exception where 儿 joins the preceding syllable. Make every Vietnamese translation faithful, and explain only verified meanings and usage within the style word limits. Write Chinese as natural spoken dialogue, not a textbook definition. Use punctuation that matches sentence intent, including a question mark for genuine questions.\n` +
      `For every lesson, the spoken order is fixed: Vietnamese source once; full Chinese sentence once; the same full Chinese sentence a second time; the exact Chinese key phrase once; then Vietnamese phrase explanation once, combining meaningVi, noteVi, and grammarNote in that order when present. The phrase must always be spoken in Chinese before its Vietnamese explanation; never omit either language when a phrase card is present, move the phrase to the end, add another reading, or add speech not represented in the lesson fields. Write 2–4 Vietnamese scene descriptions that are consistent with this full spoken sequence; scenes must not imply that a lesson or the video ends before its phrase and complete Vietnamese explanation have been spoken. The final scene and video end only after the last Vietnamese phrase explanation.\n` +
      `Never put Pinyin, pronunciation notes, bracketed stage directions, or voice instructions inside text to be spoken. Do not include any follow, subscribe, or follow-the-channel call to action in the title, hook, spoken content, or caption. Do not generate English learning content, Japanese, Traditional Chinese, or invented facts. Keep title, hook, explanation, and thumbnail text in Vietnamese.\n` +
      `Avoid Chinese phrases and lesson angles similar to these saved Chinese lessons: ${recent.join(' | ') || 'none'}.` +
      openTopicInstruction;
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
    topic: promptTopic, category: promptCategory, level: settings.level, title: 'Tiêu đề tiếng Việt ngắn',
    hook: 'Một câu mở đầu tiếng Việt', dialogues: [1, 2, 3].map((index) => ({ index, vietnamese: '', english: '', term: '', meaningVi: '', noteVi: '', grammarNote: '' })),
    caption: '', hashtags: ['#HocTiengAnh'], thumbnailTitle: ''
  };
  const prompt = SCRIPT_PROMPT
    .replaceAll('{{topic}}', promptTopic)
    .replaceAll('{{category}}', promptCategory)
    .replaceAll('{{level}}', settings.level)
    .replaceAll('{{recent}}', recent.join(' | ') || 'chưa có')
    .replaceAll('{{schema}}', JSON.stringify(schema, null, 2));
  if (!autoTopic) return prompt;
  return `${prompt}\n\nAUTOMATIC TOPIC: Choose a fresh, specific topic from your broad real-world knowledge, not from a fixed local topic list. Put the actual new topic and its matching category in the JSON fields. Avoid these previously used topic angles: ${previousTopics.slice(0, 50).join(' | ') || 'none'}.`;
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

export async function createScript(topicId, { contentLanguage = 'en', presentationStyle = null } = {}) {
  const modelChoosesTopic = !topicId && ['en', 'zh'].includes(contentLanguage);
  const topic = topicId
    ? db.prepare('SELECT * FROM topics WHERE id=?').get(topicId)
    : modelChoosesTopic
      ? { id: null, title: 'Chủ đề mới do ChatGPT Plan tự chọn', category: 'ChatGPT Plan tự chọn' }
      : pickTopic();
  if (!topic) throw new Error('Không tìm thấy chủ đề đã chọn.');
  const settings = getSettings();
  if (['en', 'zh'].includes(contentLanguage) && !chatgptStatus().connected) {
    throw new Error('ChatGPT Plan chưa kết nối. Hãy kết nối lại trong Kết nối & cài đặt để tạo nội dung; không có nội dung cục bộ thay thế.');
  }
  const historyRows = db.prepare('SELECT topic,dialogues_json,speech_segments_json,content_language FROM scripts ORDER BY created_at DESC').all();
  const latestEnglishRow = historyRows.find((row) => (row.content_language || 'en') === 'en');
  const latestEnglishSavedStyle = latestEnglishRow
    ? JSON.parse(latestEnglishRow.dialogues_json || '[]')[0]?.presentationStyle
    : null;
  const latestEnglishStyleIndex = ENGLISH_ROTATION_STYLES.indexOf(
    ENGLISH_ROTATION_STYLES.includes(latestEnglishSavedStyle) ? latestEnglishSavedStyle : 'legacy'
  );
  const nextEnglishStyle = latestEnglishRow
    ? ENGLISH_ROTATION_STYLES[(latestEnglishStyleIndex + 1) % ENGLISH_ROTATION_STYLES.length]
    : 'legacy';
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
  const requestedEnglishStyle = ENGLISH_PRESENTATION_STYLES.includes(presentationStyle)
    ? presentationStyle
    : nextEnglishStyle;
  const selectedEnglishStyle = contentLanguage === 'en' && requestedEnglishStyle !== 'legacy'
    ? requestedEnglishStyle
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
  const prompt = buildPrompt(topic, recent, settings, { autoTopic: !topicId, previousTopics: historyRows.map((row) => row.topic), contentLanguage, presentationStyle: selectedEnglishStyle || selectedChineseStyle || undefined });
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', (value) => generateWithChatGPT(value)]);
  let script;
  let provider;
  let englishPresentationReviewPassed = false;
  let chineseCaptionError = null;
  const errors = [];
  for (const [name, call] of providers) {
    let repairPrompt = prompt;
    for (let attempt = 0; attempt < 3; attempt++) {
      let candidate;
      try {
        candidate = validateScript(parseJSON(await call(repairPrompt)), { contentLanguage, presentationStyle: selectedEnglishStyle });
        if (modelChoosesTopic && [
          'Chủ đề mới, cụ thể do ChatGPT Plan tự chọn',
          'Nhóm chủ đề do ChatGPT Plan tự chọn'
        ].some((placeholder) => [candidate.topic, candidate.category].some((value) => String(value || '').trim().toLocaleLowerCase() === placeholder.toLocaleLowerCase()))) {
          throw new Error('ChatGPT Plan phải điền chủ đề thực tế và nhóm chủ đề, không để nguyên nội dung giữ chỗ trong mẫu JSON.');
        }
        if (contentLanguage === 'zh') {
          let caption;
          try {
            caption = await generateCaption(candidate);
          } catch (error) {
            chineseCaptionError = error;
            break;
          }
          candidate.caption = caption.caption;
          candidate.hashtags = caption.hashtags;
          await reviewChineseScript(candidate);
        }
        if (selectedEnglishStyle) {
          try {
            const caption = await generateCaption(candidate);
            candidate.caption = caption.caption;
            candidate.hashtags = caption.hashtags;
          } catch (error) {
            log('WARN', 'CAPTION_GENERATION_FALLBACK', `Caption generation failed: ${error.message}`);
          }
          assertEnglishReviewResponse(await generateWithChatGPT(buildEnglishReviewPrompt(candidate)));
          englishPresentationReviewPassed = true;
          log('INFO', 'EN_PRESENTATION_SCRIPT_QA_PASSED', 'Kịch bản tiếng Anh và trình tự lời đọc đã qua lượt rà soát độc lập.');
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
        const outputShape = selectedEnglishStyle
          ? `Return exactly ${selectedEnglishStyle === 'inline-meaning' || selectedEnglishStyle === 'inline-keyphrase' ? 1 : 3} dialogue item(s), with presentationStyle set to ${selectedEnglishStyle}, and follow its schema exactly.`
          : contentLanguage === 'zh'
          ? `Return exactly ${chineseLessonCount(selectedChineseStyle)} items in lessons, with presentationStyle set to ${selectedChineseStyle}.`
          : 'Return valid JSON with exactly three items in dialogues, indexed 1, 2, 3. Never add a fourth item.';
        repairPrompt = `${prompt}\n\nDo not repeat rejected ${contentLanguage === 'en' ? 'English' : contentLanguage === 'ja' ? 'Japanese' : 'Chinese'} lines: ${rejected}\nFix this validation error: ${error.message}\n${outputShape}`;
      }
    }
    if (script) break;
  }
  if (chineseCaptionError) throw chineseCaptionError;
  if (!script) throw new Error(`ChatGPT Plan không tạo được kịch bản hợp lệ. Hãy kiểm tra kết nối rồi thử lại. ${errors.join(' | ')}`);
  if (contentLanguage !== 'zh' && !englishPresentationReviewPassed) {
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
