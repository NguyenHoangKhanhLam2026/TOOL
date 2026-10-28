import { buildSourceContentSvg, buildSourceThumbnailSvg } from './source-design-renderer.mjs';
import { normalizeThingsYouDidntKnowSourceVisualDesign } from './source-visual-design.mjs';

const PREVIEW_BODY = 'In some neighborhoods, shared umbrellas wait near community entrances for anyone caught in the rain. A person can borrow one and return it later, making a sudden shower easier to manage. The practice turns an ordinary object into a small sign of trust between neighbors.';

function sourceScript(script = {}) {
  const title = String(script.imageTitle || script.title || 'A Quiet Umbrella Custom').trim();
  return {
    ...script,
    brand: String(script.brand || "Things You Didn't Know").trim(),
    title,
    thumbnailTitle: String(script.thumbnailHeadline || script.title || '').trim(),
    scriptText: String(script.imageBody || script.scriptText || PREVIEW_BODY).trim()
  };
}

export function buildThingsYouDidntKnowSourceContentSvg({
  script: inputScript = {}, design: inputDesign, tokens = [], activeTokenIds = [], highlightSettings = null,
  effects = {}, seconds = 0, editorMode = false
}) {
  const design = normalizeThingsYouDidntKnowSourceVisualDesign(inputDesign);
  const script = sourceScript(inputScript);
  const words = Array.isArray(tokens) && tokens.length
    ? tokens
    : (script.scriptText.match(/\S+/gu) || []).map((text, index) => ({ id: `things-preview:word:${index + 1}`, text }));
  return buildSourceContentSvg({
    script, tokens: words, activeTokenIds, highlightSettings, style: design.content, schemaVersion: design.schemaVersion,
    brand: script.brand, effects, seconds, editorMode
  });
}

export function buildThingsYouDidntKnowSourceThumbnailSvg({ script: inputScript = {}, design: inputDesign, editorMode = false }) {
  const design = normalizeThingsYouDidntKnowSourceVisualDesign(inputDesign);
  const script = sourceScript(inputScript);
  return buildSourceThumbnailSvg(script, design.thumbnail, {
    editorMode,
    brand: script.brand,
    headline: script.thumbnailTitle,
    highlight: script.thumbnailHighlights || script.thumbnailHighlightWords || []
  });
}

export function buildThingsYouDidntKnowSourcePreviewSvg({ mode = 'content', design, sample = {}, effects = {} } = {}) {
  const input = { ...sample };
  const script = mode === 'thumbnail'
    ? { ...input, title: input.thumbnailTitle || 'A Quiet Umbrella Custom', thumbnailTitle: input.thumbnailTitle || 'A Quiet Umbrella Custom', thumbnailHighlights: input.thumbnailHighlight || 'umbrella custom' }
    : { ...input, title: input.title || 'A Quiet Umbrella Custom', imageTitle: input.title || 'A Quiet Umbrella Custom', imageBody: input.scriptText || PREVIEW_BODY };
  const normalized = normalizeThingsYouDidntKnowSourceVisualDesign({ ...design, enabled: true });
  if (mode === 'thumbnail') {
    return buildThingsYouDidntKnowSourceThumbnailSvg({ script, design: normalized, editorMode: sample.render !== true && sample.cardPreview !== true });
  }
  return buildThingsYouDidntKnowSourceContentSvg({
    script, design: normalized,
    effects, editorMode: sample.render !== true && sample.cardPreview !== true
  });
}
