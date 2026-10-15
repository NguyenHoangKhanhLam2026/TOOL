import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PATHS } from '../src/config.mjs';
import { mapWordBoundariesToTokens, prepareSpeechText } from '../packages/audio-highlight/highlight-engine.mjs';
import { synthesizeVieNeuScript, vieneuModelStatus } from '../src/tts/vieneu-tts.mjs';
import { renderVideo } from '../packages/video-engine/render.mjs';

const settings = {
  vieneuViVoice: process.env.AERS_TEST_VI_VOICE || 'Mỹ Duyên',
  vieneuEnVoice: process.env.AERS_TEST_EN_VOICE || 'Hải Đăng',
  vieneuViSpeed: Number(process.env.AERS_TEST_VI_SPEED || 1),
  vieneuEnSpeed: Number(process.env.AERS_TEST_EN_SPEED || 0.65),
  highlightEnabled: true,
  highlightMode: 'word',
  highlightColor: '#FF8066',
  highlightPadding: 6,
  highlightRadius: 8,
  highlightTransition: 'instant'
};

const scenarios = [
  {
    name: 'number-pronunciation-and-short-phrases',
    title: 'Luyện đọc số tiếng Anh',
    topic: 'Số đếm và hội thoại ngắn',
    dialogues: [
      { id: 'order', vi: 'Đơn hàng của bạn gồm mười hai quyển sách và ba cây bút.', en: 'Your order includes 12 books and 3 pens.' },
      { id: 'arrival', vi: 'Vui lòng đến sớm mười lăm phút.', en: 'Please arrive 15 minutes early.' }
    ]
  },
  {
    name: 'long-and-short-dialogues',
    title: 'Kiểm tra highlight nhiều câu',
    topic: 'Đặt vé và yêu cầu hỗ trợ',
    dialogues: [
      { id: 'tickets', vi: 'Chúng tôi cần hai mươi mốt vé cho buổi hòa nhạc.', en: 'We need 21 tickets for the concert.' },
      { id: 'confirm', vi: 'Đúng rồi, chính xác.', en: 'Yes, exactly.' },
      { id: 'support', vi: 'Vui lòng gọi lại lúc chín giờ sáng nếu bạn cần thêm hỗ trợ.', en: 'Please call us back at 9 a.m. if you need any further assistance.' }
    ]
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(prepareSpeechText('Your order includes 12 books, 3 pens, and 1.5 liters.', 'en')
  === 'Your order includes twelve books, three pens, and one point five liters.', 'Không chuyển số tiếng Anh sang chữ đọc đúng như mong đợi.');
assert(prepareSpeechText('Có 12 quyển sách.', 'vi') === 'Có 12 quyển sách.', 'Đã thay đổi chữ số của lời thoại tiếng Việt.');
const numberMap = mapWordBoundariesToTokens('I have 12 books.', [
  { text: 'I', startSeconds: 0, endSeconds: 0.2 },
  { text: 'have', startSeconds: 0.2, endSeconds: 0.4 },
  { text: 'twelve', startSeconds: 0.4, endSeconds: 0.8 },
  { text: 'books', startSeconds: 0.8, endSeconds: 1.1 }
], 'number-map-check', { language: 'en' });
assert(numberMap.alignment.reliable && numberMap.wordTimings.find((word) => word.text === '12')?.startSeconds === 0.4,
  'Mốc đọc “twelve” không map về token hiển thị “12”.');

const initialModelStatus = vieneuModelStatus();
assert(initialModelStatus.installed, 'VieNeu chưa được cài đầy đủ; chưa thể tạo video thử.');
assert(initialModelStatus.freeRamMb >= initialModelStatus.minimumRamMb,
  `RAM trống ${initialModelStatus.freeRamMb} MB, cần ${initialModelStatus.minimumRamMb} MB trước khi nạp VieNeu.`);

const summaries = [];
for (const scenario of scenarios) {
  const model = vieneuModelStatus();
  assert(model.freeRamMb >= model.minimumRamMb,
    `RAM trống ${model.freeRamMb} MB trước kịch bản ${scenario.name}; cần ${model.minimumRamMb} MB.`);
  const videoId = `vieneu-smoke-${scenario.name}-${crypto.randomUUID()}`;
  const dialogues = scenario.dialogues.map(({ id, vi, en }) => ({ id, vietnamese: vi, english: en }));
  const script = {
    id: videoId,
    title: scenario.title,
    topic: scenario.topic,
    category: 'Kiểm tra hệ thống',
    level: 'A2-B1',
    thumbnailTitle: scenario.title,
    hook: 'Cùng luyện một vài câu tiếng Anh.',
    dialogues,
    speechSegments: scenario.dialogues.flatMap(({ id, vi, en }, index) => ([
      {
        segmentId: `${id}-vietnamese`, speakerId: `${id}-vietnamese`, language: 'vi', text: vi,
        turnId: id, state: 'vietnamese', target: { layerId: 'vietnamese-card', dialogueIndex: index }
      },
      {
        segmentId: `${id}-english`, speakerId: `${id}-english`, language: 'en', text: en,
        turnId: id, state: 'bilingual', target: { layerId: 'english-card', dialogueIndex: index }
      }
    ]))
  };

  console.log(`Tạo video thử ${scenario.name} · VI ${settings.vieneuViSpeed}x · EN ${settings.vieneuEnSpeed}x · RAM ${model.freeRamMb} MB`);
  const audio = await synthesizeVieNeuScript(script, videoId, {
    settings,
    onProgress: (_progress, detail) => {
      if (detail?.phase === 'vieneu-memory') console.log(`VieNeu memory: ${detail.state || detail.phase}`);
    }
  });
  assert(audio.length === scenario.dialogues.length * 2, `Số đoạn TTS không khớp trong ${scenario.name}.`);
  const unaligned = audio.filter((item) => !item.alignment?.reliable);
  assert(!unaligned.length,
    `Chưa căn được toàn bộ từ: ${unaligned.map((item) => {
      const missingWords = new Set(item.alignment?.unmatchedTokenIds || []);
      const words = (item.tokens || []).filter((token) => missingWords.has(token.id)).map((token) => token.text);
      return `${item.language}:${item.segmentId} thiếu [${words.join(', ')}] (${item.alignmentWarning || item.alignment?.status || 'unknown'})`;
    }).join(', ')}`);
  for (const item of audio) {
    assert(item.wordTimings.length === item.tokens.length,
      `Đoạn ${item.segmentId} thiếu mốc highlight (${item.wordTimings.length}/${item.tokens.length}).`);
    assert(Math.abs(Number(item.rate) - (item.language === 'en' ? settings.vieneuEnSpeed : settings.vieneuViSpeed)) < 0.001,
      `Tốc độ riêng của đoạn ${item.segmentId} không khớp cài đặt.`);
  }

  const targetEnglish = script.speechSegments.filter((segment) => segment.language === 'en');
  for (const segment of targetEnglish) {
    const audioItem = audio.find((item) => item.segmentId === segment.segmentId);
    const expected = prepareSpeechText(segment.text, 'en');
    assert(audioItem?.speechText === expected, `Văn bản đọc tiếng Anh không khớp ở ${segment.segmentId}.`);
  }

  const warnings = [];
  const result = await renderVideo(script, videoId, audio, {
    highlightSettings: settings,
    onProgress: () => {},
    onAlignmentWarning: (warning) => warnings.push(warning)
  });
  assert(fs.existsSync(result.videoPath) && fs.statSync(result.videoPath).size > 20_000,
    `Render ${scenario.name} không tạo được MP4 hợp lệ.`);
  assert(result.renderManifest.highlightTimeline.length > 0, `Video ${scenario.name} không có mốc highlight.`);
  assert(!warnings.length, `Video ${scenario.name} có cảnh báo căn chỉnh: ${warnings.map((item) => item.warning).join(' | ')}`);
  assert(!result.renderManifest.highlightTimeline.some((cue) => cue.endTime - cue.startTime < (1 / 30) - 0.001),
    `Video ${scenario.name} có cue ngắn hơn một frame.`);
  for (const item of audio) {
    const cues = result.renderManifest.highlightTimeline.filter((cue) => cue.segmentId === item.segmentId);
    const visibleTokenIds = new Set(cues.flatMap((cue) => cue.tokenIds));
    const missing = item.tokens.filter((token) => !visibleTokenIds.has(token.id));
    assert(!missing.length, `Video ${scenario.name} thiếu highlight cho ${item.segmentId}: ${missing.map((token) => token.text).join(', ')}`);
  }

  const outputDir = path.dirname(result.videoPath);
  fs.writeFileSync(path.join(outputDir, 'audio-manifest.json'), JSON.stringify(result.audioManifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'render-manifest.json'), JSON.stringify(result.renderManifest, null, 2), 'utf8');
  const summary = {
    scenario: scenario.name,
    videoPath: result.videoPath,
    durationSeconds: result.duration,
    dimensions: `${result.width}x${result.height}`,
    dialogueSegmentCount: audio.length,
    highlightCueCount: result.renderManifest.highlightTimeline.length,
    englishSpeechText: targetEnglish.map((segment) => ({ display: segment.text, spoken: prepareSpeechText(segment.text, 'en') })),
    alignments: audio.map((item) => ({ language: item.language, segmentId: item.segmentId, source: item.alignmentSource, reliable: item.alignment.reliable, mappedTokens: item.alignment.mappedTokenCount, totalTokens: item.tokens.length, speed: item.rate })),
    freeRamMbAfter: Math.round(os.freemem() / 1048576)
  };
  fs.writeFileSync(path.join(outputDir, 'smoke-result.json'), JSON.stringify(summary, null, 2), 'utf8');
  summaries.push(summary);
}

console.log(JSON.stringify({ status: 'passed', videos: summaries }, null, 2));
