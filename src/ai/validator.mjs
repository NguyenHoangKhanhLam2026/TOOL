import { createHash } from 'node:crypto';

export function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

export function contentHash(script) {
  const basis = [script.topic, ...script.dialogues.map((item) => item.english)].map(normalizeText).join('|');
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
  for (const line of script.dialogues) {
    for (const recent of recentSentences) {
      if (sentenceSimilarity(line.english, recent) >= threshold) throw new Error('Câu tiếng Anh quá giống nội dung gần đây; hãy tạo cách diễn đạt khác.');
    }
  }
  return script;
}

export function assertDistinctFromHistory(script, history, threshold = 0.82) {
  for (const previous of history) {
    for (const line of script.dialogues) {
      for (const saved of previous) {
        if (sentenceSimilarity(line.english, saved.english) >= threshold) {
          throw new Error(`C\u00e2u ti\u1ebfng Anh g\u1ea7n gi\u1ed1ng n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${saved.english}".`);
        }
        if (sentenceSimilarity(line.vietnamese, saved.vietnamese) >= threshold) {
          throw new Error(`C\u00e2u ti\u1ebfng Vi\u1ec7t g\u1ea7n gi\u1ed1ng n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${saved.vietnamese}".`);
        }
        if (normalizeText(line.term) && normalizeText(line.term) === normalizeText(saved.term)) {
          throw new Error(`C\u1ee5m t\u1eeb tr\u1ecdng t\u00e2m \u0111\u00e3 xu\u1ea5t hi\u1ec7n trong n\u1ed9i dung \u0111\u00e3 l\u01b0u: "${saved.term}".`);
        }
      }
    }
  }
  return script;
}

export function validateScript(raw, { maxLineChars = 150 } = {}) {
  const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const errors = [];
  if (!script || typeof script !== 'object') throw new Error('Kịch bản không phải đối tượng JSON.');
  for (const key of ['topic', 'category', 'level', 'title', 'hook', 'caption', 'thumbnailTitle']) {
    if (typeof script[key] !== 'string' || !script[key].trim()) errors.push(`Thiếu trường ${key}.`);
  }
  if (!Array.isArray(script.dialogues) || script.dialogues.length !== 3) errors.push('Kịch bản phải có đúng 3 cặp câu.');
  for (const [i, d] of (script.dialogues || []).entries()) {
    for (const key of ['vietnamese', 'english', 'term', 'meaningVi', 'noteVi']) {
      if (typeof d?.[key] !== 'string' || !d[key].trim()) errors.push(`Câu ${i + 1}: thiếu ${key}.`);
    }
    if (d?.term && d?.english && !new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(d.term)}([^\\p{L}\\p{N}]|$)`, 'iu').test(d.english)) {
      errors.push(`Cụm từ trọng tâm “${d.term}” không xuất hiện nguyên văn trong câu tiếng Anh.`);
    }
    if (d?.english?.length > maxLineChars || d?.vietnamese?.length > Math.max(180, maxLineChars)) errors.push(`Câu ${i + 1} quá dài để hiển thị.`);
  }
  if (Array.isArray(script.dialogues) && new Set(script.dialogues.map((d) => normalizeText(d?.english))).size !== script.dialogues.length) errors.push('Các câu tiếng Anh bị lặp.');
  if (Array.isArray(script.dialogues) && new Set(script.dialogues.map((dialogue) => normalizeText(dialogue?.term))).size !== script.dialogues.length) errors.push('A key phrase is repeated within the script.');
  if (errors.length) throw new Error(errors.join(' '));
  script.dialogues.forEach((d, i) => { d.index = i + 1; d.grammarNote ||= ''; });
  if (!Array.isArray(script.hashtags)) script.hashtags = [];
  script.createdAt = new Date().toISOString();
  script.id = crypto.randomUUID();
  script.contentHash = contentHash(script);
  return script;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
