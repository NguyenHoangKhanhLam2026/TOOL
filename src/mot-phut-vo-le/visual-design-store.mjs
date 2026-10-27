import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import { MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY } from './settings.mjs';
import { createMotPhutVoLeDesignSnapshot, MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS, migrateMotPhutVoLeVisualDesignToPoster, normalizeMotPhutVoLeVisualDesign } from './visual-design.mjs';

const STORE_DIR = path.join(DATA, 'mot-phut-vo-le');
const STORE_PATH = path.join(STORE_DIR, 'visual-presets.json');

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, STORE_PATH);
}

export function getMotPhutVoLeVisualDesign() {
  const stored = readStore()[MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY];
  return stored
    ? migrateMotPhutVoLeVisualDesignToPoster(stored)
    : normalizeMotPhutVoLeVisualDesign(MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS);
}

export function getMotPhutVoLeVisualDesignDefaults() {
  return normalizeMotPhutVoLeVisualDesign(MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS);
}

export function saveMotPhutVoLeVisualDesign(value) {
  const design = normalizeMotPhutVoLeVisualDesign(value);
  const store = readStore();
  store[MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY] = createMotPhutVoLeDesignSnapshot(design);
  writeStore(store);
  return design;
}

export function listMotPhutVoLeVisualPresets() {
  return Object.values(readStore().presets || {}).map((preset) => ({ id: preset.id, name: preset.name, design: preset.design }));
}

export function saveMotPhutVoLeVisualPreset(name, value) {
  const title = String(name || '').trim();
  if (!title || title.length > 80) throw new Error('Tên preset phải có từ 1 đến 80 ký tự.');
  const store = readStore();
  store.presets ||= {};
  const id = crypto.randomUUID();
  const preset = { id, name: title, design: createMotPhutVoLeDesignSnapshot(value), createdAt: new Date().toISOString() };
  store.presets[id] = preset;
  writeStore(store);
  return preset;
}

export function resetMotPhutVoLeVisualDesign() {
  return saveMotPhutVoLeVisualDesign(MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS);
}
