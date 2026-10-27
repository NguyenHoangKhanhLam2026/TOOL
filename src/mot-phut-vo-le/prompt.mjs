import {
  countMotPhutVoLeScriptWords, MOT_PHUT_VO_LE_SCRIPT_WORD_MAX, MOT_PHUT_VO_LE_SCRIPT_WORD_MIN,
  parseJsonObject, validateMotPhutVoLeContent
} from './content-validator.mjs';
import { MOT_PHUT_VO_LE_TOPIC_EXPANSION_GUIDE } from './topic-catalog.mjs';

export const MOT_PHUT_VO_LE_TOPIC_PROMPT_VERSION = 'mot-phut-vo-le-topic-v4';
export const MOT_PHUT_VO_LE_SCRIPT_PROMPT_VERSION = 'mot-phut-vo-le-script-v7';

export function buildTopicDiscoveryPrompt({ recentHistory = [], categoryHint = '', manualTopic = '', count = 8 } = {}) {
  const recent = recentHistory.slice(0, 160).map((item) => ({
    category: item.category, subcategory: item.subcategory, topic: item.topic, angle: item.angle,
    title: item.title, summary: item.summary
  }));
  const topicGuide = MOT_PHUT_VO_LE_TOPIC_EXPANSION_GUIDE.map((area) =>
    `${area.number}. ${area.name}: ${area.directions}${area.openEnded ? ' (mục mở, không phải nhóm cố định)' : ''}`
  ).join('\n');
  return [
    'Khung lĩnh vực dưới đây chỉ là gợi ý nội bộ để mở rộng độ phủ, không phải danh mục đóng hoặc giới hạn lựa chọn. Chủ động tạo lĩnh vực 41, 42, 43... khi có kiến thức phù hợp ngoài khung; không đưa số thứ tự vào nội dung đầu ra.',
    topicGuide,
    'Mục 40 chỉ nhắc rằng danh mục được mở rộng; không dùng nguyên cụm "Chủ đề mới" làm tên lĩnh vực. Hãy đặt tên cụ thể cho lĩnh vực mới được phát hiện.',
    'Trong mỗi lô, ưu tiên nhiều lĩnh vực và cơ chế khác nhau. Phát triển chủ đề mới từ kiến thức cụ thể; không chỉ đổi vài chữ hoặc đổi tên lĩnh vực cho một nội dung cũ.',
    'Bạn là biên tập viên của Một Phút Vỡ Lẽ, một kênh Reels kiến thức tổng hợp bằng tiếng Việt.',
    'Hãy đề xuất các ý tưởng mới từ không gian chủ đề mở. Không chọn lĩnh vực từ một danh sách cố định; được phép tạo lĩnh vực, nhánh và nhóm chủ đề chưa từng có.',
    `Mỗi ý tưởng chỉ có một câu hỏi hoặc vấn đề trung tâm, đủ hẹp để giải thích trọn vẹn và chính xác trong ${MOT_PHUT_VO_LE_SCRIPT_WORD_MIN}–${MOT_PHUT_VO_LE_SCRIPT_WORD_MAX} từ tiếng Việt. Ưu tiên một cơ chế hoặc nguyên nhân chính; tránh ý tưởng đòi hỏi nhiều bước, nhiều ngoại lệ hoặc nhiều luận điểm. Nếu rộng, hãy đề xuất một góc hẹp hơn.`,
    'Tránh trùng chủ đề hoặc góc khai thác với lịch sử bên dưới. Đặc biệt tránh thay vài chữ để lặp lại cùng một ý.',
    'Không bịa dữ kiện. Với chủ đề cần cập nhật hoặc có rủi ro cao, hãy ghi rõ cần nguồn kiểm chứng và chọn ý tưởng khác nếu không thể giải thích an toàn.',
    `Tạo ${Math.max(4, Math.min(12, Number(count) || 8))} ứng viên. Trả đúng JSON: {"candidates":[{"category":"...","subcategory":"...","topic":"...","angle":"...","titleHint":"...","summary":"...","knowledgeValue":1-5,"confidence":1-5,"novelty":1-5}]}.`,
    categoryHint ? `Lĩnh vực gợi ý của người dùng: ${categoryHint}` : 'Không có lĩnh vực bắt buộc; tự khám phá.',
    manualTopic ? `Chủ đề nhập tay: ${manualTopic}. Tạo góc khai thác cụ thể, khác các mục đã dùng.` : '',
    `Lịch sử gần đây (chỉ để tránh lặp, không phải danh sách giới hạn): ${JSON.stringify(recent)}`
  ].filter(Boolean).join('\n\n');
}

