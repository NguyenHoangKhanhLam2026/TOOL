import { MOT_PHUT_VO_LE_PRESETS } from './visual-design.mjs';

export const MOT_PHUT_VO_LE_BACKGROUND_THEMES = MOT_PHUT_VO_LE_PRESETS;
export const FIRST_MOT_PHUT_VO_LE_BACKGROUND_THEME_ID = 'vintage-paper';

export function getMotPhutVoLeBackgroundTheme(id) {
  return MOT_PHUT_VO_LE_BACKGROUND_THEMES[id] || MOT_PHUT_VO_LE_BACKGROUND_THEMES[FIRST_MOT_PHUT_VO_LE_BACKGROUND_THEME_ID];
}
