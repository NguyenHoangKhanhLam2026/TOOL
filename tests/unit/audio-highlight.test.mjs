import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAudioTimeline, buildHighlightIntervals, createSpeechSegments, findActiveHighlight,
  mapWordBoundariesToTokens, prepareSpeechText, tokenizeText
} from '../../packages/audio-highlight/highlight-engine.mjs';
import { assertChineseRenderQuality, filterChineseCtaAudioFiles, fitVocabularyHold, resolveSpeechTarget } from '../../packages/video-engine/render.mjs';

const ticks = (seconds) => Math.round(seconds * 10_000_000);
const boundary = (text, start, duration = 0.12) => ({ text, offsetTicks: ticks(start), durationTicks: ticks(duration) });

test('English female voice keeps its own voice identity and accurate word timing', () => {
  const segments = createSpeechSegments({ dialogues: [{ id: 'coffee', english: 'Hello there.', vietnamese: 'Xin chào.', term: 'Hello', meaningVi: 'Xin chào', noteVi: '' }] }, { kokoroEnVoice: 'af_bella', vieneuViVoice: 'Mỹ Duyên' });
  const english = segments.find((segment) => segment.language === 'en');
  const mapped = mapWordBoundariesToTokens(english.text, [boundary('Hello', 0.08), boundary('there.', 0.41)], english.segmentId);
  assert.equal(english.voiceName, 'af_bella');
  assert.equal(mapped.alignment.reliable, true);
  assert.deepEqual(mapped.wordTimings.map((word) => word.startSeconds), [0.08, 0.41]);
});

test('Vietnamese male voice override is independent of the English voice', () => {
  const segments = createSpeechSegments({ dialogues: [{ vietnamese: 'Bạn khỏe không?', vietnameseVoiceName: 'vi-VN-NamMinhNeural', english: 'Are you well?', term: 'well', meaningVi: 'khỏe', noteVi: '' }] }, { vieneuViVoice: 'Hải Đăng', kokoroEnVoice: 'am_michael' });
  assert.equal(segments[0].voiceName, 'vi-VN-NamMinhNeural');
  assert.equal(segments[1].voiceName, 'am_michael');
});

test('alternating speakers retain order, speaker IDs, and separate voices', () => {
  const segments = createSpeechSegments({ dialogues: [{ id: 'roleplay', turns: [
    { speakerId: 'a', language: 'en', voiceName: 'af_bella', text: 'Can you help?' },
    { speakerId: 'b', language: 'en', voiceName: 'am_michael', text: 'Of course.' },
    { speakerId: 'a', language: 'vi', voiceName: 'vi-VN-HoaiMyNeural', text: 'Cảm ơn bạn.' }
  ] }] });
  assert.deepEqual(segments.slice(0, 3).map((segment) => segment.speakerId), ['a', 'b', 'a']);
  assert.deepEqual(segments.slice(0, 3).map((segment) => segment.voiceName), ['af_bella', 'am_michael', 'vi-VN-HoaiMyNeural']);
  assert.deepEqual(segments.map((segment) => segment.order), [0, 1, 2, 3]);
  assert.equal(segments.at(-1).target.layerId, 'cta');
});

test('any number of dialogue pairs creates audio segments without a three-pair limit', () => {
  const dialogues = Array.from({ length: 7 }, (_, index) => ({
    id: `d${index + 1}`, vietnamese: `Câu Việt ${index + 1}.`, english: `English line ${index + 1}.`, term: `line ${index + 1}`, meaningVi: `câu ${index + 1}`, noteVi: ''
  }));
  assert.equal(createSpeechSegments({ dialogues }).length, 29);
});

test('Vietnamese phrase audio follows each bilingual dialogue and targets the vocabulary card', () => {
  const segments = createSpeechSegments({ dialogues: [{
    id: 'coffee', vietnamese: 'Bạn uống cà phê không?', english: 'Would you like coffee?',
    term: 'would you like', meaningVi: 'bạn có muốn', noteVi: ''
  }] }, { vieneuViVoice: 'Hải Đăng', kokoroEnVoice: 'af_bella' });
  assert.deepEqual(segments.map((segment) => segment.language), ['vi', 'en', 'en', 'vi', 'vi']);
  assert.equal(segments[2].state, 'vocabulary');
  assert.equal(segments[2].text, 'would you like');
  assert.equal(segments[3].voiceName, 'Hải Đăng');
  assert.equal(segments[3].target.layerId, 'vocabulary');
  assert.equal(segments[3].target.dialogueIndex, 0);
  assert.equal(segments[3].turnId, segments[0].turnId);
  assert.equal(segments[4].target.layerId, 'cta');
});

