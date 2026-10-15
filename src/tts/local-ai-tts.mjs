import { createSpeechSegments } from '../../packages/audio-highlight/highlight-engine.mjs';
import { synthesizeVieNeuScript } from './vieneu-tts.mjs';
import { synthesizeKokoroSegments } from './kokoro-tts.mjs';
import { withLocalTtsModel } from './local-model-manager.mjs';

export async function synthesizeLocalAiScript(script, videoId, { settings = {}, onProgress = () => {} } = {}) {
  const segments = createSpeechSegments(script, settings);
  const unsupported = segments.filter((segment) => !['vi', 'en'].includes(segment.language));
  if (unsupported.length) throw new Error(`Local AI TTS chưa hỗ trợ ngôn ngữ ${unsupported[0].language} ở đoạn ${unsupported[0].segmentId}.`);
  const vietnamese = segments.filter((segment) => segment.language === 'vi');
  const english = segments.filter((segment) => segment.language === 'en');
  const generated = [];
  const total = Math.max(1, segments.length);

  if (vietnamese.length) {
    const audio = await withLocalTtsModel('VieNeu-TTS v3 Turbo', (lease) => synthesizeVieNeuScript(script, videoId, {
      settings,
      segments: vietnamese,
      onProgress: (progress, detail = {}) => {
        if (detail.event === 'memory') {
          lease.update({ phase: `vieneu-${detail.phase}`, workerMemory: detail });
        } else if (detail.phase === 'vieneu-worker-started' && detail.pid) {
          lease.update({ phase: 'vieneu-worker-started', workerPid: detail.pid, workerExited: false });
        } else if (detail.phase === 'vieneu-worker-exited') {
          lease.update({ phase: 'vieneu-worker-exited', workerPid: null, workerExited: true, memoryAfter: { systemRamAvailableMb: detail.availableRamMb } });
        } else if (detail.phase === 'vieneu-synthesis') {
          lease.update({ phase: 'vieneu-synthesis', segmentIndex: Number(detail.index) || 0, segmentCount: Number(detail.total) || vietnamese.length });
        } else if (detail.phase === 'local-alignment') {
          lease.update({ phase: 'vieneu-local-alignment', segmentIndex: Number(detail.index) || 0, segmentCount: Number(detail.total) || vietnamese.length, workerExited: true, workerPid: null });
        }
        onProgress(Math.min(0.49, Math.max(0, progress) * 0.49), { ...detail, language: 'vi' });
      }
    }), {
      onPhase: (state) => onProgress(0, { phase: 'local-tts-manager', model: state.model, managerPhase: state.phase })
    });
    generated.push(...audio);
  }

  if (english.length) {
    const audio = await withLocalTtsModel('Kokoro TTS', (lease) => synthesizeKokoroSegments(english, videoId, {
      settings,
      lease,
      onProgress: (progress, detail) => onProgress(0.5 + Math.min(0.49, Math.max(0, progress) * 0.49), { ...detail, language: 'en' })
    }), {
      onPhase: (state) => onProgress(0.5, { phase: 'local-tts-manager', model: state.model, managerPhase: state.phase })
    });
    generated.push(...audio);
  }

  const bySegmentId = new Map(generated.map((item) => [item.segmentId, item]));
  const missing = segments.find((segment) => !bySegmentId.has(segment.segmentId));
  if (missing) throw new Error(`Local AI TTS không tạo được audio cho đoạn ${missing.segmentId}.`);
  const ordered = segments.map((segment) => bySegmentId.get(segment.segmentId));
  for (const [index, item] of ordered.entries()) {
    onProgress(1, { phase: 'audio', index: index + 1, total, segmentId: item.segmentId, language: item.language, workerExited: true });
  }
  return ordered;
}
