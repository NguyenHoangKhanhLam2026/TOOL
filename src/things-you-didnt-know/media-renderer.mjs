import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { DATA, FFMPEG_BIN, FFPROBE_BIN, ROOT } from '../config.mjs';
import { mapWordBoundariesToTokens, buildHighlightIntervals } from '../../packages/audio-highlight/highlight-engine.mjs';
import { buildThingsYouDidntKnowContentSvg, buildThingsYouDidntKnowThumbnailSvg, renderThingsYouDidntKnowPng } from './renderer.mjs';
import { buildThingsYouDidntKnowSourceContentSvg, buildThingsYouDidntKnowSourceThumbnailSvg } from './source-visual-renderer.mjs';
import { renderSourceDesignSvg } from './source-font-renderer.mjs';

const OUT_DIR = path.join(DATA, 'outputs', 'things-you-didnt-know');
const TEMP_DIR = path.join(DATA, 'temporary', 'things-you-didnt-know');
const WIDTH = 1080;
const HEIGHT = 1920;

function run(binary, args, timeoutMs = 20 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-8000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(path.basename(binary) + ' failed (' + code + '): ' + stderr.trim().slice(-1800)));
    });
  });
}

export async function probeThingsYouDidntKnowMedia(filePath) {
  const result = await run(FFPROBE_BIN, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], 30_000);
  const json = JSON.parse(result.stdout);
  const video = json.streams?.find((item) => item.codec_type === 'video');
  const audio = json.streams?.find((item) => item.codec_type === 'audio');
  const duration = Number(json.format?.duration);
  const parseFrameRate = (value) => {
    if (value == null || String(value).trim() === '') return NaN;
    const parts = String(value || '').split('/');
    const numerator = Number(parts[0]);
    const denominator = parts.length > 1 ? Number(parts[1]) : 1;
    return parts.length <= 2 && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : NaN;
  };
  const averageFrameRate = parseFrameRate(video?.avg_frame_rate);
  const frameRate = Number.isFinite(averageFrameRate) ? averageFrameRate : parseFrameRate(video?.r_frame_rate);
  return {
    width: Number(video?.width), height: Number(video?.height), frameRate,
    videoCodec: video?.codec_name || '', pixelFormat: video?.pix_fmt || '',
    audioCodec: audio?.codec_name || '', durationSeconds: duration, fileSize: Number(json.format?.size || 0)
  };
}

