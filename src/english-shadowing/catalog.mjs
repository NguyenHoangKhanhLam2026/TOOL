/**
 * Reference material for the isolated EnglishShadowing content type.
 * These examples guide topic and caption generation; generated lessons must
 * be original and must not copy the reference scripts verbatim.
 */
export const ENGLISH_SHADOWING_CONTENT_TYPE = 'english-shadowing';
export const ENGLISH_SHADOWING_BRAND = 'EasyEnglishShadowing';
export const ENGLISH_SHADOWING_HASHTAG = '#EasyEnglishShadowing';

export const ENGLISH_SHADOWING_REFERENCE_SAMPLES = Object.freeze([
  Object.freeze({
    id: 'wellness-habits',
    videoTitle: 'True Wellness',
    topic: 'Simple, sustainable wellness habits',
    sampleMeasurement: Object.freeze({ durationMs: 27648, spokenWords: 60, clipWordsPerMinute: 130.2, speechWindowWordsPerMinute: 133.4, sentencePauseSeconds: Object.freeze([0.76, 0.01, 0.68]) }),
    captionTitle: 'Simple habits to stay in good health beat rigid restrictions',
    referenceScript: "What do you do every day to stay in good health? True wellness isn't about extreme routines or rigid restrictions. It lives in the quiet, simple choices we make daily - drinking enough water, getting restful sleep, eating wholesome foods, and moving our bodies with joy. Health is built in the small, consistent habits we gently repeat, day by quiet day.",
    caption: 'Small daily choices like drinking water and restful sleep build lasting health. Extreme restrictions fail where gentle, consistent habits succeed every day. Wholesome food and joyful movement create physical wellness without burnout.',
    hashtags: Object.freeze(['#HealthyHabits', '#WellnessRoutines', '#MindfulLiving', ENGLISH_SHADOWING_HASHTAG, '#Shadowing'])
  }),
  Object.freeze({
    id: 'lifelong-curiosity',
    videoTitle: 'Young at Heart',
    topic: 'Staying curious, learning, and enjoying life at every age',
    sampleMeasurement: Object.freeze({ durationMs: 25643, spokenWords: 67, clipWordsPerMinute: 156.8, speechWindowWordsPerMinute: 159.7, sentencePauseSeconds: Object.freeze([0.76, 0.5, 0.54, 0.84, 0.68]) }),
    captionTitle: 'Why forgetting how old you are makes everyday life lighter',
    referenceScript: "Age is just a number, not a limit on your dreams. Too often, we let a number decide what we should or shouldn't do. But your soul doesn't have an expiration date for joy and learning. Laugh like a child, explore new paths, and love without hesitation. Life becomes so much lighter when you forget how old you are. Age gracefully, but always stay young at heart.",
    caption: 'Your soul has no expiration date for joy and learning. Letting age dictate what you pursue restricts daily curiosity. Laughing freely and exploring unfamiliar paths keeps life light. Staying young at heart means letting your dreams outgrow any calendar number.',
    hashtags: Object.freeze(['#mindsetshift', '#stayingyoungatheart', '#lifelonglearning', '#innergrowth', ENGLISH_SHADOWING_HASHTAG])
  }),
  Object.freeze({
    id: 'candidate-product-impact',
    videoTitle: 'Strong Candidate Pitch',
    topic: 'Explaining user research as measurable product and business impact in an interview',
    sampleMeasurement: Object.freeze({ durationMs: 36500, spokenWords: 63, clipWordsPerMinute: 103.6, speechWindowWordsPerMinute: 105.8, sentencePauseSeconds: Object.freeze([0.78, 0.62, 0.86, 0.54]) }),
    captionTitle: 'Translate user trends into lower churn for a stronger candidate pitch',
    referenceScript: 'What makes me a strong candidate is my ability to bridge technical data with business strategy. In my previous position, I translated complex user trends into actionable features for our product team. This approach significantly reduced customer churn and improved overall retention. I thrive in fast-paced environments where clear communication matters most. I am eager to bring that same impact to your team.',
    caption: 'Bridging technical data with business strategy reduced churn and improved overall retention. Frame user trend analysis directly into actionable product features for engineering teams. Demonstrate clear communication by linking technical metrics directly to revenue outcomes.',
    hashtags: Object.freeze(['#JobInterview', '#CustomerChurn', '#InterviewPrep', '#ProductStrategy', ENGLISH_SHADOWING_HASHTAG])
  }),
  Object.freeze({
    id: 'phone-confirmation-etiquette',
    videoTitle: 'Phone Instructions',
    topic: 'Politely slowing down a fast phone conversation and confirming instructions accurately',
    sampleMeasurement: Object.freeze({ durationMs: 20867, spokenWords: 57, clipWordsPerMinute: 163.9, speechWindowWordsPerMinute: 171.5, sentencePauseSeconds: Object.freeze([0.64, 0.58, 0.8]) }),
    captionTitle: 'Write down exact confirmation steps when a caller talks too fast',
    referenceScript: 'I am trying to write down these instructions, but you are speaking a little too fast for me to catch everything. Would you mind slowing down just a bit? I want to make sure I get the exact confirmation steps written correctly before we hang up. Thank you so much for your patience, I really appreciate it.',
    caption: 'Make sure you get the exact confirmation steps written correctly before hanging up. Handle fast-talking callers with polite phrasing to slow down the conversation. Verify important instructions, take accurate notes, and confirm details before disconnecting.',
    hashtags: Object.freeze(['#PhoneEtiquette', '#WorkplaceCommunication', '#OfficeSkills', '#ActiveListening', ENGLISH_SHADOWING_HASHTAG])
  })
]);

export function normalizeEnglishShadowingHashtags(tags = []) {
  const normalized = tags.map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => ['#paperenglishshadowing', '#englishshadowing'].includes(tag.toLowerCase()) ? ENGLISH_SHADOWING_HASHTAG : tag);
  return [...new Set(normalized)];
}
