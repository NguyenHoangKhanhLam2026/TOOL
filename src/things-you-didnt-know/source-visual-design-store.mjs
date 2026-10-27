import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.mjs';
import {
  normalizeThingsYouDidntKnowSourceVisualDesign,
  THINGS_YOU_DIDNT_KNOW_SOURCE_VISUAL_DESIGN_DEFAULTS
} from './source-visual-design.mjs';

const STORE_DIR = path.join(DATA, 'things-you-didnt-know');
const STORE_PATH = path.join(STORE_DIR, 'things-source-visual-design.json');

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function writeStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, STORE_PATH);
}

export function getThingsYouDidntKnowSourceVisualDesign() {
  return normalizeThingsYouDidntKnowSourceVisualDesign(
    readStore().activeDesign || THINGS_YOU_DIDNT_KNOW_SOURCE_VISUAL_DESIGN_DEFAULTS
  );
}

export function saveThingsYouDidntKnowSourceVisualDesign(value) {
  const design = normalizeThingsYouDidntKnowSourceVisualDesign(value);
  const store = readStore();
  store.activeDesign = design;
  writeStore(store);
  return design;
}

export function resetThingsYouDidntKnowSourceVisualDesign() {
  return saveThingsYouDidntKnowSourceVisualDesign(THINGS_YOU_DIDNT_KNOW_SOURCE_VISUAL_DESIGN_DEFAULTS);
}

export function listThingsYouDidntKnowSourceVisualPresets() {
  const store = readStore();
  return Object.values(store.presets || {}).map((preset) => ({
    ...preset,
    design: normalizeThingsYouDidntKnowSourceVisualDesign(preset.design),
    isDefault: preset.id === store.defaultPresetId
  }));
}

export function saveThingsYouDidntKnowSourceVisualPreset(name, design) {
  const normalizedName = String(name || '').trim().slice(0, 80);
  if (!normalizedName) throw new Error('Tên preset cần từ 1 đến 80 ký tự.');
  const preset = { name: normalizedName, design: normalizeThingsYouDidntKnowSourceVisualDesign(design) };
  const store = readStore();
  store.presets ||= {};
  const record = { id: crypto.randomUUID(), ...preset, createdAt: new Date().toISOString() };
  store.presets[record.id] = record;
  if (!store.defaultPresetId) {
    store.defaultPresetId = record.id;
    store.activeDesign = record.design;
  }
  writeStore(store);
  return { ...record, isDefault: record.id === store.defaultPresetId };
}

export function selectThingsYouDidntKnowSourceVisualPreset(id, { makeDefault = true } = {}) {
  const store = readStore();
  const preset = store.presets?.[String(id || '')];
  if (!preset) throw new Error('Không tìm thấy preset thiết kế Things You Didn\'t Know.');
  store.activeDesign = normalizeThingsYouDidntKnowSourceVisualDesign(preset.design);
  if (makeDefault) store.defaultPresetId = preset.id;
  writeStore(store);
  return store.activeDesign;
}
