import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mot-phut-vo-le-test-'));
process.env.AERS_DATA_DIR = temporaryRoot;

let moduleApi;
let contentValidator;
let topicEngine;
let visualDesign;
let prompt;

before(async () => {
  moduleApi = await import('../../src/mot-phut-vo-le/index.mjs');
  contentValidator = await import('../../src/mot-phut-vo-le/content-validator.mjs');
  topicEngine = await import('../../src/mot-phut-vo-le/topic-engine.mjs');
  visualDesign = await import('../../src/mot-phut-vo-le/visual-design.mjs');
  prompt = await import('../../src/mot-phut-vo-le/prompt.mjs');
});

after(() => {
  moduleApi.closeMotPhutVoLeHistory();
  const safeRoot = path.resolve(os.tmpdir());
  const target = path.resolve(temporaryRoot);
  assert.ok(target.startsWith(`${safeRoot}${path.sep}`), 'test cleanup must stay under the OS temp directory');
  fs.rmSync(target, { recursive: true, force: true });
});

function validContent(overrides = {}) {
  return {
    title: 'Vì sao giọng nói nghe khác khi ghi âm?',
    topic: 'Nhận thức về âm thanh',
    category: 'Khoa học',
    subcategory: 'Âm thanh',
    angle: 'Giải thích hiện tượng đời thường',
    scriptText: 'Khi nghe lại giọng nói được ghi âm, nhiều người cảm thấy nó rất khác. Tai chúng ta nghe giọng mình qua không khí và cả rung động truyền qua xương. Bản ghi âm chủ yếu tái tạo âm thanh truyền qua không khí, nên giọng nói có thể nghe lạ hơn.',
    summary: 'Vì sao bản ghi âm giọng nói nghe lạ.',
    caption: 'Bạn đã từng thấy giọng mình nghe lạ khi ghi âm chưa?',
    hashtags: ['#KienThucThuVi', '#KhoaHocDoiThuong'],
    deliveryStyle: 'curious', contentType: 'explanation', language: 'vi',
    ...overrides
  };
}

test('module settings are isolated and validated against the real VieNeu voice list', () => {
  const settings = moduleApi.normalizeMotPhutVoLeSettings({ targetDurationSeconds: 90, speed: 2, voice: 'voice-that-does-not-exist' });
  assert.equal(settings.targetDurationSeconds, 60);
  assert.equal(settings.speed, 1.25);
  assert.equal(settings.voice, 'Hải Đăng');
  assert.equal(moduleApi.MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY, 'motPhutVoLeVisualDesignV1');
  assert.notEqual(moduleApi.MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY, 'englishShadowingVisualDesignV1');
});

test('content validation enforces Vietnamese schema and mandatory brand hashtag', () => {
  const value = contentValidator.validateMotPhutVoLeContent(validContent());
  assert.equal(value.language, 'vi');
  assert.ok(value.contentHash.length === 64);
  assert.ok(value.hashtags.includes('#MotPhutVoLe'));
  assert.equal(contentValidator.validateMotPhutVoLeContent(validContent({ deliveryStyle: 'Một phong cách kể dài vượt quá số ký tự mà schema nội bộ dự kiến cho trường này.' })).deliveryStyle, 'natural');
  assert.ok(!value.hashtags.some((tag) => tag.toLowerCase() === '#paperenglishshadowing'));
  assert.throws(() => contentValidator.validateMotPhutVoLeContent(validContent({ language: 'en' })), /language="vi"/u);
  assert.throws(() => contentValidator.validateMotPhutVoLeContent('{bad json'), /JSON không hợp lệ/u);
});