test('repeated words map to their matching occurrence instead of the first text match', () => {
  const result = mapWordBoundariesToTokens('go go, go', [boundary('go', 0), boundary('go', 0.2), boundary('go', 0.5)], 'repeat');
  assert.equal(result.alignment.reliable, true);
  assert.equal(new Set(result.wordTimings.map((word) => word.tokenId)).size, 3);
  assert.deepEqual(result.wordTimings.map((word) => word.tokenIndex), [0, 1, 2]);
});

test('English digits are spoken as English number words while display text stays unchanged', () => {
  const segments = createSpeechSegments({ dialogues: [{
    vietnamese: 'Tôi cần 12 vé.', english: 'I need 12 tickets and 3 seats.'
  }] });
  const vietnamese = segments.find((segment) => segment.language === 'vi');
  const english = segments.find((segment) => segment.language === 'en');
  assert.equal(vietnamese.speechText, vietnamese.text);
  assert.equal(english.text, 'I need 12 tickets and 3 seats.');
  assert.equal(english.speechText, 'I need twelve tickets and three seats.');
  assert.equal(prepareSpeechText('The price is 1,250.5 or 12%.', 'en'), 'The price is one thousand two hundred fifty point five or twelve percent.');
  assert.equal(prepareSpeechText('A 12-year-old has -3 points.', 'en'), 'A twelve-year-old has minus three points.');
});

test('expanded number words share one accurate timing range with their displayed numeral', () => {
  const mapped = mapWordBoundariesToTokens('I need 21 tickets.', [
    { text: 'I', startSeconds: 0, endSeconds: 0.1 },
    { text: 'need', startSeconds: 0.12, endSeconds: 0.3 },
    { text: 'twenty', startSeconds: 0.31, endSeconds: 0.55 },
    { text: 'one', startSeconds: 0.56, endSeconds: 0.68 },
    { text: 'tickets.', startSeconds: 0.7, endSeconds: 1.1 }
  ], 'number-21', { language: 'en' });
  const numeral = mapped.wordTimings.find((word) => word.text === '21');
  assert.equal(mapped.alignment.reliable, true);
  assert.deepEqual([numeral.startSeconds, numeral.endSeconds, numeral.boundaryText], [0.31, 0.68, 'twenty one']);
});

test('partial real alignment keeps highlight cues for words with known timestamps', () => {
  const mapped = mapWordBoundariesToTokens('Please call us.', [
    { text: 'call', startSeconds: 0.4, endSeconds: 0.7 },
    { text: 'us.', startSeconds: 0.72, endSeconds: 0.9 }
  ], 'partial');
  assert.equal(mapped.alignment.reliable, false);
  assert.deepEqual(buildHighlightIntervals(mapped.wordTimings).map((item) => item.words[0]), ['call', 'us.']);
  assert.deepEqual(mapped.tokens.filter((token) => mapped.alignment.unmatchedTokenIds.includes(token.id)).map((token) => token.text), ['Please']);
});

test('long text has no fixed sentence-character cap and retains every token ID', () => {
  const text = Array.from({ length: 40 }, (_, index) => `word${index + 1}`).join(' ');
  const tokens = tokenizeText(text, 'long');
  const words = text.split(' ');
  const timings = words.map((word, index) => boundary(word, index * 0.2));
  const result = mapWordBoundariesToTokens(text, timings, 'long');
  assert.equal(tokens.length, 40);
  assert.equal(result.alignment.reliable, true);
  assert.equal(result.wordTimings.length, 40);
});

test('duplicate text in different reads has stable, distinct segment IDs', () => {
  const first = mapWordBoundariesToTokens('Read it again.', [boundary('Read', 0), boundary('it', 0.2), boundary('again.', 0.4)], 'read-1');
  const second = mapWordBoundariesToTokens('Read it again.', [boundary('Read', 0), boundary('it', 0.2), boundary('again.', 0.4)], 'read-2');
  assert.notEqual(first.wordTimings[0].tokenId, second.wordTimings[0].tokenId);
});

test('different TTS rates use independent returned offsets rather than even timing estimates', () => {
  const slow = mapWordBoundariesToTokens('One two.', [boundary('One', 0.1, 0.3), boundary('two.', 0.55, 0.4)], 'slow');
  const fast = mapWordBoundariesToTokens('One two.', [boundary('One', 0.03, 0.1), boundary('two.', 0.16, 0.12)], 'fast');
  assert.equal(slow.wordTimings[0].endSeconds, 0.4);
  assert.equal(fast.wordTimings[0].endSeconds, 0.13);
  assert.notEqual(slow.wordTimings[1].startSeconds, fast.wordTimings[1].startSeconds);
});

