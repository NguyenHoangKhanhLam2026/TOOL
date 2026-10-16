const TICKS_PER_SECOND = 10_000_000;

export const DEFAULT_HIGHLIGHT_SETTINGS = Object.freeze({
  highlightEnabled: true,
  highlightMode: 'word',
  highlightColor: '#FF8066',
  highlightPadding: 6,
  highlightRadius: 8,
  highlightTransition: 'instant'
});

export function normalizeLanguage(value) {
  const language = String(value || '').trim().toLocaleLowerCase('en-US');
  if (language === 'vi' || language === 'vietnamese' || language.startsWith('vi-')) return 'vi';
  if (language === 'en' || language === 'english' || language.startsWith('en-')) return 'en';
  return language || 'und';
}

export function defaultDialogueSegmentId(index, language, dialogue = {}) {
  const stableId = safeId(dialogue.id ?? dialogue.index ?? index + 1);
  return `dialogue-${stableId}-${normalizeLanguage(language)}`;
}

export function tokenizeText(value, segmentId = 'segment') {
  const text = String(value ?? '');
  const tokens = [];
  for (const match of text.matchAll(/\S+/gu)) {
    const normalized = normalizeWord(match[0]);
    if (!normalized) continue;
    const index = tokens.length;
    tokens.push({
      id: `${safeId(segmentId)}:word:${index + 1}`,
      index,
      text: match[0],
      normalized,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

export function normalizeWord(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[‘’`]/gu, "'")
    .replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '')
    .trim();
}

const SMALL_NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_NUMBER_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

function underThousandToWords(value) {
  const words = [];
  let rest = value;
  if (rest >= 100) {
    words.push(SMALL_NUMBER_WORDS[Math.floor(rest / 100)], 'hundred');
    rest %= 100;
  }
  if (rest >= 20) {
    words.push(TENS_NUMBER_WORDS[Math.floor(rest / 10)]);
    if (rest % 10) words.push(SMALL_NUMBER_WORDS[rest % 10]);
  } else if (rest > 0 || words.length === 0) words.push(SMALL_NUMBER_WORDS[rest]);
  return words;
}

function integerToEnglishWords(digits) {
  const normalized = String(digits).replace(/^\+/, '');
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  if (/^0\d+/u.test(unsigned)) {
    return [...(negative ? ['minus'] : []), ...[...unsigned].map((digit) => SMALL_NUMBER_WORDS[Number(digit)])];
  }
  let value;
  try { value = BigInt(unsigned || '0'); } catch { return [...unsigned].map((digit) => SMALL_NUMBER_WORDS[Number(digit)]); }
  if (value === 0n) return ['zero'];
  const groups = [];
  while (value > 0n && groups.length <= NUMBER_SCALES.length) {
    groups.push(Number(value % 1000n));
    value /= 1000n;
  }
  if (value > 0n) return [...unsigned].map((digit) => SMALL_NUMBER_WORDS[Number(digit)]);
  const words = negative ? ['minus'] : [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!groups[index]) continue;
    words.push(...underThousandToWords(groups[index]));
    if (NUMBER_SCALES[index]) words.push(NUMBER_SCALES[index]);
  }
  return words;
}

function numberTokenToEnglish(integerPart, decimalPart = '', percent = '') {
  const integerDigits = integerPart.replaceAll(',', '');
  const words = integerToEnglishWords(integerDigits);
  if (decimalPart) words.push('point', ...[...decimalPart].map((digit) => SMALL_NUMBER_WORDS[Number(digit)]));
  if (percent) words.push('percent');
  return words.join(' ');
}

export function prepareSpeechText(value, language) {
  const text = String(value ?? '');
  if (normalizeLanguage(language) !== 'en') return text;
  return text.replace(/(?<![\p{L}\p{N}])(-?\d{1,3}(?:,\d{3})+|-?\d+)(?:\.(\d+))?(%?)(?![\p{L}\p{N}])/gu,
    (match, integerPart, decimalPart = '', percent = '', offset, source) => {
      // In compounds such as “12-year-old”, the first hyphen is punctuation,
      // not a negative sign. Keep it in the source and spell the positive number.
      if (integerPart.startsWith('-') && /^-[\p{L}]/u.test(source.slice(offset + match.length))) integerPart = integerPart.slice(1);
      return numberTokenToEnglish(integerPart, decimalPart, percent);
    });
}

export function mapWordBoundariesToTokens(value, boundaries, segmentId = 'segment', { language = 'und' } = {}) {
  const tokens = tokenizeText(value, segmentId);
  const mappingLanguage = normalizeLanguage(language);
  const speechTokens = [];
  for (const token of tokens) {
    const expectedText = mappingLanguage === 'en' ? prepareSpeechText(token.text, mappingLanguage) : token.text;
    for (const part of tokenizeBoundaryText(expectedText)) speechTokens.push({ normalized: part, token });
  }
  const source = Array.isArray(boundaries) ? boundaries : [];
  const mappedByToken = new Map();
  const unmatchedBoundaries = [];
  const unmatchedTokens = new Set(tokens.map((token) => token.id));
  let speechCursor = 0;
  const matchedBoundaryIndexes = new Set();

  for (const [boundaryIndex, boundary] of source.entries()) {
    const boundaryText = String(boundary?.text ?? '');
    const parts = tokenizeBoundaryText(boundaryText);
    const offsetTicks = finiteNumber(boundary?.offsetTicks ?? boundary?.offset);
    const durationTicks = finiteNumber(boundary?.durationTicks ?? boundary?.duration);
    const startSeconds = Number.isFinite(finiteNumber(boundary?.startSeconds))
      ? Math.max(0, finiteNumber(boundary.startSeconds))
      : Number.isFinite(offsetTicks) ? Math.max(0, offsetTicks / TICKS_PER_SECOND) : NaN;
    const endSeconds = Number.isFinite(finiteNumber(boundary?.endSeconds))
      ? Math.max(startSeconds, finiteNumber(boundary.endSeconds))
      : Number.isFinite(offsetTicks) && Number.isFinite(durationTicks)
        ? Math.max(startSeconds, (offsetTicks + durationTicks) / TICKS_PER_SECOND)
        : NaN;

    if (!parts.length || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      unmatchedBoundaries.push({ index: boundaryIndex, text: boundaryText, reason: 'invalid-or-empty-boundary' });
      continue;
    }

    for (const part of parts) {
      let matchIndex = -1;
      for (let index = speechCursor; index < Math.min(speechTokens.length, speechCursor + 12); index += 1) {
        if (speechTokens[index].normalized === part) { matchIndex = index; break; }
      }

      if (matchIndex < 0) {
        unmatchedBoundaries.push({ index: boundaryIndex, text: part, reason: 'no-monotonic-text-match' });
        continue;
      }

      const token = speechTokens[matchIndex].token;
      unmatchedTokens.delete(token.id);
      matchedBoundaryIndexes.add(boundaryIndex);
      speechCursor = matchIndex + 1;
      const existing = mappedByToken.get(token.id);
      if (existing) {
        existing.startSeconds = Math.min(existing.startSeconds, startSeconds);
        existing.endSeconds = Math.max(existing.endSeconds, endSeconds);
        existing.boundaryText = `${existing.boundaryText} ${boundaryText}`.trim();
        existing.boundaryIndexes.push(boundaryIndex);
      } else {
        mappedByToken.set(token.id, {
          segmentId: safeId(segmentId),
          tokenId: token.id,
          tokenIndex: token.index,
          text: token.text,
          boundaryText,
          boundaryIndex,
          boundaryIndexes: [boundaryIndex],
          startSeconds,
          endSeconds,
          offsetTicks: Number.isFinite(offsetTicks) ? offsetTicks : undefined,
          durationTicks: Number.isFinite(durationTicks) ? durationTicks : undefined
        });
      }
    }
  }

  const ordered = [...mappedByToken.values()].sort((left, right) => left.startSeconds - right.startSeconds || left.tokenIndex - right.tokenIndex);
  const mappedBoundaryCount = matchedBoundaryIndexes.size;
  const alignment = {
    status: source.length === 0 ? 'unavailable' : unmatchedBoundaries.length || unmatchedTokens.size ? 'partial' : 'aligned',
    totalBoundaryCount: source.length,
    mappedBoundaryCount,
    mappedTokenCount: ordered.length,
    unmatchedBoundaryCount: source.length - matchedBoundaryIndexes.size,
    unmatchedTokenCount: unmatchedTokens.size,
    reliable: source.length > 0 && unmatchedBoundaries.length === 0 && unmatchedTokens.size === 0 && ordered.length > 0,
    unmatchedBoundaries,
    unmatchedTokenIds: [...unmatchedTokens]
  };
  return { segmentId: safeId(segmentId), tokens, wordTimings: ordered, alignment };
}

export function buildHighlightIntervals(wordTimings, mode = 'word', { phraseSize = 3, pauseThreshold = 0.32 } = {}) {
  const entries = (Array.isArray(wordTimings) ? wordTimings : [])
    .filter((word) => word?.tokenId && Number.isFinite(Number(word.startSeconds)) && Number.isFinite(Number(word.endSeconds)) && Number(word.endSeconds) > Number(word.startSeconds))
    .slice()
    .sort((left, right) => Number(left.startSeconds) - Number(right.startSeconds) || Number(left.tokenIndex) - Number(right.tokenIndex));
  if (mode !== 'phrase') {
    return entries.map((word, index) => ({
      id: `${word.tokenId}:interval:${index + 1}`,
      segmentId: word.segmentId,
      tokenIds: [word.tokenId],
      startSeconds: Number(word.startSeconds),
      endSeconds: Number(word.endSeconds),
      words: [word.text]
    }));
  }

  const groups = [];
  let group = [];
  const maxWords = Math.max(2, Math.min(8, Number(phraseSize) || 3));
  for (const word of entries) {
    const previous = group.at(-1);
    const gap = previous ? Number(word.startSeconds) - Number(previous.endSeconds) : 0;
    if (group.length && (gap > pauseThreshold || /[.!?;:]\s*$/u.test(previous.text || '') || group.length >= maxWords)) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);

  return groups.map((items, index) => ({
    id: `${items[0].tokenId}:phrase:${index + 1}`,
    segmentId: items[0].segmentId,
    tokenIds: [...new Set(items.map((word) => word.tokenId))],
    startSeconds: Number(items[0].startSeconds),
    endSeconds: Number(items.at(-1).endSeconds),
    words: items.map((word) => word.text)
  }));
}

export function findActiveHighlight(intervals, currentTime) {
  const time = Number(currentTime);
  if (!Number.isFinite(time)) return null;
  return (Array.isArray(intervals) ? intervals : []).find((interval) => time >= Number(interval.startSeconds) && time < Number(interval.endSeconds)) || null;
}

export function buildAudioTimeline(sequence, { startTime = 0 } = {}) {
  let cursor = Math.max(0, Number(startTime) || 0);
  const entries = [];
  for (const [index, item] of (Array.isArray(sequence) ? sequence : []).entries()) {
    const duration = Math.max(0, Number(item?.duration) || 0);
    const start = cursor;
    const end = start + duration;
    const wordTimings = (Array.isArray(item?.wordTimings) ? item.wordTimings : []).map((word) => ({
      ...word,
      startTime: start + Math.max(0, Number(word.startSeconds) || 0),
      endTime: start + Math.min(duration, Math.max(Number(word.startSeconds) || 0, Number(word.endSeconds) || 0))
    })).filter((word) => word.endTime > word.startTime && word.startTime < end);
    entries.push({ ...item, sequenceIndex: index, startTime: start, endTime: end, duration, wordTimings });
    cursor = end;
  }
  return { entries, startTime: Math.max(0, Number(startTime) || 0), endTime: cursor, duration: cursor - Math.max(0, Number(startTime) || 0) };
}

export function createSpeechSegments(script, settings = {}) {
  const explicit = Array.isArray(script?.speechSegments) && script.speechSegments.length
    ? script.speechSegments
    : Array.isArray(script?.audioSegments) && script.audioSegments.length
      ? script.audioSegments
      : null;
  const segments = [];

  if (explicit) {
    explicit.forEach((source, index) => {
      const text = String(source?.text ?? '').trim();
      if (!text) return;
      const language = normalizeLanguage(source.language || source.locale || source.voiceName || source.voice || 'und');
      const speakerId = String(source.speakerId || source.speaker || `${language}-speaker-${index + 1}`);
      const segmentId = safeId(source.segmentId || source.id || `speech-${index + 1}`);
      const target = source.target && typeof source.target === 'object' ? source.target : {};
      segments.push({
        segmentId,
        speakerId,
        voiceName: String(source.voiceName || source.voice || settings.speakerVoices?.[speakerId] || voiceForLanguage(settings, language)),
        language,
        rate: String(source.rate || rateForLanguage(settings, language)),
        text,
        speechText: prepareSpeechText(text, language),
        order: segments.length,
        turnId: String(source.turnId || source.groupId || segmentId),
        state: source.state || (language === 'en' ? 'bilingual' : 'vietnamese'),
        target: {
          ...target,
          id: String(target.id || segmentId),
          layerId: String(target.layerId || source.layerId || defaultLayerForLanguage(language)),
          dialogueIndex: Number.isInteger(Number(target.dialogueIndex ?? source.dialogueIndex)) ? Number(target.dialogueIndex ?? source.dialogueIndex) : index,
          text
        }
      });
    });
    appendVocabularySpeech(script, settings, segments);
  } else {
    const dialogues = Array.isArray(script?.dialogues) ? script.dialogues : [];
    dialogues.forEach((dialogue, index) => {
      if (Array.isArray(dialogue?.turns) && dialogue.turns.length) {
        dialogue.turns.forEach((turn, turnIndex) => {
          const language = normalizeLanguage(turn?.language || turn?.locale || turn?.voiceName || turn?.voice || 'und');
          const text = String(turn?.text ?? '').trim();
          if (!text) return;
          const segmentId = `${safeId(dialogue.id || `dialogue-${index + 1}`)}-turn-${safeId(turn.id || turnIndex + 1)}`;
          const speakerId = String(turn.speakerId || turn.speaker || `speaker-${turnIndex + 1}`);
          const target = turn.target && typeof turn.target === 'object' ? turn.target : {};
          segments.push({
            segmentId,
            speakerId,
            voiceName: String(turn.voiceName || turn.voice || settings.speakerVoices?.[speakerId] || voiceForLanguage(settings, language)),
            language,
            rate: String(turn.rate || rateForLanguage(settings, language)),
            text,
            speechText: prepareSpeechText(text, language),
            order: segments.length,
            turnId: String(turn.turnId || dialogue.id || `dialogue-${index + 1}`),
            state: turn.state || (language === 'en' ? 'bilingual' : 'vietnamese'),
            target: {
              ...target,
              id: String(target.id || segmentId),
              layerId: String(target.layerId || defaultLayerForLanguage(language)),
              dialogueIndex: Number.isInteger(Number(target.dialogueIndex ?? index)) ? Number(target.dialogueIndex ?? index) : index,
              text
            }
          });
        });
        appendVocabularySpeechForDialogue(dialogue, index, settings, segments);
        return;
      }

      for (const item of [
        { language: 'vi', text: dialogue?.vietnamese, voiceName: dialogue?.vietnameseVoiceName || dialogue?.viVoiceName, speakerId: dialogue?.vietnameseSpeakerId || dialogue?.speakers?.vi, rate: dialogue?.vietnameseRate, layerId: 'vietnamese-card' },
        { language: 'en', text: dialogue?.english, voiceName: dialogue?.englishVoiceName || dialogue?.enVoiceName, speakerId: dialogue?.englishSpeakerId || dialogue?.speakers?.en, rate: dialogue?.englishRate, layerId: 'english-card' }
      ]) {
        const text = String(item.text ?? '').trim();
        if (!text) continue;
        const segmentId = defaultDialogueSegmentId(index, item.language, dialogue);
        const speakerId = String(item.speakerId || `${item.language}-default`);
        segments.push({
          segmentId,
          speakerId,
          voiceName: String(item.voiceName || settings.speakerVoices?.[speakerId] || voiceForLanguage(settings, item.language)),
          language: item.language,
          rate: String(item.rate || rateForLanguage(settings, item.language)),
          text,
          speechText: prepareSpeechText(text, item.language),
          order: segments.length,
          turnId: String(dialogue?.id || `dialogue-${index + 1}`),
          state: item.language === 'en' ? 'bilingual' : 'vietnamese',
          target: { id: segmentId, layerId: item.layerId, dialogueIndex: index, text }
        });
      }
      appendVocabularySpeechForDialogue(dialogue, index, settings, segments);
    });
  }

  if (!segments.length) throw new Error('Kịch bản không có đoạn văn bản nào để đọc.');
  appendCtaSpeech(settings, segments);
  segments.forEach((segment, index) => { segment.order = index; });

  const ids = new Set();
  for (const segment of segments) {
    if (ids.has(segment.segmentId)) throw new Error(`ID đoạn đọc bị trùng: ${segment.segmentId}`);
    ids.add(segment.segmentId);
  }
  if (!segments.length) throw new Error('Kịch bản không có đoạn văn bản nào để đọc.');
  return segments;
}

function appendCtaSpeech(settings, segments) {
  const text = 'Follow kênh để luyện phản xạ tiếng Anh mỗi ngày!';
  const existing = segments.find((segment) => segment.target?.layerId === 'cta' || segment.state === 'cta');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].target?.layerId === 'cta' || segments[index].state === 'cta') segments.splice(index, 1);
  }
  const speakerId = 'vi-default';
  let segmentId = existing?.segmentId || 'video-cta-vi';
  let duplicateIndex = 2;
  while (segments.some((segment) => segment.segmentId === segmentId)) {
    segmentId = `video-cta-vi-${duplicateIndex}`;
    duplicateIndex += 1;
  }
  segments.push({
    segmentId,
    speakerId,
    voiceName: String(settings.speakerVoices?.[speakerId] || voiceForLanguage(settings, 'vi')),
    language: 'vi',
    rate: String(rateForLanguage(settings, 'vi')),
    text,
    speechText: prepareSpeechText(text, 'vi'),
    order: segments.length,
    turnId: 'video-cta',
    state: 'cta',
    target: { id: segmentId, layerId: 'cta', dialogueIndex: 0, text }
  });
}

function appendVocabularySpeech(script, settings, segments) {
  const dialogues = Array.isArray(script?.dialogues) ? script.dialogues : [];
  for (const [index, dialogue] of dialogues.entries()) {
    const existing = segments.find((segment) => segment.target?.layerId === 'vocabulary'
      && Number(segment.target?.dialogueIndex) === index);
    if (existing) continue;
    const vocabulary = makeVocabularySpeech(dialogue, index, settings);
    if (!vocabulary.length) continue;
    const lastSegmentIndex = segments.reduce((last, segment, segmentIndex) =>
      Number(segment.target?.dialogueIndex) === index ? segmentIndex : last, -1);
    segments.splice(lastSegmentIndex < 0 ? segments.length : lastSegmentIndex + 1, 0, ...vocabulary);
  }
}

function appendVocabularySpeechForDialogue(dialogue, index, settings, segments) {
  const vocabulary = makeVocabularySpeech(dialogue, index, settings);
  if (vocabulary.length) segments.push(...vocabulary);
}

function makeVocabularySpeech(dialogue, index, settings) {
  const term = String(dialogue?.term ?? '').trim();
  const meaningVi = String(dialogue?.meaningVi ?? '').trim();
  if (!term || !meaningVi) return [];
  const baseSegmentId = `${defaultDialogueSegmentId(index, 'vi', dialogue)}-vocabulary`;
  const englishSpeakerId = String(dialogue?.englishSpeakerId || dialogue?.speakers?.en || 'en-default');
  const vietnameseSpeakerId = String(dialogue?.vietnameseSpeakerId || dialogue?.speakers?.vi || 'vi-default');
  const turnId = String(dialogue?.id || `dialogue-${index + 1}`);
  return [
    {
      segmentId: `${baseSegmentId}-term`,
      speakerId: englishSpeakerId,
      voiceName: String(dialogue?.englishVoiceName || dialogue?.enVoiceName || settings.speakerVoices?.[englishSpeakerId] || voiceForLanguage(settings, 'en')),
      language: 'en',
      rate: String(dialogue?.englishRate || rateForLanguage(settings, 'en')),
      text: term,
      speechText: prepareSpeechText(term, 'en'),
      order: Number.MAX_SAFE_INTEGER,
      turnId,
      state: 'vocabulary',
      target: { id: `${baseSegmentId}-term`, layerId: 'vocabulary', dialogueIndex: index, text: term }
    },
    {
      segmentId: `${baseSegmentId}-meaning`,
      speakerId: vietnameseSpeakerId,
      voiceName: String(dialogue?.vietnameseVoiceName || dialogue?.viVoiceName || settings.speakerVoices?.[vietnameseSpeakerId] || voiceForLanguage(settings, 'vi')),
      language: 'vi',
      rate: String(dialogue?.vietnameseRate || rateForLanguage(settings, 'vi')),
      text: meaningVi,
      speechText: prepareSpeechText(meaningVi, 'vi'),
      order: Number.MAX_SAFE_INTEGER,
      turnId,
      state: 'vocabulary',
      target: { id: `${baseSegmentId}-meaning`, layerId: 'vocabulary', dialogueIndex: index, text: meaningVi }
    }
  ];
}

function tokenizeBoundaryText(value) {
  return String(value ?? '').split(/\s+/u).map(normalizeWord).filter(Boolean);
}

function defaultLayerForLanguage(language) { return language === 'vi' ? 'vietnamese-card' : 'english-card'; }
function voiceForLanguage(settings, language) { return language === 'vi' ? settings.viVoice || 'vi-VN-HoaiMyNeural' : settings.enVoice || 'en-US-AndrewNeural'; }
function rateForLanguage(settings, language) { return language === 'vi' ? settings.viRate || '+0%' : settings.enRate || '+0%'; }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : NaN; }
function safeId(value) { return String(value ?? 'segment').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100) || 'segment'; }
