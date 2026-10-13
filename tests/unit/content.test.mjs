import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, makeLocalScript } from '../../src/topics.mjs';
import { assertDistinctFromRecent, contentHash, normalizeText, sentenceSimilarity, validateScript } from '../../src/ai/validator.mjs';
import { createSpeechSegments } from '../../packages/audio-highlight/highlight-engine.mjs';

test('topic library contains one hundred distinct topics', () => {
  assert.equal(TOPICS.length, 100);
  assert.equal(new Set(TOPICS.map((topic) => topic.title)).size, 100);
  assert.equal(new Set(TOPICS.map((topic) => topic.category)).size, 20);
});

test('local template creates exactly three valid bilingual cards', () => {
  const script = validateScript(makeLocalScript(TOPICS[0]));
  assert.equal(script.dialogues.length, 3);
  for (const line of script.dialogues) assert.ok(line.english.toLocaleLowerCase().includes(line.term.toLocaleLowerCase()));
  assert.equal(script.contentHash, contentHash(script));
});

test('local template refuses topics without a matching content set', () => {
  const friendTopic = TOPICS.find((topic) => topic.category === 'Bạn bè');
  assert.throws(() => makeLocalScript(friendTopic), /chưa có mẫu nội dung cục bộ phù hợp/);
});

test('script validator rejects missing vocabulary term and duplicate English lines', () => {
  const sample = makeLocalScript(TOPICS[0]);
  sample.dialogues[0].term = 'not in this sentence';
  assert.throws(() => validateScript(sample), /không xuất hiện nguyên văn/);
  const duplicate = makeLocalScript(TOPICS[0]);
  duplicate.dialogues[1].english = duplicate.dialogues[0].english;
  duplicate.dialogues[1].term = duplicate.dialogues[0].term;
  assert.throws(() => validateScript(duplicate), /lặp/);
});

test('duplicate hash normalizes punctuation and casing', () => {
  const first = makeLocalScript(TOPICS[0]);
  const second = structuredClone(first);
  second.topic = first.topic.toUpperCase();
  second.dialogues[0].english = first.dialogues[0].english.replaceAll('.', '').toUpperCase();
  assert.equal(normalizeText('Keep me posted!'), normalizeText('KEEP me, posted.'));
  assert.equal(contentHash(first), contentHash(second));
});

test('near duplicate English lines are detected locally', () => {
  const similarity = sentenceSimilarity('Could you help me look over the remaining part?', 'Could you help me look over the remaining part.');
  assert.equal(similarity, 1);
  const script = validateScript(makeLocalScript(TOPICS[0]));
  assert.throws(() => assertDistinctFromRecent(script, [script.dialogues[0].english]), /quá giống/);
});

test('validator accepts flexible dialogue turns and long text for automatic speech segments', () => {
  const script = validateScript({
    topic: 'Long roleplay', category: 'Travel', level: 'B1', title: 'At the station', hook: 'Try this exchange.',
    caption: 'Learn useful English.', hashtags: [], thumbnailTitle: 'At the station',
    dialogues: Array.from({ length: 5 }, (_, index) => ({
      id: `exchange-${index + 1}`,
      turns: [
        { speakerId: 'traveler', language: 'en', text: `${'Could you please help me '.repeat(12)}with the next train?` },
        { speakerId: 'staff', language: 'vi', text: `Lượt trả lời ${index + 1}.` }
      ]
    }))
  });
  const segments = createSpeechSegments(script);
  assert.equal(script.dialogues.length, 5);
  assert.equal(segments.length, 10);
  assert.ok(segments[0].text.length > 150);
  assert.equal(segments[0].speakerId, 'traveler');
  assert.equal(segments[1].language, 'vi');
});

test('an empty canonical speechSegments array falls back to audioSegments', () => {
  const segments = createSpeechSegments({ speechSegments: [], audioSegments: [{ id: 'narrator', language: 'en', text: 'Welcome back.' }] });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].segmentId, 'narrator');
});
