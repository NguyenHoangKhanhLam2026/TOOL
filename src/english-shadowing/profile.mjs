/**
 * Visual and narration defaults inferred from the four user-provided samples.
 * This module is intentionally isolated and is not wired into the existing
 * English or Chinese content pipelines.
 */
export const ENGLISH_SHADOWING_PROFILE = Object.freeze({
  id: 'english-shadowing',
  brand: 'EasyEnglishShadowing',
  footer: '© EasyEnglishShadowing',
  hashtag: '#EasyEnglishShadowing',
  canvas: Object.freeze({ width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' }),
  reading: Object.freeze({
    narratorCount: 1,
    language: 'English',
    targetWordsPerMinute: 130.2,
    sampleClipWordsPerMinuteRange: Object.freeze([104, 164]),
    sampleSpeechWordsPerMinuteRange: Object.freeze([106, 172]),
    fixedModelRate: 0.8,
    averageSentencePauseSeconds: 0.54,
    cadence: 'Every lesson matches sample-1.wav at 130.2 clip words per minute; keep topic-specific tone guidance and sentence intent in each lesson.',
    userControls: Object.freeze(['voice']),
    speedControl: 'No speed control in the UI. Use sample-1.wav as the fixed pace for every Shadowing topic. Do not reuse the main English speed setting.'
  }),
  visual: Object.freeze({
    background: 'Single cool mint-paper texture; static through the lesson.',
    logo: 'EasyEnglishShadowing in three colors and a bold sans-serif wordmark, centered near the top.',
    opening: 'Begin directly with the lesson composition and narration; do not generate or show a thumbnail.',
    title: 'Short, bold, centered lesson heading below the logo.',
    script: 'Show the complete English passage at once in large, bold, centered, near-black text.',
    activeWord: 'Highlight the currently spoken word with the saved custom color, either as colored text or white text on a rounded colored background, according to the selected style.',
    highlightTiming: 'Follow word-level speech timing; change on the 30 fps frame grid (one frame is about 33.33 ms).',
    transitions: 'No scene cuts or card changes in the samples; retain the static composition.',
    footer: 'Small, low-contrast, centered EasyEnglishShadowing attribution near the bottom.'
  })
});
