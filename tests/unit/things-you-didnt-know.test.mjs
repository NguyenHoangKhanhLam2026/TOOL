import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_CATALOG, COUNTRY_CATALOG_SOURCE, TOPIC_GROUPS } from '../../src/things-you-didnt-know/catalog.mjs';
import { normalizeThingsYouDidntKnowSettings } from '../../src/things-you-didnt-know/settings.mjs';
import { normalizeThingsYouDidntKnowVisualDesign, THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS } from '../../src/things-you-didnt-know/visual-design.mjs';
import { validateThingsYouDidntKnowCandidate, validateThingsYouDidntKnowScript } from '../../src/things-you-didnt-know/content-validator.mjs';
import { buildThingsYouDidntKnowContentSvg, buildThingsYouDidntKnowThumbnailSvg } from '../../src/things-you-didnt-know/renderer.mjs';

const country = { id: 'JP', name: 'Japan', continent: 'Asia' };
const candidate = {
  country: 'Japan', continent: 'Asia', theme: 'Daily life', factKey: 'community umbrella sharing',
  factText: 'Some neighborhoods place shared umbrellas near community entrances for people caught in the rain.',
  supportingEvidence: 'The source describes the shared umbrella practice.',
  sources: [{ url: 'https://example.org/shared-umbrellas', title: 'Shared umbrellas', publisher: 'Example' }]
};
const narration = 'In some neighborhoods, shared umbrellas wait near community entrances for anyone caught in the rain. A person can borrow one and return it later, making a sudden shower a little easier to manage. The practice turns an ordinary object into a small sign of trust between neighbors. It is not universal, and local versions can differ, so it is best understood as one community custom rather than a rule for an entire country. Small habits like this can make a shared street feel more welcoming.';
const scriptCandidate = {
  country: 'Japan', continent: 'Asia', theme: 'Daily life', factKey: candidate.factKey, factText: candidate.factText,
  title: 'A Quiet Umbrella Custom', hook: 'What if a rainy day came with a little help?', narration,
  caption: 'In some neighborhoods, shared umbrellas wait near community entrances for anyone caught in the rain. A person can borrow one and return it later, making a sudden shower a little easier to manage. The practice turns an ordinary object into a small sign of trust between neighbors. It is not universal, and local versions can differ, so it is best understood as one community custom rather than a rule for an entire country. Would you borrow one?',
  interactionQuestion: 'Would you borrow one?',
  hashtags: ['#ThingsYouDidntKnow', '#Japan', '#DailyLife', '#Community', '#Umbrella', '#Culture', '#Neighbors', '#EverydayLife', '#CuriousFacts', '#TravelFacts'],
  imageTitle: 'A Quiet Umbrella Custom', imageBody: narration, illustrationBrief: 'umbrella, doorway, raindrops',
  thumbnailHeadline: 'A Small Umbrella Surprise', thumbnailHighlights: ['Umbrella', 'Surprise'],
  sources: candidate.sources, voiceStyle: 'warm, curious, conversational'
};

test('country catalog uses 195 unique entries and the 13 requested topic groups', () => {
  assert.equal(COUNTRY_CATALOG_SOURCE.count, 195);
  assert.equal(COUNTRY_CATALOG.length, 195);
  assert.equal(new Set(COUNTRY_CATALOG.map((item) => item.id)).size, 195);
  assert.equal(TOPIC_GROUPS.length, 13);
  assert.ok(COUNTRY_CATALOG.some((item) => item.id === 'VA'));
  assert.ok(COUNTRY_CATALOG.some((item) => item.id === 'PS'));
});

test('Things settings keep their own voice and Full Auto starts off', () => {
  const settings = normalizeThingsYouDidntKnowSettings({ voice: 'not-a-kokoro-voice', fullAutoEnabled: true }, { validVoices: ['af_heart'] });
  assert.equal(settings.voice, 'af_heart');
  assert.equal(settings.fullAutoEnabled, true);
  assert.equal(normalizeThingsYouDidntKnowSettings({}).fullAutoEnabled, false);
  assert.equal(normalizeThingsYouDidntKnowSettings({}).facebookAdapter, 'mock');
});

test('fact candidate and script validators enforce source and exact narration alignment', () => {
  const validCandidate = validateThingsYouDidntKnowCandidate(candidate, { country, theme: 'Daily life' });
  const validScript = validateThingsYouDidntKnowScript(scriptCandidate, { candidate: validCandidate, country });
  assert.equal(validScript.imageBody, validScript.narration);
  assert.throws(() => validateThingsYouDidntKnowCandidate({ ...candidate, sources: [] }, { country, theme: 'Daily life' }), /URL/iu);
  assert.throws(() => validateThingsYouDidntKnowScript({ ...scriptCandidate, imageBody: 'Different body text.' }, { candidate: validCandidate, country }), /imageBody/iu);
});

test('module design changes its own content and thumbnail preview renderer', () => {
  const design = normalizeThingsYouDidntKnowVisualDesign(THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS);
  const contentSvg = buildThingsYouDidntKnowContentSvg({ script: { ...scriptCandidate, themeId: 'daily-life' }, design });
  const editedSvg = buildThingsYouDidntKnowContentSvg({ script: { ...scriptCandidate, themeId: 'daily-life' }, design: { ...design, backgroundColor: '#123456' } });
  const editedContentElements = buildThingsYouDidntKnowContentSvg({ script: { ...scriptCandidate, themeId: 'daily-life' }, design: { ...design, headerText: 'SMALL DAILY DISCOVERIES', illustrationStyle: 'umbrella' } });
  const thumbnailSvg = buildThingsYouDidntKnowThumbnailSvg({ script: scriptCandidate, design });
  assert.match(contentSvg, /width="1080" height="1920"/u);
  assert.match(editedSvg, /#123456/u);
  assert.match(editedContentElements, /SMALL DAILY DISCOVERIES/u);
  assert.match(editedContentElements, /M270 286/u);
  assert.match(thumbnailSvg, /THINGS YOU DIDN&apos;T KNOW/u);
  assert.match(thumbnailSvg, /A/u);
  assert.match(thumbnailSvg, /Small/u);
  assert.match(thumbnailSvg, /Umbrella/u);
  assert.match(thumbnailSvg, /Surprise/u);
});

