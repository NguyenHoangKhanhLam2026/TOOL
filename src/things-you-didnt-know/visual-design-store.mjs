import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import { createThingsYouDidntKnowVisualPreset, normalizeThingsYouDidntKnowVisualDesign, THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS } from './visual-design.mjs';

const STORE_DIR = path.join(DATA, 'things-you-didnt-know');
const STORE_PATH = path.join(STORE_DIR, 'visual-presets.json');
function readStore() {
  try { const value = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
function writeStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, STORE_PATH);
}
export function getThingsYouDidntKnowVisualDesign() {
  const store = readStore();
  return normalizeThingsYouDidntKnowVisualDesign(store.activeDesign || THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS);
}
export function saveThingsYouDidntKnowVisualDesign(value) {
  const design = normalizeThingsYouDidntKnowVisualDesign(value);
  const store = readStore();
  store.activeDesign = design;
  writeStore(store);
  return design;
}
export function resetThingsYouDidntKnowVisualDesign() {
  return saveThingsYouDidntKnowVisualDesign(THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS);
}
export function listThingsYouDidntKnowVisualPresets() {
  return Object.values(readStore().presets || {}).map((preset) => ({ ...preset, isDefault: preset.id === readStore().defaultPresetId }));
}
export function saveThingsYouDidntKnowVisualPreset(name, design) {
  const preset = createThingsYouDidntKnowVisualPreset(name, design);
  const store = readStore();
  store.presets ||= {};
  const record = { id: crypto.randomUUID(), ...preset, createdAt: new Date().toISOString() };
  store.presets[record.id] = record;
  if (!store.defaultPresetId) {
    store.defaultPresetId = record.id;
    store.activeDesign = record.design;
  }
  writeStore(store);
  return record;
}
export function selectThingsYouDidntKnowVisualPreset(id, { makeDefault = true } = {}) {
  const store = readStore();
  const preset = store.presets?.[String(id || '')];
  if (!preset) throw new Error('Không tìm thấy preset Things You Didn\'t Know.');
  store.activeDesign = normalizeThingsYouDidntKnowVisualDesign(preset.design);
  if (makeDefault) store.defaultPresetId = preset.id;
  writeStore(store);
  return store.activeDesign;
}
