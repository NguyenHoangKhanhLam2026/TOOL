import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PATHS } from '../src/config.mjs';
import { createContactSheet, rasterizeScene, readVisualTemplate } from '../packages/video-engine/visual-template-engine.mjs';
import { renderVideo } from '../packages/video-engine/render.mjs';

process.env.AERS_PRIVATE_DIR ||= path.join(ROOT, 'data', 'private');
const { db, getScript } = await import(pathToFileURL(path.join(ROOT, 'src', 'database', 'db.mjs')).href);
const outputDir = path.join(PATHS.output, 'visual-regression');
fs.mkdirSync(outputDir, { recursive: true });
const row = db.prepare("SELECT v.id,v.script_id FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.status IN ('ready','published') ORDER BY CASE WHEN s.provider='chatgpt-plan' THEN 0 ELSE 1 END, v.created_at DESC LIMIT 1").get();
if (!row) throw new Error('Cần có một script đã lưu để dựng visual regression.');
const script = getScript(row.script_id);
const template = readVisualTemplate();
const previews = [
  ['vietnamese', 'preview-vietnamese.png'],
  ['bilingual', 'preview-bilingual.png'],
  ['vocabulary', 'preview-vocabulary.png'],
  ['transition', 'preview-transition.png'],
  ['cta', 'preview-cta.png']
];
const imagePaths = [];
for (const [state, filename] of previews) {
  const target = path.join(outputDir, filename);
  await rasterizeScene({ template, script, state, index: 0, outputPath: target });
  imagePaths.push(target);
  console.log(`Preview ${state}: ${target}`);
}
const contactSheet = path.join(outputDir, 'preview-contact-sheet.png');
await createContactSheet(imagePaths, contactSheet);

const audio = [];
for (let index = 0; index < 3; index++) {
  for (const language of ['vi', 'en']) {
    const file = path.join(PATHS.temporary, row.id, 'audio', `${String(index + 1).padStart(2, '0')}-${language}.mp3`);
    if (!fs.existsSync(file) || fs.statSync(file).size < 1024) throw new Error(`Thiếu audio TTS: ${file}`);
    audio.push({ index: index + 1, language, text: script.dialogues[index][language === 'vi' ? 'vietnamese' : 'english'], voice: language === 'vi' ? 'vi-VN-HoaiMyNeural' : 'en-US-JennyNeural', path: file });
  }
}
const render = await renderVideo(script, 'visual-regression-final', audio);
const finalVideo = path.join(outputDir, 'final-test-video.mp4');
const generatedManifest = path.join(PATHS.output, 'visual-regression-final', 'render-manifest.json');
fs.writeFileSync(generatedManifest, JSON.stringify(render.renderManifest, null, 2), 'utf8');
fs.copyFileSync(render.videoPath, finalVideo);
fs.copyFileSync(generatedManifest, path.join(outputDir, 'render-manifest.json'));
console.log(JSON.stringify({ scriptId: row.script_id, provider: script.provider, previews: imagePaths, contactSheet, finalVideo, duration: render.duration, resolution: `${render.width}x${render.height}`, fps: render.fps }, null, 2));
db.close();
