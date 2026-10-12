const groups = {
  'Công sở': ['Báo cáo tiến độ', 'Xin gia hạn thời hạn', 'Đặt lịch họp', 'Góp ý trong cuộc họp', 'Nhờ đồng nghiệp hỗ trợ'],
  'Phỏng vấn': ['Giới thiệu bản thân', 'Nói về điểm mạnh', 'Giải thích khoảng trống nghề nghiệp', 'Hỏi về vị trí', 'Trao đổi mức lương'],
  'Đồng nghiệp': ['Chào đồng nghiệp mới', 'Mời uống cà phê', 'Bàn giao công việc', 'Cảm ơn vì đã giúp đỡ', 'Giải quyết hiểu lầm'],
  'Gia đình': ['Hỏi thăm bố mẹ', 'Lên kế hoạch cuối tuần', 'Nhờ người thân giúp việc', 'Kể về một ngày', 'Chúc mừng sinh nhật'],
  'Bạn bè': ['Rủ bạn đi chơi', 'Hỏi thăm lâu ngày', 'Từ chối lời mời khéo léo', 'Kể về sở thích', 'Làm hòa sau bất đồng'],
  'Mối quan hệ': ['Bày tỏ sự quan tâm', 'Nói về cảm xúc', 'Đặt ranh giới lịch sự', 'Lên kế hoạch hẹn hò', 'Giải quyết bất đồng'],
  'Mua sắm': ['Hỏi giá sản phẩm', 'Đổi kích cỡ quần áo', 'Hỏi chính sách hoàn tiền', 'Tìm sản phẩm thay thế', 'Thanh toán bằng thẻ'],
  'Du lịch': ['Hỏi đường đến ga', 'Đặt vé tàu', 'Thuê xe', 'Hỏi giờ nhận phòng', 'Xin gợi ý địa điểm'],
  'Khách sạn': ['Nhận phòng', 'Yêu cầu thêm khăn', 'Báo điều hòa bị hỏng', 'Xin trả phòng muộn', 'Hỏi đường đến thang máy'],
  'Nhà hàng': ['Đặt bàn', 'Gọi món', 'Hỏi món chay', 'Báo món ăn bị nguội', 'Xin thanh toán riêng'],
  'Sân bay': ['Làm thủ tục hành lý', 'Hỏi cổng lên máy bay', 'Báo thất lạc hành lý', 'Hỏi chuyến bay bị trễ', 'Xin đổi chỗ ngồi'],
  'Học tập': ['Hỏi bài tập', 'Xin giảng lại phần khó', 'Làm việc nhóm', 'Đăng ký khóa học', 'Nói về mục tiêu học tập'],
  'Cảm xúc': ['Nói rằng mình lo lắng', 'Chia sẻ niềm vui', 'Bình tĩnh khi căng thẳng', 'Động viên người khác', 'Xin thời gian suy nghĩ'],
  'Động viên': ['Cố gắng thêm một lần', 'Ăn mừng tiến bộ nhỏ', 'Vượt qua thất bại', 'Bắt đầu thói quen mới', 'Tự tin khi nói tiếng Anh'],
  'Cuộc sống hằng ngày': ['Hỏi về thời tiết', 'Mua cà phê mang đi', 'Nói về lịch trong ngày', 'Xin chỉ đường', 'Hỏi giờ xe buýt'],
  'Tình huống khó xử': ['Đến muộn cuộc hẹn', 'Lỡ quên một việc', 'Từ chối yêu cầu', 'Sửa một thông tin sai', 'Xin lỗi vì làm phiền'],
  'Xin lỗi và cảm ơn': ['Xin lỗi vì trả lời muộn', 'Cảm ơn lời khuyên', 'Xin lỗi vì hiểu nhầm', 'Cảm ơn sự kiên nhẫn', 'Nhận lỗi ở nơi làm việc'],
  'Giao tiếp lịch sự': ['Xin phép ngắt lời', 'Nhờ nói chậm hơn', 'Đưa ra lời đề nghị', 'Xin phép sử dụng đồ vật', 'Kết thúc cuộc trò chuyện'],
  'Đưa ra ý kiến': ['Đồng ý một phần', 'Nêu quan điểm nhẹ nhàng', 'Hỏi ý kiến người khác', 'Đề xuất cách làm mới', 'Không đồng tình lịch sự'],
  'Giải quyết vấn đề': ['Làm rõ yêu cầu', 'Tìm phương án thay thế', 'Báo lỗi kỹ thuật', 'Chia nhỏ công việc', 'Theo dõi vấn đề đã báo']
};

export const TOPICS = Object.entries(groups).flatMap(([category, titles]) => titles.map((title, i) => ({
  id: `${String(Object.keys(groups).indexOf(category) + 1).padStart(2, '0')}-${i + 1}`,
  category,
  title
})));

