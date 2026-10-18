import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { COSYVOICE_VOICE_LIBRARY_DIR, DATA, FFMPEG_BIN, FFPROBE_BIN, ROOT } from '../config.mjs';

const execFileAsync = promisify(execFile);
const HF_ROOT = 'https://huggingface.co/datasets/AISHELL/AISHELL-3/resolve/main';
const SOURCE_PAGE = 'https://openslr.org/93/';
const SAMPLE_TEXT_URL = `${HF_ROOT}/train/content.txt`;
const SPEAKER_INFO_URL = `${HF_ROOT}/spk-info.txt`;
const SOURCE_CACHE_DIR = path.join(path.dirname(COSYVOICE_VOICE_LIBRARY_DIR), 'source-metadata');
const VOICE_SLOTS = [
  { id: 'female-01', directory: 'female_01', gender: 'female', name: 'Nữ Trung 01' },
  { id: 'female-02', directory: 'female_02', gender: 'female', name: 'Nữ Trung 02' },
  { id: 'female-03', directory: 'female_03', gender: 'female', name: 'Nữ Trung 03' },
  { id: 'male-01', directory: 'male_01', gender: 'male', name: 'Nam Trung 01' },
  { id: 'male-02', directory: 'male_02', gender: 'male', name: 'Nam Trung 02' },
  { id: 'male-03', directory: 'male_03', gender: 'male', name: 'Nam Trung 03' }
];
const PREFERRED_SPEAKERS = {
  female: ['SSB0012', 'SSB0011', 'SSB0057', 'SSB0379', 'SSB0005'],
  male: ['SSB0261', 'SSB0394', 'SSB0603', 'SSB0273', 'SSB0375']
};
const MIN_SAMPLE_SECONDS = 5;
const MAX_SAMPLE_SECONDS = 15;
const MIN_TRANSCRIPT_CHARACTERS = 22;
const MAX_TRANSCRIPT_CHARACTERS = 65;
const ID_PATTERN = /^(?:female|male)-0[1-3]$/;

let installJob = {
  status: 'idle', running: false, phase: 'idle', message: 'Thư viện giọng Trung chưa được kiểm tra.',
  voiceIndex: 0, total: VOICE_SLOTS.length, installed: 0, failed: [], startedAt: null, finishedAt: null
};
let activeController = null;

function slotDirectory(id) {
  const slot = VOICE_SLOTS.find((item) => item.id === String(id));
  return slot ? path.join(COSYVOICE_VOICE_LIBRARY_DIR, slot.directory) : null;
}

function isCosyVoiceLibraryId(id) { return ID_PATTERN.test(String(id || '')); }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function parseWave(filePath) {
  let buffer;
  try { buffer = fs.readFileSync(filePath); }
  catch { return null; }
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = null;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) return null;
    if (name === 'fmt ' && size >= 16) {
      format = {
        encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4), bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (name === 'data') dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || !dataBytes || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 || format.bitsPerSample !== 16) return null;
  const durationSeconds = dataBytes / (format.sampleRate * format.channels * format.bitsPerSample / 8);
  return { ...format, durationSeconds, dataBytes };
}

function readSlotProfile(slot) {
  const directory = path.join(COSYVOICE_VOICE_LIBRARY_DIR, slot.directory);
  const metadataPath = path.join(directory, 'metadata.json');
  const audioPath = path.join(directory, 'reference.wav');
  const metadata = readJson(metadataPath);
  const wave = metadata ? parseWave(audioPath) : null;
  if (!metadata || metadata.voiceId !== slot.id || metadata.validation?.status !== 'passed' || !wave) return null;
  const transcript = String(metadata.referenceText || '').trim();
  if (!transcript || !metadata.speakerId || metadata.gender !== slot.gender) return null;
  return {
    id: slot.id, name: String(metadata.displayName || slot.name).slice(0, 80), referenceText: transcript,
    ready: true, automatic: true, source: 'AISHELL-3', gender: slot.gender,
    genderLabel: slot.gender === 'female' ? 'Nữ' : 'Nam', speakerId: metadata.speakerId,
    recordId: metadata.source?.recordId || '', language: 'zh-CN', sampleRate: wave.sampleRate,
    durationSeconds: Number(wave.durationSeconds.toFixed(2)), license: metadata.license || 'Apache-2.0',
    validation: metadata.validation
  };
}

export function cosyVoiceLibraryProfiles() {
  return VOICE_SLOTS.map(readSlotProfile).filter(Boolean);
}