export function buildScriptPrompt(candidate, { alignmentCorrection = '', headlineCorrection = '', wordCountCorrection = '' } = {}) {
  return [
    'Viết kịch bản Reels kiến thức cho thương hiệu Một Phút Vỡ Lẽ.',
    'Đầu ra phải là JSON hợp lệ với các trường: title, thumbnailHighlight, topic, category, subcategory, angle, scriptText, summary, caption, hashtags, deliveryStyle, contentType, language.',
    '100% tiếng Việt tự nhiên, đủ dấu, chỉ tập trung vào một vấn đề. Kịch bản phải tự đứng độc lập và trả lời rõ câu hỏi trong title: nêu câu trả lời trực tiếp, giải thích nguyên nhân/cơ chế theo đúng trình tự, thêm một ví dụ hoặc hệ quả cụ thể khi cần để người xem hiểu, và nói rõ giới hạn/ngoại lệ nếu thiếu chúng sẽ gây hiểu sai. Kết thúc bằng ý nghĩa hoặc kết luận hoàn chỉnh, không mở thêm ý mới.',
    'Headline (title) phải ngắn gọn, có tối đa 5 từ tiếng Việt; tính theo các từ tách bằng khoảng trắng.',
    'thumbnailHighlight là đúng một từ có ý nghĩa trọng tâm nhất trong title, chép đúng chính tả từ title. Chọn khái niệm hoặc đối tượng chính, không chọn từ nối hay động từ dẫn như “khiến”, “vì”, “là”. Từ này sẽ được tô màu làm điểm nhấn trên thumbnail; không ảnh hưởng lời thoại.',
    `Phần scriptText nên gọn trong ${MOT_PHUT_VO_LE_SCRIPT_WORD_MIN}–${MOT_PHUT_VO_LE_SCRIPT_WORD_MAX} từ tiếng Việt; đếm mỗi cụm tách bằng khoảng trắng là một từ. Không cần nhắm thời lượng cố định. Ưu tiên diễn giải trọn ý; không cắt bỏ nguyên nhân, bước giải thích, ví dụ thiết yếu hoặc giới hạn quan trọng chỉ để giảm số từ. Nếu ý tưởng không thể giải thích rõ trong giới hạn này, hãy thu hẹp góc khai thác. Không kết thúc cụt hoặc bằng một nhận định chưa được giải thích.`,
    'Không dùng khuôn mở đầu lặp lại, không giật tít sai, không nhồi kiến thức, không bắt buộc bài học đạo lý, không bịa nguồn/số liệu/lời trích dẫn. Không trình bày giả thuyết như kết luận.',
    'Với sức khỏe, tài chính, luật, lịch sử hoặc khoa học, chỉ dùng kiến thức phổ thông có độ chắc chắn cao; nếu không đủ chắc chắn, diễn đạt giới hạn hoặc chọn góc an toàn. Không tuyên bố đã kiểm chứng nếu không có nguồn.',
    'Viết khoảng 3–6 câu ngắn, mạch lạc, độ dài tự nhiên để đọc rõ; không áp dụng quy tắc đếm từ tiếng Anh và không thêm câu đệm để kéo dài.',
    'Viết cho giọng đọc tiếng Việt tự nhiên: đặt dấu phẩy ở chỗ chuyển ý hoặc cần lấy hơi ngắn; kết thúc mỗi ý trọn vẹn bằng dấu chấm, hỏi hoặc chấm than phù hợp. Tránh nối nhiều mệnh đề bằng dấu phẩy, tránh câu quá dài khiến giọng đọc chạy liền một hơi. Không chèn xuống dòng, ký hiệu chỉ đạo giọng đọc hoặc dấu câu dày đặc. Giữ nguyên giới hạn hiện có: scriptText phải đủ 55–80 từ theo cách đếm của MPVL và 80–2400 ký tự.',
    alignmentCorrection ? `Điều chỉnh để lời đọc dễ căn chỉnh: ${alignmentCorrection}` : '',
    headlineCorrection ? `Sửa riêng Headline: ${headlineCorrection}` : '',
    wordCountCorrection ? `Điều chỉnh độ dài kịch bản: ${wordCountCorrection}` : '',
    'Caption gồm 1–3 câu liên quan trực tiếp và 3–5 hashtag; bắt buộc có #MotPhutVoLe. Không dùng hashtag của module khác.',
    'Đặt language là "vi". Không thêm Markdown hoặc văn bản bên ngoài JSON.',
    `Ý tưởng đã chọn: ${JSON.stringify(candidate)}`
  ].join('\n\n');
}