test('topic discovery is open-ended and compares title, angle, and text similarity', async () => {
  const built = prompt.buildTopicDiscoveryPrompt({ categoryHint: 'Khoa học', recentHistory: [] });
  assert.match(built, /không chọn lĩnh vực từ một danh sách cố định/iu);
  assert.match(built, /tạo lĩnh vực, nhánh/iu);
  const duplicate = topicEngine.findIdeaDuplicate({ titleHint: 'Vì sao giọng nói nghe khác khi ghi âm?' }, [{ title: 'Vì sao giọng nói nghe khác khi ghi âm?' }]);
  assert.equal(duplicate.duplicate, true);
  assert.equal(topicEngine.jaccardSimilarity('vi sao cay dan rung len', 'cay dan rung len'), 1);
  assert.equal(topicEngine.findIdeaDuplicate({ topic: 'Vi sao dan rung?', angle: 'Giai thich do rung' }, [
    { topic: 'Vì sao đàn rung?', angle: 'Giải thích độ rung' }
  ]).reason, 'idea-key');
  const repeatedSentence = 'Men tự nhiên biến đường thành khí carbon dioxide giúp bột chua nở.';
  assert.equal(topicEngine.findIdeaDuplicate({ title: 'A different title', topic: 'A different topic', angle: 'A different angle',
    scriptText: `${repeatedSentence} Bột được ủ trong một khoảng thời gian phù hợp.` }, [{ title: 'An older title', topic: 'An older topic', angle: 'An older angle',
    scriptText: `${repeatedSentence} Người làm bánh theo dõi nhiệt độ trong suốt quá trình.` }]).reason, 'script-sentence');
  const previousIdea = { category: 'Science', subcategory: 'Sound', topic: 'Why strings vibrate', angle: 'How vibration reaches the ear' };
  let candidateBatch = 0;
  const fresh = await topicEngine.discoverFreshTopic({ history: [previousIdea], retries: 2, generate: async () => {
    candidateBatch += 1;
    const duplicateBatch = Array.from({ length: 8 }, () => previousIdea);
    return { candidates: candidateBatch === 1 ? duplicateBatch : [
      { category: 'Food', subcategory: 'Fermentation', topic: 'Why sourdough rises', angle: 'How wild yeast forms bubbles' }
    ] };
  } });
  assert.equal(candidateBatch, 2, 'an all-duplicate group must request another group of candidates');
  assert.equal(fresh.topic, 'Why sourdough rises');
  const candidate = topicEngine.normalizeTopicCandidate({ category: 'Thiết kế âm thanh', subcategory: 'Thu âm', topic: 'Không gian', angle: 'Vì sao rèm cửa làm phòng thu bớt vang?' });
  assert.equal(candidate.category, 'Thiết kế âm thanh');
  assert.equal(moduleApi.topicAreaSuggestions({ query: 'thiết kế' }).length, 0);
  assert.ok(moduleApi.MOT_PHUT_VO_LE_SUGGESTED_AREAS.length > 20);
});

test('module-specific history reserves duplicate ideas atomically and survives reopen', () => {
  const candidate = { category: 'Khoa học', subcategory: 'Âm thanh', topic: 'Nhận thức về âm thanh', angle: 'Lý do bản ghi giọng nói nghe lạ' };
  const id = moduleApi.reserveMotPhutVoLeIdea(candidate);
  assert.ok(id);
  assert.throws(() => moduleApi.reserveMotPhutVoLeIdea(candidate), { code: 'MOT_PHUT_VO_LE_DUPLICATE_IDEA' });
  const content = contentValidator.validateMotPhutVoLeContent(validContent());
  const saved = moduleApi.saveMotPhutVoLeScript(id, content, { validation: { valid: true } });
  assert.equal(saved.title, content.title);
  moduleApi.updateMotPhutVoLeContent(id, { status: 'complete', videoPath: path.join(temporaryRoot, 'video.mp4') });
  moduleApi.closeMotPhutVoLeHistory();
  assert.equal(moduleApi.getMotPhutVoLeContent(id).status, 'complete');
  assert.equal(moduleApi.listMotPhutVoLeHistory().length, 1);
});

