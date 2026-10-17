import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
function findFfmpegBin() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const currentPath = process.env.PATH || '';
  const pathBin = currentPath.split(path.delimiter).find((directory) =>
    fs.existsSync(path.join(directory, 'ffmpeg.exe')) && fs.existsSync(path.join(directory, 'ffprobe.exe'))
  );
  if (pathBin) return pathBin;

  const packagesPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  let packages;
  try { packages = fs.readdirSync(packagesPath, { withFileTypes: true }); }
  catch { return null; }
  for (const pkg of packages) {
    if (!pkg.isDirectory() || !/^Gyan\.FFmpeg\.(Shared|Essentials|Full)_/i.test(pkg.name)) continue;
    const packagePath = path.join(packagesPath, pkg.name);
    let releases;
    try { releases = fs.readdirSync(packagePath, { withFileTypes: true }); }
    catch { continue; }
    for (const release of releases) {
      if (!release.isDirectory()) continue;
      const binPath = path.join(packagePath, release.name, 'bin');
      if (fs.existsSync(path.join(binPath, 'ffmpeg.exe')) && fs.existsSync(path.join(binPath, 'ffprobe.exe'))) {
        return binPath;
      }
    }
  }
  return null;
}

const ffmpegBin = findFfmpegBin();
if (ffmpegBin && !(process.env.PATH || '').split(path.delimiter).includes(ffmpegBin)) {
  process.env.PATH = `${ffmpegBin}${path.delimiter}${process.env.PATH || ''}`;
}
export const FFMPEG_BIN = ffmpegBin ? path.join(ffmpegBin, 'ffmpeg.exe') : 'ffmpeg';
export const FFPROBE_BIN = ffmpegBin ? path.join(ffmpegBin, 'ffprobe.exe') : 'ffprobe';

export const DATA = process.env.AERS_DATA_DIR || path.join(ROOT, 'data');
export const PORT = Number(process.env.APP_PORT || 3001);
export const HOST = process.env.APP_HOST || '127.0.0.1';
export const TIMEZONE = process.env.TIMEZONE || 'Asia/Ho_Chi_Minh';
export const PRIVATE_DIR = process.env.AERS_PRIVATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(ROOT, 'data'), 'AutoEnglishReelsStudio', 'private');
const venvPython = process.platform === 'win32' ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python');
export const PYTHON_BIN = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python');
const vieneuVenvPython = process.platform === 'win32' ? path.join(ROOT, '.venv-vieneu', 'Scripts', 'python.exe') : path.join(ROOT, '.venv-vieneu', 'bin', 'python');
export const VIENEU_PYTHON_BIN = process.env.VIENEU_PYTHON || vieneuVenvPython;
export const VIENEU_MODEL_DIR = path.join(DATA, 'models', 'vieneu-v3-turbo');
export const VIENEU_ONNX_DIR = path.join(VIENEU_MODEL_DIR, 'onnx_update');
export const VIENEU_CODEC_DIR = path.join(VIENEU_MODEL_DIR, 'codec');
export const VIENEU_HF_HOME = path.join(DATA, 'models', 'huggingface-cache');
export const VIENEU_MODEL_MARKER = path.join(VIENEU_MODEL_DIR, 'install.json');
const kokoroVenvPython = process.platform === 'win32' ? path.join(ROOT, '.venv-kokoro', 'Scripts', 'python.exe') : path.join(ROOT, '.venv-kokoro', 'bin', 'python');
export const KOKORO_PYTHON_BIN = process.env.KOKORO_PYTHON || kokoroVenvPython;
export const KOKORO_MODEL_DIR = path.join(DATA, 'models', 'kokoro-onnx');
export const KOKORO_MODEL_PATH = path.join(KOKORO_MODEL_DIR, 'kokoro-v1.0.onnx');
export const KOKORO_VOICES_PATH = path.join(KOKORO_MODEL_DIR, 'voices-v1.0.bin');
export const KOKORO_MODEL_MARKER = path.join(KOKORO_MODEL_DIR, 'install.json');
export const LOCAL_TTS_LOCK_DB = path.join(DATA, 'models', 'local-tts-manager.sqlite');
export const LOCAL_TTS_STATUS_PATH = path.join(DATA, 'temporary', 'local-tts-model-status.json');
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
export const DEFAULTS = Object.freeze({
  appName: 'Auto English Reels Studio',
  port: PORT,
  host: HOST,
  timezone: TIMEZONE,
  videoWidth: 1080,
  videoHeight: 1920,
  videoFps: 30,
  template: 'classic-beige',
  viVoice: 'vi-VN-HoaiMyNeural',
  enVoice: 'en-US-AndrewNeural',
  enRate: '-8%',
  ttsProvider: 'edge',
  vieneuViVoice: 'Hải Đăng',
  vieneuEnVoice: 'Hải Đăng',
  vieneuViSpeed: 1,
  vieneuEnSpeed: 0.9,
  kokoroEnVoice: 'af_heart',
  kokoroEnSpeed: 1,
  localTtsMinFreeRamMb: 2560,
  localTtsMinRemainingRamMb: 1024,
  highlightEnabled: true,
  highlightMode: 'word',
  highlightColor: '#FF8066',
  highlightPadding: 6,
  highlightRadius: 8,
  highlightTransition: 'instant',
  backgroundEffect: 'bubbles',
  backgroundEffectDensity: 28,
  backgroundEffectSpeed: 58,
  backgroundEffectOpacity: 32,
  level: 'A2-B1',
  postTime: '19:30',
  postsPerDay: 3,
  prepareAheadDays: 7,
  maxScriptsPerDay: 10,
  autoGenerationEnabled: false,
  autoPublishEnabled: false,
  facebookAdapter: 'mock',
  pageId: '',
  facebookConnectionVerified: false,
  allowPaidAiApi: false
});

export const PATHS = Object.freeze({
  database: path.join(DATA, 'database', 'studio.sqlite'),
  output: path.join(DATA, 'outputs'),
  temporary: path.join(DATA, 'temporary'),
  logs: path.join(DATA, 'logs'),
  private: PRIVATE_DIR,
  backups: path.join(DATA, 'backups'),
  models: path.join(DATA, 'models'),
  public: path.join(ROOT, 'public')
});