export function cosyVoiceLibraryStatus() {
  const profiles = cosyVoiceLibraryProfiles();
  const allInstalled = profiles.length === VOICE_SLOTS.length;
  const job = { ...installJob, failed: [...(installJob.failed || [])] };
  if (job.status === 'idle') job.message = profiles.length
    ? 'Thư viện AISHELL-3 đã được xác minh trên máy này.'
    : 'Chưa có mẫu AISHELL-3 nào được cài.';
  return {
    source: 'AISHELL-3', sourceUrl: SOURCE_PAGE, license: 'Apache-2.0',
    expected: VOICE_SLOTS.length, installed: profiles.length, complete: allInstalled,
    profiles, job
  };
}

function updateJob(patch) {
  installJob = { ...installJob, ...patch, updatedAt: new Date().toISOString() };
}

function throwIfCancelled(signal) {
  if (signal.aborted) throw new Error('VOICE_LIBRARY_CANCELLED');
}

async function fetchWithRetry(url, { signal, timeoutMs = 45_000, attempts = 3, onProgress = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfCancelled(signal);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetch(url, { signal: combinedSignal, redirect: 'follow' });
      if (!response.ok) throw new Error(`Nguồn AISHELL-3 trả HTTP ${response.status}.`);
      onProgress({ contentLength: Number(response.headers.get('content-length')) || 0 });
      return response;
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw new Error('VOICE_LIBRARY_CANCELLED');
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`Không tải được dữ liệu từ AISHELL-3 sau ${attempts} lần thử: ${lastError?.message || 'lỗi mạng'}`);
}

async function downloadBuffer(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return Buffer.from(await response.arrayBuffer());
}

async function getSourceMetadata(signal) {
  fs.mkdirSync(SOURCE_CACHE_DIR, { recursive: true });
  const speakerPath = path.join(SOURCE_CACHE_DIR, 'spk-info.txt');
  const transcriptPath = path.join(SOURCE_CACHE_DIR, 'train-content.txt');
  updateJob({ phase: 'checking-source', message: 'Đang kiểm tra nguồn AISHELL-3 và giấy phép Apache-2.0…' });
  for (const [url, target] of [[SPEAKER_INFO_URL, speakerPath], [SAMPLE_TEXT_URL, transcriptPath]]) {
    throwIfCancelled(signal);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
    const buffer = await downloadBuffer(url, { signal, timeoutMs: 90_000 });
    const text = buffer.toString('utf8');
    if (text.length < 1000 || text.includes('<html')) throw new Error('AISHELL-3 trả về metadata không hợp lệ.');
    const tempPath = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, target);
  }
  const speakers = new Map();
  for (const line of fs.readFileSync(speakerPath, 'utf8').split(/\r?\n/u)) {
    const match = line.trim().match(/^(SSB\d{4})\s+\S+\s+(female|male)\s+(\S+)/iu);
    if (match) speakers.set(match[1], { gender: match[2].toLowerCase(), accent: match[3] });
  }
  const records = [];
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^(SSB\d{8})\.wav\s+(.+)$/u);
    if (!match) continue;
    const recordId = match[1];
    const speakerId = recordId.slice(0, 7);
    const referenceText = Array.from(match[2]).filter((character) => /\p{Script=Han}/u.test(character) || /[，。！？；：、“”‘’（）《》【】、]/u.test(character)).join('').trim();
    const speaker = speakers.get(speakerId);
    if (!speaker || referenceText.length < MIN_TRANSCRIPT_CHARACTERS || referenceText.length > MAX_TRANSCRIPT_CHARACTERS) continue;
    records.push({ recordId, speakerId, referenceText, gender: speaker.gender, accent: speaker.accent });
  }
  if (!speakers.size || !records.length) throw new Error('Không tìm thấy metadata speaker/transcript hợp lệ của AISHELL-3.');
  return { speakers, records };
}

async function checkInstallRequirements(signal) {
  let freeBytes;
  try {
    const stats = fs.statfsSync(DATA);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    throw new Error(`Không kiểm tra được dung lượng trống ở thư mục dữ liệu: ${error.message}`);
  }
  if (freeBytes < 64 * 1024 * 1024) throw new Error(`Cần ít nhất 64 MB dung lượng trống để cài thư viện; hiện còn ${Math.floor(freeBytes / 1024 / 1024)} MB.`);
  try { await runProcess(FFMPEG_BIN, ['-version'], 6000, signal); }
  catch (error) {
    if (error.code === 'ENOENT' || /not recognized|not found/i.test(error.message)) throw new Error('Không tìm thấy FFmpeg. Cài FFmpeg rồi thử lại.');
    throw new Error(`Không chạy được FFmpeg: ${error.message}`);
  }
  try { await execFileAsync(FFPROBE_BIN, ['-version'], { timeout: 6000, windowsHide: true }); }
  catch (error) {
    if (error.code === 'ENOENT' || /not recognized|not found/i.test(error.message)) throw new Error('Không tìm thấy FFprobe. Cài FFprobe cùng FFmpeg rồi thử lại.');
    throw new Error(`Không chạy được FFprobe: ${error.message}`);
  }
}

