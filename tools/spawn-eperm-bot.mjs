import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startApp = process.argv.includes('--start');
const showHelp = process.argv.includes('--help') || process.argv.includes('-h');
const localEnv = readProjectEnv();
const DATA_DIR = process.env.AERS_DATA_DIR || localEnv.AERS_DATA_DIR || path.join(ROOT, 'data');
const checks = [];

function readProjectEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/u, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
  return values;
}

function executableCandidates(name) {
  const extensions = process.platform === 'win32' && !path.extname(name) ? ['', '.exe', '.cmd', '.bat'] : [''];
  if (path.isAbsolute(name) || name.includes(path.sep) || name.includes('/')) {
    return extensions.map((extension) => `${name}${extension}`).filter((candidate) => fs.existsSync(candidate));
  }
  const candidates = [];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (fs.existsSync(candidate)) candidates.push(candidate);
    }
  }
  return [...new Set(candidates)];
}

function findWingetFfmpeg() {
  const packagesRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  let packages = [];
  try { packages = fs.readdirSync(packagesRoot, { withFileTypes: true }); } catch { return null; }
  for (const item of packages) {
    if (!item.isDirectory() || !/^Gyan\.FFmpeg\./iu.test(item.name)) continue;
    const packageRoot = path.join(packagesRoot, item.name);
    let releases = [];
    try { releases = fs.readdirSync(packageRoot, { withFileTypes: true }); } catch { continue; }
    for (const release of releases) {
      if (!release.isDirectory()) continue;
      const bin = path.join(packageRoot, release.name, 'bin');
      if (fs.existsSync(path.join(bin, 'ffmpeg.exe')) && fs.existsSync(path.join(bin, 'ffprobe.exe'))) return bin;
    }
  }
  return null;
}

function addToPath(directory) {
  if (!directory) return false;
  const current = (process.env.PATH || '').split(path.delimiter);
  if (current.some((entry) => path.resolve(entry) === path.resolve(directory))) return false;
  process.env.PATH = [directory, ...current].filter(Boolean).join(path.delimiter);
  return true;
}

function runProbe(label, command, args) {
  const attempt = (executable) => spawnSync(executable, args, {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8_000,
    maxBuffer: 512 * 1024
  });

  let result = attempt(command);
  let usedAbsoluteFallback = false;
  if (result.error?.code === 'EPERM' && !path.isAbsolute(command)) {
    const absolute = executableCandidates(command)[0];
    if (absolute) {
      result = attempt(absolute);
      usedAbsoluteFallback = true;
    }
  }

  const ok = !result.error && result.status === 0;
  const code = result.error?.code || (ok ? null : `exit ${result.status ?? 'unknown'}`);
  checks.push({ label, ok, code, command: usedAbsoluteFallback ? executableCandidates(command)[0] : command });
  const suffix = usedAbsoluteFallback && ok ? ' (đã chạy được bằng đường dẫn tuyệt đối)' : '';
  console.log(`${ok ? '[OK]' : '[LỖI]'} ${label}${suffix}${ok ? '' : ` — ${code}`}`);
  if (!ok && result.error?.message) console.log(`      ${result.error.message}`);
  return ok;
}

function runAsyncProbe(label, command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: ROOT,
        env: process.env,
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (error) {
      checks.push({ label, ok: false, code: error.code || 'ERROR', command: error.path || command });
      console.log(`[LỖI] ${label} — ${error.code || error.message} (${error.path || command})`);
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok, code = null, executable = command) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      checks.push({ label, ok, code, command: executable });
      console.log(`${ok ? '[OK]' : '[LỖI]'} ${label}${ok ? '' : ` — ${code} (${executable})`}`);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false, 'TIMEOUT');
    }, 8_000);
    child.once('error', (error) => finish(false, error.code || error.message, error.path || command));
    child.once('close', (code) => finish(code === 0, code === 0 ? null : `exit ${code ?? 'unknown'}`));
  });
}

