// These are first-run ideas only. The topic engine never treats them as an enum.
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
