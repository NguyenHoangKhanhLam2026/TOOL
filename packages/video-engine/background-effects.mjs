export const BACKGROUND_EFFECTS = Object.freeze([
  { id: 'none', label: 'Tắt hiệu ứng', description: 'Giữ nền tĩnh' },
  { id: 'bubbles', label: 'Bong bóng trong', description: 'Bong bóng mờ trôi chậm' },
  { id: 'sparkles', label: 'Hạt sáng', description: 'Đốm sáng lấp lánh nhẹ' },
  { id: 'vocabulary', label: 'Chữ bay', description: 'Từ tiếng Anh mờ ở viền nền' },
  { id: 'waves', label: 'Sóng mềm', description: 'Đường sóng chuyển động ở hai mép' },
  { id: 'fireflies', label: 'Đom đóm', description: 'Đốm sáng vàng xanh trôi chậm' },
  { id: 'petals', label: 'Cánh hoa', description: 'Cánh nhỏ xoay và lững lờ rơi' },
  { id: 'rain', label: 'Mưa nhẹ', description: 'Vệt mưa mảnh, trong suốt' },
  { id: 'dust', label: 'Bụi mịn', description: 'Hạt bụi li ti bay trong ánh sáng' },
  { id: 'aurora', label: 'Cực quang dịu', description: 'Dải màu loang nhẹ hai bên nền' },
  { id: 'rings', label: 'Gợn vòng', description: 'Vòng tròn lan ra như gợn nước' }
]);

const EFFECT_IDS = new Set(BACKGROUND_EFFECTS.map((effect) => effect.id));
const VOCABULARY = Object.freeze(['hello', 'learn', 'speak', 'dream', 'grow', 'A2']);

export function normalizeBackgroundEffect(value) {
  return EFFECT_IDS.has(String(value || '')) ? String(value) : 'bubbles';
}

export function normalizeBackgroundEffectSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) ? Math.min(140, Math.max(25, Math.round(speed))) : 58;
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function random(seed, index, salt = '') {
  let value = hash(`${seed}:${index}:${salt}`);
  value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
  return value / 4294967296;
}

function mod(value, limit) { return ((value % limit) + limit) % limit; }
function edgeX(index, width, seed) {
  const side = random(seed, index, 'side') < 0.5 ? 1 : -1;
  return side > 0 ? 35 + random(seed, index, 'x') * width * 0.2 : width * 0.8 + random(seed, index, 'x') * width * 0.17;
}

function bubbleMarkup({ width, height, time, seed }) {
  return Array.from({ length: 46 }, (_, index) => {
    const radius = 13 + random(seed, index, 'radius') * 42;
    const x = mod(random(seed, index, 'x') * width + Math.sin(time * 0.34 + index) * 13, width);
    const y = mod(random(seed, index, 'y') * height - time * (13 + random(seed, index, 'speed') * 25), height);
    const opacity = 0.045 + random(seed, index, 'alpha') * 0.085;
    const color = random(seed, index, 'color') > 0.48 ? '#D98B65' : '#FFFFFF';
    return `<g opacity="${opacity.toFixed(3)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="url(#effectBubble)" stroke="${color}" stroke-opacity="0.8" stroke-width="2.2"/><ellipse cx="${(x - radius * 0.3).toFixed(1)}" cy="${(y - radius * 0.34).toFixed(1)}" rx="${(radius * 0.15).toFixed(1)}" ry="${(radius * 0.075).toFixed(1)}" fill="#FFFFFF" opacity="0.95"/></g>`;
  }).join('');
}

function sparklesMarkup({ width, height, time, seed }) {
  return Array.from({ length: 72 }, (_, index) => {
    const size = 5 + random(seed, index, 'size') * 9;
    const x = mod(random(seed, index, 'x') * width + Math.sin(time * 0.5 + index) * 6, width);
    const y = mod(random(seed, index, 'y') * height - time * (8 + random(seed, index, 'speed') * 18), height);
    const opacity = 0.06 + 0.18 * (0.5 + 0.5 * Math.sin(time * 2.3 + index * 1.7));
    const color = random(seed, index, 'color') > 0.48 ? '#D98B65' : '#FFFFFF';
    return `<path d="M${x.toFixed(1)} ${(y - size).toFixed(1)} Q${(x + size * 0.16).toFixed(1)} ${(y - size * 0.16).toFixed(1)} ${(x + size).toFixed(1)} ${y.toFixed(1)} Q${(x + size * 0.16).toFixed(1)} ${(y + size * 0.16).toFixed(1)} ${x.toFixed(1)} ${(y + size).toFixed(1)} Q${(x - size * 0.16).toFixed(1)} ${(y + size * 0.16).toFixed(1)} ${(x - size).toFixed(1)} ${y.toFixed(1)} Q${(x - size * 0.16).toFixed(1)} ${(y - size * 0.16).toFixed(1)} ${x.toFixed(1)} ${(y - size).toFixed(1)}Z" fill="${color}" opacity="${opacity.toFixed(3)}"/>`;
  }).join('');
}

