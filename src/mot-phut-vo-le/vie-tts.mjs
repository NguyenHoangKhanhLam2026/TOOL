import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import { VIENEU_VOICES, vieneuModelStatus, synthesizeVieNeuPreview } from '../tts/vieneu-tts.mjs';
import { normalizeMotPhutVoLeSettings } from './settings.mjs';

export const MOT_PHUT_VO_LE_VOICE_MODEL = 'vieneu-v3-turbo-onnx-fp32-v1';
export const MOT_PHUT_VO_LE_VOICES = VIENEU_VOICES;
const MODULE_DATA_DIR = path.join(DATA, 'mot-phut-vo-le');
const AUDIO_CACHE_DIR = path.join(MODULE_DATA_DIR, 'audio-cache');

export function getMotPhutVoLeTtsStatus(settings = {}) {
  return vieneuModelStatus(settings);
}

export function listMotPhutVoLeVoices() {
  return [...VIENEU_VOICES];
}

export function motPhutVoLeAudioCacheKey(text, settings = {}) {
  const normalized = normalizeMotPhutVoLeSettings(settings);
  return crypto.createHash('sha256')
    .update([MOT_PHUT_VO_LE_VOICE_MODEL, normalized.voice, normalized.speed.toFixed(2), 'vi', String(text).normalize('NFC').trim()].join('|'))
    .digest('hex');
}

export async function synthesizeMotPhutVoLeAudio({ id, text, settings = {}, revisionId = '', onProgress = () => {} }) {
  const normalized = normalizeMotPhutVoLeSettings(settings);
  const status = getMotPhutVoLeTtsStatus(settings);
  if (!status.ready) throw new Error('VieNeu-TTS chưa sẵn sàng trên máy này.');
  const cacheKey = motPhutVoLeAudioCacheKey(text, normalized);
  const contentDir = path.join(MODULE_DATA_DIR, 'content', String(id));
  const revision = revisionId ? `-${String(revisionId).replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 64)}` : '';
  const outputPath = path.join(contentDir, `speech${revision}.wav`);
  const timingPath = path.join(contentDir, `vieneu-timing${revision}.json`);
  const cacheAudio = path.join(AUDIO_CACHE_DIR, `${cacheKey}.wav`);
  const cacheTiming = path.join(AUDIO_CACHE_DIR, `${cacheKey}.json`);
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  if (isUsableAudio(cacheAudio) && fs.existsSync(cacheTiming)) {
    fs.copyFileSync(cacheAudio, outputPath);
    fs.copyFileSync(cacheTiming, timingPath);
    onProgress({ phase: 'vieneu-cache-hit', cacheKey });
    return { audioPath: outputPath, timingPath, cacheKey, reused: true, voice: normalized.voice, speed: normalized.speed, language: 'vi' };
  }

  try {
    await synthesizeVieNeuPreview({ text, language: 'vi', voice: normalized.voice, speed: normalized.speed, outputPath, timingPath,
      settings, onProgress: (progress, detail) => onProgress({ phase: 'vieneu-synthesis', progress, ...detail }) });
    if (!isUsableAudio(outputPath) || !fs.existsSync(timingPath)) throw new Error('VieNeu không tạo được audio hoặc timing metadata hợp lệ.');
    const temporaryAudio = `${cacheAudio}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const temporaryTiming = `${cacheTiming}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.copyFileSync(outputPath, temporaryAudio);
    fs.copyFileSync(timingPath, temporaryTiming);
    fs.renameSync(temporaryAudio, cacheAudio);
    fs.renameSync(temporaryTiming, cacheTiming);
    return { audioPath: outputPath, timingPath, cacheKey, reused: false, voice: normalized.voice, speed: normalized.speed, language: 'vi' };
  } catch (error) {
    error.code ||= 'MOT_PHUT_VO_LE_VIENEU_FAILED';
    throw error;
  }
}

function isUsableAudio(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 1024; } catch { return false; }
}

export async function createMotPhutVoLeVoicePreview({ text, voice, speed = 1, outputPath, settings = {}, onProgress = () => {} }) {
  const normalized = normalizeMotPhutVoLeSettings({ ...settings, voice, speed });
  if (!String(text || '').trim()) throw new Error('Nhập câu văn để nghe thử giọng.');
  const target = outputPath || path.join(MODULE_DATA_DIR, 'previews', `${crypto.randomUUID()}.wav`);
  const timingPath = `${target}.wordtimings.json`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await synthesizeVieNeuPreview({ text: String(text).normalize('NFC').trim(), language: 'vi', voice: normalized.voice,
    speed: normalized.speed, outputPath: target, timingPath, settings, onProgress: (progress, detail) => onProgress({ progress, ...detail }) });
  return { audioPath: target, timingPath, voice: normalized.voice, speed: normalized.speed, language: 'vi' };
}
