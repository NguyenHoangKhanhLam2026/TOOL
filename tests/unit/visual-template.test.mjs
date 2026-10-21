import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneSvg, readVisualTemplate, rasterizeScene, validateVisualTemplate, wrapText
} from '../../packages/video-engine/visual-template-engine.mjs';
import { tokenizeText } from '../../packages/audio-highlight/highlight-engine.mjs';
const { default: sharp } = await import('sharp');

const script = {
  title: 'At the coffee shop',
  topic: 'Ordering a drink',
  dialogues: [
    { vietnamese: 'Cho mình một ly cà phê sữa đá, ít đường nhé.', english: 'Could I have an iced milk coffee with less sugar, please?', term: 'less sugar', meaningVi: 'ít đường' },
    { vietnamese: 'Bạn có thể cho thêm một ống hút không?', english: 'Could you add one more straw?', term: 'one more', meaningVi: 'thêm một cái nữa' },
    { vietnamese: 'Cảm ơn bạn, mình sẽ ngồi ở bàn gần cửa sổ.', english: 'Thanks, I will sit at the table by the window.', term: 'by the window', meaningVi: 'gần cửa sổ' }
  ]
};

test('V2 template keeps the branded 1080x1920 scene and all standard layers', () => {
  const template = readVisualTemplate();
  assert.equal(template.canvas.width, 1080);
  assert.equal(template.canvas.height, 1920);
  assert.equal(template.canvas.fps, 30);
  assert.equal(template.layers.length, 12);
  assert.ok(['background', 'vietnamese-card', 'english-card', 'scene-number', 'character', 'logo'].every((id) => template.layers.some((layer) => layer.id === id)));
  assert.equal(template.brand.pageName, 'Sinh ra để nói tiếng Anh');
  assert.doesNotThrow(() => validateVisualTemplate(template));
});

test('scene renderer selects the right dialogue states and escapes script text', async () => {
  const template = readVisualTemplate();
  const vi = await buildSceneSvg({ template, script, state: 'vietnamese', index: 0 });
  const en = await buildSceneSvg({ template, script, state: 'bilingual', index: 0 });
  const cta = await buildSceneSvg({ template, script, state: 'cta', index: 0 });
  assert.match(vi, /data-layer-id="vietnamese-card"/);
  assert.doesNotMatch(vi, /data-layer-id="english-card"/);
  assert.match(en, /data-layer-id="english-card"/);
  assert.match(cta, /data-layer-id="cta"/);
  const isolated = await buildSceneSvg({ template, script, state: 'bilingual', index: 0, includeBackground: false, includeLayers: ['english-card'] });
  assert.match(isolated, /data-layer-id="english-card"/);
  assert.doesNotMatch(isolated, /data-layer-id="background"|data-layer-id="vietnamese-card"/);
  const escaped = await buildSceneSvg({ template, script: { ...script, title: '<script>alert(1)</script>' }, state: 'intro' });
  assert.doesNotMatch(escaped, /<script>alert/);
  assert.match(escaped, /&lt;script&gt;/);
});

test('English inline sample renders two ordered bilingual phrase cards and distinct sentence colors', async () => {
  const template = readVisualTemplate();
  const inlineScript = {
    contentLanguage: 'en', presentationStyle: 'inline-keyphrase', title: 'Tôi là người ăn chay',
    dialogues: [{
      vietnamese: 'Tôi là người ăn chay nên tôi không thể ăn thịt được.',
      english: 'I am a vegetarian, so I cannot eat any meat.',
      vocabularyCards: [
        { sourceVi: 'người ăn chay', term: 'a vegetarian', meaningVi: 'Danh từ này chỉ người theo chế độ ăn không có thịt cá.' },
        { sourceVi: 'không thể ăn thịt', term: 'cannot eat any meat', meaningVi: 'Cụm này nhấn mạnh người nói hoàn toàn không ăn các loại thịt.' }
      ]
    }]
  };
  const firstCard = await buildSceneSvg({
    template, script: inlineScript, state: 'vocabulary', index: 0,
    speechSegment: { segmentId: 'vocabulary-one', text: 'a vegetarian', target: { layerId: 'vocabulary', dialogueIndex: 0, vocabularyIndex: 0 } }
  });
  assert.match(firstCard, /data-vocabulary-card="0"/);
  assert.doesNotMatch(firstCard, /data-vocabulary-card="1"/);

  const secondCard = await buildSceneSvg({
    template, script: inlineScript, state: 'vocabulary', index: 0,
    speechSegment: { segmentId: 'vocabulary-two', text: 'cannot eat any meat', target: { layerId: 'vocabulary', dialogueIndex: 0, vocabularyIndex: 1 } }
  });
  assert.match(secondCard, /data-vocabulary-card="0"[\s\S]*data-vocabulary-card="1"/);
  assert.ok(secondCard.indexOf('người ăn chay') < secondCard.indexOf('không thể ăn thịt'));
  assert.match(secondCard, /fill="#E78300"/);
  assert.match(secondCard, /fill="#55A9EC"/);
});