function vocabularyMarkup({ width, height, time, seed }) {
  return Array.from({ length: 18 }, (_, index) => {
    const x = edgeX(index, width, seed);
    const y = mod(random(seed, index, 'y') * height - time * (9 + random(seed, index, 'speed') * 13), height);
    const size = 23 + random(seed, index, 'size') * 22;
    const rotation = (random(seed, index, 'rotate') - 0.5) * 18;
    const word = VOCABULARY[Math.floor(random(seed, index, 'word') * VOCABULARY.length)];
    const color = random(seed, index, 'color') > 0.5 ? '#17395D' : '#D98B65';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rotation.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${color}" opacity="0.11" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="${size.toFixed(1)}" font-weight="600">${word}</text>`;
  }).join('');
}

function wavesMarkup({ width, height, time, seed }) {
  const paths = [];
  for (const side of [0, 1]) {
    const sign = side === 0 ? 1 : -1;
    const start = side === 0 ? 0 : width;
    const base = side === 0 ? 0 : width;
    for (let lane = 0; lane < 7; lane += 1) {
      const phase = time * 0.34 + lane * 0.75 + random(seed, lane, `phase-${side}`) * 3;
      let d = '';
      for (let step = 0; step <= 20; step += 1) {
        const ratio = step / 20;
        const y = ratio * height;
        const envelope = Math.sin(Math.PI * ratio);
        const reach = (35 + lane * 17) * envelope;
        const x = base + sign * (reach + Math.sin(ratio * Math.PI * 5 + phase) * 15);
        d += `${step ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      }
      const color = lane % 2 ? '#D98B65' : '#FFFFFF';
      paths.push(`<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${(0.07 + random(seed, lane, 'wave-alpha') * 0.05).toFixed(3)}" stroke-width="${(2 + lane * 0.45).toFixed(1)}" stroke-linecap="round"/>`);
    }
  }
  return paths.join('');
}

function firefliesMarkup({ width, height, time, seed }) {
  return Array.from({ length: 36 }, (_, index) => {
    const baseX = random(seed, index, 'x') * width;
    const x = mod(baseX + Math.sin(time * 0.36 + index) * 28, width);
    const y = mod(random(seed, index, 'y') * height - time * (6 + random(seed, index, 'speed') * 12), height);
    const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 2 + index * 1.31));
    const color = random(seed, index, 'color') > 0.5 ? '#E6B36C' : '#DDE7A1';
    const radius = 4 + random(seed, index, 'radius') * 6;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius * 3.2).toFixed(1)}" fill="${color}" opacity="${(0.025 * pulse).toFixed(3)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="${(0.12 * pulse).toFixed(3)}"/>`;
  }).join('');
}

function petalsMarkup({ width, height, time, seed }) {
  return Array.from({ length: 26 }, (_, index) => {
    const x = mod(random(seed, index, 'x') * width + Math.sin(time * 0.42 + index) * 24, width);
    const y = mod(random(seed, index, 'y') * height + time * (9 + random(seed, index, 'speed') * 18), height);
    const rx = 7 + random(seed, index, 'rx') * 10;
    const ry = rx * (1.5 + random(seed, index, 'ry'));
    const rotate = random(seed, index, 'rotate') * 360 + time * 12;
    const fill = random(seed, index, 'color') > 0.55 ? '#D98B65' : '#F4D6B8';
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rotate.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}" opacity="0.12"/>`;
  }).join('');
}

