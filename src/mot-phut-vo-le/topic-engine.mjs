import { normalizeTitle, hashContent } from './content-validator.mjs';
import { generateTopicCandidates } from './prompt.mjs';

// normalizeForComparison removes Vietnamese diacritics, so the stop-word list
// must use the same normalized spelling or these words remain in the score.
const STOP_WORDS = new Set(['va', 'la', 'cua', 'co', 'khi', 'mot', 'nhung', 'cac', 'vi', 'sao', 'the', 'nao', 'duoc', 'trong', 'voi', 'cho', 'den', 'nay', 'do', 'theo', 'hay', 've']);
const SCRIPT_SENTENCE_DUPLICATE_THRESHOLD = 0.82;

export function normalizeForComparison(value) {
  return normalizeTitle(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd').replace(/[^a-z0-9\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function tokenSet(value) {
  return new Set(normalizeForComparison(value).split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

export function jaccardSimilarity(left, right) {
  const a = tokenSet(left), b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function trigramSimilarity(left, right) {
  const a = new Set(trigrams(normalizeForComparison(left)));
  const b = new Set(trigrams(normalizeForComparison(right)));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function trigrams(value) {
  const padded = `  ${String(value)}  `;
  const result = [];
  for (let index = 0; index < padded.length - 2; index += 1) result.push(padded.slice(index, index + 3));
  return result;
}

export function compareIdeaSimilarity(candidate, previous) {
  const topic = jaccardSimilarity(`${candidate.topic || ''} ${candidate.category || ''} ${candidate.subcategory || ''}`, `${previous.topic || ''} ${previous.category || ''} ${previous.subcategory || ''}`);
  const angle = Math.max(jaccardSimilarity(candidate.angle, previous.angle), trigramSimilarity(candidate.angle, previous.angle));
  const summary = Math.max(jaccardSimilarity(candidate.summary || candidate.titleHint, previous.summary || previous.title), trigramSimilarity(candidate.summary || candidate.titleHint, previous.summary || previous.title));
  const title = Math.max(jaccardSimilarity(candidate.titleHint || candidate.title, previous.title), trigramSimilarity(candidate.titleHint || candidate.title, previous.title));
  return Number((0.30 * topic + 0.34 * angle + 0.21 * summary + 0.15 * title).toFixed(4));
}

function scriptSentences(value) {
  return String(value || '').normalize('NFC').split(/(?<=[.!?。！？])\s+|[\r\n]+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function findRepeatedScriptSentence(candidateText, previousText) {
  const candidateSentences = scriptSentences(candidateText);
  const previousSentences = scriptSentences(previousText);
  for (const candidateSentence of candidateSentences) {
    if (tokenSet(candidateSentence).size < 5) continue;
    for (const previousSentence of previousSentences) {
      if (tokenSet(previousSentence).size < 5) continue;
      const score = Math.max(jaccardSimilarity(candidateSentence, previousSentence), trigramSimilarity(candidateSentence, previousSentence));
      if (score >= SCRIPT_SENTENCE_DUPLICATE_THRESHOLD) return score;
    }
  }
  return 0;
}

export function findIdeaDuplicate(candidate, history = [], threshold = 0.78) {
  const normalizedTitle = normalizeTitle(candidate.titleHint || candidate.title || '');
  const candidateHash = candidate.contentHash || (candidate.scriptText ? hashContent(candidate.scriptText) : null);
  const candidateIdeaKey = normalizeForComparison(`${candidate.topic || ''} ${candidate.angle || ''}`);
  for (const previous of history) {
    // candidateKey is a stored SHA-256 digest; compare normalized source fields
    // here so active and archived records share the same exact-idea check.
    const previousIdeaKey = normalizeForComparison(`${previous.topic || ''} ${previous.angle || ''}`);
    if (candidateIdeaKey && previousIdeaKey && candidateIdeaKey === previousIdeaKey) return { duplicate: true, score: 1, reason: 'idea-key', matchId: previous.id || null };
    if (normalizedTitle && normalizedTitle === normalizeTitle(previous.title)) return { duplicate: true, score: 1, reason: 'title', matchId: previous.id || null };
    if (candidateHash && candidateHash === previous.contentHash) return { duplicate: true, score: 1, reason: 'content-hash', matchId: previous.id || null };
    const repeatedSentence = findRepeatedScriptSentence(candidate.scriptText, previous.scriptText);
    if (repeatedSentence >= SCRIPT_SENTENCE_DUPLICATE_THRESHOLD) {
      return { duplicate: true, score: repeatedSentence, reason: 'script-sentence', matchId: previous.id || null };
    }
    const score = compareIdeaSimilarity(candidate, previous);
    if (score >= threshold) return { duplicate: true, score, reason: 'text-similarity', matchId: previous.id || null };
  }
  return { duplicate: false, score: 0, reason: null, matchId: null };
}

export function rankTopicCandidates(candidates, history = [], { threshold = 0.78 } = {}) {
  return candidates.map((candidate, index) => {
    const novelty = findIdeaDuplicate(candidate, history, threshold);
    const knowledgeValue = score(candidate.knowledgeValue);
    const confidence = score(candidate.confidence);
    const selfReportedNovelty = score(candidate.novelty);
    const quality = knowledgeValue * 0.40 + confidence * 0.35 + selfReportedNovelty * 0.25;
    return { ...candidate, _rank: novelty.duplicate ? -Infinity : quality, _noveltyCheck: novelty, _sourceIndex: index };
  }).sort((left, right) => right._rank - left._rank || left._sourceIndex - right._sourceIndex);
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(5, number)) : 3;
}

export async function discoverFreshTopic({ history = [], categoryHint = '', manualTopic = '', generate, threshold = 0.78, retries = 3 } = {}) {
  let lastReason = 'Không tìm được ứng viên mới.';
  for (let attempt = 0; attempt < Math.max(1, Math.min(5, retries)); attempt += 1) {
    const rawCandidates = await generateTopicCandidates({ recentHistory: history, categoryHint, manualTopic, count: 8 }, generate);
    const candidates = rawCandidates.map(normalizeTopicCandidate).filter(Boolean);
    if (!candidates.length) throw new Error('ChatGPT không trả về ứng viên có đủ lĩnh vực, chủ đề và góc khai thác.');
    const ranked = rankTopicCandidates(candidates, history, { threshold });
    const winner = ranked.find((candidate) => !candidate._noveltyCheck.duplicate);
    if (winner) {
      const { _rank, _noveltyCheck, _sourceIndex, ...idea } = winner;
      return { ...idea, noveltyScore: _rank, duplicateCheck: _noveltyCheck, attempt: attempt + 1 };
    }
    lastReason = 'Tất cả ứng viên quá giống nội dung trong lịch sử.';
  }
  throw Object.assign(new Error(`${lastReason} Hãy mở rộng lĩnh vực hoặc nhập một chủ đề/góc khai thác khác.`), {
    code: 'MOT_PHUT_VO_LE_DUPLICATE_IDEA'
  });
}

export function normalizeTopicCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = {
    category: String(value.category || '').normalize('NFC').trim(),
    subcategory: String(value.subcategory || '').normalize('NFC').trim(),
    topic: String(value.topic || '').normalize('NFC').trim(),
    angle: String(value.angle || '').normalize('NFC').trim(),
    titleHint: String(value.titleHint || '').normalize('NFC').trim(),
    summary: String(value.summary || '').normalize('NFC').trim(),
    knowledgeValue: score(value.knowledgeValue),
    confidence: score(value.confidence),
    novelty: score(value.novelty)
  };
  if (!candidate.category || !candidate.subcategory || !candidate.topic || !candidate.angle) return null;
  if (candidate.category.length > 100 || candidate.subcategory.length > 120 || candidate.topic.length > 180 || candidate.angle.length > 240 || candidate.titleHint.length > 180 || candidate.summary.length > 600) return null;
  return candidate;
}