const phraseSets = [
  {
    vi: ['Mình đang xử lý việc này và sẽ cập nhật cho bạn sớm.', 'Bạn có thể giúp mình kiểm tra phần còn lại không?', 'Cảm ơn bạn đã chờ, mình sẽ gửi bản hoàn chỉnh trước cuối ngày.'],
    en: ['I’m working on this and will keep you posted soon.', 'Could you help me look over the remaining part?', 'Thanks for waiting. I’ll send the final version by the end of the day.'],
    terms: ['keep you posted', 'look over', 'by the end of the day'],
    meanings: ['cập nhật tình hình cho bạn', 'xem lại, kiểm tra', 'trước khi hết ngày hôm nay'],
    notes: ['Cụm thường dùng khi báo tiến độ.', 'Dùng khi nhờ ai rà soát công việc.', 'Cụm chỉ mốc thời gian hoàn tất.']
  },
  {
    vi: ['Mình rất mong được tìm hiểu thêm về cơ hội này.', 'Kinh nghiệm của mình khá phù hợp với yêu cầu đó.', 'Bạn có thể cho mình biết bước tiếp theo là gì không?'],
    en: ['I’m excited to learn more about this opportunity.', 'My experience is a good fit for those requirements.', 'Could you tell me what the next step looks like?'],
    terms: ['learn more about', 'a good fit', 'the next step'],
    meanings: ['tìm hiểu thêm về', 'phù hợp', 'bước tiếp theo'],
    notes: ['Cách diễn đạt tự nhiên để thể hiện sự quan tâm.', 'Dùng để nói kinh nghiệm phù hợp với vị trí.', 'Cụm thường dùng khi hỏi quy trình tiếp theo.']
  },
  {
    vi: ['Mình muốn đổi món này sang một cỡ khác.', 'Bạn có thể kiểm tra xem còn màu xanh không?', 'Nếu không vừa, mình có thể đổi trong bao lâu?'],
    en: ['I’d like to exchange this for a different size.', 'Could you check if you have it in blue?', 'How long do I have to exchange it if it doesn’t fit?'],
    terms: ['exchange this', 'check if', 'How long do I have'],
    meanings: ['đổi món này', 'kiểm tra xem liệu', 'mình có bao lâu để'],
    notes: ['Exchange dùng khi đổi hàng, thường theo chính sách cửa hàng.', 'Cách hỏi lịch sự để nhờ kiểm tra hàng có sẵn.', 'Cấu trúc hỏi khoảng thời gian được phép làm gì.']
  },
  {
    vi: ['Mình đã đặt phòng dưới tên Nguyen.', 'Phòng của mình có thể sẵn sàng sớm hơn không?', 'Bạn có thể giữ hành lý giúp mình được chứ?'],
    en: ['I have a reservation under the name Nguyen.', 'Would it be possible for my room to be ready early?', 'Could you hold my luggage for me?'],
    terms: ['under the name', 'be possible', 'hold my luggage'],
    meanings: ['đặt dưới tên', 'có thể thực hiện được', 'giữ hành lý giúp tôi'],
    notes: ['Cụm dùng khi tìm thông tin đặt chỗ.', 'Cách đề nghị lịch sự với Would it be possible.', 'Hold ở đây có nghĩa là giữ tạm.']
  },
  {
    vi: ['Gần đây mình hơi áp lực vì có quá nhiều việc.', 'Mình sẽ nghỉ một chút rồi quay lại với tinh thần tốt hơn.', 'Bạn không cần phải giải quyết mọi thứ ngay hôm nay.'],
    en: ['I’ve been feeling a little overwhelmed lately.', 'I’ll take a short break and come back with a clearer mind.', 'You don’t have to figure everything out today.'],
    terms: ['overwhelmed', 'take a short break', 'figure everything out'],
    meanings: ['quá tải, choáng ngợp', 'nghỉ giải lao một chút', 'tìm cách giải quyết mọi thứ'],
    notes: ['Tính từ mô tả cảm giác có quá nhiều việc phải xử lý.', 'Cụm nói về việc nghỉ trong thời gian ngắn.', 'Figure out nghĩa là tìm ra lời giải hoặc cách hiểu.']
  }
];

const localTemplateByCategory = new Map([
  ['Công sở', 0],
  ['Phỏng vấn', 1],
  ['Mua sắm', 2],
  ['Khách sạn', 3],
  ['Cảm xúc', 4]
]);

export function makeLocalScript(topic, now = new Date()) {
  const setIndex = localTemplateByCategory.get(topic.category);
  if (setIndex === undefined) throw new Error(`Chủ đề “${topic.title}” chưa có mẫu nội dung cục bộ phù hợp; hãy kết nối ChatGPT hoặc Ollama.`);
  const phrases = phraseSets[setIndex];
  const title = `Tiếng Anh giao tiếp: ${topic.title}`;
  const dialogues = phrases.en.map((english, i) => ({
    index: i + 1,
    vietnamese: phrases.vi[i],
    english,
    term: phrases.terms[i],
    meaningVi: phrases.meanings[i],
    noteVi: phrases.notes[i],
    grammarNote: ''
  }));
  return {
    id: crypto.randomUUID(), topic: topic.title, category: topic.category, level: 'A2-B1', title,
    hook: `Lưu lại 3 câu tiếng Anh về chủ đề ${topic.title.toLowerCase()} nhé!`,
    dialogues,
    caption: `Học 3 câu tiếng Anh giao tiếp về ${topic.title.toLowerCase()}. Nghe, đọc theo và thử dùng hôm nay!`,
    hashtags: ['#HocTiengAnh', '#EnglishEveryday', '#TiengAnhGiaoTiep'],
    thumbnailTitle: topic.title,
    createdAt: now.toISOString(),
    contentHash: ''
  };
}