test('MPVL keeps a dedupe archive after video deletion and resumes the autosaved script', async () => {
  const idea = { category: 'Food science', subcategory: 'Starter cultures', topic: 'Fermentation in sourdough',
    angle: 'How wild yeast creates bubbles in home sourdough' };
  const id = moduleApi.reserveMotPhutVoLeIdea(idea);
  const content = contentValidator.validateMotPhutVoLeContent(validContent({
    title: 'Wild yeast bubbles in sourdough', ...idea,
    scriptText: 'Men tự nhiên trong bột chua ăn đường có sẵn trong bột mì. Quá trình này tạo khí carbon dioxide, làm khối bột nở lên từ từ. Mạng gluten giữ các bọt khí bên trong, nên ruột bánh có nhiều lỗ nhỏ. Nhiệt độ và thời gian ủ ảnh hưởng tốc độ lên men. Người làm bánh thường cho thêm bột và nước để nuôi men.'
  }));
  moduleApi.saveMotPhutVoLeScript(id, content, { validation: { valid: true } });

  let generateCalls = 0;
  const resumed = await moduleApi.createMotPhutVoLeDraft({ contentId: id, generate: async () => { generateCalls += 1; } });
  assert.equal(resumed.id, id);
  assert.equal(resumed.scriptText, content.scriptText);
  assert.equal(generateCalls, 0, 'resume must reuse the autosaved script without generating a replacement');

  moduleApi.updateMotPhutVoLeContent(id, { status: 'complete', videoPath: path.join(temporaryRoot, 'saved-video.mp4') });
  const resumedBatch = await moduleApi.createMotPhutVoLeVideos({ count: 1, resumeProgress: {
    batchIndex: 1, completedBatchIndices: [1], completedBatchContentIds: { 1: id }
  } });
  assert.equal(resumedBatch[0].id, id, 'recovery must not regenerate an already completed batch item');
  assert.equal(moduleApi.deleteMotPhutVoLeVideo(id).deleted, true);
  assert.equal(moduleApi.getMotPhutVoLeContent(id), null);
  assert.ok(moduleApi.getAllMotPhutVoLeHistoryForDeduplication().some((item) => item.sourceContentId === id && item.title === content.title));
  assert.throws(() => moduleApi.reserveMotPhutVoLeIdea(idea), { code: 'MOT_PHUT_VO_LE_DUPLICATE_IDEA' });

  const secondIdea = { ...idea, topic: 'Fermentation in rye starter', angle: 'How rye flour changes starter acidity' };
  const secondId = moduleApi.reserveMotPhutVoLeIdea(secondIdea);
  assert.throws(() => moduleApi.saveMotPhutVoLeScript(secondId, { ...content, ...secondIdea }), { code: 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT' });
});

test('visual presets include the two independent module themes and take immutable snapshots', () => {
  const design = visualDesign.normalizeMotPhutVoLeVisualDesign({ preset: 'dark-knowledge', content: { accent: '#abcdef', bodyFontSize: 120 } });
  assert.equal(design.preset, 'dark-knowledge');
  assert.equal(design.content.accent, '#abcdef');
  assert.equal(design.content.bodyFontSize, 70);
  assert.deepEqual(Object.keys(visualDesign.MOT_PHUT_VO_LE_PRESETS), ['vintage-paper', 'dark-knowledge']);
  const snapshot = visualDesign.createMotPhutVoLeDesignSnapshot(design);
  assert.notEqual(snapshot, design);
  assert.equal(snapshot.content.accent, '#abcdef');
});

test('thumbnail rasterizes to a standalone image with the expected portrait ratio', async () => {
  const outputPath = path.join(temporaryRoot, 'preview-thumbnail.png');
  const result = await moduleApi.createMotPhutVoLeThumbnail({ content: validContent(), design: { preset: 'dark-knowledge' }, outputPath });
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  assert.ok(fs.statSync(result).size > 1000);
});
