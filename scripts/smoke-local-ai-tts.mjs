import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettings } from '../src/database/db.mjs';
import { PATHS } from '../src/config.mjs';
import { synthesizeLocalAiScript } from '../src/tts/local-ai-tts.mjs';
import { getLocalTtsManagerStatus } from '../src/tts/local-model-manager.mjs';
import { probeMedia, renderVideo } from '../packages/video-engine/render.mjs';

function detectBlackIntervals(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-i', videoPath, '-vf', 'blackdetect=d=0.01:pix_th=0.10:pic_th=0.98',
      '-an', '-f', 'null', '-'
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg black-frame check failed (${code}): ${stderr.slice(-1000)}`));
      const intervals = [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/gu)]
        .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
      resolve(intervals);
    });
  });
}

function measureFrameLuma(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'info', '-i', videoPath,
      '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
      '-an', '-f', 'null', '-'
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg frame-luma check failed (${code}): ${stderr.slice(-1000)}`));
      const frames = stderr.split(/(?=frame:\d+\s+pts:)/gu).flatMap((block) => {
        const time = block.match(/pts_time:([\d.]+)/u);
        const luma = block.match(/lavfi\.signalstats\.YAVG=([\d.]+)/u);
        return time && luma ? [{ time: Number(time[1]), luma: Number(luma[1]) }] : [];
      });
      if (!frames.length) return reject(new Error('FFmpeg did not return per-frame luma measurements.'));
      resolve(frames);
    });
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function findUnexpectedDimFlashes(frames, transitions) {
  const neighborhood = 3;
  const results = [];
  for (let index = neighborhood; index < frames.length - neighborhood; index += 1) {
    const frame = frames[index];
    if (transitions.some(({ start, end }) => frame.time >= start - 0.1 && frame.time <= end + 0.1)) continue;
    const left = median(frames.slice(index - neighborhood, index).map(({ luma }) => luma));
    const right = median(frames.slice(index + 1, index + neighborhood + 1).map(({ luma }) => luma));
    // Ignore normal scene cuts. A true dim flash is a local whole-frame drop
    // surrounded by otherwise similar frames, including when it is not black.
    if (Math.abs(left - right) > 12) continue;
    const baseline = (left + right) / 2;
    if (baseline - frame.luma >= 24) results.push({ time: frame.time, baseline, luma: frame.luma });
  }
  return results;
}

const videoId = `local-ai-smoke-${randomUUID()}`;
const script = {
  topic: 'Daily routine smoke test',
  title: 'Practice everyday English',
  hook: 'Hai câu hội thoại và hai cụm từ luyện nghe.',
  dialogues: [
    {
      id: 'walk-after-dinner', index: 1,
      vietnamese: 'Tôi thường đi bộ sau bữa tối.',
      english: 'I usually take a walk after dinner.',
      term: 'after dinner', meaningVi: 'sau bữa tối', noteVi: ''
    },
    {
      id: 'before-class', index: 2,
      vietnamese: 'Tôi có mười hai phút trước khi vào lớp.',
      english: 'I have 12 minutes before class.',
      term: 'before class', meaningVi: 'trước khi vào lớp', noteVi: ''
    },
    {
      id: 'on-my-way', index: 3,
      vietnamese: 'Tôi sẽ gọi cho bạn trên đường đi.',
      english: 'I will call you on my way.',
      term: 'on my way', meaningVi: 'trên đường đi', noteVi: ''
    }
  ]
};
const settings = {
  ...getSettings(),
  ttsProvider: 'vieneu',
  vieneuViVoice: 'Hải Đăng',
  vieneuViSpeed: 1,
  kokoroEnVoice: 'af_heart',
  kokoroEnSpeed: 0.85,
  localTtsMinFreeRamMb: 2560,
  localTtsMinRemainingRamMb: 1024,
  highlightEnabled: true,
  highlightMode: 'word'
};

