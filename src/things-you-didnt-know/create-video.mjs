import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import { synthesizeThingsNarration } from './speech.mjs';
import { alignSpeechLocally } from '../tts/local-alignment.mjs';
import { mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { generateThingsYouDidntKnowCandidate, generateThingsYouDidntKnowScript } from './prompt.mjs';
import { inspectThingsYouDidntKnowSources } from './fact-check.mjs';
import { COUNTRY_CATALOG } from './catalog.mjs';
import { getThingsYouDidntKnowSourceVisualDesign } from './source-visual-design-store.mjs';
import {
  createThingsYouDidntKnowContent, getThingsYouDidntKnowContent,
  getThingsYouDidntKnowJob, getThingsYouDidntKnowRecentFormatHistory, listThingsYouDidntKnowFactKeys,
  logThingsYouDidntKnowActivity, updateThingsYouDidntKnowContent, updateThingsYouDidntKnowJob
} from './history.mjs';
import { getThingsYouDidntKnowSettings } from './settings-store.mjs';
import { renderThingsYouDidntKnowThumbnail, renderThingsYouDidntKnowVideo } from './media-renderer.mjs';

const OUTPUT_DIR = path.join(DATA, 'outputs', 'things-you-didnt-know');

function readTimingFile(timingPath) {
  try {
    const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
    return {
      ...timing,
      wordBoundaries: Array.isArray(timing.wordBoundaries) ? timing.wordBoundaries : []
    };
  } catch {
    return { provider: 'kokoro-onnx-cpu', source: null, wordBoundaries: [] };
  }
}

async function ensureThingsWordTimings(content, settings, job) {
  if (!settings.highlightEnabled) return;

  const timing = readTimingFile(content.timingPath);
  const currentAlignment = mapWordBoundariesToTokens(content.imageBody, timing.wordBoundaries, 'things-' + content.id, { language: 'en' });
  if (currentAlignment.alignment.reliable) return;

  progress(job, 'timing-alignment', { contentId: content.id, message: 'Đang căn thời gian từ trên audio Kokoro.' });
  const aligned = await alignSpeechLocally(content.audioPath, content.narration, 'en');
  const wordBoundaries = Array.isArray(aligned?.wordBoundaries) ? aligned.wordBoundaries : [];
  const result = mapWordBoundariesToTokens(content.imageBody, wordBoundaries, 'things-' + content.id, { language: 'en' });
  const warning = aligned?.warning || (result.alignment.reliable
    ? null
    : `Forced alignment chưa đủ từ: khớp ${result.alignment.mappedTokenCount}, thiếu ${result.alignment.unmatchedTokenCount}.`);

  fs.writeFileSync(content.timingPath, JSON.stringify({
    ...timing,
    provider: timing.provider || 'kokoro-onnx-cpu',
    source: aligned?.source || null,
    wordBoundaries,
    warning,
    alignment: result.alignment
  }, null, 2), 'utf8');

  if (!result.alignment.reliable) {
    throw Object.assign(new Error(`Word timing Kokoro chưa đủ tin cậy để bật highlight. ${warning || 'Không căn được timing cục bộ.'}`), {
      code: 'TYDK_TIMING_UNRELIABLE', alignment: result.alignment
    });
  }
}

function progress(job, phase, details = {}) {
  const latest = getThingsYouDidntKnowJob(job.id) || job;
  const next = { ...latest.progress, phase, ...details, updatedAt: new Date().toISOString() };
  updateThingsYouDidntKnowJob(job.id, { progress: next });
  logThingsYouDidntKnowActivity({ jobId: job.id, contentId: job.payload.contentId || null,
    stage: phase, code: 'TYDK_' + phase.toUpperCase().replace(/[^A-Z0-9]+/gu, '_').slice(0, 70),
    message: "Things You Didn't Know: " + phase.replace(/-/gu, ' ') + (details.message ? ' · ' + details.message : '') });
  return next;
}

async function discoverContent(job, settingsSnapshot, designSnapshot) {
  const country = COUNTRY_CATALOG.find((item) => item.id === job.payload.countryId);
  if (!country) throw new Error('Không tìm thấy quốc gia được giữ chỗ trong catalog.');
  const themeId = job.payload.themeId;
  let lastRejectedFact = '';
  let validationHint = '';
  const exclusions = listThingsYouDidntKnowFactKeys(500);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    progress(job, 'fact-selection', { attempt, maxAttempts: 4, country: country.name, theme: job.payload.theme });
    let candidate;
    try {
      candidate = await generateThingsYouDidntKnowCandidate({
        country, themeId, theme: job.payload.theme,
        exclusions: [...exclusions, ...(lastRejectedFact ? [lastRejectedFact] : [])], validationHint
      });
      validationHint = '';
    } catch (error) {
      if (!['TYDK_INVALID_CANDIDATE', 'TYDK_INVALID_JSON'].includes(error.code)) throw error;
      validationHint = String(error.message || error).slice(0, 500);
      logThingsYouDidntKnowActivity({ jobId: job.id, stage: 'candidate-rejected', severity: 'WARN',
        code: 'TYDK_CANDIDATE_REJECTED', message: `Lượt ${attempt}/4 bị từ chối: ${validationHint}` });
      if (attempt === 4) throw Object.assign(new Error(`Không tạo được fact hợp lệ sau 4 lượt. Lỗi cuối: ${validationHint}`), { code: 'TYDK_NO_VALID_CANDIDATE' });
      continue;
    }
    progress(job, 'source-check', { attempt, sourceCount: candidate.sources.length });
    const script = await generateThingsYouDidntKnowScript({
      candidate, country, themeId, recentFormats: getThingsYouDidntKnowRecentFormatHistory(30)
    });
    try {
      const sourceReview = await inspectThingsYouDidntKnowSources(candidate.sources);
      script.sources = sourceReview.sources;
      script.sourceReview = { status: sourceReview.status, note: sourceReview.note, checkedAt: sourceReview.checkedAt, verified: false };
      const content = createThingsYouDidntKnowContent({
        jobId: job.id, payload: job.payload, script, sourceStatus: sourceReview.status,
        sourceReviewNote: sourceReview.note, settingsSnapshot, designSnapshot
      });
      return content;
    } catch (error) {
      if (error.code !== 'TYDK_DUPLICATE_FACT') throw error;
      lastRejectedFact = script.factText;
      logThingsYouDidntKnowActivity({ jobId: job.id, stage: 'fact-duplicate', severity: 'WARN',
        code: 'TYDK_DUPLICATE_FACT_REJECTED', message: 'Bỏ qua fact trùng lịch sử và chọn fact khác cho ' + country.name + '.' });
    }
  }
  throw Object.assign(new Error('Không tìm được fact mới sau bốn lần thử; không tạo Reel trùng.'), { code: 'TYDK_NO_NEW_FACT' });
}

