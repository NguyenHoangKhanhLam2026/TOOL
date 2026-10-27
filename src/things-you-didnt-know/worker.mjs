import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimNextThingsYouDidntKnowJob, completeThingsYouDidntKnowReservation,
  getThingsYouDidntKnowJob, logThingsYouDidntKnowActivity, recoverThingsYouDidntKnowJobs,
  releaseThingsYouDidntKnowReservation, updateThingsYouDidntKnowJob } from './history.mjs';
import { createThingsYouDidntKnowVideo } from './create-video.mjs';
import { getThingsYouDidntKnowSettings } from './settings-store.mjs';
import { listThingsYouDidntKnowSchedules } from './history.mjs';
import { processThingsYouDidntKnowScheduleTick } from './scheduler.mjs';

let stopping = false;

export async function processThingsYouDidntKnowJob(job, { onProgress = () => {} } = {}) {
  if (job?.type !== 'create_tydk_reel') throw new Error('Job Things You Didn\'t Know có type không hợp lệ.');
  updateThingsYouDidntKnowJob(job.id, { status: 'running', progress: { ...(job.progress || {}), phase: 'started', updatedAt: new Date().toISOString() } });
  logThingsYouDidntKnowActivity({ jobId: job.id, stage: 'job-started', code: 'TYDK_JOB_STARTED', message: 'Bắt đầu pipeline create_tydk_reel.' });
  try {
    const result = await createThingsYouDidntKnowVideo(job, { onProgress });
    const latest = getThingsYouDidntKnowJob(job.id);
    updateThingsYouDidntKnowJob(job.id, { status: 'complete', progress: { ...(latest?.progress || {}), phase: 'complete', contentId: result.contentId, updatedAt: new Date().toISOString() } });
    completeThingsYouDidntKnowReservation(job.id);
    logThingsYouDidntKnowActivity({ jobId: job.id, contentId: result.contentId, stage: 'job-complete', code: 'TYDK_JOB_COMPLETED', message: 'Reel đã render và lưu vào thư viện Things You Didn\'t Know.' });
    return result;
  } catch (error) {
    const latest = getThingsYouDidntKnowJob(job.id);
    if (!latest?.payload?.contentId) releaseThingsYouDidntKnowReservation(job.id);
    updateThingsYouDidntKnowJob(job.id, { status: 'failed', errorCode: error.code || 'TYDK_JOB_FAILED', lastError: String(error.message || error).slice(0, 900), progress: { ...(latest?.progress || {}), phase: 'failed', failedPhase: latest?.progress?.phase || null, errorCode: error.code || null, updatedAt: new Date().toISOString() } });
    throw error;
  }
}

export function thingsYouDidntKnowSchedulerShouldStayAwake() {
  if (getThingsYouDidntKnowSettings().fullAutoEnabled) return true;
  return listThingsYouDidntKnowSchedules().some((item) => ['scheduled', 'publishing'].includes(item.status));
}

export async function runThingsYouDidntKnowWorker({ pollIntervalMs = 3500, idleExitMs = 0, onError = console.error } = {}) {
  recoverThingsYouDidntKnowJobs();
  let idleSince = Date.now();
  while (!stopping) {
    try {
      const job = claimNextThingsYouDidntKnowJob();
      if (job) {
        idleSince = Date.now();
        try { await processThingsYouDidntKnowJob(job); }
        catch (error) { onError(error); }
        await processThingsYouDidntKnowScheduleTick({ onError });
        continue;
      }
      await processThingsYouDidntKnowScheduleTick({ onError });
    } catch (error) { onError(error); }
    if (Number(idleExitMs) > 0 && Date.now() - idleSince >= Number(idleExitMs) && !thingsYouDidntKnowSchedulerShouldStayAwake()) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(pollIntervalMs) || 3500)));
  }
  const { closeThingsYouDidntKnowDatabase } = await import('./history.mjs');
  closeThingsYouDidntKnowDatabase();
}

function stop() { stopping = true; }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const idleExitMs = Math.max(0, Number(process.env.TYDK_WORKER_IDLE_EXIT_MS) || 0);
  runThingsYouDidntKnowWorker({ idleExitMs }).catch((error) => { console.error(error); process.exitCode = 1; });
}