if (getLocalTtsManagerStatus().active) throw new Error('Đang có một TTS local khác chạy; không bắt đầu smoke test chồng model.');
const memoryEvents = [];
console.log(JSON.stringify({ phase: 'starting', videoId, freeRamMb: Math.round(os.freemem() / (1024 * 1024)) }));
const audio = await synthesizeLocalAiScript(script, videoId, {
  settings,
  onProgress: (progress, detail = {}) => {
    if (detail.workerMemory) memoryEvents.push(detail.workerMemory);
    else if (detail.event === 'memory') memoryEvents.push(detail);
    if (detail.phase || detail.managerPhase) console.log(JSON.stringify({ progress, ...detail }));
  }
});
assert.equal(audio.length, 9, 'Three dialogue pairs should create VI + EN + phrase audio for each pair.');
assert.deepEqual(audio.map((item) => item.order), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(audio.filter((item) => item.language === 'en' && item.voiceName === 'af_heart').length, 3);
assert.equal(audio.filter((item) => item.state === 'vocabulary' && item.language === 'vi').length, 3);
for (const item of audio) {
  assert.ok(fs.existsSync(item.path) && fs.statSync(item.path).size > 1024, `Missing audio: ${item.segmentId}`);
}

const result = await renderVideo(script, videoId, audio, {
  highlightSettings: settings,
  onProgress: (progress) => { if (progress === 1) console.log(JSON.stringify({ phase: 'render-complete', progress })); },
  onTimeline: (timeline) => console.log(JSON.stringify({ phase: 'timeline', timeline })),
  onAlignmentWarning: (warning) => console.warn(JSON.stringify({ phase: 'alignment-warning', ...warning }))
});
const media = await probeMedia(result.videoPath);
const manifest = result.renderManifest;
const vocabularyEntries = manifest.timeline.filter((entry) => entry.type === 'speech' && entry.state === 'vocabulary');
const transitionEntries = manifest.timeline.filter((entry) => entry.type === 'silence' && entry.state === 'transition');
assert.equal(vocabularyEntries.length, 3, 'Each phrase must be spoken while the vocabulary card is on screen.');
assert.equal(transitionEntries.length, script.dialogues.length, 'Each dialogue group must have exactly one explicit black transition.');
assert.equal(manifest.effectiveTiming.vocabularyHold, 5, 'Vocabulary cards must remain visible for five seconds after phrase narration ends.');
for (const [index, entry] of vocabularyEntries.entries()) {
  const pauseAfterPhrase = transitionEntries[index].start - entry.end;
  assert.ok(pauseAfterPhrase >= 5 && pauseAfterPhrase < 5 + (1 / 30) + 0.001, 'Each phrase must be followed by a full five-second hold before transition.');
}
const transitionFrameCount = Math.round(manifest.effectiveTiming.transition * 30);
assert.equal(transitionFrameCount, 2, 'Black transition must be exactly two output frames.');
assert.ok(transitionEntries.every((entry) => Math.abs(entry.start * 30 - Math.round(entry.start * 30)) < 0.0001), 'Every black transition must start on a 30 FPS frame boundary.');
const blackIntervals = await detectBlackIntervals(result.videoPath);
assert.equal(blackIntervals.length, transitionEntries.length, 'There must be no extra black flash between speech and scene transitions.');
for (const [index, black] of blackIntervals.entries()) {
  const expected = transitionEntries[index];
  assert.ok(Math.abs(black.start - expected.start) < 0.001, 'Black interval must begin exactly at its planned transition.');
  assert.ok(Math.abs(black.duration - transitionFrameCount / 30) < 0.001, 'Black interval must be exactly two frames long.');
}
const frameLuma = await measureFrameLuma(result.videoPath);
const dimFlashes = findUnexpectedDimFlashes(frameLuma, transitionEntries);
assert.deepEqual(dimFlashes, [], `Unexpected whole-frame dim flash outside planned transitions: ${JSON.stringify(dimFlashes)}`);
for (const [index, phrase] of vocabularyEntries.entries()) {
  const holdStart = phrase.end + 0.1;
  const holdEnd = transitionEntries[index].start - 0.1;
  const heldFrames = frameLuma.filter(({ time }) => time >= holdStart && time <= holdEnd);
  assert.ok(heldFrames.length >= 30, 'Phrase hold must be long enough to inspect for brief dim frames.');
  const lumas = heldFrames.map(({ luma }) => luma);
  const spread = Math.max(...lumas) - Math.min(...lumas);
  assert.ok(spread <= 2, `Phrase hold must remain visually steady without dim flashes; luma spread was ${spread.toFixed(3)}.`);
}
assert.equal(media.streams.find((stream) => stream.codec_type === 'video')?.codec_name, 'h264');
assert.equal(media.streams.find((stream) => stream.codec_type === 'audio')?.codec_name, 'aac');
assert.ok(manifest.highlightTimeline.length > 0, 'Video must contain audio-synchronized word highlights.');
const manager = getLocalTtsManagerStatus();
assert.equal(manager.active, false, 'Model manager lock must be released when TTS workers finish.');
assert.equal(manager.workerExited, true);
console.log(JSON.stringify({
  phase: 'smoke-passed', videoId, videoPath: result.videoPath, duration: media.duration,
  dimensions: `${result.width}x${result.height}`, speechSegments: audio.length,
  vocabularySegments: vocabularyEntries.length, blackTransitions: transitionEntries.length, dimFlashes: dimFlashes.length,
  inspectedFrames: frameLuma.length, highlightCues: manifest.highlightTimeline.length,
  memory: memoryEvents, ttsManager: manager
}, null, 2));
