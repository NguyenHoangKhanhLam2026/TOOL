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

export function mapWordBoundariesToTokens(value, boundaries, segmentId = 'segment') {
  const tokens = tokenizeText(value, segmentId);
  const source = Array.isArray(boundaries) ? boundaries : [];
  const mapped = [];
  const unmatchedBoundaries = [];
  const unmatchedTokens = new Set(tokens.map((token) => token.id));
  let tokenCursor = 0;

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
      for (let index = tokenCursor; index < Math.min(tokens.length, tokenCursor + 4); index += 1) {
        if (tokens[index].normalized === part) { matchIndex = index; break; }
      }

      if (matchIndex < 0) {
        unmatchedBoundaries.push({ index: boundaryIndex, text: part, reason: 'no-monotonic-text-match' });
        continue;
      }

      const token = tokens[matchIndex];
      unmatchedTokens.delete(token.id);
      mapped.push({
        segmentId: safeId(segmentId),
        tokenId: token.id,
        tokenIndex: token.index,
        text: token.text,
        boundaryText,
        boundaryIndex,
        startSeconds,
        endSeconds,
        offsetTicks: Number.isFinite(offsetTicks) ? offsetTicks : undefined,
        durationTicks: Number.isFinite(durationTicks) ? durationTicks : undefined
      });
      tokenCursor = matchIndex + 1;
    }
  }

  const ordered = mapped.sort((left, right) => left.startSeconds - right.startSeconds || left.boundaryIndex - right.boundaryIndex);
  const mappedBoundaryCount = new Set(ordered.map((entry) => entry.boundaryIndex)).size;
  const alignment = {
    status: source.length === 0 ? 'unavailable' : unmatchedBoundaries.length || unmatchedTokens.size ? 'partial' : 'aligned',
    totalBoundaryCount: source.length,
    mappedBoundaryCount,
    mappedTokenCount: new Set(ordered.map((entry) => entry.tokenId)).size,
    unmatchedBoundaryCount: unmatchedBoundaries.length,
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
          order: segments.length,
          turnId: String(dialogue?.id || `dialogue-${index + 1}`),
          state: item.language === 'en' ? 'bilingual' : 'vietnamese',
          target: { id: segmentId, layerId: item.layerId, dialogueIndex: index, text }
        });
      }
    });
  }

  const ids = new Set();
  for (const segment of segments) {
    if (ids.has(segment.segmentId)) throw new Error(`ID đoạn đọc bị trùng: ${segment.segmentId}`);
    ids.add(segment.segmentId);
  }
  if (!segments.length) throw new Error('Kịch bản không có đoạn văn bản nào để đọc.');
  return segments;
}

function tokenizeBoundaryText(value) {
  return String(value ?? '').split(/\s+/u).map(normalizeWord).filter(Boolean);
}

function defaultLayerForLanguage(language) { return language === 'vi' ? 'vietnamese-card' : 'english-card'; }
function voiceForLanguage(settings, language) { return language === 'vi' ? settings.viVoice || 'vi-VN-HoaiMyNeural' : settings.enVoice || 'en-US-AndrewNeural'; }
function rateForLanguage(settings, language) { return language === 'vi' ? settings.viRate || '+0%' : settings.enRate || '+0%'; }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : NaN; }
function safeId(value) { return String(value ?? 'segment').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100) || 'segment'; }
