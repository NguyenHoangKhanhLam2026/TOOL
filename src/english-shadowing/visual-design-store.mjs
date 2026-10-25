import { db } from '../database/db.mjs';
import {
  ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS,
  ENGLISH_SHADOWING_VISUAL_DESIGN_KEY,
  normalizeEnglishShadowingVisualDesign
} from './visual-design.mjs';

export function getEnglishShadowingVisualDesign() {
  const row = db.prepare('SELECT value FROM english_shadowing_state WHERE key=?').get(ENGLISH_SHADOWING_VISUAL_DESIGN_KEY);
  if (!row) return normalizeEnglishShadowingVisualDesign(ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS);
  try { return normalizeEnglishShadowingVisualDesign(JSON.parse(row.value)); }
  catch { return normalizeEnglishShadowingVisualDesign(ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS); }
}

export function saveEnglishShadowingVisualDesign(value) {
  const design = normalizeEnglishShadowingVisualDesign(value);
  db.prepare('INSERT INTO english_shadowing_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .run(ENGLISH_SHADOWING_VISUAL_DESIGN_KEY, JSON.stringify(design), new Date().toISOString());
  return design;
}
