import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG_BIN } from '../src/config.mjs';
import { alignSpeechBatchLocally } from '../src/tts/local-alignment.mjs';
import { ENGLISH_SHADOWING_REFERENCE_SAMPLES } from '../src/english-shadowing/catalog.mjs';

const sourceDirectory = 'C:/Users/BMW RAPTOR/Downloads';
const targetDirectory = path.resolve('.tmp-english-shadowing-analysis');
const filenames = [
  'Simple habits to stay in good health beat rigid restrictions… Xem thêm.mp4',
  'Why forgetting how old you are makes everyday life lighter… Xem thêm.mp4',
  'Translate user trends into lower churn for a stronger candidate pitch Bridging technical data with business strategy reduced churn and improved overall retention. Frame user trend analysis directly into action.mp4',
  'Write down exact confirmation steps when a caller talks too fast Make sure you get the exact confirmation steps written correctly before hanging up. Handle fast-talking callers with polite phrasing to slow dow.mp4'
];

fs.mkdirSync(targetDirectory, { recursive: true });
const items = filenames.map((filename, index) => {
  const audioPath = path.join(targetDirectory, `sample-${index + 1}.wav`);
  const sourcePath = path.join(sourceDirectory, filename);
  const extraction = spawnSync(FFMPEG_BIN, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath
  ], { encoding: 'utf8', windowsHide: true });
  if (extraction.error || extraction.status !== 0) {
    throw new Error(`Audio extraction failed for sample ${index + 1}: ${extraction.error?.message || extraction.stderr}`);
  }
  return {
    segmentId: ENGLISH_SHADOWING_REFERENCE_SAMPLES[index].id,
    audioPath,
    text: ENGLISH_SHADOWING_REFERENCE_SAMPLES[index].referenceScript,
    language: 'en'
  };
});

const aligned = await alignSpeechBatchLocally(items);
const result = aligned.map((item, index) => {
  const boundaries = item.wordBoundaries || [];
  const sentencePauses = boundaries.flatMap((word, wordIndex) => {
    if (!/[.!?]["')\]]*$/u.test(String(word.text || ''))) return [];
    const next = boundaries[wordIndex + 1];
    return next ? [{ after: word.text, seconds: Number(Math.max(0, next.startSeconds - word.endSeconds).toFixed(3)) }] : [];
  });
  const start = boundaries[0]?.startSeconds || 0;
  const end = boundaries.at(-1)?.endSeconds || 0;
  const seconds = end - start;
  return {
    id: items[index].segmentId,
    status: item.status,
    warning: item.warning || null,
    source: item.source || null,
    wordBoundaryCount: boundaries.length,
    firstWordAtSeconds: Number(start.toFixed(3)),
    lastWordEndsAtSeconds: Number(end.toFixed(3)),
    speechWindowSeconds: Number(seconds.toFixed(3)),
    wordsPerMinuteDuringSpeechWindow: Number((boundaries.length * 60 / seconds).toFixed(1)),
    sentencePauses
  };
});
fs.writeFileSync(path.join(targetDirectory, 'alignment-summary.json'), JSON.stringify(result, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
