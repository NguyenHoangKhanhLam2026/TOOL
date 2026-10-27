const emoji = /\p{Extended_Pictographic}/u;
const hashtag = /^#[\p{L}\p{N}_]{2,50}$/u;
const bannedTopic = /\b(war|terrorism|battle|bomb|massacre|genocide|disaster|earthquake|hurricane|religion|religious|political|election|president|minister|medical|medicine|cure|treatment|investment|lawsuit|court case)\b/iu;

export function wordCount(value) { return String(value || '').trim().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length || 0; }
export const THINGS_NARRATION_WORD_MIN = 40;
export const THINGS_NARRATION_WORD_MAX = 80;
export const THINGS_NARRATION_SENTENCE_MIN = 4;
export const THINGS_NARRATION_SENTENCE_MAX = 6;
export function whitespaceWordCount(value) { return String(value ?? '').normalize('NFC').trim().split(/\s+/u).filter(Boolean).length; }
export function sentenceCount(value) {
  const text = String(value ?? '').normalize('NFC').trim();
  if (!text) return 0;
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)]
      .filter((item) => item.segment.trim()).length;
  }
  return text.split(/(?<=[.!?])\s+/u).filter(Boolean).length;
}
const clean = (value, max = 2000) => String(value ?? '').normalize('NFC').trim().slice(0, max);
const normalizePhrase = (value) => clean(value, 400).toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sourceList(value) {
  if (!Array.isArray(value)) throw new Error('Fact cần danh sách sources dạng array.');
  return value.slice(0, 3).map((item, index) => {
    const url = clean(item?.url, 500);
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`Nguồn ${index + 1} cần URL https hợp lệ.`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`Nguồn ${index + 1} cần dùng URL https công khai.`);
    const title = clean(item?.title, 180);
    if (!title) throw new Error(`Nguồn ${index + 1} cần có tiêu đề.`);
    return { url: parsed.toString(), title, publisher: clean(item?.publisher, 100) || parsed.hostname, evidence: clean(item?.evidence || item?.quote || '', 500), retrievalStatus: 'not-fetched' };
  });
}

function invalidCandidate(message) {
  return Object.assign(new Error(message), { code: 'TYDK_INVALID_CANDIDATE' });
}

export function validateThingsYouDidntKnowCandidate(input, { country, theme }) {
  let sources;
  try { sources = sourceList(input?.sources); }
  catch (error) { throw invalidCandidate(error.message); }
  const candidate = {
    country: clean(input?.country, 100), continent: clean(input?.continent, 60), theme: clean(input?.theme, 100),
    factKey: clean(input?.factKey, 180), factText: clean(input?.factText, 600),
    supportingEvidence: clean(input?.supportingEvidence, 600), sources
  };
  if (candidate.country !== country.name || candidate.continent !== country.continent) throw invalidCandidate('Fact trả về không khớp quốc gia hoặc châu lục đã chọn.');
  if (candidate.theme.toLowerCase() !== String(theme).toLowerCase()) throw invalidCandidate('Fact trả về không khớp nhóm chủ đề đã chọn.');
  const missing = [];
  if (wordCount(candidate.factKey) < 2) missing.push('factKey (cần ít nhất 2 từ)');
  if (wordCount(candidate.factText) < 8) missing.push(`factText (cần ít nhất 8 từ, hiện có ${wordCount(candidate.factText)})`);
  if (!candidate.supportingEvidence) missing.push('supportingEvidence (mô tả điều nguồn phải chứng minh)');
  if (missing.length) throw invalidCandidate('Fact chưa đạt yêu cầu: ' + missing.join('; ') + '.');
  if (!candidate.sources.length) throw invalidCandidate('Fact cần ít nhất một nguồn https công khai có thể kiểm tra.');
  if (bannedTopic.test(`${candidate.factKey} ${candidate.factText}`)) throw invalidCandidate('Fact thuộc nhóm nhạy cảm bị loại khỏi Things You Didn\'t Know.');
  return candidate;
}

