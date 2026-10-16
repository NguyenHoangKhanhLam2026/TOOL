import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { BRAND_HASHTAG, ensureBrandHashtag } from './hashtag-utils.mjs';

const LENGTHS = [
  { id: 'short', weight: 30, min: 30, max: 55, target: 42, label: 'ngắn' },
  { id: 'medium', weight: 45, min: 65, max: 100, target: 82, label: 'vừa' },
  { id: 'long', weight: 25, min: 115, max: 160, target: 132, label: 'dài' }
];
const STYLES = [
  { id: 'story', label: 'kể chuyện' }, { id: 'real-life', label: 'tình huống thực tế' },
  { id: 'vocabulary', label: 'giải thích từ vựng' }, { id: 'communication-tip', label: 'mẹo giao tiếp' },
  { id: 'question', label: 'câu hỏi thú vị' }, { id: 'knowledge', label: 'chia sẻ kiến thức' }
];
const VI_STOP_WORDS = new Set(['va', 'la', 'cho', 'cua', 'mot', 'nhung', 'cac', 'trong', 'tai', 'voi', 'den', 'tu', 'theo', 've', 'o', 'de', 'khi', 'ban', 'minh']);
const EN_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'you', 'have', 'could', 'would', 'please', 'this', 'that', 'into', 'about']);
const GENERIC_TAGS = new Set(['english', 'englishlearning', 'englishvocabulary', 'learnenglish', 'hoctienganh', 'tienganh', 'tienganhgiaotiep', 'giaotiep']);

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function selectLength() {
  const value = Math.random() * 100;
  let boundary = 0;
  return LENGTHS.find((item) => {
    boundary += item.weight;
    return value < boundary;
  }) || LENGTHS.at(-1);
}

function normalizeTag(value) {
  const slug = String(value || '').replace(/^#+/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (letter) => letter === 'đ' ? 'd' : 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug.length >= 3 ? `#${slug}` : '';
}

function topicTag(value) {
  const clean = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (letter) => letter === 'đ' ? 'd' : 'D').toLowerCase();
  const slug = clean.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !VI_STOP_WORDS.has(word) && !EN_STOP_WORDS.has(word)).join('');
  return slug.length >= 3 ? `#${slug.slice(0, 28)}` : '';
}

function tagsFor(script, supplied = []) {
  const source = [
    script.topic, script.category, script.title,
    ...(script.dialogues || []).flatMap((line) => [line.term, ...(Array.isArray(line.turns) ? line.turns.map((turn) => turn.text) : [])]),
    ...speechSegmentsFor(script).map((segment) => segment.text)
  ].filter(Boolean);
  const topical = source.map(topicTag).filter(Boolean);
  const relevantWords = source.flatMap((value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2);
  const candidates = [...supplied.map(normalizeTag), ...topical];
  const unique = [];
  for (const tag of candidates) {
    if (!tag || tag === BRAND_HASHTAG || unique.includes(tag)) continue;
    const slug = tag.slice(1);
    const relevant = GENERIC_TAGS.has(slug) || slug.startsWith('english') || slug.startsWith('tienganh') || slug.startsWith('learnenglish') || relevantWords.some((word) => slug.includes(word) || word.includes(slug));
    if (relevant) unique.push(tag);
  }
  const shuffled = unique.sort(() => Math.random() - 0.5);
  const extras = shuffled.slice(0, Math.min(4, Math.max(2, shuffled.length)));
  if (extras.length < 2) {
    for (const fallback of ['#hoctienganh', '#tienganhgiaotiep']) {
      if (!extras.includes(fallback)) extras.push(fallback);
      if (extras.length === 2) break;
    }
  }
  return ensureBrandHashtag(extras.slice(0, 4));
}

function parseResponse(value) {
  const clean = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI không trả JSON caption hợp lệ.');
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!parsed || typeof parsed.caption !== 'string' || !parsed.caption.trim()) throw new Error('AI trả caption rỗng.');
  return parsed;
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function paragraphCount(value) {
  return String(value || '').split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean).length;
}