async function generateWithConnectedChatGPT(prompt) {
  const { generateWithChatGPT } = await import('../ai/chatgpt-plan.mjs');
  return generateWithChatGPT(prompt);
}

export async function generateTopicCandidates(options = {}, generate = generateWithConnectedChatGPT) {
  const response = await generate(buildTopicDiscoveryPrompt(options));
  const parsed = parseJsonObject(response);
  if (!Array.isArray(parsed.candidates) || !parsed.candidates.length) throw new Error('ChatGPT không trả về danh sách ý tưởng hợp lệ.');
  return parsed.candidates;
}

export async function generateMotPhutVoLeScript(candidate, options = {}, generate = generateWithConnectedChatGPT) {
  let promptOptions = { ...options };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parsed = parseJsonObject(await generate(buildScriptPrompt(candidate, promptOptions)));
    if (typeof parsed.scriptText === 'string') {
      const wordCount = countMotPhutVoLeScriptWords(parsed.scriptText);
      if (wordCount < MOT_PHUT_VO_LE_SCRIPT_WORD_MIN || wordCount > MOT_PHUT_VO_LE_SCRIPT_WORD_MAX) {
        if (attempt === 2) {
          const error = new Error(`ChatGPT vẫn trả kịch bản ${wordCount} từ; MPVL giới hạn ${MOT_PHUT_VO_LE_SCRIPT_WORD_MIN}–${MOT_PHUT_VO_LE_SCRIPT_WORD_MAX} từ.`);
          error.code = 'MOT_PHUT_VO_LE_WORD_COUNT';
          error.wordCount = wordCount;
          throw error;
        }
        promptOptions = {
          ...promptOptions,
          wordCountCorrection: `Bản trước có ${wordCount} từ. Viết lại gọn trong khoảng ${MOT_PHUT_VO_LE_SCRIPT_WORD_MIN}–${MOT_PHUT_VO_LE_SCRIPT_WORD_MAX} từ, giữ đủ mọi ý cần thiết để người xem hiểu trọn câu trả lời; bỏ câu dẫn thừa, không bỏ bước giải thích.`
        };
        continue;
      }
    }

    const content = validateMotPhutVoLeContent(parsed);
    const headlineWordCount = countHeadlineWords(content.title);
    if (headlineWordCount <= 5) return content;
    if (attempt === 2) throw new Error('Headline Một Phút Vỡ Lẽ phải có tối đa 5 từ.');
    promptOptions = {
      ...promptOptions,
      headlineCorrection: `Headline vừa có ${headlineWordCount} từ. Viết lại title tối đa 5 từ, giữ đúng ý chính. Headline cũ: ${content.title}`
    };
  }
  throw new Error('Không tạo được kịch bản MPVL trong giới hạn độ dài đã đặt.');
}

function countHeadlineWords(value) {
  return String(value || '').match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)?.length || 0;
}