export async function renderThingsYouDidntKnowThumbnail({ script, design, outputPath }) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + '.' + crypto.randomUUID() + '.tmp.png';
  const usesSourceDesign = Number(design?.schemaVersion) >= 3 && design.enabled !== false;
  const svg = usesSourceDesign
    ? buildThingsYouDidntKnowSourceThumbnailSvg({ script, design })
    : buildThingsYouDidntKnowThumbnailSvg({ script, design });
  try {
    const png = usesSourceDesign ? await renderSourceDesignSvg(svg) : await renderThingsYouDidntKnowPng(svg);
    fs.writeFileSync(temp, png);
    const metadata = await sharp(temp).metadata();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT) throw new Error('Thumbnail phải có kích thước 1080×1920.');
    fs.renameSync(temp, target);
    return { path: target, width: metadata.width, height: metadata.height };
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function quoteConcatPath(file) {
  return path.resolve(file).replace(/\\/gu, '/').replace(/'/gu, "'\\''");
}

export async function renderThingsYouDidntKnowVideo({ content, audioPath, timingPath, outputPath, settings, design, onProgress = () => {} }) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const videoTarget = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(videoTarget), { recursive: true });
  const renderId = crypto.randomUUID();
  const workDir = path.join(TEMP_DIR, renderId);
  fs.mkdirSync(workDir, { recursive: true });
  try {
  const stagedVideo = path.join(workDir, 'render.tmp.mp4');
  const timing = (() => { try { return JSON.parse(fs.readFileSync(timingPath, 'utf8')); } catch { return { wordBoundaries: [] }; } })();
  const mapped = mapWordBoundariesToTokens(content.imageBody, timing.wordBoundaries || [], 'things-' + content.id, { language: 'en' });
  if (settings.highlightEnabled && !mapped.alignment.reliable) {
    throw Object.assign(new Error('Word timing Kokoro chưa đủ tin cậy để bật highlight. Tắt highlight hoặc tạo lại audio.'), { code: 'TYDK_TIMING_UNRELIABLE', alignment: mapped.alignment });
  }
  const audioProbe = await run(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], 30_000);
  const duration = Number(audioProbe.stdout);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("FFprobe không đọc được thời lượng audio Things You Didn't Know.");
  const usesSourceDesign = Number(design?.schemaVersion) >= 3 && design.enabled !== false;
  const activeThumbnailDesign = Number(design?.schemaVersion) >= 3 && design.enabled !== false;
  const introSeconds = activeThumbnailDesign ? Math.max(0, Number(design.thumbnail?.introSeconds) || 0) : 0;
  const introFrameCount = introSeconds > 0 ? Math.max(1, Math.round(introSeconds * 30)) : 0;
  const introDuration = introFrameCount / 30;
  const introPath = introFrameCount ? path.join(workDir, 'thumbnail-intro.png') : null;
  if (introPath) {
    const thumbnailSvg = buildThingsYouDidntKnowSourceThumbnailSvg({ script: content.script, design });
    fs.writeFileSync(introPath, await renderSourceDesignSvg(thumbnailSvg));
  }
  const phrases = settings.highlightEnabled ? buildHighlightIntervals(mapped.wordTimings, settings.highlightMode, { phraseSize: 3 }) : [];
  const framePlan = [];
  if (phrases.length) {
    for (let index = 0; index < phrases.length; index += 1) {
      const interval = phrases[index];
      const nextStart = phrases[index + 1]?.startSeconds ?? duration;
      const start = Math.max(0, Math.min(duration, Number(interval.startSeconds) || 0));
      const end = Math.max(start + .02, Math.min(duration, Number(nextStart) || duration));
      if (end > start) framePlan.push({ start, end, activeTokenIds: interval.tokenIds || [] });
    }
    if (framePlan.length && framePlan[0].start > 0) framePlan.unshift({ start: 0, end: framePlan[0].start, activeTokenIds: [] });
  } else framePlan.push({ start: 0, end: duration, activeTokenIds: [] });
  if (!framePlan.length) framePlan.push({ start: 0, end: duration, activeTokenIds: [] });

  const framePaths = [];
  for (const [index, frame] of framePlan.entries()) {
    const framePath = path.join(workDir, 'frame-' + String(index).padStart(4, '0') + '.png');
    const svg = usesSourceDesign
      ? buildThingsYouDidntKnowSourceContentSvg({
        script: content.script, design, tokens: mapped.tokens, activeTokenIds: frame.activeTokenIds,
        highlightSettings: settings, effects: settings, seconds: frame.start
      })
      : buildThingsYouDidntKnowContentSvg({
        script: content.script, design, effects: settings, tokens: mapped.tokens,
        activeTokenIds: frame.activeTokenIds, seconds: frame.start, highlightSettings: settings
      });
    const png = usesSourceDesign ? await renderSourceDesignSvg(svg) : await renderThingsYouDidntKnowPng(svg);
    fs.writeFileSync(framePath, png);
    framePaths.push(framePath);
    onProgress({ phase: 'frame-render', index: index + 1, total: framePlan.length });
  }
  const manifest = path.join(workDir, 'timeline.ffconcat');
  const lines = ['ffconcat version 1.0'];
  if (introPath) {
    lines.push("file '" + quoteConcatPath(introPath) + "'");
    lines.push('duration ' + introDuration.toFixed(4));
  }
  framePlan.forEach((frame, index) => {
    lines.push("file '" + quoteConcatPath(framePaths[index]) + "'");
    lines.push('duration ' + Math.max(.02, frame.end - frame.start).toFixed(4));
  });
  lines.push("file '" + quoteConcatPath(framePaths.at(-1)) + "'");
  fs.writeFileSync(manifest, lines.join('\n'), 'utf8');
  const stagedScript = path.join(workDir, 'timeline.ffconcat');
  onProgress({ phase: 'render-started', durationSeconds: duration, frameCount: framePlan.length });
    await run(FFMPEG_BIN, [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', stagedScript,
      '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-r', '30', '-fps_mode:v', 'cfr',
      ...(introFrameCount ? ['-af', 'adelay=' + Math.round(introDuration * 1000) + ':all=1'] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', stagedVideo
    ]);
    const quality = await probeThingsYouDidntKnowMedia(stagedVideo);
    const qualityFailures = [];
    if (quality.width !== WIDTH || quality.height !== HEIGHT) qualityFailures.push(`kích thước ${quality.width}×${quality.height}`);
    if (!Number.isFinite(quality.frameRate) || Math.round(quality.frameRate) !== 30) qualityFailures.push(`frame rate ${quality.frameRate} fps`);
    if (quality.videoCodec !== 'h264') qualityFailures.push(`video codec ${quality.videoCodec || 'không xác định'}`);
    if (quality.pixelFormat !== 'yuv420p') qualityFailures.push(`pixel format ${quality.pixelFormat || 'không xác định'}`);
    if (quality.audioCodec !== 'aac') qualityFailures.push(`audio codec ${quality.audioCodec || 'không xác định'}`);
    if (!Number.isFinite(quality.durationSeconds) || quality.durationSeconds < duration - .35) qualityFailures.push(`thời lượng ${quality.durationSeconds}s (audio ${duration}s)`);
    if (quality.fileSize <= 1000) qualityFailures.push(`dung lượng ${quality.fileSize} byte`);
    if (qualityFailures.length) throw new Error('FFprobe xác nhận video không đạt: ' + qualityFailures.join('; ') + '.');
    if (fs.existsSync(videoTarget)) throw new Error('Video đích đã tồn tại; không ghi đè file MP4 hiện có.');
    fs.renameSync(stagedVideo, videoTarget);
    onProgress({ phase: 'render-complete', quality });
    return { path: videoTarget, durationSeconds: quality.durationSeconds, quality, alignment: mapped.alignment };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function thingsYouDidntKnowOutputDirectories() {
  return { output: OUT_DIR, temporary: TEMP_DIR };
}
