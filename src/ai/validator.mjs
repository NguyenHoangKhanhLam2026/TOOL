import { createHash } from 'node:crypto';

export function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

export function contentHash(script) {
  const targetField = script.contentLanguage === 'ja' ? 'japanese' : script.contentLanguage === 'zh' ? 'chinese' : 'english';
  const dialogueText = (Array.isArray(script.dialogues) ? script.dialogues : []).flatMap((item) => [
    item?.english,
    item?.vietnamese,
    ...(targetField === 'english' ? [] : [item?.[targetField]]),
    ...(Array.isArray(item?.turns) ? item.turns.map((turn) => turn?.text) : [])
  ]);
  const speechText = [
    ...(Array.isArray(script.speechSegments) ? script.speechSegments : []),
    ...(Array.isArray(script.audioSegments) ? script.audioSegments : [])
  ].map((item) => item?.text);
  const englishStyle = script.contentLanguage === 'en' && script.presentationStyle ? [`presentation:${script.presentationStyle}`] : [];
  const basis = [script.topic, ...(script.contentLanguage && script.contentLanguage !== 'en' ? [script.contentLanguage] : []), ...englishStyle, ...dialogueText, ...speechText].map(normalizeText).join('|');
  return createHash('sha256').update(basis).digest('hex');
}

