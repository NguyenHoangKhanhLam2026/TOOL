import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  COSYVOICE_MODEL_DIR, COSYVOICE_MODEL_MARKER, COSYVOICE_PYTHON_BIN, COSYVOICE_REFERENCE_PATH, COSYVOICE_SOURCE_DIR,
  COSYVOICE_PROFILES_DIR, OPEN_JTALK_DICTIONARY_DIR, PATHS, ROOT, STYLE_BERT_VITS2_MODELS_DIR, STYLE_BERT_VITS2_MODEL_MARKER, STYLE_BERT_VITS2_PYTHON_BIN, VIENEU_HF_HOME
} from '../config.mjs';
import { cosyVoiceLibraryProfiles, cosyVoiceLibraryVoicePath, isCosyVoiceLibraryId } from './cosyvoice-voice-library.mjs';
import { alignSpeechBatchLocally } from './local-alignment.mjs';
import { mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

const SBV2_WORKER = path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize_style_bert_vits2.py');
const COSYVOICE_WORKER = path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize_cosyvoice3.py');
const SBV2_VERSION = 'style-bert-vits2-jvnv-f1-jp-cpu-v1';
const COSYVOICE_VERSION = 'cosyvoice3-0.5b-2512-cpu-v2-compact-instruction';
export const STYLE_BERT_VITS2_VOICES = Object.freeze([
  { id: 'jvnv-F1-jp', label: 'JVNV F1 · Nữ 1', checkpoint: 'jvnv-F1-jp_e160_s14000.safetensors' },
  { id: 'jvnv-F2-jp', label: 'JVNV F2 · Nữ 2', checkpoint: 'jvnv-F2_e166_s20000.safetensors' },
  { id: 'jvnv-M1-jp', label: 'JVNV M1 · Nam 1', checkpoint: 'jvnv-M1-jp_e158_s14000.safetensors' },
  { id: 'jvnv-M2-jp', label: 'JVNV M2 · Nam 2', checkpoint: 'jvnv-M2-jp_e159_s17000.safetensors' }
]);
const SBV2_MIN_FREE_RAM_MB = 4096;
const COSYVOICE_MIN_FREE_RAM_MB = 3072;
const MIN_REMAINING_RAM_MB = 1024;

function nonEmpty(file, bytes = 1) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size >= bytes; }
  catch { return false; }
}

function readMarker(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function cosyVoiceProfileAudioPath(id) {
  if (isCosyVoiceLibraryId(id)) return cosyVoiceLibraryVoicePath(id);
  const profilePath = path.join(COSYVOICE_PROFILES_DIR, `${id}.wav`);
  if (id === 'legacy' && !nonEmpty(profilePath, 44_100)) return COSYVOICE_REFERENCE_PATH;
  return profilePath;
}

export function styleBertVits2Status() {
  const marker = readMarker(STYLE_BERT_VITS2_MODEL_MARKER);
  const voices = STYLE_BERT_VITS2_VOICES.map((voice) => {
    const directory = path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id);
    const modelPath = path.join(directory, voice.checkpoint);
    const ready = nonEmpty(modelPath, 10_000_000) && nonEmpty(path.join(directory, 'config.json'), 100) && nonEmpty(path.join(directory, 'style_vectors.npy'), 100);
    return { ...voice, installed: ready, modelBytes: nonEmpty(modelPath) ? fs.statSync(modelPath).size : 0 };
  });
  const bertSnapshots = path.join(VIENEU_HF_HOME, 'hub', 'models--ku-nlp--deberta-v2-large-japanese-char-wwm', 'snapshots');
  let bertCacheReady = false;
  try {
    bertCacheReady = fs.readdirSync(bertSnapshots).some((snapshot) => {
      const directory = path.join(bertSnapshots, snapshot);
      return nonEmpty(path.join(directory, 'config.json'), 100)
        && (nonEmpty(path.join(directory, 'pytorch_model.bin'), 10_000_000) || nonEmpty(path.join(directory, 'model.safetensors'), 10_000_000));
    });
  }
  catch { /* The required Japanese BERT cache has not been installed. */ }
  const openJtalkDictionaryReady = ['char.bin', 'matrix.bin', 'sys.dic', 'unk.dic']
    .every((file) => nonEmpty(path.join(OPEN_JTALK_DICTIONARY_DIR, file), 100));
  const installed = marker.provider === 'style-bert-vits2-jvnv-jp'
    && marker.backend === 'cpu' && fs.existsSync(STYLE_BERT_VITS2_PYTHON_BIN)
    && voices.every((voice) => voice.installed) && bertCacheReady && openJtalkDictionaryReady;
  return {
    installed, ready: installed, model: 'Style-Bert-VITS2 · JVNV F1 Japanese',
    modelDir: STYLE_BERT_VITS2_MODELS_DIR, python: STYLE_BERT_VITS2_PYTHON_BIN,
    openJtalkDictionaryDir: OPEN_JTALK_DICTIONARY_DIR, openJtalkDictionaryReady,
    modelBytes: voices.reduce((total, voice) => total + voice.modelBytes, 0), voices,
    minimumRamMb: SBV2_MIN_FREE_RAM_MB, minimumRemainingRamMb: MIN_REMAINING_RAM_MB,
    freeRamMb: Math.round(os.freemem() / (1024 * 1024)), device: 'CPU'
  };
}