test('audio timeline accounts for pauses between independently synthesized clips', () => {
  const timeline = buildAudioTimeline([
    { segmentId: 'first', duration: 0.8, wordTimings: [{ tokenId: 'first:word:1', startSeconds: 0.1, endSeconds: 0.3 }] },
    { kind: 'silence', duration: 0.5 },
    { segmentId: 'second', duration: 1.2, wordTimings: [{ tokenId: 'second:word:1', startSeconds: 0.2, endSeconds: 0.5 }] }
  ], { startTime: 1 });
  assert.equal(timeline.entries[2].startTime, 2.3);
  assert.equal(timeline.entries[2].wordTimings[0].startTime, 2.5);
  assert.equal(timeline.endTime, 3.5);
});

test('explicit speech segments are not tied to the bilingual template or a fixed voice pair', () => {
  const segments = createSpeechSegments({ speechSegments: [
    { id: 'narrator', speakerId: 'host', language: 'en-GB', voiceName: 'en-GB-SoniaNeural', text: 'Welcome.', target: { layerId: 'custom-copy' } },
    { id: 'reply', speakerId: 'guest', language: 'vi-VN', voiceName: 'vi-VN-NamMinhNeural', text: 'Xin chào.', target: { layerId: 'custom-copy' } }
  ] });
  assert.equal(segments[0].target.layerId, 'custom-copy');
  assert.deepEqual(segments.map((segment) => segment.language), ['en', 'vi', 'vi']);
  assert.deepEqual(segments.slice(0, 2).map((segment) => segment.voiceName), ['en-GB-SoniaNeural', 'vi-VN-NamMinhNeural']);
  assert.equal(segments.at(-1).target.layerId, 'cta');
});

test('Chinese re-renders discard legacy CTA segments and do not append a new one', () => {
  const segments = createSpeechSegments({
    contentLanguage: 'zh',
    speechSegments: [
      { segmentId: 'zh-lesson', speakerId: 'zh-default', language: 'zh', text: '你好。', state: 'bilingual', target: { layerId: 'chinese-card' } },
      { segmentId: 'zh-cta-vi', speakerId: 'vi-default', language: 'vi', text: 'Theo dõi kênh nhé.', state: 'cta', target: { layerId: 'cta' } }
    ]
  }, { contentLanguage: 'zh' });
  assert.deepEqual(segments.map((segment) => segment.segmentId), ['zh-lesson']);
  assert.equal(segments.some((segment) => segment.state === 'cta' || segment.target.layerId === 'cta'), false);
});

test('Chinese rendering excludes legacy CTA audio even when the audio metadata is incomplete', () => {
  const script = {
    contentLanguage: 'zh',
    speechSegments: [{ segmentId: 'saved-cta-id', state: 'cta' }]
  };
  const files = [
    { segmentId: 'lesson' },
    { segmentId: 'saved-cta-id' },
    { segmentId: 'zh-cta-vi' },
    { segmentId: 'legacy-target', target: { layerId: 'cta' } },
    { segmentId: 'legacy-state', state: 'cta' }
  ];
  assert.deepEqual(filterChineseCtaAudioFiles(script, files).map((item) => item.segmentId), ['lesson']);
  assert.strictEqual(filterChineseCtaAudioFiles({ contentLanguage: 'en' }, files), files);
});

