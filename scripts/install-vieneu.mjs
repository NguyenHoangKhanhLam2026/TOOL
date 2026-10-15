import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, DATA, VIENEU_HF_HOME, VIENEU_MODEL_DIR, VIENEU_MODEL_MARKER } from '../src/config.mjs';

const venvDir = path.join(ROOT, '.venv-vieneu');
const python = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const requirements = path.join(ROOT, 'packages', 'tts-engine', 'python', 'requirements-vieneu.txt');
const modelDownloader = path.join(ROOT, 'packages', 'tts-engine', 'python', 'download_vieneu_model.py');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, windowsHide: true, stdio: 'inherit', ...options });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}

function findBasePython() {
  const candidates = process.platform === 'win32'
    ? [{ command: 'py', args: ['-3.13'] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return candidate;
  }
  throw new Error('Không tìm thấy Python 3.10 trở lên. Cài Python rồi chạy lại npm run setup:vieneu.');
}

async function main() {
  const basePython = findBasePython();
  if (!fs.existsSync(python)) {
    console.log('Tạo Python virtual environment riêng cho VieNeu-TTS...');
    await run(basePython.command, [...basePython.args, '-m', 'venv', venvDir]);
  }

  console.log('Cài VieNeu-TTS CPU/ONNX trong môi trường riêng; không cài PyTorch/CUDA...');
  await run(python, ['-m', 'ensurepip', '--upgrade']);
  await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '-r', requirements]);

  console.log('Tải các tệp model FP32 ONNX về ổ đĩa. Việc này không nạp model vào RAM...');
  fs.mkdirSync(VIENEU_HF_HOME, { recursive: true });
  await run(python, [modelDownloader], {
    env: { ...process.env, AERS_DATA_DIR: DATA, VIENEU_MODEL_DIR, HF_HOME: VIENEU_HF_HOME }
  });

  const marker = {
    provider: 'vieneu-v3-turbo',
    backend: 'onnx-cpu',
    precision: 'fp32',
    installedAt: new Date().toISOString(),
    modelDir: VIENEU_MODEL_DIR,
    python,
  };
  fs.writeFileSync(VIENEU_MODEL_MARKER, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  console.log('Đã cài VieNeu-TTS. Model chỉ vào RAM khi tiến trình TTS bắt đầu.');
}

main().catch((error) => {
  console.error(`Cài VieNeu-TTS thất bại: ${error.message}`);
  process.exitCode = 1;
});