export function cosyVoice3Status(settings = {}) {
  const marker = readMarker(COSYVOICE_MODEL_MARKER);
  const installed = marker.provider === 'cosyvoice3-0.5b-2512' && marker.backend === 'cpu'
    && fs.existsSync(COSYVOICE_PYTHON_BIN) && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'cosyvoice3.yaml'), 100)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'llm.pt'), 1_000_000_000)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'flow.pt'), 1_000_000_000)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'hift.pt'), 10_000_000)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'campplus.onnx'), 1_000_000)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'speech_tokenizer_v3.onnx'), 100_000_000)
    && nonEmpty(path.join(COSYVOICE_MODEL_DIR, 'CosyVoice-BlankEN', 'model.safetensors'), 500_000_000)
    && fs.existsSync(path.join(COSYVOICE_SOURCE_DIR, 'third_party', 'Matcha-TTS'));
  const libraryProfiles = cosyVoiceLibraryProfiles();
  const libraryProfilesById = new Map(libraryProfiles.map((profile) => [profile.id, profile]));
  const configuredProfiles = (Array.isArray(settings.cosyVoiceProfiles) ? settings.cosyVoiceProfiles : []).map((profile) => {
    const id = String(profile?.id || '');
    const safeId = /^[a-z0-9][a-z0-9-]{1,63}$/i.test(id);
    const referencePath = safeId ? cosyVoiceProfileAudioPath(id) : '';
    if (isCosyVoiceLibraryId(id)) {
      const installed = libraryProfilesById.get(id);
      if (installed) return { ...installed, name: String(profile?.name || installed.name).slice(0, 80), ready: true };
    }
    return {
      id, name: String(profile?.name || '').slice(0, 80), referenceText: String(profile?.referenceText || '').slice(0, 1000),
      ready: Boolean(safeId && nonEmpty(referencePath, 44_100) && String(profile?.name || '').trim() && String(profile?.referenceText || '').trim())
    };
  });
  const profilesById = new Map(configuredProfiles.map((profile) => [profile.id, profile]));
  for (const profile of libraryProfiles) if (!profilesById.has(profile.id)) profilesById.set(profile.id, profile);
  const profiles = [...profilesById.values()];
  if (!profiles.some((profile) => profile.id === 'legacy') && nonEmpty(COSYVOICE_REFERENCE_PATH, 44_100)) {
    profiles.push({
      id: 'legacy', name: String(settings.cosyVoiceProfileName || 'Giọng đã lưu trước đây').slice(0, 80),
      referenceText: String(settings.cosyVoiceReferenceText || '').slice(0, 1000), ready: Boolean(String(settings.cosyVoiceReferenceText || '').trim())
    });
  }
  const selectedProfile = profiles.find((profile) => profile.id === String(settings.cosyVoiceProfileId || ''));
  const legacyReferenceReady = !settings.cosyVoiceProfileId && nonEmpty(COSYVOICE_REFERENCE_PATH, 44_100) && Boolean(String(settings.cosyVoiceReferenceText || '').trim());
  const referenceReady = Boolean(selectedProfile?.ready || legacyReferenceReady);
  return {
    installed, ready: installed, model: 'CosyVoice 3.0 · 0.5B · CPU',
    modelDir: COSYVOICE_MODEL_DIR, sourceDir: COSYVOICE_SOURCE_DIR, python: COSYVOICE_PYTHON_BIN,
    modelBytes: Number(marker.modelBytes) || 0,
    minimumRamMb: COSYVOICE_MIN_FREE_RAM_MB, minimumRemainingRamMb: MIN_REMAINING_RAM_MB,
    freeRamMb: Math.round(os.freemem() / (1024 * 1024)), device: 'CPU',
    referenceReady, referenceName: selectedProfile?.name || String(settings.cosyVoiceProfileName || ''), profiles,
    referenceText: selectedProfile?.referenceText || String(settings.cosyVoiceReferenceText || '')
  };
}