export async function createThingsYouDidntKnowVideo(job, { onProgress = () => {} } = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const settingsSnapshot = job.payload.settingsSnapshot || getThingsYouDidntKnowSettings();
  const designSnapshot = job.payload.designSnapshot || getThingsYouDidntKnowSourceVisualDesign();
  let content = job.payload.contentId ? getThingsYouDidntKnowContent(job.payload.contentId) : null;
  let currentJob = job;
  try {
    if (!content) {
      progress(currentJob, 'fact-selection', { country: job.payload.country });
      content = await discoverContent(currentJob, settingsSnapshot, designSnapshot);
      currentJob = { ...currentJob, payload: { ...currentJob.payload, contentId: content.id } };
      updateThingsYouDidntKnowJob(job.id, { payload: currentJob.payload });
      logThingsYouDidntKnowActivity({ jobId: job.id, contentId: content.id, stage: 'script-ready',
        code: 'TYDK_SCRIPT_READY', message: "Đã lưu kịch bản Things You Didn't Know để có thể thử lại mà không tạo fact khác." });
    }
    if (!content.audioPath || !content.timingPath || !fs.existsSync(content.audioPath) || !fs.existsSync(content.timingPath)) {
      progress(currentJob, 'voice-generation', { contentId: content.id, voice: settingsSnapshot.voice });
      const voiceDir = path.join(OUTPUT_DIR, content.id);
      fs.mkdirSync(voiceDir, { recursive: true });
      const audioPath = path.join(voiceDir, 'narration-' + Date.now() + '.wav');
      const timingPath = audioPath + '.wordtimings.json';
      const ttsSettings = {
        kokoroEnVoice: settingsSnapshot.voice,
        kokoroEnSpeed: settingsSnapshot.speechRate,
        highlightEnabled: settingsSnapshot.highlightEnabled
      };
      const speech = await synthesizeThingsNarration({
        text: content.narration, voice: settingsSnapshot.voice, speed: settingsSnapshot.speechRate,
        outputPath: audioPath, timingPath, contentId: content.id, settings: ttsSettings
      });
      progress(currentJob, 'voice-generation', {
        contentId: content.id, voice: settingsSnapshot.voice, sentenceCount: speech.sentenceCount,
        message: `Đã tạo giọng theo ${speech.sentenceCount} câu, có khoảng nghỉ tự nhiên giữa câu.`
      });
      content = updateThingsYouDidntKnowContent(content.id, { audioPath, timingPath, status: 'audio_ready' });
      progress(currentJob, 'timing-alignment', { contentId: content.id });
      onProgress({ phase: 'timing-alignment', contentId: content.id });
    }
    await ensureThingsWordTimings(content, settingsSnapshot, currentJob);
    if (!content.videoPath || !fs.existsSync(content.videoPath)) {
      progress(currentJob, 'video-render', { contentId: content.id });
      const videoPath = path.join(OUTPUT_DIR, content.id, 'reel-' + Date.now() + '.mp4');
      const result = await renderThingsYouDidntKnowVideo({
        content, audioPath: content.audioPath, timingPath: content.timingPath, outputPath: videoPath,
        settings: settingsSnapshot, design: content.designSnapshot,
        onProgress: (detail) => { onProgress(detail); if (detail.phase === 'frame-render') progress(currentJob, 'video-render', { contentId: content.id, frame: detail.index, frameCount: detail.total }); }
      });
      content = updateThingsYouDidntKnowContent(content.id, { videoPath: result.path, durationSeconds: result.durationSeconds, status: 'needs_review' });
      progress(currentJob, 'thumbnail-render', { contentId: content.id });
      const thumbnailPath = path.join(OUTPUT_DIR, content.id, 'thumbnail-' + Date.now() + '.png');
      await renderThingsYouDidntKnowThumbnail({ script: content.script, design: content.designSnapshot, outputPath: thumbnailPath });
      content = updateThingsYouDidntKnowContent(content.id, { thumbnailPath, status: 'needs_review' });
    } else if (!content.thumbnailPath || !fs.existsSync(content.thumbnailPath)) {
      const thumbnailPath = path.join(OUTPUT_DIR, content.id, 'thumbnail-' + Date.now() + '.png');
      await renderThingsYouDidntKnowThumbnail({ script: content.script, design: content.designSnapshot, outputPath: thumbnailPath });
      content = updateThingsYouDidntKnowContent(content.id, { thumbnailPath, status: 'needs_review' });
    }
    progress(currentJob, 'saved-to-library', { contentId: content.id, status: content.status });
    return { contentId: content.id, status: content.status, sourceStatus: content.sourceStatus,
      videoPath: content.videoPath, thumbnailPath: content.thumbnailPath, durationSeconds: content.durationSeconds };
  } catch (error) {
    if (content && !content.videoPath) updateThingsYouDidntKnowContent(content.id, { status: 'failed' });
    logThingsYouDidntKnowActivity({ jobId: job.id, contentId: content?.id || null, stage: 'failed', severity: 'ERROR',
      code: error.code || 'TYDK_PIPELINE_FAILED', message: String(error.message || error).slice(0, 800) });
    throw error;
  }
}
