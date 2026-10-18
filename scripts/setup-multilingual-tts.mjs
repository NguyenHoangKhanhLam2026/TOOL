import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  COSYVOICE_MODEL_DIR, COSYVOICE_MODEL_MARKER, COSYVOICE_PYTHON_BIN, COSYVOICE_SOURCE_DIR,
  DATA, OPEN_JTALK_DICTIONARY_DIR, ROOT, STYLE_BERT_VITS2_MODELS_DIR, STYLE_BERT_VITS2_MODEL_MARKER,
  STYLE_BERT_VITS2_PYTHON_BIN, VIENEU_HF_HOME
} from '../src/config.mjs';

const UV_HOME = path.join(DATA, 'models', 'uv-tools');
const UV_CACHE = path.join(DATA, 'models', 'uv-cache');
const STYLE_REPO = 'litagin/style_bert_vits2_jvnv';
const STYLE_BERT_VITS2_VOICES = [
  { id: 'jvnv-F1-jp', checkpoint: 'jvnv-F1-jp_e160_s14000.safetensors' },
  { id: 'jvnv-F2-jp', checkpoint: 'jvnv-F2_e166_s20000.safetensors' },
  { id: 'jvnv-M1-jp', checkpoint: 'jvnv-M1-jp_e158_s14000.safetensors' },
  { id: 'jvnv-M2-jp', checkpoint: 'jvnv-M2-jp_e159_s17000.safetensors' }
];
const JAPANESE_BERT_REPO = 'ku-nlp/deberta-v2-large-japanese-char-wwm';
const COSY_REPO = 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512';
const CPU_TORCH = ['torch==2.3.1', 'torchaudio==2.3.1'];
const SBV2_CPU_TORCH = ['torch==2.6.0', 'torchaudio==2.6.0'];

function environment() {
  return {
    ...process.env,
    HF_HOME: VIENEU_HF_HOME,
    OPEN_JTALK_DICT_DIR: OPEN_JTALK_DICTIONARY_DIR,
    HF_HUB_DISABLE_TELEMETRY: '1',
    UV_CACHE_DIR: UV_CACHE,
    UV_PYTHON_INSTALL_DIR: path.join(DATA, 'models', 'uv-python'),
    GIT_TERMINAL_PROMPT: '0',
    PYTHONUTF8: '1'
  };
}

function run(command, args, { cwd = ROOT, env = environment(), capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-4000); });
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function executableOnPath(command) {
  try {
    await run(command, ['--version'], { capture: true });
    return command;
  } catch { return null; }
}

function findFile(root, filename) {
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, filename);
      if (nested) return nested;
    }
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Auto-English-Reels-Studio' } });
  if (!response.ok) throw new Error(`Download metadata failed (${response.status}): ${url}`);
  return response.json();
}