function runWorker(provider, python, worker, request, onEvent, onSpawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(python, [worker, request], {
        cwd: ROOT, windowsHide: true,
        env: { ...process.env, OPEN_JTALK_DICT_DIR: OPEN_JTALK_DICTIONARY_DIR, PYTHONUTF8: '1', CUDA_VISIBLE_DEVICES: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
      });
    } catch (error) { reject(describeSpawnError(python, error)); return; }
    onSpawn(child.pid || null);
    let stderr = '';
    let pending = '';
    let settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 30 * 60_000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.stderr?.on('data', (chunk) => {
      const value = chunk.toString();
      stderr = `${stderr}${value}`.slice(-12_000);
      pending += value;
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() || '';
      for (const line of lines) {
        const at = line.indexOf(`${provider.toUpperCase()}_`);
        if (at < 0) continue;
        const separator = line.indexOf(':', at);
        if (separator < 0) continue;
        try { onEvent(line.slice(at, separator), JSON.parse(line.slice(separator + 1))); }
        catch { /* Keep malformed diagnostics in stderr. */ }
      }
    });
    child.once('error', (error) => finish(describeSpawnError(python, error)));
    child.once('close', (code) => code === 0 ? finish() : finish(new Error(`${provider} worker exited (${code}): ${stderr.slice(-3000)}`)));
  });
}

function configFor(provider, settings) {
  if (provider === 'vieneu-sbv2') {
    const status = styleBertVits2Status();
    if (!status.installed) throw new Error('Style-Bert-VITS2 Japanese is not installed. Run npm run setup:multilingual-tts.');
    const voice = STYLE_BERT_VITS2_VOICES.find((item) => item.id === String(settings.styleBertVits2Voice || 'jvnv-F1-jp'));
    if (!voice) throw new Error('Choose an installed Style-Bert-VITS2 Japanese voice.');
    const free = Math.round(os.freemem() / (1024 * 1024));
    if (free < status.minimumRamMb) throw new Error(`Style-Bert-VITS2 needs at least ${status.minimumRamMb} MB free RAM before loading; currently ${free} MB is free.`);
    return {
      language: 'ja', provider: 'SBV2', python: STYLE_BERT_VITS2_PYTHON_BIN, worker: SBV2_WORKER,
      modelVersion: SBV2_VERSION, voice: voice.id,
      style: String(settings.styleBertVits2Style || 'Neutral'),
      speed: Math.max(0.7, Math.min(1.4, Number(settings.styleBertVits2Speed) || 1)),
    modelPath: path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id, voice.checkpoint),
      configPath: path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id, 'config.json'),
      stylePath: path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id, 'style_vectors.npy')
    };
  }
  if (provider === 'vieneu-cosyvoice3') {
    const status = cosyVoice3Status(settings);
    if (!status.installed) throw new Error('CosyVoice 3.0 is not installed. Run npm run setup:multilingual-tts.');
    if (!status.referenceReady) throw new Error('Upload a clean WAV voice sample and save its exact transcript in TTS settings before generating Chinese speech.');
    const free = Math.round(os.freemem() / (1024 * 1024));
    if (free < status.minimumRamMb) throw new Error(`CosyVoice 3.0 needs at least ${status.minimumRamMb} MB free RAM before loading; currently ${free} MB is free.`);
    const selectedProfile = status.profiles.find((profile) => profile.id === String(settings.cosyVoiceProfileId || ''));
    const referencePath = selectedProfile
      ? cosyVoiceProfileAudioPath(selectedProfile.id)
      : COSYVOICE_REFERENCE_PATH;
    const referenceText = selectedProfile?.referenceText || String(settings.cosyVoiceReferenceText || '').trim();
    return {
      language: 'zh', provider: 'COSYVOICE', python: COSYVOICE_PYTHON_BIN, worker: COSYVOICE_WORKER,
      modelVersion: COSYVOICE_VERSION, voice: 'cosyvoice3-reference',
      speed: 1,
      sourceDir: COSYVOICE_SOURCE_DIR, modelDir: COSYVOICE_MODEL_DIR,
      referenceText, referencePath,
      referenceHash: crypto.createHash('sha256').update(fs.readFileSync(referencePath)).digest('hex')
    };
  }
  throw new Error(`Unsupported local TTS provider: ${provider}`);
}