export function sentenceSimilarity(left, right) {
  const tokensFor = (value) => {
    const text = normalizeText(value);
    const language = /[\u3040-\u30ff]/u.test(text) ? 'ja' : /[\u3400-\u9fff]/u.test(text) ? 'zh' : null;
    return language && typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
      : text.split(' ').filter(Boolean);
  };
  const a = new Set(tokensFor(left));
  const b = new Set(tokensFor(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

export function assertDistinctFromRecent(script, recentSentences, threshold = 0.92) {
  for (const line of contentItems(script)) {
    const english = englishTexts(line);
    for (const recent of recentSentences) {
      if (english.some((text) => sentenceSimilarity(text, recent) >= threshold)) throw new Error('Câu tiếng Anh quá giống nội dung gần đây; hãy tạo cách diễn đạt khác.');
    }
  }
  return script;
}

export function assertDistinctFromHistory(script, history, threshold = 0.82) {
  const targetField = script.contentLanguage === 'ja' ? 'japanese' : script.contentLanguage === 'zh' ? 'chinese' : 'english';
  for (const previous of history) {
    if (script.contentLanguage === 'zh' && previous?.contentLanguage !== 'zh') continue;
    const previousItems = Array.isArray(previous)
      ? previous
      : [...(Array.isArray(previous?.dialogues) ? previous.dialogues : []), ...speechSegments(previous)];
    for (const line of contentItems(script)) {
      for (const saved of previousItems) {
        for (const text of targetTexts(line, targetField)) for (const previousText of targetTexts(saved, targetField)) {
          if (sentenceSimilarity(text, previousText) >= threshold) throw new Error(`Câu ${script.contentLanguage === 'ja' ? 'tiếng Nhật' : script.contentLanguage === 'zh' ? 'tiếng Trung' : 'tiếng Anh'} gần giống nội dung đã lưu: "${previousText}".`);
        }
        if (!(script.contentLanguage === 'zh' && (isChineseCta(line) || isChineseCta(saved)))) {
          for (const text of vietnameseTexts(line)) for (const previousText of vietnameseTexts(saved)) {
            if (sentenceSimilarity(text, previousText) >= threshold) throw new Error(`C\u00e2u ti\u1ebfng Vi\u1ec7t g\u1ea7n gi\u1ed1ng n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${previousText}".`);
          }
        }
        if (script.contentLanguage === 'zh' && previous?.contentLanguage === 'zh') {
          if (sentenceSimilarity(line.meaningVi || '', saved.meaningVi || '') >= 0.9) throw new Error(`Nghĩa tiếng Việt của điểm học gần trùng bài tiếng Trung đã lưu: “${saved.meaningVi}”.`);
          if (sentenceSimilarity(script.topic || '', previous.topic || '') >= 0.95 && sentenceSimilarity(line.term || '', saved.term || '') >= 0.65) {
            throw new Error(`Chủ đề và cụm trọng tâm gần trùng bài tiếng Trung đã lưu: “${saved.term}”.`);
          }
        }
        if (normalizeText(line.term) && normalizeText(line.term) === normalizeText(saved.term) && (targetField === 'english' || previous?.contentLanguage === script.contentLanguage)) {
          throw new Error(`C\u1ee5m t\u1eeb tr\u1ecdng t\u00e2m \u0111\u00e3 xu\u1ea5t hi\u1ec7n trong n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${saved.term}".`);
        }
      }
    }
  }
  return script;
}

const ENGLISH_PRESENTATION_STYLES = ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase'];

function englishPresentationDialogueCount(style) {
  return ['inline-meaning', 'inline-keyphrase'].includes(style) ? 1 : 3;
}

function validateEnglishPresentationScript(raw, presentationStyle) {
  const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!script || typeof script !== 'object' || Array.isArray(script)) throw new Error('Kịch bản tiếng Anh không phải đối tượng JSON.');
  const errors = [];
  script.contentLanguage = 'en';
  script.presentationStyle = presentationStyle;
  const expectedCount = englishPresentationDialogueCount(presentationStyle);
  const inlineStyle = ['inline-meaning', 'inline-keyphrase'].includes(presentationStyle);
  const numberedStyle = presentationStyle === 'numbered-scenario';
  for (const key of ['topic', 'category', 'level', 'title', 'hook', 'caption', 'thumbnailTitle']) {
    if (typeof script[key] !== 'string' || !script[key].trim()) errors.push(`Thiếu trường ${key} của nội dung tiếng Anh.`);
  }
  if (!Array.isArray(script.dialogues) || script.dialogues.length !== expectedCount) {
    errors.push(`Kiểu ${presentationStyle} cần đúng ${expectedCount} câu học tiếng Anh.`);
  }
  if (!Array.isArray(script.dialogues)) script.dialogues = [];
  const phraseOccursIn = (phrase, sentence) => Boolean(phrase && sentence
    && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}([^\\p{L}\\p{N}]|$)`, 'iu').test(sentence));
  const addSpeech = (segments, { text, language, layerId, dialogueIndex, id, state, pauseAfterSeconds = 0, vocabularyIndex }) => {
    const segment = {
      segmentId: `en-${presentationStyle}-${dialogueIndex + 1}-${id}`,
      turnId: `en-${presentationStyle}-dialogue-${dialogueIndex + 1}`,
      language,
      text,
      state,
      pauseAfterSeconds,
      target: {
        layerId,
        dialogueIndex,
        ...(Number.isInteger(vocabularyIndex) ? { vocabularyIndex } : {})
      }
    };
    segments.push(segment);
  };
  const speechSegments = [];
  script.dialogues = script.dialogues.slice(0, expectedCount).map((dialogue, index) => {
    const prefix = `Câu học tiếng Anh ${index + 1}`;
    const vietnamese = String(dialogue?.vietnamese || '').trim();
    const english = String(dialogue?.english || '').trim();
    if (!vietnamese) errors.push(`${prefix}: thiếu câu tiếng Việt.`);
    if (!english) errors.push(`${prefix}: thiếu câu tiếng Anh.`);
    const vietnameseWords = wordCount(vietnamese);
    const englishWords = wordCount(english);
    if (vietnameseWords < 5 || vietnameseWords > 14) errors.push(`${prefix}: câu tiếng Việt cần từ 5 đến 14 từ (hiện có ${vietnameseWords}).`);
    if (englishWords < 5 || englishWords > 18) errors.push(`${prefix}: câu tiếng Anh cần từ 5 đến 18 từ (hiện có ${englishWords}).`);
    let vocabularyCards = [];
    if (numberedStyle) {
      const term = String(dialogue?.term || '').trim();
      const meaningVi = String(dialogue?.meaningVi || '').trim();
      if (!term || !meaningVi) errors.push(`${prefix}: thiếu cụm từ hoặc nghĩa tiếng Việt.`);
      if (wordCount(term) < 1 || wordCount(term) > 5) errors.push(`${prefix}: cụm từ trọng tâm cần từ 1 đến 5 từ.`);
      if (wordCount(meaningVi) < 5 || wordCount(meaningVi) > 16) errors.push(`${prefix}: giải thích cách dùng cần từ 5 đến 16 từ.`);
      if (term && !phraseOccursIn(term, english)) errors.push(`${prefix}: cụm từ “${term}” không xuất hiện nguyên văn trong câu tiếng Anh.`);
      vocabularyCards = [{ term, meaningVi }];
    } else if (inlineStyle) {
      if (!Array.isArray(dialogue?.vocabularyCards) || dialogue.vocabularyCards.length !== 2) {
        errors.push(`${prefix}: cần đúng 2 thẻ vocabularyCards.`);
      }
      vocabularyCards = (Array.isArray(dialogue?.vocabularyCards) ? dialogue.vocabularyCards : []).slice(0, 2).map((card, cardIndex) => {
        const sourceVi = String(card?.sourceVi || '').trim();
        const term = String(card?.term || '').trim();
        const meaningVi = String(card?.meaningVi || '').trim();
        if (!sourceVi || !term || !meaningVi) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: thiếu cụm tiếng Việt, cụm tiếng Anh hoặc giải thích.`);
        if (wordCount(sourceVi) < 1 || wordCount(sourceVi) > 8) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: cụm tiếng Việt cần từ 1 đến 8 từ.`);
        if (wordCount(term) < 1 || wordCount(term) > 5) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: cụm từ cần từ 1 đến 5 từ.`);
        if (wordCount(meaningVi) < 8 || wordCount(meaningVi) > 24) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: giải thích cần từ 8 đến 24 từ.`);
        if (sourceVi && !phraseOccursIn(sourceVi, vietnamese)) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: cụm tiếng Việt “${sourceVi}” không xuất hiện nguyên văn trong câu tiếng Việt.`);
        if (term && !phraseOccursIn(term, english)) errors.push(`${prefix}, thẻ cụm từ ${cardIndex + 1}: “${term}” không xuất hiện nguyên văn trong câu tiếng Anh.`);
        return { sourceVi, term, meaningVi };
      });
      if (vocabularyCards.length === 2 && normalizeText(vocabularyCards[0].term) === normalizeText(vocabularyCards[1].term)) {
        errors.push(`${prefix}: hai thẻ cụm từ không được trùng nhau.`);
      }
      if (vocabularyCards.length === 2 && normalizeText(vocabularyCards[0].sourceVi) === normalizeText(vocabularyCards[1].sourceVi)) {
        errors.push(`${prefix}: hai cụm tiếng Việt trong thẻ không được trùng nhau.`);
      }
    }
    const result = {
      ...dialogue,
      index: index + 1,
      vietnamese,
      english,
      presentationStyle,
      term: vocabularyCards[0]?.term || '',
      meaningVi: vocabularyCards[0]?.meaningVi || '',
      ...(inlineStyle ? { vocabularyCards } : { vocabularyCards: undefined })
    };
    addSpeech(speechSegments, { text: vietnamese, language: 'vi', layerId: 'vietnamese-card', dialogueIndex: index, id: 'vi', state: 'vietnamese', pauseAfterSeconds: 0.55 });
    addSpeech(speechSegments, { text: english, language: 'en', layerId: 'english-card', dialogueIndex: index, id: 'en', state: 'bilingual' });
    vocabularyCards.forEach((card, cardIndex) => {
      if (!card.term || !card.meaningVi) return;
      addSpeech(speechSegments, { text: card.term, language: 'en', layerId: 'vocabulary', dialogueIndex: index, id: `term-${cardIndex + 1}`, state: 'vocabulary', vocabularyIndex: cardIndex });
      addSpeech(speechSegments, { text: card.meaningVi, language: 'vi', layerId: 'vocabulary', dialogueIndex: index, id: `meaning-${cardIndex + 1}`, state: 'vocabulary', vocabularyIndex: cardIndex });
    });
    return result;
  });
  if (new Set(script.dialogues.map((dialogue) => normalizeText(dialogue.english)).filter(Boolean)).size !== script.dialogues.length) {
    errors.push('Các câu tiếng Anh trong cùng một video bị lặp.');
  }
  const learningTerms = script.dialogues.flatMap((dialogue) => Array.isArray(dialogue.vocabularyCards)
    ? dialogue.vocabularyCards.map((card) => card.term)
    : [dialogue.term]).map(normalizeText).filter(Boolean);
  if (new Set(learningTerms).size !== learningTerms.length) errors.push('Các cụm từ trong cùng một video bị lặp.');
  if (errors.length) throw new Error(errors.join(' '));
  script.speechSegments = speechSegments;
  if (!Array.isArray(script.hashtags)) script.hashtags = [];
  script.createdAt = new Date().toISOString();
  script.id = crypto.randomUUID();
  script.contentHash = contentHash(script);
  return script;
}