test('Chinese render gate requires the complete script order and an exact content ending', () => {
  const script = { contentLanguage: 'zh', speechSegments: [
    { segmentId: 'lesson-vi', state: 'vietnamese', language: 'vi', text: 'Xin chào.' },
    { segmentId: 'lesson-zh', state: 'bilingual', language: 'zh', text: '你好。' }
  ] };
  const result = {
    duration: 4,
    audioManifest: [
      { segmentId: 'lesson-vi', language: 'vi', text: 'Xin chào.' },
      { segmentId: 'lesson-zh', language: 'zh', text: '你好。' }
    ],
    renderManifest: {
      timeline: [
        { type: 'silence', state: 'intro', start: 0, end: 1 },
        { type: 'speech', state: 'vietnamese', segmentId: 'lesson-vi', start: 1, end: 2.5 },
        { type: 'speech', state: 'bilingual', segmentId: 'lesson-zh', start: 2.5, end: 4 },
        { type: 'silence', state: 'cta', start: 4, end: 4 }
      ],
      durationSeconds: 4,
      synchronization: { checked: true, driftSeconds: 0.01 }
    }
  };
  assert.strictEqual(assertChineseRenderQuality(script, result), result);
  assert.throws(() => assertChineseRenderQuality(script, { ...result, duration: 4.2 }), /phần đuôi/);
  assert.throws(() => assertChineseRenderQuality(script, {
    ...result,
    renderManifest: { ...result.renderManifest, timeline: [...result.renderManifest.timeline, { type: 'speech', state: 'cta', segmentId: 'cta', start: 4, end: 5 }] }
  }), /kêu gọi theo dõi/);
  assert.throws(() => assertChineseRenderQuality(script, {
    ...result,
    audioManifest: [result.audioManifest[0], { ...result.audioManifest[1], text: '再见。' }]
  }), /không khớp kịch bản/);
  assert.deepEqual(assertChineseRenderQuality({ contentLanguage: 'en' }, {}), {});
});

test('a generic template selects a compatible text layer when the default card is absent', () => {
  const template = { layers: [
    { id: 'title', kind: 'text', visible: true },
    { id: 'english-copy', kind: 'text', visible: true, language: 'en' },
    { id: 'vietnamese-copy', kind: 'text', visible: true, language: 'vi' }
  ] };
  const target = resolveSpeechTarget(template, { segmentId: 'reply-1', speakerId: 'speaker-b', language: 'en-US', target: { layerId: 'english-card' } });
  assert.equal(target.layerId, 'english-copy');
});

test('post-phrase vocabulary pause is calculated against total speech and the Reels duration cap', () => {
  assert.equal(fitVocabularyHold({ configuredHold: 5.5, groupCount: 3, speechDuration: 24, intro: 1.25, cta: 2.6, transition: 0.06 }), 5.5);
  const hold = fitVocabularyHold({ configuredHold: 5.5, groupCount: 8, speechDuration: 43, intro: 1.25, cta: 2.6, transition: 0.06 });
  assert.ok(hold < 5.5);
  assert.ok(1.25 + 2.6 + 43 + 8 * 0.06 + 8 * hold <= 60);
});

test('punctuation, contractions, and Vietnamese Unicode remain alignable', () => {
  const english = mapWordBoundariesToTokens("I'm here — aren't you?", [boundary("I'm", 0), boundary('here', 0.2), boundary("aren't", 0.5), boundary('you?', 0.8)], 'unicode-en');
  const vietnamese = mapWordBoundariesToTokens('Mình đang ở đây nhé!', [boundary('Mình', 0), boundary('đang', 0.2), boundary('ở', 0.4), boundary('đây', 0.6), boundary('nhé!', 0.8)], 'unicode-vi');
  assert.equal(english.alignment.reliable, true);
  assert.equal(vietnamese.alignment.reliable, true);
});

test('a clip without real word boundaries returns an unavailable alignment and no fabricated intervals', () => {
  const result = mapWordBoundariesToTokens('No timestamps here.', [], 'missing');
  assert.equal(result.alignment.status, 'unavailable');
  assert.equal(result.alignment.reliable, false);
  assert.deepEqual(buildHighlightIntervals(result.wordTimings), []);
});

test('local forced-alignment seconds are mapped without conversion or estimation', () => {
  const mapped = mapWordBoundariesToTokens('Hello, world!', [
    { text: 'Hello,', startSeconds: 0.12, endSeconds: 0.31 },
    { text: 'world!', startSeconds: 0.34, endSeconds: 0.71 }
  ], 'local-fallback');
  assert.equal(mapped.alignment.reliable, true);
  assert.deepEqual(mapped.wordTimings.map((word) => [word.startSeconds, word.endSeconds]), [[0.12, 0.31], [0.34, 0.71]]);
});

test('phrase mode groups nearby words and active lookup uses the returned timeline', () => {
  const mapped = mapWordBoundariesToTokens('We can begin now.', [
    boundary('We', 0, 0.1), boundary('can', 0.12, 0.1), boundary('begin', 0.24, 0.16), boundary('now.', 0.6, 0.12)
  ], 'phrase');
  const intervals = buildHighlightIntervals(mapped.wordTimings, 'phrase', { phraseSize: 3 });
  assert.deepEqual(intervals.map((item) => item.tokenIds.length), [3, 1]);
  assert.equal(findActiveHighlight(intervals, 0.3).tokenIds.length, 3);
  assert.equal(findActiveHighlight(intervals, 0.5), null);
});
