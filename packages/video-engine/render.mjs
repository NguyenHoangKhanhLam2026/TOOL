import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../../src/config.mjs';
import {
  getTemplateAssetVersions, rasterizeScene, readVisualTemplate
} from './visual-template-engine.mjs';

function run(command, args, { onProgress = () => {}, totalSeconds = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    let timedOut = false;
    let lastProgress = -1;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 100_000) stderr = stderr.slice(-60_000); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const matches = [...stdout.matchAll(/out_time_ms=(\d+)/g)];
      stdout = stdout.slice(-12_000);
      const latest = matches.at(-1);
      if (latest) {
        const progress = Math.min(0.995, Number(latest[1]) / 1_000_000 / totalSeconds);
        if (progress - lastProgress >= 0.02) { lastProgress = progress; onProgress(progress); }
      }
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error(`${command} chưa cài. Hãy cài FFmpeg và thêm ffmpeg/ffprobe vào PATH.`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { onProgress(1); resolve(); }
      else reject(new Error(timedOut ? `${command} vượt quá thời gian chờ.` : `${command} lỗi (${code}): ${stderr.slice(-900)}`));
    });
  });
}

function majorVersion(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-version'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', () => reject(new Error('ffmpeg chưa cài. Hãy cài FFmpeg và thêm vào PATH.')));
    child.on('close', (code) => {
      const match = output.match(/ffmpeg version\s+(\d+)/i);
      if (code !== 0 || !match) reject(new Error('Không xác định được phiên bản FFmpeg.'));
      else resolve(Number(match[1]));
    });
  });
}

export async function probeMedia(file) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', file], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => reject(new Error('ffprobe chưa cài.')));
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `ffprobe lỗi ${code}`)));
  });
  const data = JSON.parse(result);
  return { duration: Number(data.format?.duration || 0), streams: data.streams || [] };
}

export async function renderStillPreviewVideo(imagePath, outputPath, seconds = 5, { onProgress = () => {} } = {}) {
  const duration = Math.max(1, Math.min(5, Number(seconds) || 5));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await run('ffmpeg', [
    '-y', '-loop', '1', '-framerate', '30', '-i', imagePath,
    '-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(duration), '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-c:a', 'aac', '-b:a', '96k',
    '-shortest', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath
  ], { onProgress, totalSeconds: duration });
  const media = await probeMedia(outputPath);
  const video = media.streams.find((stream) => stream.codec_type === 'video');
  const audio = media.streams.find((stream) => stream.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' || video.width !== 1080 || video.height !== 1920) {
    throw new Error('Bản render thử phải là H.264/AAC 1080×1920.');
  }
  return { path: outputPath, duration: media.duration, width: video.width, height: video.height };
}

function silentAudio(seconds) { return { silence: Number(seconds) }; }

