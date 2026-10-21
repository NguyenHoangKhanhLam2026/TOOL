/**
 * Background themes used only by the isolated EasyEnglishShadowing renderer.
 * The order is intentional: each newly created lesson advances through this
 * list, then returns to the first theme.
 */
export const ENGLISH_SHADOWING_BACKGROUND_THEMES = Object.freeze([
  Object.freeze({ id: 'deep-teal', label: 'Deep Teal', backgroundStart: '#1E3945', backgroundMid: '#335864', backgroundEnd: '#27444F', glow: '#168F91', accent: '#37BFB1' }),
  Object.freeze({ id: 'slate-blue', label: 'Slate Blue', backgroundStart: '#27384C', backgroundMid: '#41546A', backgroundEnd: '#314255', glow: '#6C91B5', accent: '#78AFC0' }),
  Object.freeze({ id: 'forest', label: 'Forest', backgroundStart: '#2D4138', backgroundMid: '#4A5F51', backgroundEnd: '#374B42', glow: '#5A9573', accent: '#80B89A' }),
  Object.freeze({ id: 'plum', label: 'Plum', backgroundStart: '#383141', backgroundMid: '#584D61', backgroundEnd: '#433C4B', glow: '#87669A', accent: '#B28AB4' }),
  Object.freeze({ id: 'petrol', label: 'Petrol', backgroundStart: '#233F47', backgroundMid: '#3E6167', backgroundEnd: '#2D4A51', glow: '#278C8C', accent: '#58B8AD' }),
  Object.freeze({ id: 'blue-gray', label: 'Blue Gray', backgroundStart: '#343D4B', backgroundMid: '#515C6A', backgroundEnd: '#3E4755', glow: '#8298AD', accent: '#A2BAC8' }),
  Object.freeze({ id: 'cocoa', label: 'Cocoa', backgroundStart: '#453B32', backgroundMid: '#69594B', backgroundEnd: '#50443C', glow: '#A17A5A', accent: '#C49B73' }),
  Object.freeze({ id: 'mauve', label: 'Mauve', backgroundStart: '#3E323D', backgroundMid: '#614D59', backgroundEnd: '#483C47', glow: '#A17491', accent: '#C092AE' }),
  Object.freeze({ id: 'midnight', label: 'Midnight', backgroundStart: '#202D4B', backgroundMid: '#374A74', backgroundEnd: '#293757', glow: '#536FAD', accent: '#82A3D4' }),
  Object.freeze({ id: 'burgundy', label: 'Burgundy', backgroundStart: '#46323D', backgroundMid: '#6E4A55', backgroundEnd: '#523B45', glow: '#AA5969', accent: '#D17B86' }),
  Object.freeze({ id: 'olive', label: 'Olive', backgroundStart: '#3F4130', backgroundMid: '#5E5F45', backgroundEnd: '#494B38', glow: '#999358', accent: '#B9B780' }),
  Object.freeze({ id: 'charcoal', label: 'Charcoal', backgroundStart: '#2F3438', backgroundMid: '#4D5154', backgroundEnd: '#393E43', glow: '#71848A', accent: '#9DB2B2' })
]);

const THEME_BY_ID = new Map(ENGLISH_SHADOWING_BACKGROUND_THEMES.map((theme) => [theme.id, theme]));

export const FIRST_ENGLISH_SHADOWING_BACKGROUND_THEME_ID = ENGLISH_SHADOWING_BACKGROUND_THEMES[0].id;

export function getEnglishShadowingBackgroundTheme(themeId) {
  return THEME_BY_ID.get(String(themeId || '')) || null;
}

export function getNextEnglishShadowingBackgroundThemeId(previousThemeId = null) {
  const previousIndex = ENGLISH_SHADOWING_BACKGROUND_THEMES.findIndex((theme) => theme.id === String(previousThemeId || ''));
  const nextIndex = previousIndex < 0 ? 0 : (previousIndex + 1) % ENGLISH_SHADOWING_BACKGROUND_THEMES.length;
  return ENGLISH_SHADOWING_BACKGROUND_THEMES[nextIndex].id;
}
