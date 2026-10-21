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

export function localScheduleSlot(value, timeZone = 'Asia/Ho_Chi_Minh') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { day, minute, key: `${day}T${parts.hour}:${parts.minute}` };
}

const minimumPostGapMinutes = 5 * 60;
const maximumPostGapMinutes = 8 * 60;
const minimumFacebookScheduleLeadMinutes = 15;

function shiftLocalDate(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function randomTimeOnUnderfilledScheduledDay(now, timeZone, limit, occupied, candidateDays = []) {
  const today = localScheduleSlot(now, timeZone).day;
  const candidateDaySet = new Set(candidateDays);
  const days = [...new Set([...occupied.keys(), ...candidateDaySet])]
    .filter((day) => day >= today)
    .sort()
    .map((day) => [day, occupied.get(day) || { minutes: new Set(), times: [], count: 0 }])
    .filter(([day, used]) => (used.times.length > 0 || candidateDaySet.has(day)) && used.count < limit);

  for (const [day, used] of days) {
    const start = zonedLocalToDate(`${day}T00:00`, timeZone);
    const end = zonedLocalToDate(`${shiftLocalDate(day, 1)}T00:00`, timeZone);
    const dayMinutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
    const earliestMinute = Math.max(0, Math.ceil((now.getTime() + minimumFacebookScheduleLeadMinutes * 60_000 - start.getTime()) / 60_000));
    const available = [];
    for (let minute = earliestMinute; minute < dayMinutes; minute += 1) {
      if (!used.minutes.has(minute)) available.push(new Date(start.getTime() + minute * 60_000));
    }
    if (!available.length) continue;

    const preferred = available.filter((candidate) => {
      const gaps = used.times.map((scheduledAt) => Math.abs(candidate.getTime() - scheduledAt.getTime()) / 60_000);
      return gaps.every((gap) => gap >= minimumPostGapMinutes) && gaps.some((gap) => gap <= maximumPostGapMinutes);
    });
    const candidates = preferred.length ? preferred : available;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return null;
}

export function randomNextScheduledTime(after, timeZone = 'Asia/Ho_Chi_Minh', postsPerDay = 1, schedules = [], { preferUnderfilledDay = false, candidateDays = [] } = {}) {
  const now = new Date(after);
  if (!Number.isFinite(now.getTime())) throw new Error('Mốc thời gian đặt lịch không hợp lệ.');
  const limit = Math.max(1, Math.min(4, Number(postsPerDay) || 1));
  const occupied = new Map();
  const scheduleTimes = [];
  for (const schedule of schedules) {
    try {
      const scheduledAt = new Date(schedule.scheduled_at ?? schedule.scheduledAt);
      if (!Number.isFinite(scheduledAt.getTime())) continue;
      scheduleTimes.push(scheduledAt);
      const slot = localScheduleSlot(scheduledAt, timeZone);
      if (!occupied.has(slot.day)) occupied.set(slot.day, { minutes: new Set(), times: [], count: 0 });
      const day = occupied.get(slot.day);
      day.minutes.add(slot.minute);
      day.times.push(scheduledAt);
      if (schedule.counts_toward_limit !== false && schedule.countsTowardLimit !== false) day.count += 1;
    } catch {}
  }
  if (preferUnderfilledDay) {
    const underfilled = randomTimeOnUnderfilledScheduledDay(now, timeZone, limit, occupied, candidateDays);
    if (underfilled) return underfilled;
  }
  const latestSchedule = scheduleTimes.length ? new Date(Math.max(...scheduleTimes.map((date) => date.getTime()))) : null;
  const base = latestSchedule && latestSchedule > now ? latestSchedule : now;
  const isAvailable = (candidate) => {
    const slot = localScheduleSlot(candidate, timeZone);
    const used = occupied.get(slot.day);
    return (!used || used.count < limit) && !used?.minutes.has(slot.minute);
  };
  if (latestSchedule) {
    const intervalCandidates = [];
    for (let gap = minimumPostGapMinutes; gap <= maximumPostGapMinutes; gap += 1) {
      const candidate = new Date(base.getTime() + gap * 60_000);
      if (candidate > now && isAvailable(candidate)) intervalCandidates.push(candidate);
    }
    if (intervalCandidates.length) return intervalCandidates[Math.floor(Math.random() * intervalCandidates.length)];
  }
  const firstDay = localScheduleSlot(base, timeZone).day;
  for (let offset = 0; offset <= 370; offset += 1) {
    const day = shiftLocalDate(firstDay, offset);
    const start = zonedLocalToDate(`${day}T00:00`, timeZone);
    const end = zonedLocalToDate(`${shiftLocalDate(day, 1)}T00:00`, timeZone);
    const dayMinutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
    const used = occupied.get(day) || { minutes: new Set(), times: [], count: 0 };
    if (used.count >= limit) continue;
    const earliestMinute = offset === 0
      ? Math.max(
        0,
        Math.floor((base.getTime() - start.getTime()) / 60_000) + 1,
        Math.ceil((now.getTime() + minimumFacebookScheduleLeadMinutes * 60_000 - start.getTime()) / 60_000)
      )
      : 0;
    const available = [];
    for (let minute = earliestMinute; minute < dayMinutes; minute += 1) {
      const candidate = new Date(start.getTime() + minute * 60_000);
      const slot = localScheduleSlot(candidate, timeZone);
      if (candidate > base && slot.day === day && !used.minutes.has(slot.minute)) available.push(candidate);
    }
    if (available.length) return available[Math.floor(Math.random() * available.length)];
  }
  throw new Error('Không tìm được khung giờ đăng còn trống trong 371 ngày tới.');
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