test('English centered dialogue word highlight stays aligned inside its card', async () => {
  const template = readVisualTemplate();
  const text = 'Do you have five minutes free?';
  const segmentId = 'centered-english-line';
  const token = tokenizeText(text, segmentId, 'en').find((item) => item.text.toLocaleLowerCase() === 'minutes');
  const svg = await buildSceneSvg({
    template,
    script: {
      contentLanguage: 'en', presentationStyle: 'dialogue-cards', title: 'A quick favor',
      dialogues: [{ vietnamese: 'Bạn có rảnh khoảng năm phút không?', english: text }]
    },
    state: 'bilingual', index: 0,
    speechSegment: { segmentId, text, target: { layerId: 'english-card', dialogueIndex: 0 } },
    highlight: { segmentId, tokenIds: [token.id] },
    highlightSettings: { highlightEnabled: true, highlightColor: '#55A9EC', highlightPadding: 6, highlightRadius: 8 }
  });
  const highlight = svg.match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#55A9EC"\/>/u);
  assert.ok(highlight, 'spoken word highlight should be rendered');
  const x = Number(highlight[1]);
  const width = Number(highlight[3]);
  assert.ok(x >= 80 && x + width <= 1000, `centered word highlight must stay within the English card: ${x}..${x + width}`);
  assert.match(svg, /text-anchor="middle"/);
});

test('English numbered scenario uses simple step numbers and colors its spoken target phrase', async () => {
  const template = readVisualTemplate();
  const scenario = await buildSceneSvg({
    template,
    script: {
      contentLanguage: 'en', presentationStyle: 'numbered-scenario', title: 'Xe máy bị hỏng',
      dialogues: [{
        vietnamese: 'Chiếc xe máy cũ của tôi lại bất ngờ bị hỏng.',
        english: 'My old motorbike suddenly broke down on the road today.',
        term: 'broke down', meaningVi: 'Cụm này dùng khi phương tiện hoặc máy móc bất ngờ bị hỏng.'
      }]
    },
    state: 'vietnamese', index: 0, totalCount: 3
  });
  assert.match(scenario, />1<\/text>/);
  assert.doesNotMatch(scenario, />01\s+\/\s+03<\/text>/);
  const EnglishLine = await buildSceneSvg({
    template,
    script: {
      contentLanguage: 'en', presentationStyle: 'numbered-scenario', title: 'Xe máy bị hỏng',
      dialogues: [{
        vietnamese: 'Chiếc xe máy cũ của tôi lại bất ngờ bị hỏng.',
        english: 'My old motorbike suddenly broke down on the road today.',
        term: 'broke down', meaningVi: 'Cụm này dùng khi phương tiện hoặc máy móc bất ngờ bị hỏng.'
      }]
    },
    state: 'bilingual', index: 0
  });
  assert.match(EnglishLine, /fill="#55A9EC"/);
});