async function ensureUv() {
  const available = await executableOnPath(process.env.UV || 'uv');
  if (available) return available;
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Cần cài uv từ https://docs.astral.sh/uv/getting-started/installation/ trước khi cài hai model này.');
  }
  console.log('Đang tải uv chính thức để tạo hai môi trường Python riêng...');
  fs.mkdirSync(UV_HOME, { recursive: true });
  const release = await fetchJson('https://api.github.com/repos/astral-sh/uv/releases/latest');
  const asset = release.assets?.find((item) => item.name === 'uv-x86_64-pc-windows-msvc.zip');
  if (!asset) throw new Error('Không tìm thấy gói uv Windows x64 trong bản phát hành chính thức.');
  const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Auto-English-Reels-Studio' } });
  if (!response.ok || !response.body) throw new Error(`Không tải được uv (${response.status}).`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aers-uv-'));
  try {
    const archive = path.join(temporary, asset.name);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${temporary.replaceAll("'", "''")}' -Force`]);
    const uvFile = findFile(temporary, 'uv.exe');
    if (!uvFile) throw new Error('Gói uv đã tải nhưng không tìm thấy uv.exe bên trong.');
    const target = path.join(UV_HOME, 'uv.exe');
    fs.copyFileSync(uvFile, target);
    return target;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

async function createPythonEnvironment(uv, pythonPath) {
  if (fs.existsSync(pythonPath)) {
    await run(pythonPath, ['--version'], { capture: true });
    return;
  }
  const environmentPath = path.dirname(path.dirname(pythonPath));
  fs.mkdirSync(path.dirname(environmentPath), { recursive: true });
  await run(uv, ['python', 'install', '3.10']);
  await run(uv, ['venv', '--python', '3.10', '--python-preference', 'only-managed', environmentPath]);
}

async function installCpuTorch(uv, pythonPath, packages = CPU_TORCH) {
  await run(uv, [
    'pip', 'install', '--python', pythonPath,
    '--index-url', 'https://download.pytorch.org/whl/cpu',
    '--extra-index-url', 'https://pypi.org/simple',
    '--index-strategy', 'unsafe-best-match',
    ...packages
  ]);
}

async function python(uv, pythonPath, code, args = []) {
  await run(pythonPath, ['-c', code, ...args]);
}

function assertModelFiles(directory, names) {
  const missing = names.filter((name) => !fs.existsSync(path.join(directory, name)) || fs.statSync(path.join(directory, name)).size === 0);
  if (missing.length) throw new Error(`Thiếu tệp model sau khi tải: ${missing.join(', ')}`);
}

function openJTalkDictionaryIsReady(directory = OPEN_JTALK_DICTIONARY_DIR) {
  return ['char.bin', 'matrix.bin', 'sys.dic', 'unk.dic'].every((name) => {
    const file = path.join(directory, name);
    return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 100;
  });
}

async function installOpenJTalkDictionary(uv) {
  if (openJTalkDictionaryIsReady()) return;
  if (fs.existsSync(OPEN_JTALK_DICTIONARY_DIR)) {
    throw new Error(`OpenJTalk dictionary directory exists but is incomplete; preserved it: ${OPEN_JTALK_DICTIONARY_DIR}`);
  }

  console.log('\nInstalling the Japanese OpenJTalk pronunciation dictionary...');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aers-openjtalk-'));
  try {
    const archive = path.join(temporary, 'open_jtalk_dic_utf_8-1.11.tar.gz');
    const response = await fetch('https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz', {
      headers: { 'User-Agent': 'Auto-English-Reels-Studio' }
    });
    if (!response.ok || !response.body) throw new Error(`OpenJTalk dictionary download failed (${response.status}).`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));

    const extractionRoot = path.join(temporary, 'extract');
    fs.mkdirSync(extractionRoot, { recursive: true });
    await python(uv, STYLE_BERT_VITS2_PYTHON_BIN, [
      'import pathlib, sys, tarfile',
      'archive = pathlib.Path(sys.argv[1])',
      'destination = pathlib.Path(sys.argv[2]).resolve()',
      'destination.mkdir(parents=True, exist_ok=True)',
      'with tarfile.open(archive, "r:gz") as bundle:',
      '    members = bundle.getmembers()',
      '    for member in members:',
      '        if member.issym() or member.islnk(): raise ValueError("OpenJTalk archive contains an unexpected link")',
      '        target = (destination / member.name).resolve()',
      '        if not target.is_relative_to(destination): raise ValueError("OpenJTalk archive contains an unsafe path")',
      '    bundle.extractall(destination, members=members)'
    ].join('\n'), [archive, extractionRoot]);

    const unpacked = path.join(extractionRoot, 'open_jtalk_dic_utf_8-1.11');
    if (!openJTalkDictionaryIsReady(unpacked)) throw new Error('The downloaded OpenJTalk dictionary is missing required files.');
    fs.cpSync(unpacked, OPEN_JTALK_DICTIONARY_DIR, { recursive: true, force: false, errorOnExist: true });
    if (!openJTalkDictionaryIsReady()) throw new Error('OpenJTalk dictionary verification failed after installation.');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

async function installStyleBertVits2(uv) {
  console.log('\n[1/2] Cài Style-Bert-VITS2 tiếng Nhật (JVNV F1/F2/M1/M2, CPU)...');
  await createPythonEnvironment(uv, STYLE_BERT_VITS2_PYTHON_BIN);
  await installCpuTorch(uv, STYLE_BERT_VITS2_PYTHON_BIN, SBV2_CPU_TORCH);
  await run(uv, ['pip', 'install', '--python', STYLE_BERT_VITS2_PYTHON_BIN, 'style-bert-vits2==2.5.0', 'soundfile', 'numpy<2', 'setuptools==80.10.2']);
  await python(uv, STYLE_BERT_VITS2_PYTHON_BIN, [
    'from packaging.version import Version',
    'import numpy, torch, torchaudio, transformers, pkg_resources',
    'assert Version(torch.__version__.split("+")[0]) >= Version("2.6.0"), "Style-Bert-VITS2 requires PyTorch >= 2.6.0"',
    'assert torch.__version__.split("+")[0] == torchaudio.__version__.split("+")[0], "PyTorch and torchaudio versions must match"',
    'assert Version(numpy.__version__) < Version("2"), "Style-Bert-VITS2 requires NumPy < 2"',
    'assert transformers.utils.is_torch_available(), "Transformers cannot use PyTorch"'
  ].join('; '));
  await installOpenJTalkDictionary(uv);
  await python(uv, STYLE_BERT_VITS2_PYTHON_BIN, "import pyopenjtalk; assert pyopenjtalk.run_frontend('こんにちは')");
  fs.mkdirSync(STYLE_BERT_VITS2_MODELS_DIR, { recursive: true });
  const downloader = [
    'from huggingface_hub import snapshot_download',
    `snapshot_download(repo_id=${JSON.stringify(STYLE_REPO)}, local_dir=${JSON.stringify(STYLE_BERT_VITS2_MODELS_DIR)}, allow_patterns=${JSON.stringify(STYLE_BERT_VITS2_VOICES.map((voice) => `${voice.id}/*`))})`,
    `snapshot_download(repo_id=${JSON.stringify(JAPANESE_BERT_REPO)})`
  ].join('; ');
  await python(uv, STYLE_BERT_VITS2_PYTHON_BIN, downloader);
  for (const voice of STYLE_BERT_VITS2_VOICES) {
    assertModelFiles(path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id), [voice.checkpoint, 'config.json', 'style_vectors.npy']);
  }
  fs.mkdirSync(path.dirname(STYLE_BERT_VITS2_MODEL_MARKER), { recursive: true });
  fs.writeFileSync(STYLE_BERT_VITS2_MODEL_MARKER, JSON.stringify({
    provider: 'style-bert-vits2-jvnv-jp', backend: 'cpu', repository: STYLE_REPO,
    voices: STYLE_BERT_VITS2_VOICES,
    bertRepository: JAPANESE_BERT_REPO,
    modelBytes: STYLE_BERT_VITS2_VOICES.reduce((total, voice) => total + fs.statSync(path.join(STYLE_BERT_VITS2_MODELS_DIR, voice.id, voice.checkpoint)).size, 0),
    installedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  console.log('Đã cài 4 giọng Style-Bert-VITS2 JVNV tiếng Nhật.');
}

async function ensureCosyVoiceSource() {
  const pythonModule = path.join(COSYVOICE_SOURCE_DIR, 'cosyvoice', 'cli', 'cosyvoice.py');
  if (fs.existsSync(pythonModule)) {
    const origin = await run('git', ['-C', COSYVOICE_SOURCE_DIR, 'remote', 'get-url', 'origin'], { capture: true });
    if (!/FunAudioLLM\/CosyVoice(?:\.git)?$/i.test(origin.stdout.trim())) {
      throw new Error(`Thư mục nguồn CosyVoice hiện có không đến từ repository chính thức: ${COSYVOICE_SOURCE_DIR}`);
    }
    await run('git', ['-C', COSYVOICE_SOURCE_DIR, 'submodule', 'update', '--init', '--recursive', '--depth', '1']);
    return;
  }
  if (fs.existsSync(COSYVOICE_SOURCE_DIR) && fs.readdirSync(COSYVOICE_SOURCE_DIR).length) {
    throw new Error(`Thư mục nguồn đã tồn tại nhưng không phải cài đặt CosyVoice hoàn chỉnh; giữ nguyên để tránh xóa dữ liệu: ${COSYVOICE_SOURCE_DIR}`);
  }
  fs.mkdirSync(path.dirname(COSYVOICE_SOURCE_DIR), { recursive: true });
  await run('git', ['clone', '--depth', '1', '--recursive', 'https://github.com/FunAudioLLM/CosyVoice.git', COSYVOICE_SOURCE_DIR]);
}

async function installCosyVoice(uv) {
  console.log('\n[2/2] Cài CosyVoice 3.0 tiếng Trung (0.5B, CPU)...');
  await ensureCosyVoiceSource();
  await createPythonEnvironment(uv, COSYVOICE_PYTHON_BIN);
  await installCpuTorch(uv, COSYVOICE_PYTHON_BIN);
  const requirementsPath = path.join(COSYVOICE_SOURCE_DIR, 'requirements.txt');
  const requirements = fs.readFileSync(requirementsPath, 'utf8').split(/\r?\n/u).filter((line) => {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('--')) return false;
    return !/^(?:torch|torchaudio|deepspeed|onnxruntime-gpu|tensorrt(?:[-=]|$)|openai-whisper(?:[<=>!~;]|$))/i.test(value);
  });
  const filteredRequirements = path.join(DATA, 'models', 'cosyvoice3-windows-requirements.txt');
  fs.mkdirSync(path.dirname(filteredRequirements), { recursive: true });
  fs.writeFileSync(filteredRequirements, `${requirements.join('\n')}\n`, 'utf8');
  // The pinned upstream Whisper sdist imports pkg_resources during its build,
  // but does not declare that build dependency. Build it with the last
  // setuptools line that still ships pkg_resources, then install the runtime
  // dependencies from the normal requirements list.
  await run(uv, ['pip', 'install', '--python', COSYVOICE_PYTHON_BIN, 'setuptools==80.9.0']);
  await run(uv, ['pip', 'install', '--python', COSYVOICE_PYTHON_BIN, '--no-build-isolation', 'openai-whisper==20231117']);
  await run(uv, ['pip', 'install', '--python', COSYVOICE_PYTHON_BIN, '--requirement', filteredRequirements]);
  await run(uv, ['pip', 'install', '--python', COSYVOICE_PYTHON_BIN, 'hf-xet']);
  fs.mkdirSync(COSYVOICE_MODEL_DIR, { recursive: true });
  await python(uv, COSYVOICE_PYTHON_BIN, [
    'from huggingface_hub import snapshot_download',
    `snapshot_download(repo_id=${JSON.stringify(COSY_REPO)}, local_dir=${JSON.stringify(COSYVOICE_MODEL_DIR)}, max_workers=4, allow_patterns=["cosyvoice3.yaml", "campplus.onnx", "speech_tokenizer_v3.onnx", "llm.pt", "flow.pt", "hift.pt", "CosyVoice-BlankEN/**"])`
  ].join('; '));
  assertModelFiles(COSYVOICE_MODEL_DIR, ['cosyvoice3.yaml', 'campplus.onnx', 'speech_tokenizer_v3.onnx', 'llm.pt', 'flow.pt', 'hift.pt', path.join('CosyVoice-BlankEN', 'model.safetensors')]);
  const modelBytes = directoryBytes(COSYVOICE_MODEL_DIR);
  fs.writeFileSync(COSYVOICE_MODEL_MARKER, JSON.stringify({
    provider: 'cosyvoice3-0.5b-2512', backend: 'cpu', repository: COSY_REPO,
    modelBytes, installedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  console.log(`Đã cài CosyVoice 3.0 tiếng Trung (${(modelBytes / 1024 ** 3).toFixed(2)} GB).`);
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile()) total += fs.statSync(full).size;
    else if (entry.isDirectory()) total += directoryBytes(full);
  }
  return total;
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Bộ cài model này hiện dành cho Windows x64.');
  fs.mkdirSync(path.join(DATA, 'models'), { recursive: true });
  fs.mkdirSync(VIENEU_HF_HOME, { recursive: true });
  const uv = await ensureUv();
  await installStyleBertVits2(uv);
  if (!process.argv.includes('--sbv2-only')) await installCosyVoice(uv);
  if (process.argv.includes('--sbv2-only')) {
    console.log('Style-Bert-VITS2 Japanese setup complete. Restart the app to refresh model status.');
    return;
  }
  console.log('\nCài xong cả hai model. Mở lại ứng dụng để trạng thái model cập nhật; CosyVoice cần WAV mẫu và bản chép chính xác trước khi tạo giọng Trung.');
}

main().catch((error) => {
  console.error(`\nKhông cài được model TTS đa ngôn ngữ: ${error.message}`);
  process.exitCode = 1;
});
