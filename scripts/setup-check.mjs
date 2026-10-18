import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS, PYTHON_BIN } from '../src/config.mjs';

const dirs = [path.dirname(PATHS.database), PATHS.output, PATHS.temporary, PATHS.logs, PATHS.private, PATHS.backups];
for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeMinor = Number(process.versions.node.split('.')[1]);
function probe(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, ...options });
  return { ok: !result.error && result.status === 0, errorCode: result.error?.code || null };
}

const checks = [
  ['Node.js 22.13+', nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13), null],
  ...[
    ['Node child-process', process.execPath, ['--version']],
    ['Python', PYTHON_BIN, ['--version']],
    ['FFmpeg', 'ffmpeg', ['-version']],
    ['FFprobe', 'ffprobe', ['-version']],
  ].map(([name, command, args]) => {
    const result = probe(command, args, { stdio: 'ignore' });
    return [name, result.ok, result.errorCode];
  })
];
console.log('Auto English Reels Studio · kiểm tra môi trường\n');
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '○'} ${name}${ok ? '' : ' — chưa cài'}`);
console.log(`\nThư mục dữ liệu: ${path.join(ROOT, 'data')}`);
console.log(`Thông tin bí mật: ${PATHS.private}`);
if (checks.some(([name, ok]) => !ok && name !== 'Node.js 22.13+')) {
  console.log('\nKiểm tra Python (căn chỉnh cục bộ) và cài FFmpeg/FFprobe, thêm FFmpeg vào PATH rồi mở terminal mới.');
  console.log('Model TTS local được quản lý riêng bằng npm run setup:vieneu, npm run setup:kokoro và npm run setup:multilingual-tts.');
}
const spawnBlocked = checks.filter(([, , errorCode]) => errorCode === 'EPERM').map(([name]) => name);
if (spawnBlocked.length) {
  console.error(`\nWindows is blocking child-process creation (EPERM): ${spawnBlocked.join(', ')}.`);
  console.error('Close this launch and run start.bat from a regular Windows session (for example, File Explorer), not from a sandboxed IDE/task runner.');
  process.exitCode = 2;
} else if (!checks[0][1]) {
  process.exitCode = 1;
}