export function validateScript(raw, { contentLanguage = 'en', requireChineseScenes = true, presentationStyle = null } = {}) {
  if (contentLanguage === 'zh') return validateChineseScript(raw, { requireScenes: requireChineseScenes });
  if (contentLanguage === 'en' && ENGLISH_PRESENTATION_STYLES.includes(presentationStyle)) {
    return validateEnglishPresentationScript(raw, presentationStyle);
  }
  const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const errors = [];
  if (!['en', 'ja', 'zh'].includes(contentLanguage)) throw new Error('Unsupported content language.');
  if (script && typeof script === 'object' && !Array.isArray(script)) script.contentLanguage = contentLanguage;
  if (!script || typeof script !== 'object' || Array.isArray(script)) throw new Error('Kịch bản không phải đối tượng JSON.');
  for (const key of ['topic', 'category', 'level', 'title', 'hook', 'caption', 'thumbnailTitle']) {
    if (typeof script[key] !== 'string' || !script[key].trim()) errors.push(`Thiếu trường ${key}.`);
  }
  const hasExplicitSpeech = ['speechSegments', 'audioSegments'].some((key) => Array.isArray(script[key]) && script[key].length > 0);
  if ((!Array.isArray(script.dialogues) || script.dialogues.length === 0) && !hasExplicitSpeech) errors.push('Kịch bản cần ít nhất một đoạn hội thoại hoặc một mảng speechSegments.');
  for (const key of ['speechSegments', 'audioSegments']) if (script[key] !== undefined && !Array.isArray(script[key])) errors.push(`${key} phải là một mảng.`);
  if (!Array.isArray(script.dialogues)) script.dialogues = [];
  if (script.dialogues.length !== 3) errors.push('Mỗi video phải có đúng 3 nội dung (3/3).');
  for (const [i, d] of script.dialogues.entries()) {
    for (const text of vietnameseTexts(d)) {
      const count = wordCount(text);
      if (count && (count < 7 || count > 10)) errors.push(`Câu tiếng Việt ${i + 1} cần từ 7 đến 10 từ (hiện có ${count}).`);
    }
    if (d?.turns !== undefined && !Array.isArray(d.turns)) errors.push(`Lượt hội thoại ${i + 1}: turns phải là một mảng.`);
    if (Array.isArray(d?.turns) && d.turns.length) {
      for (const [turnIndex, turn] of d.turns.entries()) {
        if (typeof turn?.text !== 'string' || !turn.text.trim()) errors.push(`Lượt ${i + 1}.${turnIndex + 1}: thiếu text.`);
        if (typeof turn?.language !== 'string' || !turn.language.trim()) errors.push(`Lượt ${i + 1}.${turnIndex + 1}: thiếu language.`);
        if (turn?.voiceName !== undefined && (typeof turn.voiceName !== 'string' || !turn.voiceName.trim())) errors.push(`Lượt ${i + 1}.${turnIndex + 1}: voiceName không hợp lệ.`);
      }
      continue;
    }
    const targetField = contentLanguage === 'ja' ? 'japanese' : contentLanguage === 'zh' ? 'chinese' : 'english';
    for (const key of ['vietnamese', targetField, 'term', 'meaningVi', 'noteVi']) {
      if (typeof d?.[key] !== 'string' || !d[key].trim()) errors.push(`Câu ${i + 1}: thiếu ${key}.`);
    }
    const targetText = String(d?.[targetField] || '');
    const phraseIsPresent = contentLanguage === 'en'
      ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(d?.term || '')}([^\\p{L}\\p{N}]|$)`, 'iu').test(targetText)
      : Boolean(d?.term && targetText.includes(d.term));
    if (d?.term && targetText && !phraseIsPresent) {
      errors.push(`Cụm từ trọng tâm “${d.term}” không xuất hiện nguyên văn trong câu ${contentLanguage === 'ja' ? 'tiếng Nhật' : contentLanguage === 'zh' ? 'tiếng Trung' : 'tiếng Anh'}.`);
    }
  }
  for (const key of ['speechSegments', 'audioSegments']) {
    if (!Array.isArray(script[key])) continue;
    for (const [i, segment] of script[key].entries()) {
      if (typeof segment?.text !== 'string' || !segment.text.trim()) errors.push(`Đoạn đọc ${i + 1}: thiếu text.`);
      if (typeof segment?.language !== 'string' || !segment.language.trim()) errors.push(`Đoạn đọc ${i + 1}: thiếu language.`);
      if (segment?.voiceName !== undefined && (typeof segment.voiceName !== 'string' || !segment.voiceName.trim())) errors.push(`Đoạn đọc ${i + 1}: voiceName không hợp lệ.`);
      if (/^(vi|vietnamese)(-|$)/i.test(String(segment?.language || segment?.locale || '')) && typeof segment?.text === 'string' && segment.text.trim()) {
        const count = wordCount(segment.text);
        if (count < 7 || count > 10) errors.push(`Đoạn đọc tiếng Việt ${i + 1} cần từ 7 đến 10 từ (hiện có ${count}).`);
      }
    }
  }
  const targetField = contentLanguage === 'ja' ? 'japanese' : contentLanguage === 'zh' ? 'chinese' : 'english';
  const englishLines = script.dialogues.filter((d) => !Array.isArray(d?.turns)).map((d) => normalizeText(d?.[targetField])).filter(Boolean);
  if (new Set(englishLines).size !== englishLines.length) errors.push(`Các câu ${contentLanguage === 'ja' ? 'tiếng Nhật' : contentLanguage === 'zh' ? 'tiếng Trung' : 'tiếng Anh'} bị lặp.`);
  const terms = script.dialogues.map((d) => normalizeText(d?.term)).filter(Boolean);
  if (new Set(terms).size !== terms.length) errors.push('A key phrase is repeated within the script.');
  if (errors.length) throw new Error(errors.join(' '));
  script.dialogues.forEach((d, i) => { d.index = i + 1; d.grammarNote ||= ''; });
  if (!Array.isArray(script.hashtags)) script.hashtags = [];
  script.createdAt = new Date().toISOString();
  script.id = crypto.randomUUID();
  script.contentHash = contentHash(script);
  return script;
}

function pinyinSyllables(value) {
  // Pinyin orthography joins syllables inside words (for example qǐngwèn).
  // Count vowel nuclei so a normal word does not incorrectly count as one syllable.
  return String(value || '').toLocaleLowerCase('zh-CN').match(/[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+/gu) || [];
}

function pinyinErhuaCount(value, chinese) {
  const erhuaHanzi = [...String(chinese || '').matchAll(/(?<=\p{Script=Han})儿/gu)].length;
  const erhuaSyllables = [...String(value || '').toLocaleLowerCase('zh-CN').matchAll(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüv]+r(?=$|[\s,，.。!?！？;；:：·])/gu)]
    .filter(([syllable]) => normalizePinyin(syllable) !== 'er').length;
  return Math.min(erhuaHanzi, erhuaSyllables);
}

function normalizePinyin(value) {
  const toneMap = {
    ā: 'a', á: 'a', ǎ: 'a', à: 'a', ē: 'e', é: 'e', ě: 'e', è: 'e',
    ī: 'i', í: 'i', ǐ: 'i', ì: 'i', ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
    ū: 'u', ú: 'u', ǔ: 'u', ù: 'u', ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v'
  };
  return [...String(value || '').toLocaleLowerCase('zh-CN')]
    .map((character) => toneMap[character] ?? character)
    .join('')
    .replace(/[^a-zv]/gu, '');
}

function normalizeChinese(value) {
  return String(value || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
}

export function containsChineseFollowCta(value) {
  return /(?:\b(?:follow|subscribe)\b|theo\s*dõi|đăng\s*ký(?:\s*(?:kênh|channel|trang|page))?|关注(?:我|我们|本频道|频道|账号|一下)|订阅(?:我|我们|本频道|频道|账号))/iu.test(String(value || ''));
}

function validateChineseScript(raw, { requireScenes = true } = {}) {
  const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!script || typeof script !== 'object' || Array.isArray(script)) throw new Error('Kịch bản tiếng Trung không phải đối tượng JSON.');
  const originalId = script.id;
  const originalCreatedAt = script.createdAt;
  script.contentLanguage = 'zh';
  const errors = [];
  for (const key of ['topic', 'category', 'level', 'title', 'hook', 'thumbnailTitle']) {
    if (typeof script[key] !== 'string' || !script[key].trim()) errors.push(`Thiếu trường ${key} của nội dung tiếng Trung.`);
  }
  const presentationStyles = ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase'];
  const presentationStyle = String(script.presentationStyle || script.dialogues?.[0]?.presentationStyle || 'inline-meaning');
  if (!presentationStyles.includes(presentationStyle)) errors.push(`Kiểu trình bày tiếng Trung không hợp lệ: ${presentationStyle}.`);
  const expectedLessonCount = presentationStyle === 'numbered-scenario' ? 3 : presentationStyle === 'dialogue-cards' ? 2 : 1;
  const sourceLessons = Array.isArray(script.lessons)
    ? script.lessons
    : script.lessonPoint ? [script.lessonPoint]
      : Array.isArray(script.dialogues) ? script.dialogues : [];
  if (sourceLessons.length !== expectedLessonCount) errors.push(`Kiểu ${presentationStyle} cần đúng ${expectedLessonCount} câu học tiếng Trung.`);
  const traditionalCharacters = /[體國學語說話車間為會點這個來時開門錢電見長東書讀聽買後發現應該知道裡兩怎樣歡迎飛魚鳥風]/u;
  const lessons = sourceLessons.slice(0, expectedLessonCount).map((lesson, index) => {
    const prefix = `Câu tiếng Trung ${index + 1}`;
    for (const key of ['chinese', 'pinyin', 'vietnamese', 'term', 'termPinyin', 'meaningVi', 'noteVi']) {
      if (typeof lesson?.[key] !== 'string' || !lesson[key].trim()) errors.push(`${prefix} thiếu ${key}.`);
    }
    const chinese = String(lesson?.chinese || '').trim();
    const pinyin = String(lesson?.pinyin || '').trim();
    const term = String(lesson?.term || '').trim();
    const termPinyin = String(lesson?.termPinyin || '').trim();
    const hanziCount = (chinese.match(/\p{Script=Han}/gu) || []).length;
    const termHanziCount = (term.match(/\p{Script=Han}/gu) || []).length;
    const wordCountVi = (value) => String(value || '').trim().split(/\s+/u).filter(Boolean).length;
    const hanziLimit = presentationStyle === 'dialogue-cards' ? 12 : presentationStyle === 'numbered-scenario' ? 5 : 16;
    const vietnameseWordLimit = presentationStyle === 'numbered-scenario' ? 6 : 12;
    if (hanziCount > hanziLimit) errors.push(`${prefix}: câu này dài ${hanziCount} chữ Hán, tối đa ${hanziLimit} cho kiểu ${presentationStyle}.`);
    if (/[\r\n]/u.test(chinese) || (chinese.match(/[。！？!?]/gu) || []).length > 1) errors.push(`${prefix}: chỉ dùng một câu tiếng Trung ngắn, không xuống dòng hoặc ghép nhiều câu.`);
    if (wordCountVi(lesson?.vietnamese) > vietnameseWordLimit) errors.push(`${prefix}: câu tiếng Việt vượt giới hạn ${vietnameseWordLimit} từ của kiểu ${presentationStyle}.`);
    if (presentationStyle === 'numbered-scenario') {
      const explanationWordCount = wordCountVi([lesson?.meaningVi, lesson?.noteVi].filter(Boolean).join(' '));
      if (explanationWordCount > 4) errors.push(`${prefix}: meaningVi và noteVi cộng lại tối đa 4 từ để giữ timeline dưới 60 giây.`);
      if (String(lesson?.grammarNote || '').trim()) errors.push(`${prefix}: grammarNote phải để trống trong kiểu numbered-scenario.`);
    }
    if (!hanziCount) errors.push(`${prefix} phải có câu bằng chữ Hán giản thể.`);
    if (!termHanziCount) errors.push(`${prefix}: cụm trọng tâm phải có ít nhất một chữ Hán.`);
    if (/[A-Za-z]{2,}/u.test(chinese)) errors.push(`${prefix} không được chèn từ tiếng Anh hoặc Pinyin.`);
    if (!term || !chinese.includes(term)) errors.push(`${prefix}: cụm chữ Hán trọng tâm phải xuất hiện nguyên văn trong câu.`);
    if (traditionalCharacters.test(chinese)) errors.push(`${prefix} có ký tự phồn thể; yêu cầu dùng chữ Hán giản thể.`);
    if (/[\u3400-\u9fff]/u.test(pinyin) || !/^[\p{Script=Latin}\p{M}\d\s'’.,!?;:·-]+$/u.test(pinyin)) errors.push(`${prefix}: Pinyin phải dùng ký tự Latin, không chèn chữ Hán.`);
    if (!/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|[1-5]/u.test(pinyin)) errors.push(`${prefix}: Pinyin cần thể hiện dấu thanh hoặc số thanh điệu.`);
    const sentencePinyinSyllables = pinyinSyllables(pinyin).length;
    const expectedSentenceSyllables = hanziCount - pinyinErhuaCount(pinyin, chinese);
    if (hanziCount && sentencePinyinSyllables !== expectedSentenceSyllables) errors.push(`${prefix}: số âm tiết Pinyin ước tính (${sentencePinyinSyllables}) không khớp số chữ Hán sau khi tính âm 儿 hóa (${expectedSentenceSyllables}).`);
    if (!/^[\p{Script=Latin}\p{M}\d\s'’.,!?;:·-]+$/u.test(termPinyin) || /[\u3400-\u9fff]/u.test(termPinyin)) errors.push(`${prefix}: Pinyin của cụm trọng tâm không hợp lệ.`);
    if (!/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|[1-5]/u.test(termPinyin)) errors.push(`${prefix}: Pinyin của cụm trọng tâm cần thể hiện dấu thanh hoặc số thanh điệu.`);
    const termPinyinSyllables = pinyinSyllables(termPinyin).length;
    const expectedTermSyllables = termHanziCount - pinyinErhuaCount(termPinyin, term);
    if (termHanziCount && termPinyinSyllables !== expectedTermSyllables) errors.push(`${prefix}: số âm tiết Pinyin ước tính của cụm trọng tâm không khớp số chữ Hán sau khi tính âm 儿 hóa.`);
    if (normalizePinyin(termPinyin) && !normalizePinyin(pinyin).includes(normalizePinyin(termPinyin))) {
      errors.push(`${prefix}: Pinyin của cụm trọng tâm phải khớp với một đoạn trong Pinyin toàn câu (không tính dấu thanh).`);
    }
    return {
      ...lesson,
      index: index + 1,
      presentationStyle,
      chinese,
      pinyin,
      term,
      termPinyin,
      vietnamese: String(lesson?.vietnamese || '').trim(),
      meaningVi: String(lesson?.meaningVi || '').trim(),
      noteVi: String(lesson?.noteVi || '').trim(),
      grammarNote: String(lesson?.grammarNote || '').trim()
    };
  });
  const normalizedLessonLines = lessons.map((lesson) => normalizeChinese(lesson.chinese)).filter(Boolean);
  if (new Set(normalizedLessonLines).size !== normalizedLessonLines.length) errors.push('Các câu tiếng Trung trong cùng một kịch bản không được lặp lại.');
  const ctaSurfaces = [script.title, script.hook, script.thumbnailTitle, script.caption, ...lessons.flatMap((lesson) => [lesson?.chinese, lesson?.vietnamese, lesson?.term, lesson?.meaningVi, lesson?.noteVi, lesson?.grammarNote])];
  if (ctaSurfaces.some(containsChineseFollowCta)) errors.push('Nội dung tiếng Trung không được có lời kêu gọi follow, theo dõi hoặc đăng ký kênh.');
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  if (requireScenes && (scenes.length < 2 || scenes.length > 4 || scenes.some((scene) => typeof scene?.description !== 'string' || !scene.description.trim()))) errors.push('Kịch bản cần 2 đến 4 mô tả cảnh đời thường bằng tiếng Việt.');
  if (errors.length) throw new Error(errors.join(' '));
  script.presentationStyle = presentationStyle;
  script.lessons = lessons;
  script.lessonPoint = lessons[0];
  script.dialogues = lessons;
  script.caption = String(script.caption || '').trim();
  script.hashtags = Array.isArray(script.hashtags) ? script.hashtags : [];
  const punctuationDirection = (chinese) => /[?？]/u.test(chinese)
    ? '这是一句问句，句尾自然上扬，保持像真实交流。'
    : /[!！]/u.test(chinese)
      ? '根据感叹语气稍微提起情绪，避免夸张。'
      : '根据句子意思自然安排语气，不要机械地逐字匀速朗读。';
  const standardMandarinDirection = '保留参考音频中的说话人音色。请用标准普通话，以亲切、明快、有交流感的短视频中文老师语气朗读。根据句意和标点改变轻重、停顿与音量；重点表达稍加重并略微提高音量，其他部分自然放轻，避免喊叫或夸张表演。声调准确，咬字清楚。只朗读提供的汉字，不要添加、删改文字。';
  const speechSegments = [];
  for (const [index, dialogue] of lessons.entries()) {
    const dialogueIndex = index;
    const turnId = `zh-lesson-${index + 1}`;
    const targetDirection = standardMandarinDirection + punctuationDirection(dialogue.chinese);
    speechSegments.push(
      { turnId, segmentId: `zh-vietnamese-source-${index + 1}`, speakerId: 'vi-default', language: 'vi', text: dialogue.vietnamese, state: 'vietnamese', pauseAfterSeconds: 0.85, target: { layerId: 'vietnamese-card', dialogueIndex } },
      { turnId, segmentId: `zh-reading-1-${index + 1}`, speakerId: 'zh-default', language: 'zh', text: dialogue.chinese, ttsDirection: targetDirection + `首次自然完整朗读，按拼音“${dialogue.pinyin}”准确处理每个字的声调；短语“${dialogue.term}”稍作强调，句末轻松收住。`, ttsSpeed: 0.85, state: 'bilingual', pauseAfterSeconds: 0.55, target: { layerId: 'chinese-card', dialogueIndex, pinyinVisible: false } },
      { turnId, segmentId: `zh-reading-2-${index + 1}`, speakerId: 'zh-default', language: 'zh', text: dialogue.chinese, ttsDirection: targetDirection + `这是教学复读，停顿由语意自然安排，按意群清楚分开；短语“${dialogue.term}”比周围字稍重、稍响，其余部分放轻，按拼音“${dialogue.pinyin}”准确处理声调。`, ttsSpeed: 0.8, state: 'bilingual', pauseAfterSeconds: 0.35, target: { layerId: 'chinese-card', dialogueIndex, pinyinVisible: true } }
    );
    if (dialogue.term && dialogue.meaningVi) {
      const numberedScenario = presentationStyle === 'numbered-scenario';
      const vietnamesePhraseExplanation = [dialogue.meaningVi, dialogue.noteVi, dialogue.grammarNote]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .map((part) => /[.!?…。！？]$/u.test(part) ? part : `${part}.`)
        .join(' ');
      speechSegments.push({
        turnId,
        segmentId: `zh-practice-${index + 1}`,
        speakerId: 'zh-default',
        language: 'zh',
        text: dialogue.term,
        ttsSpeed: 0.85,
        ttsDirection: targetDirection + (numberedScenario
          ? `请单独、稍慢地朗读重点短语，音节清楚并保持连贯；按拼音“${dialogue.termPinyin}”准确发音，不要添加其他词。`
          : `像带领观众跟读一样，清楚、自信地说出重点短语；音节分明但保持连贯，目标词稍微加重并提高音量，最后自然收轻。按拼音“${dialogue.termPinyin}”准确发音，不要添加其他词。`),
        state: 'vocabulary',
        pauseAfterSeconds: numberedScenario ? 0.4 : 0.5,
        target: { layerId: 'vocabulary', dialogueIndex, pinyin: dialogue.termPinyin }
      });
      speechSegments.push({
        turnId,
        segmentId: `zh-explanation-vi-${index + 1}`,
        speakerId: 'vi-default',
        language: 'vi',
        text: vietnamesePhraseExplanation,
        state: 'vocabulary',
        pauseAfterSeconds: 0.35,
        target: { layerId: 'vocabulary', dialogueIndex }
      });
    }
  }
  script.speechSegments = speechSegments.filter((segment) => segment.state !== 'cta' && segment.target?.layerId !== 'cta');
  script.createdAt = originalCreatedAt || new Date().toISOString();
  script.id = originalId || crypto.randomUUID();
  script.contentHash = contentHash(script);
  return script;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordCount(value) { return String(value || '').trim().split(/\s+/u).filter(Boolean).length; }
function englishTexts(dialogue) {
  if (/^(en|english)(-|$)/i.test(String(dialogue?.language || dialogue?.locale || '')) && dialogue?.text) return [dialogue.text];
  if (Array.isArray(dialogue?.turns) && dialogue.turns.length) return dialogue.turns.filter((turn) => /^(en|english)(-|$)/i.test(String(turn?.language || turn?.locale || ''))).map((turn) => turn.text).filter(Boolean);
  return [dialogue?.english].filter(Boolean);
}
function targetTexts(dialogue, field) {
  if (field === 'english') return englishTexts(dialogue);
  const language = field === 'japanese' ? /^(ja|japanese)(-|$)/i : /^(zh|chinese)(-|$)/i;
  if (Array.isArray(dialogue?.turns) && dialogue.turns.length) return dialogue.turns.filter((turn) => language.test(String(turn?.language || turn?.locale || ''))).map((turn) => turn.text).filter(Boolean);
  return [dialogue?.[field]].filter(Boolean);
}
function vietnameseTexts(dialogue) {
  if (/^(vi|vietnamese)(-|$)/i.test(String(dialogue?.language || dialogue?.locale || '')) && dialogue?.text) return [dialogue.text];
  if (Array.isArray(dialogue?.turns) && dialogue.turns.length) return dialogue.turns.filter((turn) => /^(vi|vietnamese)(-|$)/i.test(String(turn?.language || turn?.locale || ''))).map((turn) => turn.text).filter(Boolean);
  return [dialogue?.vietnamese].filter(Boolean);
}
function speechSegments(script) {
  if (Array.isArray(script?.speechSegments) && script.speechSegments.length) return script.speechSegments;
  return Array.isArray(script?.audioSegments) ? script.audioSegments : [];
}
function contentItems(script) {
  return [...(Array.isArray(script?.dialogues) ? script.dialogues : []), ...speechSegments(script)];
}
function isChineseCta(item) {
  return item?.target?.layerId === 'cta' || item?.segmentId === 'zh-cta-vi' || containsChineseFollowCta(item?.text);
}
