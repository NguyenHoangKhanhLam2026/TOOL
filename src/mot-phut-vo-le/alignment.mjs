import fs from 'node:fs';
import path from 'node:path';
import { alignSpeechLocally } from '../tts/local-alignment.mjs';
import { mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';

export async function alignMotPhutVoLeAudio({ audioPath, scriptText, segmentId, onProgress = () => {} }) {
  if (!fs.existsSync(audioPath)) throw new Error('Không tìm thấy audio cần căn chỉnh.');
  const id = String(segmentId || 'mot-phut-vo-le');
  onProgress({ phase: 'local-alignment-started', language: 'vi' });
  let local;
  try {
    local = await alignSpeechLocally(audioPath, String(scriptText).normalize('NFC'), 'vi');
    if (local?.status === 'failed') {
      onProgress({ phase: 'local-alignment-retry', language: 'vi', warning: local.warning || null });
      local = await alignSpeechLocally(audioPath, String(scriptText).normalize('NFC'), 'vi');
    }
  } catch (error) {
    error.code ||= 'MOT_PHUT_VO_LE_ALIGNMENT_FAILED';
    throw error;
  }

  const mapped = mapWordBoundariesToTokens(scriptText, local.wordBoundaries || [], id, { language: 'vi' });
  const manifest = {
    module: 'mot-phut-vo-le', language: 'vi', source: local.source || null,
    status: mapped.alignment.reliable ? 'aligned' : local.status === 'unavailable' ? 'unavailable' : 'partial',
    reliable: mapped.alignment.reliable,
    wordTimings: mapped.wordTimings,
    tokens: mapped.tokens,
    alignment: mapped.alignment,
    warning: mapped.alignment.reliable ? null : local.warning || `Mapping còn thiếu ${mapped.alignment.unmatchedTokenCount} đơn vị hiển thị.`,
    transcriptLanguage: 'vi', createdAt: new Date().toISOString()
  };
  onProgress({ phase: 'local-alignment-complete', reliable: manifest.reliable, mappedTokenCount: mapped.alignment.mappedTokenCount,
    unmatchedTokenCount: mapped.alignment.unmatchedTokenCount, source: manifest.source });
  return manifest;
}

export function saveMotPhutVoLeAlignmentManifest(filePath, manifest) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
  return filePath;
}

export function validateMotPhutVoLeAlignment(manifest, { allowPartial = false } = {}) {
  if (manifest?.reliable) return true;
  if (allowPartial) return false;
  throw Object.assign(new Error(manifest?.warning || 'Không căn chỉnh chính xác được lời đọc với văn bản tiếng Việt.'), { code: 'MOT_PHUT_VO_LE_ALIGNMENT_UNRELIABLE' });
}
