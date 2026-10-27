import { getMotPhutVoLeContent, listMotPhutVoLeHistory } from './history.mjs';

export function listMotPhutVoLeVideos(options = {}) {
  return listMotPhutVoLeHistory(options).filter((item) => item.videoPath || ['processing', 'failed', 'script_ready'].includes(item.status));
}

export function getMotPhutVoLeVideo(id) {
  return getMotPhutVoLeContent(id);
}

export function listMotPhutVoLeTopics(options = {}) {
  return listMotPhutVoLeHistory(options).map(({ id, category, subcategory, topic, angle, title, status, createdAt }) => ({
    id, category, subcategory, topic, angle, title, status, createdAt
  }));
}
