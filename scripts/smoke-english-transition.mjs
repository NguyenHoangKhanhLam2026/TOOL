import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const keepArtifacts = process.argv.includes('--keep');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aers-english-transition-'));
process.env.AERS_DATA_DIR = dataRoot;
process.env.AERS_PRIVATE_DIR = path.join(dataRoot, 'private');

const [{ renderVideo, probeMedia }, { readVisualTemplate }] = await Promise.all([
  import('../packages/video-engine/render.mjs'),
  import('../packages/video-engine/visual-template-engine.mjs')
]);

function writeToneWav(file, durationSeconds, frequency) {
  const sampleRate = 44100;
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataSize = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 1800);
    wav.writeInt16LE(sample, 44 + index * bytesPerSample);
  }
  fs.writeFileSync(file, wav);
}

async function main() {
  const audioDir = path.join(dataRoot, 'input-audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const sceneText = [
    { id: 'transition-first', vietnamese: 'Bạn có thể gửi cho tôi bản báo cáo mới nhất không?', english: 'Could you send me the latest report?' },
    { id: 'transition-second', vietnamese: 'Tôi sẽ kiểm tra lại các con số sau cuộc họp.', english: 'I will review the numbers after the meeting.' }
  ];
  const script = {
    contentLanguage: 'en',
    presentationStyle: 'dialogue-cards',
    title: 'English transition render check',
    dialogues: sceneText,
    speechSegments: []
  };
  const audioFiles = [];
  let audioIndex = 0;
  for (const [dialogueIndex, dialogue] of sceneText.entries()) {
    for (const [language, text, layerId, state] of [
      ['vi', dialogue.vietnamese, 'vietnamese-card', 'vietnamese'],
      ['en', dialogue.english, 'english-card', 'bilingual']
    ]) {
      const segmentId = `${dialogue.id}-${language}`;
      const target = { layerId, dialogueIndex };
      const audioPath = path.join(audioDir, `${segmentId}.wav`);
      writeToneWav(audioPath, 1, 350 + audioIndex * 90);
      const segment = { segmentId, speakerId: `${language}-test`, language, text, state, turnId: dialogue.id, target };
      script.speechSegments.push(segment);
      audioFiles.push({ ...segment, index: audioIndex, path: audioPath });
      audioIndex += 1;
    }
  }

  const template = structuredClone(readVisualTemplate({ contentLanguage: 'en' }));
  template.timing = { ...template.timing, intro: 0, vocabularyHold: 0, transition: 0.3, cta: 0.2 };
  const results = [];
  for (const backgroundEffect of ['none', 'bubbles']) {
    const videoId = `transition-${backgroundEffect}`;
    const rendered = await renderVideo(script, videoId, audioFiles, {
      templateSnapshot: template,
      highlightSettings: {
        highlightEnabled: false,
        backgroundEffect,
        backgroundEffectDensity: 10,
        backgroundEffectSpeed: 25,
        backgroundEffectOpacity: 10
      }
    });
    const media = await probeMedia(rendered.videoPath);
    const transition = rendered.renderManifest.timeline.filter((entry) => entry.state === 'transition');
    assert.equal(transition.length, 1, `${backgroundEffect}: expected one scene transition`);
    assert.equal(Math.round((transition[0].end - transition[0].start) * 30), 9, `${backgroundEffect}: transition must be nine frames`);
    assert.equal(media.streams.find((stream) => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(media.streams.find((stream) => stream.codec_type === 'audio')?.codec_name, 'aac');
    assert.ok(Math.abs(media.duration - 4.5) < 0.12, `${backgroundEffect}: unexpected output duration ${media.duration}`);

    const layerDir = path.join(dataRoot, 'temporary', videoId, 'visual-layers-v2');
    if (backgroundEffect === 'none') {
      const transitionFrames = fs.readdirSync(layerDir).filter((file) => /^transition-\d{4}-\d{2}\.png$/u.test(file));
      assert.equal(transitionFrames.length, 9, 'No-effect route must render each transition frame');
    } else {
      const firstFrame = Math.ceil(transition[0].start * 30 - 1e-7);
      const endFrame = Math.ceil(transition[0].end * 30 - 1e-7);
      for (let frame = firstFrame; frame < endFrame; frame += 1) {
        const file = path.join(layerDir, `effect-frame-${String(frame + 1).padStart(5, '0')}.png`);
        assert.ok(fs.existsSync(file), `Background-effect route is missing transition frame ${frame}`);
      }
    }
    results.push({
      backgroundEffect,
      videoPath: rendered.videoPath,
      duration: media.duration,
      transitionFrames: 9,
      transitionStartFrame: Math.ceil(transition[0].start * 30 - 1e-7)
    });
  }

  const contactFrames = [];
  for (const [index, result] of results.entries()) {
    const videoId = `transition-${result.backgroundEffect}`;
    const layerDir = path.join(dataRoot, 'temporary', videoId, 'visual-layers-v2');
    const files = result.backgroundEffect === 'none'
      ? fs.readdirSync(layerDir).filter((file) => /^transition-\d{4}-\d{2}\.png$/u.test(file)).sort()
      : Array.from({ length: 9 }, (_, frame) => `effect-frame-${String(result.transitionStartFrame + frame + 1).padStart(5, '0')}.png`);
    const selected = [files[0], files[Math.floor(files.length / 2)], files.at(-1)];
    for (const [sampleIndex, file] of selected.entries()) {
      const png = path.join(layerDir, file);
      const resized = await sharp(png).resize(180, 320).png().toBuffer();
      contactFrames.push({ input: resized, left: (index * 3 + sampleIndex) * 180, top: 0 });
    }
  }
  await sharp({ create: { width: 6 * 180, height: 320, channels: 3, background: '#eee9df' } })
    .composite(contactFrames)
    .png()
    .toFile(path.join(dataRoot, 'transition-contact-sheet.png'));
  console.log(JSON.stringify({ passed: true, dataRoot, contactSheet: path.join(dataRoot, 'transition-contact-sheet.png'), results }, null, 2));
}

try {
  await main();
} catch (error) {
  fs.rmSync(dataRoot, { recursive: true, force: true });
  throw error;
}

if (!keepArtifacts) fs.rmSync(dataRoot, { recursive: true, force: true });
