import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import { generateMotPhutVoLeScript } from './prompt.mjs';
import { discoverFreshTopic, findIdeaDuplicate } from './topic-engine.mjs';
import { validateMotPhutVoLeContent } from './content-validator.mjs';
import {
  getAllMotPhutVoLeHistoryForDeduplication, getMotPhutVoLeContent,
  reserveMotPhutVoLeIdea, saveMotPhutVoLeScript, updateMotPhutVoLeContent
} from './history.mjs';
import { normalizeMotPhutVoLeSettings } from './settings.mjs';
import { getMotPhutVoLeSettings } from './settings-store.mjs';
import { normalizeMotPhutVoLeVisualDesign, createMotPhutVoLeDesignSnapshot } from './visual-design.mjs';
import { getMotPhutVoLeVisualDesign } from './visual-design-store.mjs';
import { synthesizeMotPhutVoLeAudio } from './vie-tts.mjs';
import { alignMotPhutVoLeAudio, saveMotPhutVoLeAlignmentManifest } from './alignment.mjs';
import { createMotPhutVoLeSpeechPacedAudio } from './speech-pacing.mjs';
import { createMotPhutVoLeThumbnail, renderMotPhutVoLeVideo } from './renderer.mjs';
import { validateAudioDuration } from './timing.mjs';
import { normalizeMotPhutVoLeDelivery } from './delivery.mjs';
import { reviewMotPhutVoLeFactClaims } from './fact-check.mjs';

const OUTPUT_DIR = path.join(DATA, 'outputs', 'mot-phut-vo-le');
const MODULE_DATA_DIR = path.join(DATA, 'mot-phut-vo-le');