function checkWritable(label, directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, `.spawn-eperm-probe-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'probe', { flag: 'wx' });
    fs.unlinkSync(probe);
    console.log(`[OK] Quyền ghi ${label}`);
    return true;
  } catch (error) {
    checks.push({ label: `Quyền ghi ${label}`, ok: false, code: error.code || 'ERROR' });
    console.log(`[LỖI] Quyền ghi ${label} — ${error.code || error.message}`);
    return false;
  }
}

function findPythonCandidates() {
  const envPython = process.env.PYTHON || localEnv.PYTHON;
  const venvPython = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  const values = [
    ...(envPython ? executableCandidates(envPython) : []),
    ...(fs.existsSync(venvPython) ? [venvPython] : []),
    ...executableCandidates('python'),
    ...executableCandidates('python3'),
    ...executableCandidates('py')
  ];
  return [...new Set(values)];
}

function checkPython() {
  const candidates = findPythonCandidates();
  if (!candidates.length) {
    checks.push({ label: 'Python', ok: false, code: 'ENOENT' });
    console.log('[LỖI] Python — không tìm thấy trong .venv, .env hoặc PATH');
    return false;
  }
  for (const candidate of candidates) {
    const isLauncher = path.basename(candidate).toLowerCase() === 'py.exe';
    if (runProbe('Python', candidate, isLauncher ? ['-3', '--version'] : ['--version'])) {
      process.env.PYTHON = candidate;
      return true;
    }
  }
  return false;
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function latestJobFailure() {
  const databasePath = path.join(DATA_DIR, 'database', 'studio.sqlite');
  if (!fs.existsSync(databasePath)) return null;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const failure = database.prepare("SELECT job_id,message,created_at FROM logs WHERE code='JOB_FAILED' AND job_id IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    if (!failure) return null;
    const job = database.prepare('SELECT id,type,status,attempts,last_error FROM jobs WHERE id=?').get(failure.job_id);
    const running = Number(database.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='running'").get().count);
    return { ...failure, job, running };
  } finally { database.close(); }
}

function readWorkerHeartbeat() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'logs', 'worker-heartbeat.json'), 'utf8'));
    const match = String(value.workerId || '').match(/^worker-(\d+)-/);
    return match ? { pid: Number(match[1]), active: Date.now() - new Date(value.lastSeen).getTime() < 30_000 } : null;
  } catch { return null; }
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function stopWorker(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid === process.pid) throw new Error('PID worker không hợp lệ; bot không dừng tiến trình.');
  if (processIsAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let i = 0; i < 20 && processIsAlive(pid); i += 1) await wait(250);
    if (processIsAlive(pid)) {
      const killed = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5_000 });
      if (killed.status !== 0 && processIsAlive(pid)) throw new Error(`Không dừng được worker PID ${pid}: ${killed.stderr || killed.error?.message || 'taskkill failed'}`);
    }
  }
}

function startWorkerDetached() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'workers', 'worker.mjs')], {
      cwd: ROOT, env: process.env, detached: true, stdio: 'ignore', windowsHide: true
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}

async function waitForWorker(pid) {
  const heartbeatPath = path.join(DATA_DIR, 'logs', 'worker-heartbeat.json');
  for (let i = 0; i < 30; i += 1) {
    try {
      const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
      if (String(heartbeat.workerId || '').startsWith(`worker-${pid}-`) && Date.now() - new Date(heartbeat.lastSeen).getTime() < 30_000) return true;
    } catch { /* worker has not written the first heartbeat yet */ }
    await wait(500);
  }
  return false;
}

async function retryFailedJob(jobId) {
  const now = new Date().toISOString();
  try {
    const port = Number(process.env.APP_PORT || localEnv.APP_PORT || 3001);
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs/${jobId}/retry`, { method: 'POST', signal: AbortSignal.timeout(3_000) });
    if (response.status === 202) return true;
    if (response.status !== 404 && response.status !== 503) return false;
  } catch { /* fall back to the same atomic update used by the local retry API */ }

    const database = new DatabaseSync(path.join(DATA_DIR, 'database', 'studio.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout=5000');
    const result = database.prepare("UPDATE jobs SET status='pending',attempts=0,last_error=NULL,scheduled_at=?,updated_at=? WHERE id=? AND status='failed'")
      .run(now, now, jobId);
    return Number(result.changes) === 1;
  } finally { database.close(); }
}

