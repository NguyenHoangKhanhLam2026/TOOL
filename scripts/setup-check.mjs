import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS, PYTHON_BIN } from '../src/config.mjs';

const dirs = [path.dirname(PATHS.database), PATHS.output, PATHS.temporary, PATHS.logs, PATHS.private, PATHS.backups];
for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeMinor = Number(process.versions.node.split('.')[1]);
const checks = [
  ['Node.js 22.13+', nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)],
  ['Python', spawnSync(PYTHON_BIN, ['--version'], { windowsHide: true }).status === 0],
  ['FFmpeg', spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0],
  ['FFprobe', spawnSync('ffprobe', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0],
  ['Edge TTS Python package', spawnSync(PYTHON_BIN, ['-c', 'import edge_tts'], { windowsHide: true, stdio: 'ignore' }).status === 0]
];
console.log('Auto English Reels Studio · kiểm tra môi trường\n');
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '○'} ${name}${ok ? '' : ' — chưa cài'}`);
console.log(`\nThư mục dữ liệu: ${path.join(ROOT, 'data')}`);
console.log(`Thông tin bí mật: ${PATHS.private}`);
if (checks.some(([name, ok]) => !ok && name !== 'Node.js 22.13+')) {
  console.log('\nĐể cài giọng đọc: chạy setup.ps1. Cài FFmpeg/FFprobe, thêm vào PATH rồi mở terminal mới.');
}
if (!checks[0][1]) process.exitCode = 1;