function candidateRecords(records, gender, usedSpeakers) {
  const preferred = PREFERRED_SPEAKERS[gender] || [];
  const preferredOrder = new Map(preferred.map((speakerId, index) => [speakerId, index]));
  const grouped = new Map();
  for (const record of records) {
    if (record.gender !== gender || usedSpeakers.has(record.speakerId)) continue;
    const group = grouped.get(record.speakerId) || [];
    group.push(record);
    grouped.set(record.speakerId, group);
  }
  for (const group of grouped.values()) group.sort((a, b) => Math.abs(a.referenceText.length - 34) - Math.abs(b.referenceText.length - 34) || a.recordId.localeCompare(b.recordId));
  const speakers = [...grouped.keys()].sort((a, b) => {
    const orderA = preferredOrder.has(a) ? preferredOrder.get(a) : 1000;
    const orderB = preferredOrder.has(b) ? preferredOrder.get(b) : 1000;
    return orderA - orderB || a.localeCompare(b);
  });
  const result = [];
  for (let sampleIndex = 0; ; sampleIndex += 1) {
    let added = false;
    for (const speakerId of speakers) {
      const record = grouped.get(speakerId)[sampleIndex];
      if (record) { result.push(record); added = true; }
    }
    if (!added) break;
  }
  return result;
}

function runProcess(command, args, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    throwIfCancelled(signal);
    let child;
    try { child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { try { child.kill(); } catch {} finish(new Error('VOICE_LIBRARY_CANCELLED')); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(new Error(`Process timed out: ${path.basename(command)}`)); }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000); });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => code === 0 ? finish(null, { stdout, stderr }) : finish(new Error(stderr || `${path.basename(command)} exited ${code}`)));
  });
}