function lessonData(script) {
  return {
    topic: script.topic,
    category: script.category,
    title: script.title,
    dialogues: (script.dialogues || []).map(({ vietnamese, english, term, meaningVi, noteVi, grammarNote, turns }) => ({
      vietnamese, english, term, meaningVi, noteVi, grammarNote,
      ...(Array.isArray(turns) ? { turns: turns.map(({ speakerId, language, text }) => ({ speakerId, language, text })) } : {})
    })),
    speechSegments: speechSegmentsFor(script).map(({ speakerId, language, text }) => ({ speakerId, language, text }))
  };
}

function makePrompt(script, length, style, repair = '') {
  return `Viết caption Facebook bằng tiếng Việt tự nhiên cho video bài đăng dưới đây.\n` +
    `Độ dài ${length.label}: ${length.min}-${length.max} từ, phong cách: ${style.label}.\n` +
    `Tối ưu SEO tự nhiên cho Facebook: câu mở đầu phải nêu chủ đề cụ thể và cụm từ khóa chính “tiếng Anh giao tiếp” hoặc “học tiếng Anh giao tiếp”; đưa từ khóa chủ đề vào đúng ngữ cảnh. Dùng cụm từ trong bài như từ khóa phụ khi phù hợp, không nhồi hoặc lặp từ khóa.\n` +
    `Bố cục bắt buộc đúng 3 đoạn, ngăn nhau bằng một dòng trống: (1) Mở bài 1 câu thu hút, có từ khóa chính và chủ đề; (2) Thân bài giải thích ngắn gọn cách dùng/ngữ cảnh của các cụm từ hoặc lượt hội thoại xuất hiện trong dữ liệu, chỉ phân biệt sắc thái hoặc lỗi thường gặp khi ghi chú nguồn có căn cứ; (3) Kết bài 1 câu chốt ý hoặc gợi ý luyện tập cụ thể, tự nhiên. Không ghi nhãn “Mở bài/Thân bài/Kết bài”. Giữ độ dài câu vừa phải, không viết cả caption thành một đoạn. Không chỉ tóm tắt, không bịa kiến thức ngữ pháp hay tình huống. Có thể xen câu tiếng Anh, câu hỏi, emoji vừa phải; tránh lời kêu gọi sáo rỗng.\n` +
    `Trả đúng JSON: {"caption":"caption không kèm hashtag","hashtags":["#hashtagliênquan"]}. Chọn hashtag đúng chủ đề, không lặp; không cần thêm hashtag thương hiệu vì hệ thống sẽ bổ sung.\n` +
    `${repair ? `Sửa bản trước: ${repair}\n` : ''}` +
    `Dữ liệu thật của bài học: ${JSON.stringify(lessonData(script))}`;
}

