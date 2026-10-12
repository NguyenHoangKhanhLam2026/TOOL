import { getSettings } from '../database/db.mjs';
import { chatgptStatus, generateWithChatGPT } from './chatgpt-plan.mjs';
import { generateWithOllama } from './ollama.mjs';

const BRAND_TAG = '#sinhradenoitienganh';
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
  const source = [script.topic, script.category, script.title, ...(script.dialogues || []).map((line) => line.term)].filter(Boolean);
  const topical = source.map(topicTag).filter(Boolean);
  const relevantWords = source.flatMap((value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2);
  const candidates = [...supplied.map(normalizeTag), ...topical];
  const unique = [];
  for (const tag of candidates) {
    if (!tag || tag === BRAND_TAG || unique.includes(tag)) continue;
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
  return [...new Set([...extras.slice(0, 4), BRAND_TAG])];
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

function lessonData(script) {
  return {
    topic: script.topic,
    category: script.category,
    title: script.title,
    dialogues: (script.dialogues || []).map(({ vietnamese, english, term, meaningVi, noteVi, grammarNote }) => ({ vietnamese, english, term, meaningVi, noteVi, grammarNote }))
  };
}

function makePrompt(script, length, style, repair = '') {
  return `Viết caption Facebook Reels bằng tiếng Việt tự nhiên cho nội dung học dưới đây.\n` +
    `Độ dài ${length.label}: ${length.min}-${length.max} từ, phong cách: ${style.label}.\n` +
    `Caption cần dạy được điều hữu ích từ cả ba câu: giải thích cách dùng/ngữ cảnh của các cụm từ, phân biệt sắc thái hoặc lỗi thường gặp chỉ khi ghi chú nguồn có căn cứ. Không chỉ tóm tắt, không bịa kiến thức ngữ pháp hay tình huống. Có thể xen câu tiếng Anh, câu hỏi, emoji vừa phải. Thay đổi cách mở đầu và cấu trúc, tránh lời kêu gọi sáo rỗng.\n` +
    `Trả đúng JSON: {"caption":"caption không kèm hashtag","hashtags":["#hashtagliênquan"]}. Chọn hashtag đúng chủ đề, không lặp; không cần thêm hashtag thương hiệu vì hệ thống sẽ bổ sung.\n` +
    `${repair ? `Sửa bản trước: ${repair}\n` : ''}` +
    `Dữ liệu thật của bài học: ${JSON.stringify(lessonData(script))}`;
}

function fallbackCaption(script, length, style) {
  const lines = script.dialogues || [];
  const topic = script.topic || 'giao tiếp tiếng Anh';
  const openings = {
    story: `Có lúc chỉ một cụm từ đúng cũng giúp cuộc trò chuyện tự nhiên hơn. Bài học “${topic}” có ba cách nói đáng nhớ.`,
    'real-life': `Trong tình huống “${topic}”, bạn có thể luyện ba câu tiếng Anh dưới đây và ghi nhớ cụm từ trong ngữ cảnh.`,
    vocabulary: `Cùng học từ vựng qua ba câu về “${topic}”: hiểu cụm từ nằm trong câu sẽ dễ nhớ cách dùng hơn.`,
    'communication-tip': `Mẹo giao tiếp hôm nay: ghi nhớ cả cụm từ trong câu rồi đọc lại thành tiếng. Chủ đề là “${topic}”.`,
    question: `Bạn sẽ dùng câu nào đầu tiên khi nói về “${topic}”? Cùng xem ba cụm từ giúp diễn đạt chủ đề này.`,
    knowledge: `Ba câu về “${topic}” giúp bạn học từ vựng ngay trong ngữ cảnh thay vì ghi nhớ từng từ riêng lẻ.`
  };
  const keypoints = lines.map((line) => `“${line.term}” nghĩa là “${line.meaningVi}”.`).join(' ');
  const fixed = `${openings[style.id]}\n\n${keypoints}`;
  const details = lines.map((line, index) => `Câu ${index + 1}: “${line.english}”. ${[line.noteVi, line.grammarNote].filter(Boolean).join(' ')}`.trim()).join('\n\n');
  const practice = 'Đọc từng câu thành tiếng, chú ý cụm từ trong ngữ cảnh, rồi chọn một câu để tự luyện lại.';
  const review = 'Để ôn, che phần nghĩa tiếng Việt và thử nhớ lại khi nhìn câu tiếng Anh. Sau đó nhìn nghĩa rồi tự nói lại câu. Cách luyện này giúp bạn chủ động gọi lại nội dung của cả ba câu.';
  const extras = length.id === 'short' ? [] : [details, practice, ...(length.id === 'long' ? [review] : [])];
  let caption = [fixed, ...extras].filter(Boolean).join('\n\n');
  if (wordCount(caption) > length.max) {
    const available = Math.max(0, length.max - wordCount(fixed));
    const extraText = extras.join('\n\n').trim().split(/\s+/).slice(0, available).join(' ');
    caption = extraText ? `${fixed}\n\n${extraText}` : fixed;
  }
  return caption;
}
export async function generateCaption(script) {
  const length = selectLength();
  const style = randomItem(STYLES);
  const settings = getSettings();
  const providers = [];
  if (chatgptStatus().connected) providers.push(['chatgpt-plan', generateWithChatGPT]);
  providers.push(['ollama', (prompt) => generateWithOllama(prompt, settings)]);
  let caption = '';
  let suppliedTags = [];
  let feedback = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const [name, provider] = providers[attempt % providers.length];
    try {
      const result = parseResponse(await provider(makePrompt(script, length, style, feedback)));
      const embeddedTags = result.caption.match(/#[\p{L}\p{N}_]+/gu) || [];
      const candidate = result.caption.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\n{3,}/g, '\n\n').trim();
      const count = wordCount(candidate);
      if (count < length.min || count > length.max) {
        feedback = `caption có ${count} từ; cần ${length.min}-${length.max} từ. Giữ phong cách ${style.label} và độ dài ${length.label}.`;
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