function safeId(value) { return String(value || 'segment').replace(/[^\w-]+/gu, '-').slice(0, 100) || 'segment'; }

export async function synthesizeMultilingualSegments(segments, videoId, { provider, settings = {}, lease = null, onProgress = () => {} } = {}) {
  const config = configFor(provider, settings);
  if (segments.some((segment) => segment.language !== config.language)) throw new Error(`${provider} cannot synthesize a segment outside ${config.language}.`);
  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  const stagingDir = path.join(PATHS.temporary, videoId, `${provider}-staging`);
  const cacheDir = path.join(PATHS.temporary, 'audio-cache');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const files = [];
  const pending = [];
  const outputBySegment = new Map();

  for (const [index, segment] of segments.entries()) {
    const text = segment.speechText || segment.text;
    const isCosyVoice = provider === 'vieneu-cosyvoice3';
    const ttsDirection = isCosyVoice ? String(segment.ttsDirection || '').trim() : '';
    const ttsSpeed = config.speed;
    const cacheKey = [config.modelVersion, config.voice, config.style || '', config.speed, config.referenceHash || '', config.referenceText || ''];
    if (isCosyVoice) cacheKey.push(ttsDirection, ttsSpeed);
    cacheKey.push(text);
    const hash = crypto.createHash('sha256').update(JSON.stringify(cacheKey)).digest('hex');
    const cachedPath = path.join(cacheDir, `${hash}.multilingual.wav`);
    const cachedTimingPath = `${cachedPath}.wordtimings.json`;
    const targetPath = segment.outputPath || segment.rawPath || path.join(workDir, `${String(segment.order + 1).padStart(3, '0')}-${safeId(segment.segmentId)}.wav`);
    const rawPath = path.join(stagingDir, `${String(index + 1).padStart(3, '0')}-${crypto.randomUUID()}.raw.wav`);
    const timingPath = `${targetPath}.wordtimings.json`;
    const item = {
      ...segment, text, speechText: text, voiceName: config.voice, rate: ttsSpeed,
      ...(isCosyVoice ? { ttsDirection, ttsSpeed } : {}),
      path: targetPath, audioPath: targetPath, cachePath: cachedPath, cacheTimingPath: cachedTimingPath, timingPath
    };
    if (!nonEmpty(cachedPath, 1024) || !nonEmpty(cachedTimingPath)) {
      pending.push({ segment, item, rawPath, hash });
    }
    files.push(item);
    outputBySegment.set(segment.segmentId, { item, rawPath });
  }

  if (pending.length) {
    const requestPath = path.join(PATHS.temporary, `${provider}-${process.pid}-${crypto.randomUUID()}.request.json`);
    const request = {
      ...Object.fromEntries(['modelPath', 'configPath', 'stylePath', 'style', 'sourceDir', 'modelDir', 'referencePath', 'referenceText'].filter((key) => config[key] !== undefined).map((key) => [key, config[key]])),
      items: pending.map(({ segment, item, rawPath }) => ({
        segmentId: segment.segmentId, text: segment.speechText || segment.text,
        speed: item.ttsSpeed || config.speed, style: config.style,
        ...(provider === 'vieneu-cosyvoice3' && item.ttsDirection ? { instruction: item.ttsDirection } : {}),
        outputPath: rawPath
      }))
    };
    fs.writeFileSync(requestPath, JSON.stringify(request), 'utf8');
    try {
      lease?.update({ phase: `${provider}-loading`, workerExited: false });
      await runWorker(config.provider, config.python, config.worker, requestPath, (kind, value) => {
        if (kind.endsWith('_PROGRESS')) {
          lease?.update({ phase: `${provider}-synthesis`, segmentIndex: Number(value.index) || 0, segmentCount: pending.length });
          onProgress(Math.min(0.62, Number(value.index || 0) / pending.length * 0.62), { ...value, phase: `${provider}-synthesis`, language: config.language });
        }
      }, (pid) => lease?.update({ phase: `${provider}-worker-started`, workerPid: pid, workerExited: false }));
      for (const { rawPath } of pending) if (!nonEmpty(rawPath, 1024)) throw new Error(`${provider} did not produce a valid WAV file.`);
    } finally { fs.rmSync(requestPath, { force: true }); }

    lease?.update({ phase: `${provider}-local-alignment`, workerPid: null, workerExited: true });
    let aligned = pending.map(() => ({ wordBoundaries: [], warning: 'Local word alignment is unavailable.', source: null }));
    if (settings.highlightEnabled !== false) {
      try {
        aligned = await alignSpeechBatchLocally(pending.map(({ segment, rawPath }) => ({
          segmentId: segment.segmentId, audioPath: rawPath,
          text: segment.speechText || segment.text, language: config.language
        })));
      } catch (error) {
        aligned = pending.map(() => ({ wordBoundaries: [], warning: error.message, source: null }));
      }
    }
    for (const [index, staged] of pending.entries()) {
      const timing = aligned[index] || { wordBoundaries: [], warning: null, source: null };
      fs.copyFileSync(staged.rawPath, staged.item.cachePath);
      fs.writeFileSync(staged.item.cacheTimingPath, JSON.stringify({
        source: timing.source || null, warning: timing.warning || null,
        wordBoundaries: Array.isArray(timing.wordBoundaries) ? timing.wordBoundaries : []
      }), 'utf8');
      fs.rmSync(staged.rawPath, { force: true });
      onProgress(0.62 + (index + 1) / pending.length * 0.34, { phase: `${provider}-local-alignment`, index: index + 1, total: pending.length, segmentId: staged.segment.segmentId, language: config.language });
    }
  }

  const output = [];
  for (const [index, file] of files.entries()) {
    const { item, rawPath } = outputBySegment.get(file.segmentId);
    const sourcePath = item.cachePath;
    if (!nonEmpty(sourcePath, 1024) || !nonEmpty(item.cacheTimingPath)) throw new Error(`No cached ${provider} audio is available for ${file.segmentId}.`);
    fs.mkdirSync(path.dirname(item.path), { recursive: true });
    fs.copyFileSync(sourcePath, item.path);
    const metadata = JSON.parse(fs.readFileSync(item.cacheTimingPath, 'utf8'));
    const mapped = mapWordBoundariesToTokens(file.text, metadata.wordBoundaries, file.segmentId, { language: config.language });
    const record = {
      ...file, index: index + 1, voice: config.voice, modelVersion: config.modelVersion,
      tokens: mapped.tokens, wordTimings: mapped.wordTimings, alignment: mapped.alignment,
      alignmentSource: metadata.source || null,
      alignmentWarning: metadata.warning || (mapped.alignment.reliable ? null : 'Local word alignment did not map every token.'),
      alignmentPath: item.timingPath
    };
    fs.writeFileSync(item.timingPath, JSON.stringify({ source: record.alignmentSource, warning: record.alignmentWarning, wordBoundaries: metadata.wordBoundaries, alignment: mapped.alignment }), 'utf8');
    output.push(record);
    fs.rmSync(rawPath, { force: true });
    onProgress(1, { phase: 'audio', index: index + 1, total: files.length, segmentId: file.segmentId, language: config.language, workerExited: true });
  }
  return output;
}

export function multilingualTtsMinRam(provider) {
  return provider === 'vieneu-cosyvoice3' ? COSYVOICE_MIN_FREE_RAM_MB : SBV2_MIN_FREE_RAM_MB;
}
