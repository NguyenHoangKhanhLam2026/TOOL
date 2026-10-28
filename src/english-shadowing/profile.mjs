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
    defaultModelRate: 0.75,
    defaultSentencePauseSeconds: 0.62,
    averageSentencePauseSeconds: 0.54,
    cadence: 'Use the existing sample as a style reference. Shadowing keeps its own adjustable rate and sentence pause while preserving each script verbatim.',
    userControls: Object.freeze(['voice', 'speechRate', 'sentencePauseSeconds']),
    speedControl: 'Use the isolated Shadowing controls (0.65x–0.90x and 0.35–0.90s sentence pause); do not reuse the main English speed setting.'
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
