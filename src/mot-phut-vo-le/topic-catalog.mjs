// These are first-run ideas only. The topic engine never treats them as an enum.
// This internal guide seeds AI topic discovery; it is deliberately not sent to the UI.
export const MOT_PHUT_VO_LE_TOPIC_EXPANSION_GUIDE = Object.freeze([
  { number: 1, name: 'Tâm lý học', directions: 'Hành vi, cảm xúc, nhận thức, thói quen' },
  { number: 2, name: 'Cuộc sống', directions: 'Bài học, kinh nghiệm, lựa chọn, sai lầm' },
  { number: 3, name: 'Con người', directions: 'Tính cách, bản năng, hành vi xã hội' },
  { number: 4, name: 'Khoa học', directions: 'Vật lý, hóa học, sinh học, khám phá' },
  { number: 5, name: 'Vũ trụ', directions: 'Hành tinh, thiên hà, bí ẩn không gian' },
  { number: 6, name: 'Trái Đất', directions: 'Địa chất, khí hậu, đại dương, núi lửa' },
  { number: 7, name: 'Động vật', directions: 'Tập tính, khả năng đặc biệt, tiến hóa' },
  { number: 8, name: 'Thực vật', directions: 'Cây cối, sinh tồn, thiên nhiên' },
  { number: 9, name: 'Lịch sử', directions: 'Nhân vật, sự kiện, nền văn minh' },
  { number: 10, name: 'Địa lý', directions: 'Quốc gia, địa danh, hiện tượng tự nhiên' },
  { number: 11, name: 'Văn hóa', directions: 'Phong tục, truyền thống, khác biệt văn hóa' },
  { number: 12, name: 'Ngôn ngữ', directions: 'Nguồn gốc từ ngữ, cách giao tiếp' },
  { number: 13, name: 'Công nghệ', directions: 'Internet, điện thoại, thiết bị thông minh' },
  { number: 14, name: 'Trí tuệ nhân tạo', directions: 'Ứng dụng AI, kiến thức, xu hướng' },
  { number: 15, name: 'Internet', directions: 'Mạng xã hội, thuật toán, văn hóa số' },
  { number: 16, name: 'Công việc', directions: 'Công sở, nghề nghiệp, kỹ năng làm việc' },
  { number: 17, name: 'Kinh doanh', directions: 'Doanh nghiệp, thương hiệu, marketing' },
  { number: 18, name: 'Tài chính', directions: 'Tiền bạc, tiết kiệm, kinh tế đời thường' },
  { number: 19, name: 'Giao tiếp', directions: 'Ứng xử, trò chuyện, thuyết phục' },
  { number: 20, name: 'Gia đình', directions: 'Cha mẹ, con cái, các mối quan hệ' },
  { number: 21, name: 'Tình yêu', directions: 'Tình cảm, niềm tin, sự gắn bó' },
  { number: 22, name: 'Giáo dục', directions: 'Học tập, trí nhớ, phương pháp học' },
  { number: 23, name: 'Sức khỏe', directions: 'Kiến thức sức khỏe phổ thông' },
  { number: 24, name: 'Dinh dưỡng', directions: 'Thực phẩm, thói quen ăn uống' },
  { number: 25, name: 'Giấc ngủ', directions: 'Giấc mơ, đồng hồ sinh học' },
  { number: 26, name: 'Ẩm thực', directions: 'Món ăn, nguồn gốc, văn hóa ăn uống' },
  { number: 27, name: 'Du lịch', directions: 'Quốc gia, trải nghiệm, mẹo du lịch' },
  { number: 28, name: 'Kiến trúc', directions: 'Công trình, nhà cửa, thiết kế' },
  { number: 29, name: 'Nghệ thuật', directions: 'Hội họa, âm nhạc, sáng tạo' },
  { number: 30, name: 'Điện ảnh', directions: 'Kỹ thuật phim, lịch sử điện ảnh' },
  { number: 31, name: 'Thể thao', directions: 'Khoa học vận động, lịch sử môn thể thao' },
  { number: 32, name: 'Phát minh', directions: 'Những ý tưởng làm thay đổi thế giới' },
  { number: 33, name: 'Bí ẩn lịch sử', directions: 'Câu hỏi chưa có lời giải chắc chắn' },
  { number: 34, name: 'Những sự thật thú vị', directions: 'Hiện tượng bất ngờ, điều ít biết' },
  { number: 35, name: 'Thói quen con người', directions: 'Hành động tưởng nhỏ nhưng đáng tìm hiểu' },
  { number: 36, name: 'Kỹ năng sinh tồn', directions: 'Xử lý tình huống, an toàn cá nhân' },
  { number: 37, name: 'Môi trường', directions: 'Sinh thái, ô nhiễm, tái chế' },
  { number: 38, name: 'Giao thông', directions: 'Xe cộ, hàng không, đường sắt' },
  { number: 39, name: 'Luật và xã hội', directions: 'Quyền lợi, quy tắc, kiến thức pháp luật' },
  { number: 40, name: 'Chủ đề mới', directions: 'Bất kỳ lĩnh vực phù hợp nào chưa có trong danh sách', openEnded: true }
].map((area) => Object.freeze(area)));

export const MOT_PHUT_VO_LE_SUGGESTED_AREAS = Object.freeze([
  'Tâm lý', 'Cuộc sống', 'Con người', 'Khoa học', 'Vũ trụ', 'Thiên nhiên', 'Động vật', 'Thực vật',
  'Lịch sử', 'Địa lý', 'Văn hóa', 'Công nghệ', 'Trí tuệ nhân tạo', 'Internet', 'Công việc', 'Kinh doanh',
  'Tài chính', 'Giao tiếp', 'Gia đình', 'Các mối quan hệ', 'Giáo dục', 'Sức khỏe', 'Ẩm thực', 'Du lịch',
  'Kiến trúc', 'Nghệ thuật', 'Thể thao', 'Phát minh', 'Ngôn ngữ', 'Môi trường', 'Những hiện tượng thú vị',
  'Kiến thức đời thường', 'Những câu hỏi bất ngờ'
]);

export function topicAreaSuggestions({ query = '', limit = 12 } = {}) {
  const needle = String(query).normalize('NFC').toLocaleLowerCase('vi-VN').trim();
  const filtered = needle ? MOT_PHUT_VO_LE_SUGGESTED_AREAS.filter((item) => item.toLocaleLowerCase('vi-VN').includes(needle)) : MOT_PHUT_VO_LE_SUGGESTED_AREAS;
  return filtered.slice(0, Math.max(1, Math.min(40, Number(limit) || 12)));
}