async function convertAndInspect(inputPath, outputPath, signal) {
  updateJob({ phase: 'converting-wav', message: 'Đang chuyển mẫu sang WAV mono PCM 16-bit, 16 kHz…' });
  await runProcess(FFMPEG_BIN, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', outputPath], 60_000, signal);
  const wave = parseWave(outputPath);
  if (!wave) throw new Error('WAV sau chuyển đổi không đạt mono PCM 16-bit, 16 kHz hoặc không đọc được.');
  if (wave.durationSeconds < MIN_SAMPLE_SECONDS || wave.durationSeconds > MAX_SAMPLE_SECONDS) {
    throw new Error(`Mẫu dài ${wave.durationSeconds.toFixed(2)} giây, ngoài khoảng ${MIN_SAMPLE_SECONDS}–${MAX_SAMPLE_SECONDS} giây.`);
  }
  try {
    const result = await execFileAsync(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample', '-of', 'json', outputPath], { timeout: 12_000, windowsHide: true });
    const stream = JSON.parse(result.stdout).streams?.[0];
    if (stream?.codec_name !== 'pcm_s16le' || Number(stream.sample_rate) !== 16000 || Number(stream.channels) !== 1) throw new Error('FFprobe không xác nhận đúng định dạng WAV.');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Không tìm thấy FFprobe để xác minh WAV. Cài FFmpeg/FFprobe rồi thử lại.');
    throw error;
  }
  return wave;
}

async function installSlot(slot, context, usedSpeakers, signal, slotIndex) {
  const existing = readSlotProfile(slot);
  if (existing) {
    usedSpeakers.add(existing.speakerId);
    updateJob({ phase: 'registering', voiceIndex: slotIndex, installed: cosyVoiceLibraryProfiles().length, message: `Đã có ${existing.name}; giữ nguyên mẫu đã cài.` });
    return existing;
  }
  const candidates = candidateRecords(context.records, slot.gender, usedSpeakers);
  if (!candidates.length) throw new Error(`AISHELL-3 không có transcript tiếng Trung hợp lệ cho giọng ${slot.gender === 'female' ? 'nữ' : 'nam'}.`);
  let lastError = null;
  let attempts = 0;
  for (const record of candidates) {
    if (attempts >= 18) break;
    attempts += 1;
    throwIfCancelled(signal);
    updateJob({
      phase: 'voice-download', voiceIndex: slotIndex,
      message: `Đang tải giọng ${slotIndex}/${VOICE_SLOTS.length} (${slot.gender === 'female' ? 'nữ' : 'nam'} · ${record.speakerId})…`
    });
    const folder = slotDirectory(slot.id);
    const staging = path.join(COSYVOICE_VOICE_LIBRARY_DIR, `.staging-${slot.id}-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const sourcePath = path.join(staging, 'source.wav');
    const referencePath = path.join(staging, 'reference.wav');
    try {
      const wavUrl = `${HF_ROOT}/train/wav/${record.speakerId}/${record.recordId}.wav`;
      const wav = await downloadBuffer(wavUrl, { signal, timeoutMs: 90_000, attempts: 2 });
      if (wav.length < 16_000 || wav.length > 20 * 1024 * 1024 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Tệp nguồn không phải WAV hợp lệ hoặc có kích thước bất thường.');
      }
      fs.writeFileSync(sourcePath, wav);
      const wave = await convertAndInspect(sourcePath, referencePath, signal);
      fs.rmSync(sourcePath, { force: true });
      updateJob({ phase: 'validating-transcript', message: `Đang kiểm tra transcript tiếng Trung cho bản ghi ${record.recordId}…` });
      if (!/\p{Script=Han}/u.test(record.referenceText) || record.referenceText.length < MIN_TRANSCRIPT_CHARACTERS) throw new Error('Bản chép tiếng Trung bị thiếu hoặc không hợp lệ.');
      const metadata = {
        voiceId: slot.id,
        displayName: slot.name,
        speakerId: record.speakerId,
        gender: record.gender,
        language: 'zh-CN',
        referencePath: path.relative(ROOT, path.join(folder, 'reference.wav')).split(path.sep).join('/'),
        referenceText: record.referenceText,
        sampleRate: wave.sampleRate,
        channels: wave.channels,
        bitsPerSample: wave.bitsPerSample,
        durationSeconds: Number(wave.durationSeconds.toFixed(3)),
        source: {
          dataset: 'AISHELL-3', sourcePage: SOURCE_PAGE,
          repository: 'https://huggingface.co/datasets/AISHELL/AISHELL-3',
          recordId: record.recordId, sourceAudio: `train/wav/${record.speakerId}/${record.recordId}.wav`,
          speakerMetadata: { gender: record.gender, accent: record.accent }
        },
        license: 'Apache-2.0',
        validation: { status: 'passed', checks: ['dataset transcript present', 'source speaker gender matched', '16kHz mono PCM16 WAV', 'duration 5-15 seconds', 'ffprobe readable'], validatedAt: new Date().toISOString() },
        downloadedAt: new Date().toISOString()
      };
      updateJob({ phase: 'registering', message: `Đang đăng ký ${slot.name} vào thư viện…` });
      fs.writeFileSync(path.join(staging, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      const installedProfile = {
        id: slot.id, name: metadata.displayName, referenceText: metadata.referenceText,
        ready: true, automatic: true, source: 'AISHELL-3', gender: metadata.gender,
        genderLabel: slot.gender === 'female' ? 'Nữ' : 'Nam', speakerId: metadata.speakerId,
        recordId: record.recordId, language: 'zh-CN', sampleRate: wave.sampleRate,
        durationSeconds: Number(wave.durationSeconds.toFixed(2)), license: metadata.license,
        referencePath: path.join(folder, 'reference.wav')
      };
      const backup = `${folder}.backup-${process.pid}`;
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(folder)) fs.renameSync(folder, backup);
      try { fs.renameSync(staging, folder); }
      catch (error) { if (fs.existsSync(backup) && !fs.existsSync(folder)) fs.renameSync(backup, folder); throw error; }
      fs.rmSync(backup, { recursive: true, force: true });
      usedSpeakers.add(record.speakerId);
      updateJob({ installed: cosyVoiceLibraryProfiles().length, message: `Đã cài ${slot.name} từ speaker ${record.speakerId}.` });
      return installedProfile;
    } catch (error) {
      lastError = error;
      fs.rmSync(staging, { recursive: true, force: true });
      if (error.message === 'VOICE_LIBRARY_CANCELLED') throw error;
      if (/trả HTTP 401|trả HTTP 403|trả HTTP 429|không tải được dữ liệu/u.test(error.message)) throw error;
    }
  }
  throw new Error(`Không tìm được mẫu tiếng ${slot.gender === 'female' ? 'nữ' : 'nam'} hợp lệ sau ${attempts} bản ghi: ${lastError?.message || 'không có mẫu phù hợp'}`);
}

async function performInstall(signal, onProfile) {
  const errors = [];
  let context;
  const missingVoices = VOICE_SLOTS.some((slot) => !readSlotProfile(slot));
  if (missingVoices) {
    updateJob({ phase: 'checking-source', message: 'Đang kiểm tra dung lượng trống và FFmpeg/FFprobe…' });
    await checkInstallRequirements(signal);
  }
  try { context = await getSourceMetadata(signal); }
  catch (error) {
    if (error.message === 'VOICE_LIBRARY_CANCELLED') throw error;
    errors.push({ stage: 'source', message: error.message });
    throw error;
  }
  const usedSpeakers = new Set(cosyVoiceLibraryProfiles().map((profile) => profile.speakerId));
  let completedSlots = 0;
  for (const slot of VOICE_SLOTS) {
    throwIfCancelled(signal);
    const index = ++completedSlots;
    try {
      const profile = await installSlot(slot, context, usedSpeakers, signal, index);
      await onProfile(profile);
    } catch (error) {
      if (error.message === 'VOICE_LIBRARY_CANCELLED') throw error;
      errors.push({ voiceId: slot.id, name: slot.name, message: error.message });
      updateJob({ failed: errors, voiceIndex: index, message: `${slot.name}: ${error.message}` });
    }
  }
  const installed = cosyVoiceLibraryProfiles().length;
  return { installed, failed: errors, complete: installed === VOICE_SLOTS.length };
}

export function startCosyVoiceLibraryInstall({ onProfile = async () => {} } = {}) {
  if (installJob.running) return { started: false, job: cosyVoiceLibraryStatus().job };
  activeController = new AbortController();
  updateJob({
    status: 'running', running: true, phase: 'checking-source', message: 'Đang kiểm tra nguồn AISHELL-3…',
    voiceIndex: 0, total: VOICE_SLOTS.length, installed: cosyVoiceLibraryProfiles().length,
    failed: [], startedAt: new Date().toISOString(), finishedAt: null
  });
  const signal = activeController.signal;
  void performInstall(signal, onProfile).then((result) => {
    updateJob({ status: result.complete ? 'complete' : 'partial', running: false, phase: 'complete', installed: result.installed, failed: result.failed, message: result.complete ? 'Đã cài đủ 6 giọng AISHELL-3.' : `Đã cài ${result.installed}/6 giọng; giọng lỗi có thể thử lại.`, finishedAt: new Date().toISOString() });
  }).catch((error) => {
    const cancelled = error.message === 'VOICE_LIBRARY_CANCELLED';
    updateJob({ status: cancelled ? 'cancelled' : 'failed', running: false, phase: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Đã hủy tải thư viện giọng.' : error.message, finishedAt: new Date().toISOString() });
  }).finally(() => { activeController = null; });
  return { started: true, job: cosyVoiceLibraryStatus().job };
}

export function cancelCosyVoiceLibraryInstall() {
  if (!installJob.running || !activeController) return false;
  activeController.abort();
  return true;
}

export function renameCosyVoiceLibraryProfile(id, name) {
  const slot = VOICE_SLOTS.find((item) => item.id === String(id));
  if (!slot) throw new Error('Không tìm thấy giọng AISHELL-3.');
  const directory = slotDirectory(slot.id);
  const metadataPath = path.join(directory, 'metadata.json');
  const metadata = readJson(metadataPath);
  if (!metadata || !readSlotProfile(slot)) throw new Error('Hồ sơ AISHELL-3 chưa được cài đầy đủ.');
  metadata.displayName = String(name || '').trim().slice(0, 80);
  if (!metadata.displayName) throw new Error('Tên giọng không được để trống.');
  const tempPath = `${metadataPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, metadataPath);
  return readSlotProfile(slot);
}

export function deleteCosyVoiceLibraryProfile(id) {
  const directory = slotDirectory(id);
  if (!directory) throw new Error('Mã giọng thư viện không hợp lệ.');
  const resolvedRoot = path.resolve(COSYVOICE_VOICE_LIBRARY_DIR);
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== resolvedRoot) throw new Error('Đường dẫn giọng nằm ngoài thư viện.');
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

export function cosyVoiceLibraryVoicePath(id) {
  const directory = slotDirectory(id);
  return directory ? path.join(directory, 'reference.wav') : null;
}

export { VOICE_SLOTS as COSYVOICE_LIBRARY_SLOTS, isCosyVoiceLibraryId };