test('Chinese preview reveals its text with the Chinese voice and omits the follow CTA state', async () => {
  const template = readVisualTemplate({ contentLanguage: 'zh' });
  const chineseScript = {
    contentLanguage: 'zh', presentationStyle: 'inline-meaning', title: 'Nói lời chào',
    dialogues: [{ vietnamese: 'Xin chào bạn.', chinese: '你好。', pinyin: 'Nǐ hǎo.', term: '你好', termPinyin: 'nǐ hǎo', meaningVi: 'xin chào' }]
  };
  const vietnamese = await buildSceneSvg({ template, script: chineseScript, state: 'vietnamese', index: 0 });
  const chinese = await buildSceneSvg({ template, script: chineseScript, state: 'bilingual', index: 0 });
  const firstChineseRead = await buildSceneSvg({
    template, script: chineseScript, state: 'bilingual', index: 0,
    speechSegment: { segmentId: 'first-read', text: '你好。', target: { layerId: 'chinese-card', pinyinVisible: false } },
    chineseTextEffectProgress: 0
  });
  const cta = await buildSceneSvg({ template, script: chineseScript, state: 'cta', index: 0 });
  assert.doesNotMatch(vietnamese, /data-layer-id="chinese-card"|data-layer-id="pinyin"/);
  assert.match(chinese, /data-layer-id="chinese-card"/);
  assert.match(firstChineseRead, /<g id="layer-chinese-card"[^>]+opacity="1"/);
  assert.doesNotMatch(cta, /data-layer-id="cta"/);
});

test('scene rasterizes as portrait PNG and wraps long Vietnamese dialogue', async () => {
  const template = readVisualTemplate();
  const png = await rasterizeScene({ template, script, state: 'bilingual', index: 0 });
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.ok(wrapText('Một câu hội thoại tiếng Việt dài để kiểm tra cách tự động xuống dòng trong thẻ nội dung.', 540, 48).length > 1);
});