export async function createMotPhutVoLeDraft({ topic = '', category = '', contentId = '', settings: settingsInput = {}, onProgress = () => {}, generate } = {}) {
  const settings = normalizeMotPhutVoLeSettings(settingsInput);
  let resumedReservation = null;
  if (contentId) {
    const saved = getMotPhutVoLeContent(contentId);
    if (!saved) throw Object.assign(new Error(`Saved MPVL draft not found: ${contentId}.`), { code: 'MOT_PHUT_VO_LE_CONTENT_NOT_FOUND' });
    const idea = { category: saved.category, subcategory: saved.subcategory, topic: saved.topic, angle: saved.angle,
      titleHint: saved.title, summary: saved.summary };
    const design = createMotPhutVoLeDesignSnapshot(saved.visualDesign || settingsInput.design || getMotPhutVoLeVisualDesign());
    if (String(saved.scriptText || '').trim()) {
      onProgress({ phase: 'script-ready', contentId, topic: saved.topic, resumed: true,
        wordCount: String(saved.scriptText).trim().split(/\s+/u).filter(Boolean).length });
      return { ...saved, idea, settings, design };
    }
    resumedReservation = { id: contentId, idea };
  }
  const { chatgptStatus } = await import('../ai/chatgpt-plan.mjs');
  if (!chatgptStatus().connected) throw Object.assign(new Error('Chưa kết nối ChatGPT Plan trong ứng dụng.'), { code: 'MOT_PHUT_VO_LE_CHATGPT_UNAVAILABLE' });
  let lastError;
  for (let attempt = 0; attempt < settings.maxTopicRetries; attempt += 1) {
    let idea, id;
    if (resumedReservation) {
      ({ id, idea } = resumedReservation);
      resumedReservation = null;
    } else {
      onProgress({ phase: 'topic-discovery', attempt: attempt + 1, maxAttempts: settings.maxTopicRetries });
      const history = getAllMotPhutVoLeHistoryForDeduplication();
      try {
        idea = await discoverFreshTopic({ history, categoryHint: category, manualTopic: topic, generate, retries: 1 });
      } catch (error) {
        lastError = error;
        if (error.code === 'MOT_PHUT_VO_LE_DUPLICATE_IDEA') continue;
        throw error;
      }
      try {
        id = reserveMotPhutVoLeIdea(idea);
      } catch (error) {
        lastError = error;
        if (error.code === 'MOT_PHUT_VO_LE_DUPLICATE_IDEA') continue;
        throw error;
      }
    }

    try {
      onProgress({ phase: 'script-generation', contentId: id, topic: idea.topic });
      const generated = await generateMotPhutVoLeScript(idea, {}, generate);
      onProgress({ phase: 'script-review-started', contentId: id, topic: idea.topic });
      const existing = getAllMotPhutVoLeHistoryForDeduplication({ excludeId: id });
      const duplicate = findIdeaDuplicate(generated, existing, 0.84);
      if (duplicate.duplicate) {
        throw Object.assign(new Error(`Kịch bản trùng hoặc quá giống nội dung ${duplicate.matchId || 'đã lưu'} (độ tương đồng văn bản ${duplicate.score}).`), { code: 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT' });
      }
      const factCheck = reviewMotPhutVoLeFactClaims(generated);
      const content = saveMotPhutVoLeScript(id, generated, { validation: { schema: 'mot-phut-vo-le-v1', valid: true, factCheck } });
      updateMotPhutVoLeContent(id, { caption: normalizeMotPhutVoLeDelivery(content).caption, hashtags: content.hashtags, status: 'script_ready' });
      onProgress({ phase: 'script-ready', contentId: id, topic: idea.topic,
        wordCount: String(content.scriptText || '').trim().split(/\s+/u).filter(Boolean).length,
        factCheckStatus: factCheck?.status || 'reviewed' });
      return { ...getMotPhutVoLeContent(id), idea, settings, design: createMotPhutVoLeDesignSnapshot(settingsInput.design || getMotPhutVoLeVisualDesign()) };
    } catch (error) {
      updateMotPhutVoLeContent(id, { status: 'failed', lastError: error.message });
      lastError = error;
      if (error.code === 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT') continue;
      error.code ||= 'MOT_PHUT_VO_LE_SCRIPT_FAILED';
      throw error;
    }
  }
  throw lastError || new Error('Không tìm được chủ đề mới sau số lần thử đã giới hạn.');
}

export async function createMotPhutVoLeVideo({ topic = '', category = '', contentId = '', settings: settingsInput = {}, design: designInput = null, onProgress = () => {}, generate } = {}) {
  const baseSettings = normalizeMotPhutVoLeSettings(settingsInput);
  const existing = contentId ? getMotPhutVoLeContent(contentId) : null;
  if (contentId && !existing) throw Object.assign(new Error(`Saved MPVL draft not found: ${contentId}.`), { code: 'MOT_PHUT_VO_LE_CONTENT_NOT_FOUND' });
  if (existing?.status === 'complete' && existing.videoPath && fs.existsSync(existing.videoPath)) {
    onProgress({ phase: 'complete', contentId, videoPath: existing.videoPath, resumed: true });
    return existing;
  }
  const draft = await createMotPhutVoLeDraft({ topic, category, contentId, settings: baseSettings, generate, onProgress });
  const settings = draft.settings;
  const id = draft.id;
  const design = normalizeMotPhutVoLeVisualDesign(designInput || draft.design);
  const contentDir = path.join(MODULE_DATA_DIR, 'content', id);
  const videoDir = path.join(OUTPUT_DIR, id);
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });
  const voiceProfile = { provider: 'vieneu-v3-turbo-onnx-fp32', language: 'vi', voice: settings.voice, speed: settings.speed, model: 'vieneu-v3-turbo-onnx-fp32-v1' };
  updateMotPhutVoLeContent(id, { status: 'processing', voiceProfile, visualDesign: createMotPhutVoLeDesignSnapshot(design) });

  try {
    let content = getMotPhutVoLeContent(id);
    onProgress({ phase: 'vieneu-synthesis', contentId: id, attempt: 1 });
    let audio = await synthesizeMotPhutVoLeAudio({ id, text: content.scriptText, settings, onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    let duration = await readAudioDuration(audio.audioPath);
    validateAudioDuration(duration);
    onProgress({ phase: 'audio-ready', contentId: id, durationSeconds: duration, reused: audio.reused === true });

    let alignment = await alignMotPhutVoLeAudio({ audioPath: audio.audioPath, scriptText: content.scriptText, segmentId: id,
      onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    if (!alignment.reliable && alignment.status === 'partial' && !settings.allowStaticOnAlignmentFailure) {
      onProgress({ phase: 'alignment-script-revision', contentId: id, unmatchedTokenCount: alignment.alignment?.unmatchedTokenCount || 0 });
      const correction = 'Một lượt căn chỉnh tiếng Việt cục bộ còn thiếu một âm tiết. Hãy viết lại các câu ngắn và rõ hơn, dùng cụm từ phổ biến, giữ nguyên kiến thức và góc khai thác, tránh tên riêng hoặc chuỗi từ khó nghe. Không thêm hoặc bỏ ý quan trọng.';
      const revised = validateMotPhutVoLeContent(await generateMotPhutVoLeScript(draft.idea, {
        alignmentCorrection: correction
      }, generate));
      const prior = getAllMotPhutVoLeHistoryForDeduplication({ excludeId: id });
      const duplicate = findIdeaDuplicate(revised, prior, 0.88);
      if (duplicate.duplicate) throw Object.assign(new Error('Bản sửa để căn chỉnh bị phát hiện quá giống một kịch bản đã lưu.'), { code: 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT' });
      const factCheck = reviewMotPhutVoLeFactClaims(revised);
      content = saveMotPhutVoLeScript(id, revised, { validation: { schema: 'mot-phut-vo-le-v1', valid: true, alignmentRevision: 1, factCheck }, duplicateThreshold: 0.88 });
      onProgress({ phase: 'script-revised', contentId: id,
        wordCount: String(content.scriptText || '').trim().split(/\s+/u).filter(Boolean).length, reason: 'alignment' });
      updateMotPhutVoLeContent(id, { status: 'processing' });
      audio = await synthesizeMotPhutVoLeAudio({ id, text: content.scriptText, settings, onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
      duration = await readAudioDuration(audio.audioPath);
      validateAudioDuration(duration);
      onProgress({ phase: 'audio-ready', contentId: id, durationSeconds: duration, reused: audio.reused === true });
      alignment = await alignMotPhutVoLeAudio({ audioPath: audio.audioPath, scriptText: content.scriptText, segmentId: id,
        onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    }
    // Sentence pacing is an additive MPVL-only pass for newly created reels.
    // Resumed drafts and completed reels keep their original audio and timings.
    if (!contentId && alignment.reliable) {
      const pacedAudioPath = path.join(contentDir, `speech-paced-${Date.now()}.wav`);
      try {
        const pacing = createMotPhutVoLeSpeechPacedAudio({
          audioPath: audio.audioPath, outputPath: pacedAudioPath, scriptText: content.scriptText, alignment
        });
        if (pacing.applied) {
          const pacedAlignment = await alignMotPhutVoLeAudio({
            audioPath: pacedAudioPath, scriptText: content.scriptText, segmentId: `${id}-paced-${Date.now()}`,
            onProgress: (detail) => onProgress({ contentId: id, ...detail })
          });
          if (pacedAlignment.reliable) {
            const pacedDuration = await readAudioDuration(pacedAudioPath);
            validateAudioDuration(pacedDuration);
            audio = { ...audio, audioPath: pacedAudioPath, pacing };
            alignment = pacedAlignment;
            duration = pacedDuration;
            onProgress({ phase: 'speech-pacing', contentId: id, insertedPauseCount: pacing.insertedPauseCount,
              insertedDurationSeconds: pacing.insertedDurationSeconds, durationSeconds: duration });
          } else {
            fs.rmSync(pacedAudioPath, { force: true });
            onProgress({ phase: 'speech-pacing-skipped', contentId: id, reason: 'paced-alignment-unreliable' });
          }
        } else {
          onProgress({ phase: 'speech-pacing-skipped', contentId: id, reason: pacing.reason });
        }
      } catch (error) {
        fs.rmSync(pacedAudioPath, { force: true });
        onProgress({ phase: 'speech-pacing-skipped', contentId: id, reason: error.message });
      }
    }
    const durationCheck = validateAudioDuration(duration);
    const alignmentPath = path.join(contentDir, 'alignment.json');
    saveMotPhutVoLeAlignmentManifest(alignmentPath, alignment);
    const thumbnailPath = path.join(videoDir, 'thumbnail.png');
    await createMotPhutVoLeThumbnail({ content, design, outputPath: thumbnailPath });
    updateMotPhutVoLeContent(id, { status: 'processing', audioPath: audio.audioPath, alignmentManifest: alignment, thumbnailPath,
      visualDesign: createMotPhutVoLeDesignSnapshot(design), voiceProfile });
    onProgress({ phase: 'thumbnail-ready', contentId: id, thumbnailPath });
    const videoPath = path.join(videoDir, `video-${Date.now()}.mp4`);
    onProgress({ phase: 'render-started', contentId: id, durationSeconds: duration });
    const renderResult = await renderMotPhutVoLeVideo({ content, audioPath: audio.audioPath, alignment, design, outputPath: videoPath,
      backgroundEffect: settings, highlightMode: settings.highlightMode,
      allowPartialAlignment: settings.allowStaticOnAlignmentFailure, onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    const record = updateMotPhutVoLeContent(id, {
      status: 'complete', audioPath: audio.audioPath, alignmentManifest: alignment, videoPath: renderResult.videoPath,
      thumbnailPath, visualDesign: createMotPhutVoLeDesignSnapshot(design), voiceProfile,
      validation: { schema: 'mot-phut-vo-le-v1', valid: true, audioDuration: durationCheck, alignmentReliable: alignment.reliable,
        renderSettings: createMotPhutVoLeRenderSettings(settings) }, lastError: null
    });
    onProgress({ phase: 'complete', contentId: id, videoPath: renderResult.videoPath, durationSeconds: renderResult.durationSeconds });
    return { ...record, render: renderResult, audio, alignment };
  } catch (error) {
    updateMotPhutVoLeContent(id, { status: 'failed', lastError: error.message });
    if (error.code?.startsWith('MOT_PHUT_VO_LE_')) throw error;
    error.code ||= 'MOT_PHUT_VO_LE_RENDER_FAILED';
    throw error;
  }
}

export async function createMotPhutVoLeVideos({ count = 1, resumeProgress = null, ...options } = {}) {
  const total = Math.max(1, Math.min(5, Number(count) || 1));
  const results = [];
  const completed = new Set((Array.isArray(resumeProgress?.completedBatchIndices) ? resumeProgress.completedBatchIndices : []).map(Number));
  const resumeIndex = Number(resumeProgress?.batchIndex) || 0;
  for (let index = 0; index < total; index += 1) {
    const batchIndex = index + 1;
    if (completed.has(batchIndex)) {
      const completedId = resumeProgress?.completedBatchContentIds?.[batchIndex];
      const saved = completedId ? getMotPhutVoLeContent(completedId) : null;
      if (saved) results.push(saved);
      continue;
    }
    const resumeId = batchIndex === resumeIndex ? String(resumeProgress?.resumeContentId || resumeProgress?.contentId || '') : '';
    results.push(await createMotPhutVoLeVideo({ ...options, contentId: resumeId || '',
      onProgress: (detail) => options.onProgress?.({ batchIndex, batchTotal: total, ...detail }) }));
  }
  return results;
}

export async function rerenderMotPhutVoLeVideo(id, { design: designInput = null, voice = null, speed = null, scriptText = null, onProgress = () => {} } = {}) {
  let content = getMotPhutVoLeContent(id);
  const savedRenderSettings = content?.validation?.renderSettings || createMotPhutVoLeRenderSettings(getMotPhutVoLeSettings());
  if (!content) throw new Error('Không tìm thấy nội dung để render lại.');
  const currentVoice = content.voiceProfile?.voice || 'Hải Đăng';
  const currentSpeed = Number(content.voiceProfile?.speed) || 1;
  const targetSettings = normalizeMotPhutVoLeSettings({ voice: voice || currentVoice, speed: speed ?? currentSpeed });
  const scriptChanged = typeof scriptText === 'string' && scriptText.normalize('NFC').trim() !== content.scriptText;
  const voiceChanged = targetSettings.voice !== currentVoice || Math.abs(targetSettings.speed - currentSpeed) > 0.001;
  const audioChanged = scriptChanged || voiceChanged || !content.audioPath || !content.alignmentManifest;

  if (scriptChanged) {
    const editedScript = scriptText.normalize('NFC').trim();
    const revised = validateMotPhutVoLeContent({ ...content, scriptText: editedScript, summary: editedScript.split(/[.!?]+/u)[0] || editedScript,
      deliveryStyle: 'natural', contentType: 'explanation', language: 'vi' });
    const prior = getAllMotPhutVoLeHistoryForDeduplication({ excludeId: id });
    const duplicate = findIdeaDuplicate(revised, prior, 0.88);
    if (duplicate.duplicate) throw Object.assign(new Error(`Kịch bản đã chỉnh sửa quá giống nội dung ${duplicate.matchId || 'đã lưu'}.`), { code: 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT' });
    content = saveMotPhutVoLeScript(id, revised, { validation: { schema: 'mot-phut-vo-le-v1', valid: true,
      userEdited: true, factCheck: reviewMotPhutVoLeFactClaims(revised) }, duplicateThreshold: 0.88 });
  }

  const design = normalizeMotPhutVoLeVisualDesign(designInput || content.visualDesign || getMotPhutVoLeVisualDesign());
  const videoDir = path.join(OUTPUT_DIR, id);
  const revisionId = String(Date.now());
  let audioPath = content.audioPath;
  let alignment = content.alignmentManifest;
  const voiceProfile = { provider: 'vieneu-v3-turbo-onnx-fp32', language: 'vi', voice: targetSettings.voice, speed: targetSettings.speed, model: 'vieneu-v3-turbo-onnx-fp32-v1' };
  if (audioChanged) {
    onProgress({ phase: scriptChanged ? 'script-updated' : 'voice-updated', contentId: id, voice: targetSettings.voice, speed: targetSettings.speed });
    const audio = await synthesizeMotPhutVoLeAudio({ id, text: content.scriptText, settings: targetSettings, revisionId,
      onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    audioPath = audio.audioPath;
    const duration = await readAudioDuration(audioPath);
    onProgress({ phase: 'audio-ready', contentId: id, durationSeconds: duration, reused: audio.reused === true });
    validateAudioDuration(duration);
    alignment = await alignMotPhutVoLeAudio({ audioPath, scriptText: content.scriptText, segmentId: `${id}-${revisionId}`,
      onProgress: (detail) => onProgress({ contentId: id, ...detail }) });
    if (!alignment.reliable) throw Object.assign(new Error(alignment.warning || 'Không căn chỉnh chính xác được audio mới.'), { code: 'MOT_PHUT_VO_LE_ALIGNMENT_UNRELIABLE' });
    saveMotPhutVoLeAlignmentManifest(path.join(MODULE_DATA_DIR, 'content', id, `alignment-${revisionId}.json`), alignment);
  }
  const outputPath = path.join(videoDir, `video-${revisionId}.mp4`);
  const thumbnailPath = path.join(videoDir, `thumbnail-${revisionId}.png`);
  const thumbnail = await createMotPhutVoLeThumbnail({ content, design, outputPath: thumbnailPath });
  onProgress({ phase: 'thumbnail-ready', contentId: id, thumbnailPath, rerender: true });
  onProgress({ phase: 'render-started', contentId: id, rerender: true });
  const render = await renderMotPhutVoLeVideo({ content, audioPath, alignment, design, outputPath,
    backgroundEffect: savedRenderSettings.backgroundEffect, highlightMode: savedRenderSettings.highlightMode,
    allowPartialAlignment: false, onProgress });
  const saved = updateMotPhutVoLeContent(id, {
    status: 'complete', videoPath: render.videoPath, thumbnailPath: thumbnail,
    ...(audioChanged ? { audioPath, alignmentManifest: alignment, voiceProfile } : {}),
    visualDesign: createMotPhutVoLeDesignSnapshot(design),
    validation: { ...(content.validation || {}), renderSettings: savedRenderSettings }, lastError: null
  });
  return { ...saved, render, audioChanged };
}

function createMotPhutVoLeRenderSettings(settings) {
  return {
    backgroundEffect: {
      backgroundEffect: settings.backgroundEffect,
      backgroundEffectDensity: settings.backgroundEffectDensity,
      backgroundEffectSpeed: settings.backgroundEffectSpeed,
      backgroundEffectOpacity: settings.backgroundEffectOpacity,
      highlightEnabled: settings.highlightEnabled,
      highlightColor: settings.highlightColor,
      highlightPadding: settings.highlightPadding,
      highlightRadius: settings.highlightRadius
    },
    highlightMode: settings.highlightMode,
    highlightTransition: settings.highlightTransition
  };
}

export function saveMotPhutVoLeCaption(id, caption, hashtags = []) {
  const delivery = normalizeMotPhutVoLeDelivery({ caption, hashtags });
  return updateMotPhutVoLeContent(id, { caption: delivery.caption, hashtags: delivery.hashtags });
}

async function readAudioDuration(file) {
  const { spawn } = await import('node:child_process');
  const { FFPROBE_BIN, ROOT } = await import('../config.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      const duration = Number(stdout.trim());
      if (code === 0 && Number.isFinite(duration)) resolve(duration);
      else reject(new Error(`FFprobe không đọc được thời lượng VieNeu: ${stderr.slice(-400)}`));
    });
  });
}
