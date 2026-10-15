import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { KOKORO_MODEL_DIR, KOKORO_MODEL_MARKER, KOKORO_MODEL_PATH, KOKORO_PYTHON_BIN, KOKORO_VOICES_PATH, ROOT } from '../src/config.mjs';

const bootstrapPython = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const downloads = [
  { name: 'kokoro-v1.0.onnx', path: KOKORO_MODEL_PATH, url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx', minimumBytes: 100_000_000 },
  { name: 'voices-v1.0.bin', path: KOKORO_VOICES_PATH, url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin', minimumBytes: 10_000_000 }
];

function run(command, args) {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  } catch (error) {
    throw new Error(`Không chạy được ${command} ${args[0]}: ${error.message}`);
  }
}

function pythonVersion(command) {
  const result = spawnSync(command, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Không chạy được Python dùng cho Kokoro: ${result.stderr || result.error?.message || 'không rõ lỗi'}`);
  const [major, minor] = result.stdout.trim().split('.').map(Number);
  if (major !== 3 || minor < 10 || minor >= 14) throw new Error(`Kokoro ONNX cần Python 3.10–3.13; đang có ${result.stdout.trim()}.`);
}

function moduleInstalled(python) {
  const result = spawnSync(python, ['-c', "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('kokoro_onnx') and importlib.util.find_spec('soundfile') else 1)"], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(item) {
  if (fs.existsSync(item.path) && fs.statSync(item.path).size >= item.minimumBytes) {
    console.log(`${item.name}: đã có, bỏ qua tải.`);
    return;
  }
  console.log(`Đang tải ${item.name}…`);
  const response = await fetch(item.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Không tải được ${item.name}: HTTP ${response.status}.`);
  fs.mkdirSync(path.dirname(item.path), { recursive: true });
  const temporary = `${item.path}.${process.pid}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'w' }));
    const size = fs.statSync(temporary).size;
    if (size < item.minimumBytes) throw new Error(`Tệp tải ${item.name} quá nhỏ (${size} bytes); bỏ tệp dở.`);
    fs.renameSync(temporary, item.path);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function main() {
  fs.mkdirSync(KOKORO_MODEL_DIR, { recursive: true });
  if (!fs.existsSync(KOKORO_PYTHON_BIN)) {
    pythonVersion(bootstrapPython);
    run(bootstrapPython, ['-m', 'venv', path.join(ROOT, '.venv-kokoro')]);
  }
  pythonVersion(KOKORO_PYTHON_BIN);
  if (!moduleInstalled(KOKORO_PYTHON_BIN)) {
    run(KOKORO_PYTHON_BIN, ['-m', 'pip', 'install', '--disable-pip-version-check', 'kokoro-onnx==0.6.1', 'soundfile>=0.13.0']);
  } else {
    console.log('Gói Kokoro ONNX và SoundFile đã có; bỏ qua cài lại.');
  }
  for (const item of downloads) await download(item);
  const marker = {
    provider: 'kokoro-82m',
    backend: 'onnxruntime-cpu',
    version: 'kokoro-onnx-0.6.1 / kokoro-v1.0',
    python: KOKORO_PYTHON_BIN,
    files: Object.fromEntries(await Promise.all(downloads.map(async (item) => [item.name, { sizeBytes: fs.statSync(item.path).size, sha256: await sha256(item.path) }]))),
    installedAt: new Date().toISOString()
  };
  fs.writeFileSync(`${KOKORO_MODEL_MARKER}.${process.pid}.tmp`, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  fs.renameSync(`${KOKORO_MODEL_MARKER}.${process.pid}.tmp`, KOKORO_MODEL_MARKER);
  console.log(`Kokoro đã sẵn sàng: ${KOKORO_MODEL_DIR}`);
  console.log('Model chạy CPU ONNX trong worker riêng; không nạp khi khởi động ứng dụng.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