async function repairRecentSpawnFailure() {
  const latest = latestJobFailure();
  const message = String(latest?.message || latest?.job?.last_error || '');
  if (!latest) return false;
  if (!/spawn\s+(?:EPERM|EACCES|ENOENT)/i.test(message)) {
    if (/WSServerHandshakeError:\s*403|403, message=['"]Invalid response status/i.test(message)) {
      console.log('[INFO] Lỗi gần nhất là Edge TTS HTTP 403; đây là phản hồi từ dịch vụ TTS, bot không khởi động lại worker cho lỗi này.');
    }
    return false;
  }
  if (!latest.job || !['failed', 'pending'].includes(latest.job.status)) {
    console.log('[INFO] Job ghi lỗi spawn đã đổi trạng thái; bot không chạy lại job cũ.');
    return false;
  }
  if (latest.running > 0) {
    console.log(`[DỪNG] Còn ${latest.running} job đang chạy; bot không dừng worker để tránh ngắt tác vụ.`);
    return true;
  }

  const heartbeat = readWorkerHeartbeat();
  if (heartbeat && processIsAlive(heartbeat.pid)) {
    console.log(`[SỬA] Phát hiện spawn EPERM trong job ${latest.job.id}; khởi động lại worker PID ${heartbeat.pid}.`);
    await stopWorker(heartbeat.pid);
  } else {
    console.log(`[SỬA] Phát hiện spawn EPERM trong job ${latest.job.id}; khởi chạy worker mới.`);
  }
  const pid = await startWorkerDetached();
  if (!await waitForWorker(pid)) throw new Error(`Worker PID ${pid} không ghi heartbeat sau khi khởi động.`);
  if (latest.job.status === 'failed') {
    if (!await retryFailedJob(latest.job.id)) throw new Error(`Worker đã chạy lại nhưng bot không thể đưa job ${latest.job.id} về hàng đợi.`);
    console.log(`[SỬA] Đã đưa lại chính job ${latest.job.id} vào hàng đợi một lần; không tạo job/video trùng.`);
  } else {
    console.log(`[SỬA] Worker PID ${pid} đã chạy lại và sẽ tiếp tục job đang chờ.`);
  }
  return true;
}

async function main() {
  if (showHelp) {
    console.log('Dùng: node tools/spawn-eperm-bot.mjs [--start]');
    console.log('  Mặc định: kiểm tra spawn và quyền ghi; --start: nếu log mới nhất là spawn EPERM, khởi động lại worker và chạy lại đúng job một lần; nếu tool đã chạy thì không mở trùng.');
    return;
  }

  console.log('Spawn EPERM Bot — kiểm tra và chuẩn hóa PATH/PYTHON cho phiên khởi chạy; không thể vượt quyền chặn tiến trình của Windows.\n');

  const nodeBin = path.dirname(process.execPath);
  const wingetBin = findWingetFfmpeg();
  const nodePathChanged = addToPath(nodeBin);
  const ffmpegPathChanged = addToPath(wingetBin);
  const pathChanged = nodePathChanged || ffmpegPathChanged;
  if (pathChanged) console.log('[SỬA] Đã bổ sung Node.js/FFmpeg vào PATH của phiên bot này.');
  if (wingetBin) console.log(`[INFO] FFmpeg: ${wingetBin}`);

  runProbe('Node.js', process.execPath, ['--version']);
  const ffmpeg = executableCandidates('ffmpeg')[0];
  const ffprobe = executableCandidates('ffprobe')[0];
  if (ffmpeg) runProbe('FFmpeg', ffmpeg, ['-version']);
  else {
    checks.push({ label: 'FFmpeg', ok: false, code: 'ENOENT' });
    console.log('[LỖI] FFmpeg — không tìm thấy trong PATH hoặc WinGet');
  }
  if (ffprobe) runProbe('FFprobe', ffprobe, ['-version']);
  else {
    checks.push({ label: 'FFprobe', ok: false, code: 'ENOENT' });
    console.log('[LỖI] FFprobe — không tìm thấy trong PATH hoặc WinGet');
  }
  checkPython();

  await runAsyncProbe('Node.js (spawn bất đồng bộ như ứng dụng)', process.execPath, ['--version']);
  if (ffmpeg) await runAsyncProbe('FFmpeg (spawn bất đồng bộ)', ffmpeg, ['-version']);
  if (ffprobe) await runAsyncProbe('FFprobe (spawn bất đồng bộ)', ffprobe, ['-version']);
  if (process.env.PYTHON) {
    await runAsyncProbe('Python + Edge TTS (spawn bất đồng bộ)', process.env.PYTHON, ['-c', 'import edge_tts']);
  }

  checkWritable('data/temporary', path.join(DATA_DIR, 'temporary'));
  checkWritable('data/outputs', path.join(DATA_DIR, 'outputs'));

  if (startApp) {
    try {
      if (await repairRecentSpawnFailure()) return;
    } catch (error) {
      console.error(`[LỖI BOT] Không tự khởi động lại worker: ${error.message}`);
      process.exitCode = 2;
      return;
    }
  }

  const failures = checks.filter((item) => !item.ok);
  console.log('');
  if (failures.length) {
    console.log('Bot chưa thể xác nhận môi trường chạy được. Nếu EPERM vẫn xuất hiện bằng đường dẫn tuyệt đối, Windows hoặc môi trường chạy đang chặn tiến trình; bot không thể vượt chặn này bằng mã ứng dụng.');
    console.log('Hãy chạy lại bot từ Windows Terminal thường, đóng các cửa sổ server/worker đang mở, rồi gửi nội dung báo cáo này nếu vẫn lỗi.');
    process.exitCode = 2;
    return;
  }

  console.log('[OK] Các tiến trình và thư mục cần thiết đều hoạt động trong phiên này.');
  if (!startApp) {
    console.log('Để mở tool bằng môi trường vừa kiểm tra, chạy: node tools/spawn-eperm-bot.mjs --start');
    return;
  }

  const port = Number(process.env.APP_PORT || localEnv.APP_PORT || 3001);
  if (!await checkPortAvailable(port)) {
    const heartbeat = readWorkerHeartbeat();
    if (!heartbeat || !processIsAlive(heartbeat.pid)) {
      console.log(`[SỬA] Server đang chạy ở cổng ${port} nhưng worker chưa hoạt động; khởi chạy worker.`);
      const pid = await startWorkerDetached();
      if (!await waitForWorker(pid)) throw new Error(`Worker PID ${pid} không ghi heartbeat sau khi khởi động.`);
      console.log(`[OK] Worker PID ${pid} đã sẵn sàng.`);
      return;
    }
    console.log(`[OK] Tool và worker đã chạy ở cổng ${port}; không mở tiến trình trùng.`);
    return;
  }
  const heartbeat = readWorkerHeartbeat();
  if (heartbeat?.active && processIsAlive(heartbeat.pid)) {
    console.log('[DỪNG] Worker hiện đang hoạt động. Bot không mở worker thứ hai.');
    process.exitCode = 3;
    return;
  }

  const child = spawn('cmd.exe', ['/d', '/c', 'start.bat'], {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.once('error', (error) => {
    console.error(`[LỖI] Không mở được start.bat: ${error.code || error.message}`);
    process.exitCode = 2;
  });
  child.unref();
  console.log('[OK] Đã mở start.bat với PATH/PYTHON đã kiểm tra trong phiên bot.');
}

main().catch((error) => {
  console.error(`[LỖI BOT] ${error.code || error.message}`);
  process.exitCode = 2;
});