export async function renderVideo(script, videoId, audioFiles, { onProgress = () => {}, onTimeline = () => {} } = {}) {
  const template = readVisualTemplate();
  const tempDir = path.join(PATHS.temporary, videoId);
  const layerDir = path.join(tempDir, 'visual-layers-v2');
  const outDir = path.join(PATHS.output, videoId);
  fs.mkdirSync(layerDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (!Array.isArray(script.dialogues) || script.dialogues.length !== 3 || !Array.isArray(audioFiles) || audioFiles.length !== 6) {
    throw new Error('Branded Dialogue V2 cần đúng 3 cặp hội thoại và 6 tệp Edge TTS.');
  }
  const durations = [];
  for (const item of audioFiles) {
    const probe = await probeAudio(item.path);
    durations.push({ ...item, duration: probe });
  }
  const timing = template.timing;
  const timeline = [];
  let cursor = Number(timing.intro);
  const sceneBounds = [];
  for (let index = 0; index < 3; index++) {
    const vi = durations[index * 2]; const en = durations[index * 2 + 1];
    const viStart = cursor; const viEnd = viStart + vi.duration;
    const enStart = viEnd; const enEnd = enStart + en.duration;
    const vocabularyStart = enEnd; const vocabularyEnd = vocabularyStart + timing.vocabularyHold;
    const transitionStart = vocabularyEnd; const transitionEnd = transitionStart + timing.transition;
    sceneBounds.push({ index, viStart, viEnd, enStart, enEnd, vocabularyStart, vocabularyEnd, transitionStart, transitionEnd });
    timeline.push(
      { state: 'vietnamese', index, start: viStart, end: viEnd },
      { state: 'bilingual', index, start: enStart, end: enEnd },
      { state: 'vocabulary', index, start: vocabularyStart, end: vocabularyEnd },
      { state: 'transition', index, start: transitionStart, end: transitionEnd }
    );
    cursor = transitionEnd;
  }
  const ctaStart = cursor;
  const total = ctaStart + timing.cta;
  timeline.unshift({ state: 'intro', index: 0, start: 0, end: timing.intro });
  timeline.push({ state: 'cta', index: 2, start: ctaStart, end: total });

  for (const item of durations) if (!fs.existsSync(item.path)) throw new Error(`Thiếu âm thanh ${item.language} ở câu ${item.index}.`);
  onTimeline(timeline);

  const persistentLayers = ['background', 'character', 'logo', 'footer'];
  const layersByState = {
    intro: [...persistentLayers, 'title'],
    vietnamese: [...persistentLayers, 'scene-number', 'vietnamese-card'],
    bilingual: [...persistentLayers, 'scene-number', 'vietnamese-card', 'english-card'],
    vocabulary: [...persistentLayers, 'scene-number', 'vietnamese-card', 'english-card', 'vocabulary'],
    transition: [],
    cta: [...persistentLayers, 'cta']
  };
  const segments = [];
  for (let index = 0; index < timeline.length; index++) {
    const entry = timeline[index];
    const file = path.join(layerDir, `segment-${String(index + 1).padStart(2, '0')}-${entry.state}.png`);
    const sceneIndex = Math.max(0, Math.min(2, Number(entry.index || 0)));
    await rasterizeScene({ template, script, state: entry.state, index: sceneIndex, outputPath: file, includeBackground: true, includeLayers: layersByState[entry.state] });
    segments.push({ ...entry, duration: Math.max(1 / 30, entry.end - entry.start), file });
  }

  const audioItems = [silentAudio(timing.intro)];
  for (let index = 0; index < 3; index++) {
    audioItems.push(durations[index * 2], durations[index * 2 + 1], silentAudio(timing.vocabularyHold), silentAudio(timing.transition));
  }
  audioItems.push(silentAudio(timing.cta));
  const inputs = [];
  for (const item of audioItems) {
    if (item.silence) inputs.push('-f', 'lavfi', '-t', `${item.silence}`, '-i', 'anullsrc=r=44100:cl=stereo');
    else inputs.push('-i', item.path);
  }
  const audioInputCount = audioItems.length;
  for (const segment of segments) inputs.push('-loop', '1', '-framerate', '30', '-t', segment.duration.toFixed(3), '-i', segment.file);

  const filters = [];
  const segmentLabels = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const inputIndex = audioInputCount + index;
    const label = `scene${index}`;
    const duration = segment.duration;
    const fade = Math.min(Number(timing.fade), duration / 2);
    const transitionFade = Math.min(Number(timing.transitionFade ?? timing.fade), duration / 2);
    const fades = [];
    if (segment.state === 'intro') fades.push(`fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}:color=black`);
    if (segment.state === 'vietnamese' || segment.state === 'cta') fades.push(`fade=t=in:st=0:d=${transitionFade.toFixed(3)}:color=black`);
    if (segment.state === 'vocabulary') fades.push(`fade=t=out:st=${Math.max(0, duration - transitionFade).toFixed(3)}:d=${transitionFade.toFixed(3)}:color=black`);
    filters.push(`[${inputIndex}:v]fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p${fades.map((filter) => `,${filter}`).join('')},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[${label}]`);
    segmentLabels.push(`[${label}]`);
  }
  filters.push(`${segmentLabels.join('')}concat=n=${segments.length}:v=1:a=0[vout]`);

  const audioFilters = [];
  for (let index = 0; index < audioItems.length; index++) {
    const inputIndex = index;
    audioFilters.push(`[${inputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`);
  }
  audioFilters.push(`${audioItems.map((_, index) => `[a${index}]`).join('')}concat=n=${audioItems.length}:v=0:a=1[aout]`);
  filters.push(...audioFilters);

  const filterFile = path.join(tempDir, 'render-v2.filter');
  fs.writeFileSync(filterFile, filters.join(';\n'), 'utf8');
  const output = path.join(outDir, 'final.mp4');
  const filterOption = await majorVersion('ffmpeg') >= 7 ? '-/filter_complex' : '-filter_complex_script';
  const ffmpegArgs = ['-y', ...inputs, filterOption, filterFile, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '22', '-threads', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output];
  await run('ffmpeg', ffmpegArgs, { onProgress, totalSeconds: total });
  const check = await probeMedia(output);
  const videoStream = check.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = check.streams.find((stream) => stream.codec_type === 'audio');
  const [fpsNumerator, fpsDenominator] = String(videoStream?.r_frame_rate || '').split('/').map(Number);
  const fps = fpsDenominator ? fpsNumerator / fpsDenominator : Number(videoStream?.r_frame_rate);
  if (!videoStream || !audioStream || videoStream.codec_name !== 'h264' || videoStream.width !== 1080 || videoStream.height !== 1920 || Math.round(fps) !== 30 || audioStream.codec_name !== 'aac' || check.duration < 4 || check.duration > 60) {
    throw new Error('Video không đạt yêu cầu H.264 1080×1920, 30 FPS, AAC hoặc thời lượng Reels 4–60 giây.');
  }
  const thumbnail = path.join(outDir, 'thumbnail.png');
  await run('ffmpeg', ['-y', '-ss', '1.8', '-i', output, '-frames:v', '1', '-vf', 'scale=1080:1920', thumbnail]);
  if (!fs.existsSync(thumbnail) || fs.statSync(thumbnail).size < 1024) throw new Error('FFmpeg không tạo được thumbnail PNG.');
  const assetVersions = getTemplateAssetVersions(template);
  const manifest = {
    templateId: template.templateId,
    templateVersion: template.version,
    template: JSON.parse(JSON.stringify(template)),
    pageName: template.brand.pageName,
    palette: template.brand,
    assetVersions,
    fonts: { family: template.brand.fontFamily, license: 'SIL Open Font License 1.1', files: ['fonts/BeVietnamPro-Regular.ttf', 'fonts/BeVietnamPro-SemiBold.ttf', 'fonts/BeVietnamPro-Bold.ttf'] },
    canvas: template.canvas,
    timeline,
    durationSeconds: check.duration,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream.codec_name,
    createdAt: new Date().toISOString()
  };
  return {
    videoPath: output, thumbnailPath: thumbnail, duration: check.duration,
    width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate,
    audioManifest: durations.map((item) => ({ index: item.index, language: item.language, text: item.text, voice: item.voice, duration: item.duration })),
    renderManifest: manifest
  };
}

async function probeAudio(file) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => reject(new Error('ffprobe chưa cài.')));
    child.on('close', (code) => code === 0 ? resolve(Number(stdout.trim())) : reject(new Error(stderr || `ffprobe lỗi ${code}`)));
  });
  if (!Number.isFinite(result) || result <= 0) throw new Error(`Không đọc được thời lượng âm thanh: ${file}`);
  return result;
}
