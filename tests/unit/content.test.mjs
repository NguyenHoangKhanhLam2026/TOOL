import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, makeLocalScript } from '../../src/topics.mjs';
import { assertDistinctFromRecent, contentHash, normalizeText, sentenceSimilarity, validateScript } from '../../src/ai/validator.mjs';
import { buildChineseCaptionFallback, validateChineseCaption } from '../../src/ai/caption-service.mjs';
import { assertChineseReviewResponse } from '../../src/ai/chinese-quality.mjs';
import { createSpeechSegments } from '../../packages/audio-highlight/highlight-engine.mjs';

function chineseFixture(style) {
  const dialogueCards = [
    { chinese: '你喝茶吗？', pinyin: 'Nǐ hē chá ma?', vietnamese: 'Bạn uống trà không?', term: '喝茶', termPinyin: 'hē chá', meaningVi: 'uống trà', noteVi: 'Dùng để hỏi về trà.', grammarNote: '' },
    { chinese: '我喝茶。', pinyin: 'Wǒ hē chá.', vietnamese: 'Mình uống trà.', term: '喝茶', termPinyin: 'hē chá', meaningVi: 'uống trà', noteVi: 'Dùng để trả lời về trà.', grammarNote: '' }
  ];
  const numberedScenario = [
    { chinese: '你去哪？', pinyin: 'Nǐ qù nǎ?', vietnamese: 'Bạn đi đâu?', term: '去哪', termPinyin: 'qù nǎ', meaningVi: 'đi đâu', noteVi: 'Hỏi.', grammarNote: '' },
    { chinese: '我去上班。', pinyin: 'Wǒ qù shàng bān.', vietnamese: 'Mình đi làm.', term: '去上班', termPinyin: 'qù shàng bān', meaningVi: 'đi làm', noteVi: 'Báo việc.', grammarNote: '' },
    { chinese: '再见，明天见！', pinyin: 'Zàijiàn, míngtiān jiàn!', vietnamese: 'Tạm biệt, mai gặp nhé.', term: '明天见', termPinyin: 'míngtiān jiàn', meaningVi: 'gặp mai', noteVi: 'Hẹn lại.', grammarNote: '' }
  ];
  const lesson = style === 'dialogue-cards'
    ? dialogueCards
    : style === 'numbered-scenario'
      ? numberedScenario
      : [{ chinese: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.', vietnamese: 'Tôi thích uống trà.', term: '喝茶', termPinyin: 'hē chá', meaningVi: 'uống trà', noteVi: 'Dùng khi nói về sở thích.', grammarNote: '' }];
  return {
    contentLanguage: 'zh', presentationStyle: style, topic: 'Giao tiếp hằng ngày', category: 'Giao tiếp', level: 'A1',
    title: 'Nói về trà', hook: 'Cùng học một câu ngắn.', thumbnailTitle: 'Nói về trà',
    lessons: lesson, scenes: [{ description: 'Bạn bè nói chuyện ở quán trà.' }, { description: 'Một người gọi trà.' }]
  };
}

function englishInlineFixture(presentationStyle = 'inline-keyphrase') {
  return {
    topic: 'Ăn chay', category: 'Sinh hoạt', level: 'A2', title: 'Tôi là người ăn chay',
    hook: 'Một câu tiếng Anh trong đời sống.', caption: 'Học cách nói về chế độ ăn.',
    thumbnailTitle: 'Người ăn chay', presentationStyle,
    dialogues: [{
      vietnamese: 'Tôi là người ăn chay nên tôi không thể ăn thịt được.',
      english: 'I am a vegetarian, so I cannot eat any meat.',
      vocabularyCards: [
        { sourceVi: 'người ăn chay', term: 'a vegetarian', meaningVi: 'Danh từ này chỉ người theo chế độ ăn không có thịt cá.' },
        { sourceVi: 'không thể ăn thịt', term: 'cannot eat any meat', meaningVi: 'Cụm này nhấn mạnh người nói hoàn toàn không ăn các loại thịt.' }
      ]
    }],
    hashtags: []
  };
}

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

test('English inline sample scripts keep Vietnamese-to-English phrase pairs in spoken order', () => {
  for (const style of ['inline-meaning', 'inline-keyphrase']) {
    const script = validateScript(englishInlineFixture(style), { contentLanguage: 'en', presentationStyle: style });
    assert.equal(script.dialogues[0].vocabularyCards.length, 2, style);
    assert.deepEqual(script.dialogues[0].vocabularyCards.map((card) => card.sourceVi), ['người ăn chay', 'không thể ăn thịt'], style);
    assert.deepEqual(
      script.speechSegments.map((segment) => [segment.language, segment.text, segment.target.vocabularyIndex]),
      [
        ['vi', script.dialogues[0].vietnamese, undefined],
        ['en', script.dialogues[0].english, undefined],
        ['en', 'a vegetarian', 0],
        ['vi', script.dialogues[0].vocabularyCards[0].meaningVi, 0],
        ['en', 'cannot eat any meat', 1],
        ['vi', script.dialogues[0].vocabularyCards[1].meaningVi, 1]
      ],
      style
    );
  }
});

test('English inline sample validation rejects phrase mappings not found in source lines', () => {
  const script = englishInlineFixture();
  script.dialogues[0].vocabularyCards[1].sourceVi = 'ăn chay trường';
  assert.throws(() => validateScript(script, { contentLanguage: 'en', presentationStyle: 'inline-keyphrase' }), /không xuất hiện nguyên văn trong câu tiếng Việt/);
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

test('validator accepts long spoken turns while keeping the three-scene format', () => {
  const script = validateScript({
    topic: 'Long roleplay', category: 'Travel', level: 'B1', title: 'At the station', hook: 'Try this exchange.',
    caption: 'Learn useful English.', hashtags: [], thumbnailTitle: 'At the station',
    dialogues: Array.from({ length: 3 }, (_, index) => ({
      id: `exchange-${index + 1}`,
      turns: [
        { speakerId: 'traveler', language: 'en', text: `${'Could you please help me '.repeat(12)}with the next train?` },
        { speakerId: 'staff', language: 'vi', text: 'Tôi sẽ trả lời câu hỏi này cho bạn sớm.' }
      ]
    }))
  });
  const segments = createSpeechSegments(script);
  assert.equal(script.dialogues.length, 3);
  assert.equal(segments.length, 7);
  assert.ok(segments[0].text.length > 150);
  assert.equal(segments[0].speakerId, 'traveler');
  assert.equal(segments[1].language, 'vi');
});

test('an empty canonical speechSegments array falls back to audioSegments', () => {
  const segments = createSpeechSegments({ speechSegments: [], audioSegments: [{ id: 'narrator', language: 'en', text: 'Welcome back.' }] });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].segmentId, 'narrator');
  assert.equal(segments[1].target.layerId, 'cta');
});

test('all four Chinese lesson formats produce the expected spoken order without a follow CTA', () => {
  const expected = {
    'inline-meaning': { lessons: 1, count: 5 },
    'inline-keyphrase': { lessons: 1, count: 5 },
    'dialogue-cards': { lessons: 2, count: 6 },
    'numbered-scenario': { lessons: 3, count: 12 }
  };
  for (const [style, shape] of Object.entries(expected)) {
    const script = validateScript(chineseFixture(style), { contentLanguage: 'zh' });
    assert.equal(script.dialogues.length, shape.lessons, style);
    assert.equal(script.speechSegments.length, shape.count, style);
    assert.ok(script.speechSegments.every((segment) => segment.state !== 'cta' && segment.target.layerId !== 'cta'), style);
    assert.deepEqual(
      script.speechSegments.filter((segment) => segment.language === 'zh').map((segment) => segment.text),
      script.dialogues.flatMap((dialogue) => style === 'dialogue-cards'
        ? [dialogue.chinese, dialogue.chinese]
        : style === 'numbered-scenario'
          ? [dialogue.chinese, dialogue.chinese]
          : [dialogue.chinese, dialogue.chinese, dialogue.term]),
      style
    );
  }
});

test('Chinese validation rejects repeated lesson lines and mismatched key phrase Pinyin', () => {
  const repeated = chineseFixture('numbered-scenario');
  repeated.lessons[1] = structuredClone(repeated.lessons[0]);
  assert.throws(() => validateScript(repeated, { contentLanguage: 'zh' }), /không được lặp lại/);

  const mismatchedPinyin = chineseFixture('inline-meaning');
  mismatchedPinyin.lessons[0].termPinyin = 'hē shuǐ';
  assert.throws(() => validateScript(mismatchedPinyin, { contentLanguage: 'zh' }), /Pinyin.*khớp/);
});

test('Chinese Pinyin validation accounts for 儿化 and rejects follow calls in lesson text', () => {
  const erhua = chineseFixture('inline-meaning');
  erhua.lessons[0] = {
    chinese: '你在哪儿？', pinyin: 'Nǐ zài nǎr?', vietnamese: 'Bạn đang ở đâu?',
    term: '在哪儿', termPinyin: 'zài nǎr', meaningVi: 'ở đâu', noteVi: 'Dùng để hỏi vị trí.', grammarNote: ''
  };
  assert.equal(validateScript(erhua, { contentLanguage: 'zh' }).dialogues[0].chinese, '你在哪儿？');

  const followCta = chineseFixture('inline-meaning');
  followCta.lessons[0].noteVi = 'Hãy theo dõi kênh để học thêm.';
  assert.throws(() => validateScript(followCta, { contentLanguage: 'zh' }), /không được có lời kêu gọi/);
});

test('Chinese review gate fails closed on issues and malformed reviewer responses', () => {
  assert.deepEqual(assertChineseReviewResponse('{"approved":true,"issues":[]}'), { approved: true, issues: [] });
  assert.throws(() => assertChineseReviewResponse({ approved: true, issues: ['lesson 1 pinyin: tone is wrong'] }), /chưa đạt/);
  assert.throws(() => assertChineseReviewResponse({ approved: 'true', issues: [] }), /bị chặn/);
  assert.throws(() => assertChineseReviewResponse({ approved: true, issues: [], notes: 'unclear' }), /bị chặn/);
});

test('a saved Chinese script can be revalidated without unpersisted scenes and keeps its ID', () => {
  const script = validateScript(chineseFixture('dialogue-cards'), { contentLanguage: 'zh' });
  const savedId = script.id;
  delete script.scenes;
  const checked = validateScript(script, { contentLanguage: 'zh', requireChineseScenes: false });
  assert.equal(checked.id, savedId);
  assert.ok(checked.speechSegments.every((segment) => segment.state !== 'cta'));
});

test('Chinese captions invite practice without follow or subscribe language', () => {
  const valid = 'Nói về trà\n\n“我喜欢喝茶。” đọc là “Wǒ xǐhuan hē chá”, nghĩa là “Tôi thích uống trà”. Cụm “喝茶” nghĩa là “uống trà”.\n\nHãy thử đọc câu này và bình luận cách bạn gọi trà nhé.';
  assert.equal(validateChineseCaption(valid), '');
  assert.match(validateChineseCaption(valid.replace('bình luận', 'theo dõi kênh')), /không được có lời kêu gọi/);
  assert.match(validateChineseCaption(valid.replace('bình luận', 'follow the page and')), /không được có lời kêu gọi/);
});

test('Chinese caption fallback validates and summarizes every lesson style', () => {
  for (const style of ['inline-meaning', 'inline-keyphrase', 'dialogue-cards', 'numbered-scenario']) {
    const script = validateScript(chineseFixture(style), { contentLanguage: 'zh' });
    const caption = buildChineseCaptionFallback(script);
    assert.equal(validateChineseCaption(caption), '', style);
    for (const dialogue of script.dialogues) assert.ok(caption.includes(dialogue.chinese.replace(/[.!?。！？]+$/u, '')), style);
    assert.doesNotMatch(caption, /follow|theo\s*dõi|đăng\s*ký|关注|订阅/iu, style);
  }
});
