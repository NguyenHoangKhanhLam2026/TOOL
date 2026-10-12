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
export const DATA = process.env.AERS_DATA_DIR || path.join(ROOT, 'data');
export const PORT = Number(process.env.APP_PORT || 3001);
export const HOST = process.env.APP_HOST || '127.0.0.1';
export const TIMEZONE = process.env.TIMEZONE || 'Asia/Ho_Chi_Minh';
export const PRIVATE_DIR = process.env.AERS_PRIVATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(ROOT, 'data'), 'AutoEnglishReelsStudio', 'private');
const venvPython = process.platform === 'win32' ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python');
export const PYTHON_BIN = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python');
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
  maxLineChars: 150,
  level: 'A2-B1',
  postTime: '19:30',
  postsPerDay: 1,
  prepareAheadDays: 7,
  maxScriptsPerDay: 10,
  autoGenerationEnabled: false,
  autoPublishEnabled: false,
  facebookAdapter: 'mock',
  facebookConnectionVerified: false,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  allowPaidAiApi: false
});

export const PATHS = Object.freeze({
  database: path.join(DATA, 'database', 'studio.sqlite'),
  output: path.join(DATA, 'outputs'),
  temporary: path.join(DATA, 'temporary'),
  logs: path.join(DATA, 'logs'),
  private: PRIVATE_DIR,
  backups: path.join(DATA, 'backups'),
  public: path.join(ROOT, 'public')
});
