export function zonedLocalToDate(value, timeZone) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') throw new Error('Ngày giờ không hợp lệ.');
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return new Date(value);
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/);
  if (!match) throw new Error('Ngày giờ phải theo định dạng YYYY-MM-DDTHH:mm.');
  const [, y, m, d, hh, mm, ss = '00'] = match;
  const localAsUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let guess = localAsUtc;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = localAsUtc - represented;
    guess += correction;
    if (!correction) break;
  }
  return new Date(guess);
}

export function formatLocal(iso, timeZone) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function startOfLocalDay(now = new Date(), timeZone = 'Asia/Ho_Chi_Minh') {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return zonedLocalToDate(`${local}T00:00`, timeZone);
}

export function nextScheduledTime(after, postTime = '19:30', timeZone = 'Asia/Ho_Chi_Minh', postsPerDay = 1) {
  const [hour, minute] = postTime.split(':').map(Number);
  const now = new Date(after);
  const count = Math.max(1, Math.min(4, Number(postsPerDay) || 1));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)));
  for (let daysAhead = 0; daysAhead <= 370; daysAhead++) {
    const date = new Date(localDate.getTime() + daysAhead * 24 * 60 * 60_000);
    const yyyy = date.getUTCFullYear(); const mm = String(date.getUTCMonth() + 1).padStart(2, '0'); const dd = String(date.getUTCDate()).padStart(2, '0');
    const base = zonedLocalToDate(`${yyyy}-${mm}-${dd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timeZone);
    for (let slot = 0; slot < count; slot++) {
      const candidate = new Date(base.getTime() + slot * (24 * 60 * 60_000 / count));
      if (candidate > now) return candidate;
    }
  }
  throw new Error('Không tìm được lịch đăng kế tiếp.');
}