function rainMarkup({ width, height, time, seed }) {
  return Array.from({ length: 90 }, (_, index) => {
    const x = mod(random(seed, index, 'x') * width + time * (28 + random(seed, index, 'drift') * 20), width);
    const y = mod(random(seed, index, 'y') * height + time * (150 + random(seed, index, 'speed') * 220), height);
    const length = 18 + random(seed, index, 'length') * 40;
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l-5 ${length.toFixed(1)}" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');
}

function dustMarkup({ width, height, time, seed }) {
  return Array.from({ length: 110 }, (_, index) => {
    const x = mod(random(seed, index, 'x') * width + Math.sin(time * 0.2 + index) * 8, width);
    const y = mod(random(seed, index, 'y') * height - time * (3 + random(seed, index, 'speed') * 10), height);
    const radius = 1 + random(seed, index, 'radius') * 3.4;
    const opacity = 0.08 + random(seed, index, 'alpha') * 0.14;
    const color = random(seed, index, 'color') > 0.5 ? '#D98B65' : '#FFFFFF';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(3)}"/>`;
  }).join('');
}

function auroraMarkup({ width, height, time, seed }) {
  const wave = Math.sin(time * 0.25) * 45;
  const right = width;
  return `<path d="M0 0 C${(width * 0.18 + wave).toFixed(1)} ${(height * 0.23).toFixed(1)} ${(width * 0.04).toFixed(1)} ${(height * 0.43).toFixed(1)} ${(width * 0.21).toFixed(1)} ${(height * 0.62).toFixed(1)} S${(width * 0.12).toFixed(1)} ${(height * 0.9).toFixed(1)} ${(width * 0.25).toFixed(1)} ${height} L0 ${height}Z" fill="url(#effectAuroraA)" opacity="0.20"/><path d="M${right} 0 C${(width * 0.78 - wave).toFixed(1)} ${(height * 0.2).toFixed(1)} ${(width * 0.98).toFixed(1)} ${(height * 0.45).toFixed(1)} ${(width * 0.8).toFixed(1)} ${(height * 0.65).toFixed(1)} S${(width * 0.91).toFixed(1)} ${(height * 0.91).toFixed(1)} ${(width * 0.74).toFixed(1)} ${height} L${right} ${height}Z" fill="url(#effectAuroraB)" opacity="0.17"/>`;
}

function ringsMarkup({ width, height, time, seed }) {
  return Array.from({ length: 17 }, (_, index) => {
    const x = edgeX(index, width, seed);
    const y = random(seed, index, 'y') * height;
    const phase = mod(time * (22 + random(seed, index, 'speed') * 26) + random(seed, index, 'phase') * 130, 130);
    const opacity = 0.11 * (1 - phase / 130);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${phase.toFixed(1)}" fill="none" stroke="${index % 2 ? '#D98B65' : '#FFFFFF'}" stroke-opacity="${opacity.toFixed(3)}" stroke-width="3"/>`;
  }).join('');
}

export function renderBackgroundEffectMarkup(effectId, { width = 1080, height = 1920, time = 0, seed = 'preview', speed = 58 } = {}) {
  const effect = normalizeBackgroundEffect(effectId);
  if (effect === 'none') return '';
  const speedMultiplier = normalizeBackgroundEffectSpeed(speed) / 58;
  const context = { width, height, time: Math.max(0, Number(time) || 0) * speedMultiplier, seed: String(seed || 'preview') };
  const bodies = {
    bubbles: bubbleMarkup,
    sparkles: sparklesMarkup,
    vocabulary: vocabularyMarkup,
    waves: wavesMarkup,
    fireflies: firefliesMarkup,
    petals: petalsMarkup,
    rain: rainMarkup,
    dust: dustMarkup,
    aurora: auroraMarkup,
    rings: ringsMarkup
  };
  const body = bodies[effect]?.(context) || '';
  return `<g class="background-effect background-effect-${effect}" pointer-events="none"><defs><radialGradient id="effectBubble"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.84"/><stop offset="0.66" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="1" stop-color="#D98B65" stop-opacity="0.05"/></radialGradient><linearGradient id="effectAuroraA" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#D8E9C8"/><stop offset=".62" stop-color="#D6E9E5" stop-opacity=".52"/><stop offset="1" stop-color="#D8E9C8" stop-opacity="0"/></linearGradient><linearGradient id="effectAuroraB" x1="1" x2="0" y1="0" y2="0"><stop stop-color="#E1E9D0"/><stop offset=".58" stop-color="#D6E8E8" stop-opacity=".5"/><stop offset="1" stop-color="#D6E8E8" stop-opacity="0"/></linearGradient></defs>${body}</g>`;
}