export function validateThingsYouDidntKnowScript(input, { candidate, country }) {
  const script = {
    country: clean(input?.country, 100), continent: clean(input?.continent, 60), theme: clean(input?.theme, 100),
    factKey: clean(input?.factKey, 180), factText: clean(input?.factText, 600),
    title: clean(input?.title, 120), hook: clean(input?.hook, 240), narration: clean(input?.narration, 900),
    caption: clean(input?.caption, 1200), interactionQuestion: clean(input?.interactionQuestion, 120),
    hashtags: Array.isArray(input?.hashtags) ? input.hashtags.map((item) => clean(item, 60)) : [],
    imageTitle: clean(input?.imageTitle, 120), imageBody: clean(input?.imageBody, 900),
    illustrationBrief: clean(input?.illustrationBrief, 300), thumbnailHeadline: clean(input?.thumbnailHeadline, 100),
    thumbnailHighlights: Array.isArray(input?.thumbnailHighlights) ? input.thumbnailHighlights.map((item) => clean(item, 40)) : [],
    sources: sourceList(input?.sources), voiceStyle: clean(input?.voiceStyle, 120)
  };
  if (script.country !== country.name || script.continent !== country.continent || script.theme !== candidate.theme) throw new Error('Kịch bản lệch quốc gia, châu lục hoặc chủ đề đã đặt.');
  if (script.factKey !== candidate.factKey || normalizePhrase(script.factText) !== normalizePhrase(candidate.factText)) throw new Error('Kịch bản đã thay đổi fact đã chọn.');
  const titleWordCount = wordCount(script.title);
  if (!script.title || titleWordCount > 5 || /[\r\n]/u.test(script.title) || script.title.length > 40) {
    throw Object.assign(new Error(`Title cần tối đa 5 từ, trên một dòng và không quá 40 ký tự (hiện ${titleWordCount} từ, ${script.title.length} ký tự).`), {
      code: 'TYDK_TITLE_LENGTH', wordCount: titleWordCount, characterCount: script.title.length
    });
  }
  const missingFields = ['hook', 'narration', 'imageTitle', 'imageBody', 'illustrationBrief'].filter((field) => !script[field]);
  if (missingFields.length) throw Object.assign(new Error('Kịch bản thiếu trường bắt buộc: ' + missingFields.join(', ') + '.'), {
    code: 'TYDK_REQUIRED_SCRIPT_FIELDS', fields: missingFields
  });
  const narrationWords = whitespaceWordCount(script.narration);
  if (narrationWords < THINGS_NARRATION_WORD_MIN || narrationWords > THINGS_NARRATION_WORD_MAX || script.narration.length > 520) {
    const error = new Error(`Narration cần ${THINGS_NARRATION_WORD_MIN}–${THINGS_NARRATION_WORD_MAX} từ theo khoảng trắng, tối đa 520 ký tự (hiện ${narrationWords} từ, ${script.narration.length} ký tự).`);
    error.code = 'TYDK_NARRATION_LENGTH';
    error.wordCount = narrationWords;
    error.characterCount = script.narration.length;
    throw error;
  }
  const narrationSentences = sentenceCount(script.narration);
  if (narrationSentences < THINGS_NARRATION_SENTENCE_MIN || narrationSentences > THINGS_NARRATION_SENTENCE_MAX) {
    const error = new Error(`Narration cần ${THINGS_NARRATION_SENTENCE_MIN}–${THINGS_NARRATION_SENTENCE_MAX} câu ngắn (hiện ${narrationSentences} câu).`);
    error.code = 'TYDK_NARRATION_SENTENCE_COUNT';
    error.sentenceCount = narrationSentences;
    throw error;
  }
  if (normalizePhrase(script.narration) !== normalizePhrase(script.imageBody)) throw Object.assign(new Error('Narration và imageBody phải cùng nội dung để highlight đồng bộ.'), { code: 'TYDK_NARRATION_IMAGE_MISMATCH' });
  if (/[#•▪●]|\p{Extended_Pictographic}/u.test(script.imageBody)) throw Object.assign(new Error('Image body không được có hashtag, emoji hoặc bullet.'), { code: 'TYDK_IMAGE_BODY_FORMAT' });
  const captionWords = wordCount(script.caption);
  if (captionWords < 70 || captionWords > 90) throw Object.assign(new Error(`Caption cần 70–90 từ (hiện ${captionWords}).`), {
    code: 'TYDK_CAPTION_LENGTH', wordCount: captionWords
  });
  if (!script.interactionQuestion || wordCount(script.interactionQuestion) > 10 || !script.caption.endsWith(script.interactionQuestion)) {
    throw Object.assign(new Error('Caption cần kết thúc chính xác bằng câu tương tác tối đa 10 từ.'), { code: 'TYDK_CAPTION_INTERACTION' });
  }
  if ((script.caption.match(/\?/gu) || []).length > 2 || emoji.test(script.caption)) {
    throw Object.assign(new Error('Caption có quá hai câu hỏi hoặc chứa emoji.'), { code: 'TYDK_CAPTION_FORMAT' });
  }
  if (script.hashtags.length !== 10 || script.hashtags.some((item) => !hashtag.test(item))
    || script.hashtags[0] !== '#ThingsYouDidntKnow' || new Set(script.hashtags.map((item) => item.toLowerCase())).size !== 10) {
    throw Object.assign(new Error('Kịch bản cần đúng 10 hashtag duy nhất, hashtag đầu là #ThingsYouDidntKnow.'), { code: 'TYDK_HASHTAGS' });
  }
  const titleWords = wordCount(script.thumbnailHeadline);
  if (titleWords < 4 || titleWords > 6 || script.thumbnailHighlights.length < 2 || script.thumbnailHighlights.length > 3) {
    throw Object.assign(new Error('Thumbnail cần headline 4–6 từ và 2–3 từ highlight.'), { code: 'TYDK_THUMBNAIL_FIELDS' });
  }
  const normalizedHeadline = normalizePhrase(script.thumbnailHeadline).split(' ');
  if (script.thumbnailHighlights.some((item) => !normalizedHeadline.includes(normalizePhrase(item)))) {
    throw Object.assign(new Error('Từ thumbnail highlight phải xuất hiện nguyên văn trong headline.'), { code: 'TYDK_THUMBNAIL_FIELDS' });
  }
  const incomingSources = sourceList(input?.sources);
  if (JSON.stringify(incomingSources.map((item) => item.url)) !== JSON.stringify(candidate.sources.map((item) => item.url))) throw new Error('Kịch bản đã thay đổi URL nguồn của fact.');
  if (bannedTopic.test(`${script.title} ${script.factText} ${script.narration}`)) throw new Error('Kịch bản chứa nội dung thuộc nhóm nhạy cảm bị loại.');
  return script;
}
