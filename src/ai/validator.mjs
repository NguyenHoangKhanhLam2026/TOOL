import { createHash } from 'node:crypto';

export function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

export function contentHash(script) {
  const dialogueText = (Array.isArray(script.dialogues) ? script.dialogues : []).flatMap((item) => [
    item?.english,
    item?.vietnamese,
    ...(Array.isArray(item?.turns) ? item.turns.map((turn) => turn?.text) : [])
  ]);
  const speechText = [
    ...(Array.isArray(script.speechSegments) ? script.speechSegments : []),
    ...(Array.isArray(script.audioSegments) ? script.audioSegments : [])
  ].map((item) => item?.text);
  const basis = [script.topic, ...dialogueText, ...speechText].map(normalizeText).join('|');
  return createHash('sha256').update(basis).digest('hex');
}

export function sentenceSimilarity(left, right) {
  const a = new Set(normalizeText(left).split(' ').filter(Boolean));
  const b = new Set(normalizeText(right).split(' ').filter(Boolean));
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
  for (const previous of history) {
    const previousItems = Array.isArray(previous)
      ? previous
      : [...(Array.isArray(previous?.dialogues) ? previous.dialogues : []), ...speechSegments(previous)];
    for (const line of contentItems(script)) {
      for (const saved of previousItems) {
        for (const text of englishTexts(line)) for (const previousText of englishTexts(saved)) {
          if (sentenceSimilarity(text, previousText) >= threshold) throw new Error(`C\u00e2u ti\u1ebfng Anh g\u1ea7n gi\u1ed1ng n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${previousText}".`);
        }
        for (const text of vietnameseTexts(line)) for (const previousText of vietnameseTexts(saved)) {
          if (sentenceSimilarity(text, previousText) >= threshold) throw new Error(`C\u00e2u ti\u1ebfng Vi\u1ec7t g\u1ea7n gi\u1ed1ng n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${previousText}".`);
        }
        if (normalizeText(line.term) && normalizeText(line.term) === normalizeText(saved.term)) {
          throw new Error(`C\u1ee5m t\u1eeb tr\u1ecdng t\u00e2m \u0111\u00e3 xu\u1ea5t hi\u1ec7n trong n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${saved.term}".`);
        }
      }
    }
  }
  return script;
}

export function validateScript(raw) {
  const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const errors = [];
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
    for (const key of ['vietnamese', 'english', 'term', 'meaningVi', 'noteVi']) {
      if (typeof d?.[key] !== 'string' || !d[key].trim()) errors.push(`Câu ${i + 1}: thiếu ${key}.`);
    }
    if (d?.term && d?.english && !new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(d.term)}([^\\p{L}\\p{N}]|$)`, 'iu').test(d.english)) {
      errors.push(`Cụm từ trọng tâm “${d.term}” không xuất hiện nguyên văn trong câu tiếng Anh.`);
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
  const englishLines = script.dialogues.filter((d) => !Array.isArray(d?.turns)).map((d) => normalizeText(d?.english)).filter(Boolean);
  if (new Set(englishLines).size !== englishLines.length) errors.push('Các câu tiếng Anh bị lặp.');
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

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordCount(value) { return String(value || '').trim().split(/\s+/u).filter(Boolean).length; }
function englishTexts(dialogue) {
  if (/^(en|english)(-|$)/i.test(String(dialogue?.language || dialogue?.locale || '')) && dialogue?.text) return [dialogue.text];
  if (Array.isArray(dialogue?.turns) && dialogue.turns.length) return dialogue.turns.filter((turn) => /^(en|english)(-|$)/i.test(String(turn?.language || turn?.locale || ''))).map((turn) => turn.text).filter(Boolean);
  return [dialogue?.english].filter(Boolean);
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