function fallbackCaption(script, length, style) {
  const lines = script.dialogues || [];
  const topic = script.topic || 'giao tiếp tiếng Anh';
  const termCount = lines.filter((line) => line.term).length;
  const countPhrase = termCount ? `${termCount} cụm từ` : 'các lượt hội thoại';
  const openings = {
    story: `Muốn nói về “${topic}” tự nhiên hơn? Học tiếng Anh giao tiếp qua ${countPhrase}.`,
    'real-life': `Học tiếng Anh giao tiếp chủ đề “${topic}” qua một tình huống quen thuộc.`,
    vocabulary: `${termCount || 'Các'} cụm từ tiếng Anh giao tiếp về “${topic}” sẽ dễ nhớ hơn khi học trong câu.`,
    'communication-tip': `Mẹo học tiếng Anh giao tiếp: dùng ${countPhrase} về “${topic}” đúng ngữ cảnh.`,
    question: `Bạn diễn đạt “${topic}” bằng tiếng Anh thế nào? Cùng học ${countPhrase} hữu ích.`,
    knowledge: `Học tiếng Anh giao tiếp theo ngữ cảnh giúp bạn nhớ cách nói về “${topic}”.`
  };
  let opening = openings[style.id];
  const body = lines.flatMap((line) => line.term
    ? [`“${line.term}” nghĩa là “${line.meaningVi}”.`]
    : (line.turns || []).filter((turn) => /^(en|english)(-|$)/i.test(turn.language || '')).map((turn) => `Luyện câu “${turn.text}” để quen phản xạ theo ngữ cảnh.`));
  if (!body.length) body.push(...speechSegmentsFor(script).slice(0, 3).map((segment) => `Luyện câu “${segment.text}” theo đúng tình huống.`));
  const keypointCount = body.length;
  const details = lines.filter((line) => line.english).map((line, index) => `Câu ${index + 1}: “${line.english}”. ${[line.noteVi, line.grammarNote].filter(Boolean).join(' ')}`.trim());
  const closing = ['Chọn một cụm từ và thử đặt câu về trải nghiệm của bạn.'];
  const fits = () => wordCount([opening, body.join(' '), closing.join(' ')].join(' ')) <= length.max;

  if (length.id !== 'short') {
    for (const detail of details) {
      if (wordCount([opening, body.join(' '), detail, closing.join(' ')].join(' ')) <= length.max) body.push(detail);
    }
  }
  if (length.id === 'long') {
    const review = 'Để ôn, thử nhớ nghĩa khi nhìn câu tiếng Anh, rồi tự nói lại câu.';
    if (wordCount([opening, body.join(' '), ...closing, review].join(' ')) <= length.max) closing.push(review);
  }
  while (!fits() && body.length > keypointCount) body.pop();
  if (!fits()) {
    opening = `Học tiếng Anh giao tiếp về “${topic}” qua ${countPhrase}.`;
    closing.splice(1);
    closing[0] = 'Thử dùng một cụm từ trong câu của bạn.';
  }
  return [opening, body.join(' '), closing.join(' ')].join('\n\n');
}

function speechSegmentsFor(script) {
  if (Array.isArray(script.speechSegments) && script.speechSegments.length) return script.speechSegments;
  return Array.isArray(script.audioSegments) ? script.audioSegments : [];
}
export async function generateCaption(script) {
  const length = selectLength();
  const style = randomItem(STYLES);
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', generateWithChatGPT]);
  let caption = '';
  let suppliedTags = [];
  let feedback = '';
  for (let attempt = 0; providers.length && attempt < 3; attempt++) {
    const [name, provider] = providers[attempt % providers.length];
    try {
      const result = parseResponse(await provider(makePrompt(script, length, style, feedback)));
      const embeddedTags = result.caption.match(/#[\p{L}\p{N}_]+/gu) || [];
      const candidate = result.caption.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const count = wordCount(candidate);
      const paragraphs = paragraphCount(candidate);
      const issues = [];
      if (count < length.min || count > length.max) issues.push(`caption có ${count} từ; cần ${length.min}-${length.max} từ`);
      if (paragraphs !== 3) issues.push(`caption có ${paragraphs} đoạn; cần đúng 3 đoạn mở bài, thân bài, kết bài, ngăn bằng dòng trống`);
      if (issues.length) {
        feedback = `${issues.join('; ')}. Giữ ý đúng, từ khóa tự nhiên, phong cách ${style.label} và độ dài ${length.label}.`;
        continue;
      }
      caption = candidate;
      suppliedTags = [...(Array.isArray(result.hashtags) ? result.hashtags : []), ...embeddedTags];
      break;
    } catch (error) {
      feedback = error.message;
    }
  }
  if (!caption) caption = fallbackCaption(script, length, style);
  return { caption, hashtags: tagsFor(script, suppliedTags), length: length.id, style: style.id };
}
