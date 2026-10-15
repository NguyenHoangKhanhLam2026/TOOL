import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, PYTHON_BIN } from '../src/config.mjs';

function run(args, options = {}) {
  const result = spawnSync(PYTHON_BIN, args, { cwd: ROOT, windowsHide: true, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

let pip = run(['-m', 'pip', '--version']);
if (pip.status !== 0) {
  pip = run(['-m', 'ensurepip', '--upgrade'], { stdio: 'inherit' });
  if (pip.status !== 0) throw new Error('Không thể bật pip trong môi trường Python của dự án.');
}

const requirements = path.join(ROOT, 'packages', 'tts-engine', 'python', 'requirements-alignment.txt');
const install = run(['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status || 1);
console.log('Đã cài stable-ts. Whisper small sẽ được tải vào data/models/whisper khi căn chỉnh lần đầu.');