test('a separate generic template can highlight its own text layer', async () => {
  const template = structuredClone(readVisualTemplate());
  template.templateId = 'custom-lesson-template';
  const text = 'We can learn English together every day to improve our speaking confidence.';
  template.layers = [{ id: 'lesson-copy', kind: 'text', x: 96, y: 240, width: 420, height: 600, fontSize: 56, lineHeight: 70, text }];
  validateVisualTemplate(template);
  const svg = await buildSceneSvg({
    template,
    script: { title: 'Custom layout', dialogues: [] },
    state: 'bilingual',
    speechSegment: { segmentId: 'custom-segment', text, target: { layerId: 'lesson-copy' } },
    highlight: { segmentId: 'custom-segment', tokenIds: [tokenizeText(text, 'custom-segment').at(-1).id] },
    highlightSettings: { highlightEnabled: true, highlightColor: '#FF8066', highlightPadding: 6, highlightRadius: 8, highlightTransition: 'instant' }
  });
  assert.match(svg, /data-layer-id="lesson-copy"/);
  assert.match(svg, /fill="#FF8066"/);
  assert.match(svg, /fill="#FFFFFF" font-weight="700"/);
  assert.ok([...svg.matchAll(/<tspan x="96" y="[^"]+"/gu)].length > 1, 'long text should wrap while retaining token positions');
});

test('word highlight bounds contain the selected English and Vietnamese glyphs only', async () => {
  const template = readVisualTemplate();
  const samples = [
    { language: 'en', text: 'I took time off for six months to care for my mother.', index: 4, nextIndex: 5, layerId: 'english-card' },
    { language: 'vi', text: 'Tôi đã nghỉ làm sáu tháng để chăm sóc mẹ.', index: 5, nextIndex: 6, layerId: 'vietnamese-card' },
    { language: 'en', text: "What's your refund policy for unopened headphones?", index: 6, layerId: 'english-card' }
  ];

  for (const sample of samples) {
    const segmentId = `exact-${sample.language}`;
    const tokens = tokenizeText(sample.text, segmentId);
    const dialogue = sample.language === 'en'
      ? { vietnamese: 'Tôi đã nghỉ làm sáu tháng để chăm sóc mẹ.', english: sample.text, term: 'time off', meaningVi: 'nghỉ việc' }
      : { vietnamese: sample.text, english: 'I took time off for six months to care for my mother.', term: 'time off', meaningVi: 'nghỉ việc' };
    let svg = await buildSceneSvg({
      template,
      script: { title: 'Highlight position check', dialogues: [dialogue] },
      state: 'bilingual',
      index: 0,
      speechSegment: { segmentId, text: sample.text, target: { layerId: sample.layerId, dialogueIndex: 0 } },
      highlight: { segmentId, tokenIds: [tokens[sample.index].id] },
      highlightSettings: { highlightEnabled: true, highlightColor: '#FF8066', highlightPadding: 6, highlightRadius: 8, highlightTransition: 'instant' }
    });

    const colorToken = (source, tokenId, markerColor) => {
      const start = source.indexOf(`data-token-id="${tokenId}"`);
      assert.ok(start >= 0, `missing text span for ${tokenId}`);
      const end = source.indexOf('>', start);
      const opening = source.slice(start, end + 1);
      const marked = opening.replace(/ fill="#[0-9a-f]{6}"/iu, '').replace(/>$/u, ` fill="${markerColor}">`);
      return `${source.slice(0, start)}${marked}${source.slice(end + 1)}`;
    };
    svg = colorToken(svg, tokens[sample.index].id, '#01FE02');
    const previousIndex = sample.previousIndex ?? sample.index - 1;
    if (previousIndex >= 0) svg = colorToken(svg, tokens[previousIndex].id, '#FD8A01');
    if (Number.isInteger(sample.nextIndex)) svg = colorToken(svg, tokens[sample.nextIndex].id, '#FE01FD');

    const rectMatch = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#FF8066"\/>/u);
    assert.ok(rectMatch, 'highlight rectangle should be present');
    const [, rectXValue, rectYValue, rectWidthValue, rectHeightValue] = rectMatch;
    const rect = { x: Number(rectXValue), y: Number(rectYValue), width: Number(rectWidthValue), height: Number(rectHeightValue) };
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const boundsFor = (matches) => {
      const bounds = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
      for (let pixel = 0; pixel < data.length; pixel += info.channels) {
        if (!matches(data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3])) continue;
        const x = (pixel / info.channels) % info.width;
        const y = Math.floor(pixel / info.channels / info.width);
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
      return bounds;
    };
    const selected = boundsFor((r, g, b, a) => r < 8 && g > 245 && b < 8 && a > 200);
    const previous = boundsFor((r, g, b, a) => r > 245 && g > 100 && g < 160 && b < 8 && a > 200);
    const next = boundsFor((r, g, b, a) => r > 245 && g < 8 && b > 245 && a > 200);

    assert.ok(selected.maxX >= selected.minX && selected.maxY >= selected.minY, 'selected word must be rasterized');
    if (Number.isInteger(sample.nextIndex)) assert.ok(next.maxX >= next.minX && next.maxY >= next.minY, 'following word must be rasterized');
    if (previousIndex >= 0) assert.ok(previous.maxX >= previous.minX && previous.maxY >= previous.minY, 'preceding word must be rasterized');
    assert.ok(rect.x <= selected.minX && rect.x + rect.width - 1 >= selected.maxX, `rectangle should surround selected glyphs: ${JSON.stringify({ sample: sample.text, rect, selected })}`);
    assert.ok(rect.y <= selected.minY && rect.y + rect.height - 1 >= selected.maxY, `rectangle should surround selected glyph height: ${JSON.stringify({ sample: sample.text, rect, selected })}`);
    if (previousIndex >= 0) assert.ok(rect.x > previous.maxX, 'rectangle must not spill into the preceding word');
    if (Number.isInteger(sample.nextIndex)) assert.ok(rect.x + rect.width < next.minX, 'rectangle must not spill into the following word');
  }
});

test('background vocabulary follows the content language in Chinese and Japanese scenes', async () => {
  const vocabularies = {
    zh: new Set(['你好', '学习', '表达', '梦想', '成长', '中文', '词语', '坚持']),
    ja: new Set(['こんにちは', '学ぶ', '会話', '夢', '成長', '日本語', '言葉', '挑戦'])
  };
  const englishWords = ['hello', 'learn', 'speak', 'dream', 'grow', 'A2'];

  for (const [contentLanguage, allowedWords] of Object.entries(vocabularies)) {
    const template = readVisualTemplate({ contentLanguage });
    const svg = await buildSceneSvg({
      template,
      script: {
        contentLanguage, title: 'Localized background sample',
        dialogues: [{ vietnamese: 'Câu mẫu.', english: contentLanguage === 'zh' ? '今天很开心。' : '今日は楽しいです。' }]
      },
      state: 'intro', backgroundEffect: 'vocabulary', backgroundEffectDensity: 60, effectSeed: `${contentLanguage}-vocabulary-test`
    });
    const languageMarker = svg.indexOf('background-effect-vocabulary');
    const effectStart = svg.lastIndexOf('<g', languageMarker);
    const effectEnd = svg.indexOf('</g>', effectStart);
    const effect = svg.slice(effectStart, effectEnd);
    const renderedWords = effect.split('<text ').slice(1).map((entry) => {
      const body = entry.split('</text>')[0];
      return body.slice(body.lastIndexOf('>') + 1);
    });

    assert.ok(languageMarker >= 0 && effectEnd > effectStart, `${contentLanguage} scene should contain its background effect`);
    assert.equal(renderedWords.length, 60);
    assert.ok(renderedWords.every((word) => allowedWords.has(word)), `${contentLanguage} scene should use only its own background vocabulary`);
    assert.ok(englishWords.every((word) => !effect.includes(`>${word}</text>`)), `${contentLanguage} scene should not contain English background vocabulary`);
  }
});

test('phrase highlighting keeps every selected spoken word aligned to its own glyph box', async () => {
  const template = readVisualTemplate();
  const text = 'How spicy would you like it?';
  const segmentId = 'phrase-exact';
  const tokens = tokenizeText(text, segmentId);
  const selected = tokens.slice(2, 5);
  const svg = await buildSceneSvg({
    template,
    script: { title: 'Phrase highlight', dialogues: [{ vietnamese: 'B?n mu?n m?n n?y cay ??n m?c n?o?', english: text, term: 'How spicy', meaningVi: 'cay ??n m?c n?o' }] },
    state: 'bilingual',
    index: 0,
    speechSegment: { segmentId, text, target: { layerId: 'english-card', dialogueIndex: 0 } },
    highlight: { segmentId, tokenIds: selected.map((token) => token.id) },
    highlightSettings: { highlightEnabled: true, highlightColor: '#FF8066', highlightPadding: 6, highlightRadius: 8 }
  });
  const openingFor = (tokenId) => {
    const start = svg.indexOf(`data-token-id="${tokenId}"`);
    assert.ok(start >= 0, `missing text span for ${tokenId}`);
    return svg.slice(start, svg.indexOf('>', start) + 1);
  };
  for (const token of selected) assert.match(openingFor(token.id), /fill="#FFFFFF" font-weight="700"/u);
  assert.doesNotMatch(openingFor(tokens[1].id), /fill="#FFFFFF"/u, 'preceding word must keep its base color');
  assert.doesNotMatch(openingFor(tokens[5].id), /fill="#FFFFFF"/u, 'following word must keep its base color');
  const rects = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="[^"]+" fill="#FF8066"\/>/gu)]
    .map((match) => ({ x: Number(match[1]), width: Number(match[3]) }));
  assert.equal(rects.length, selected.length, 'each active word should have exactly one measured box');
  assert.ok(rects[0].x < rects[1].x && rects[1].x < rects[2].x, 'phrase boxes should follow spoken word order');
});

test('template rejects wrong output dimensions and assets outside branding directory', () => {
  const template = structuredClone(readVisualTemplate());
  template.canvas.width = 720;
  assert.throws(() => validateVisualTemplate(template), /1080/);
  const unsafe = structuredClone(readVisualTemplate());
  unsafe.layers.find((layer) => layer.id === 'background').asset = '../private/token.png';
  assert.throws(() => validateVisualTemplate(unsafe), /assets\/branding/);
});
