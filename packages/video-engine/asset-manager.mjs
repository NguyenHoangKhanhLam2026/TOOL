import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, ROOT } from '../../src/config.mjs';
import { BRANDING_DIR, getTemplateAssetVersions, readVisualTemplate, resolveBrandingAsset, saveVisualTemplate } from './visual-template-engine.mjs';

const CATALOG_PATH = path.join(ROOT, 'assets', 'asset-catalog.json');
const UPLOAD_DIR = path.join(BRANDING_DIR, 'uploads');
const { default: sharp } = await import('sharp');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  const records = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return Array.isArray(records) ? records : [];
}

function writeCatalog(records) {
  const temp = `${CATALOG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, CATALOG_PATH);
}

function activeFile(template, type) {
  if (type === 'font') return template.brand.fontFile || 'fonts/BeVietnamPro-Regular.ttf';
  if (type === 'icon') return template.brand.iconFile || '';
  if (type === 'thumbnail') return template.brand.thumbnailFile || '';
  const layerId = type === 'background' ? 'background' : type === 'character' ? 'character' : 'logo';
  return template.layers.find((layer) => layer.id === layerId)?.asset || '';
}

function baseAssets(template) {
  return [
    { id: 'background-main', type: 'background', name: 'Nền chính', file: 'background-main.png', builtin: true },
    { id: 'background-warm', type: 'background', name: 'Nền ấm', file: 'background-warm.png', builtin: true },
    { id: 'background-cool', type: 'background', name: 'Nền mát', file: 'background-cool.png', builtin: true },
    { id: 'brand-logo', type: 'logo', name: 'Logo thương hiệu', file: 'brand-logo.png', builtin: true },
    { id: 'teacher-female', type: 'character', name: 'Nhân vật nữ', file: 'teacher-female.png', builtin: true },
    { id: 'font-regular', type: 'font', name: 'Be Vietnam Pro Regular', fontFamily: 'Be Vietnam Pro', file: 'fonts/BeVietnamPro-Regular.ttf', builtin: true },
    { id: 'font-semibold', type: 'font', name: 'Be Vietnam Pro SemiBold', fontFamily: 'Be Vietnam Pro', file: 'fonts/BeVietnamPro-SemiBold.ttf', builtin: true },
    { id: 'font-bold', type: 'font', name: 'Be Vietnam Pro Bold', fontFamily: 'Be Vietnam Pro', file: 'fonts/BeVietnamPro-Bold.ttf', builtin: true }
  ].map((item) => ({ ...item, isDefault: activeFile(template, item.type) === item.file, url: `/assets/branding/${item.file}` }));
}

export async function listAssets() {
  const template = readVisualTemplate();
  const records = [...baseAssets(template), ...readCatalog().map((record) => ({ ...record, builtin: false, url: `/assets/branding/${record.previewFile || record.file}` }))];
  for (const record of records) {
    const filePath = resolveBrandingAsset(record.file);
    if (!fs.existsSync(filePath)) { record.missing = true; continue; }
    try {
      const metadata = await sharp(filePath).metadata();
      if (metadata.width) record.width = metadata.width;
      if (metadata.height) record.height = metadata.height;
      if (metadata.hasAlpha !== undefined) record.hasAlpha = metadata.hasAlpha;
    } catch { /* Font and SVG records can omit raster metadata. */ }
  }
  return records;
}

function cleanFileName(value) {
  return path.basename(String(value || 'asset')).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'asset';
}

function validateSvg(buffer) {
  const text = buffer.toString('utf8').replace(/xmlns\s*=\s*(["'])https?:\/\/www\.w3\.org\/2000\/svg\1/ig, '');
  if (!/<svg\b/i.test(text) || /<script\b|<foreignObject\b|javascript:|https?:\/\//i.test(text)) throw new Error('SVG chỉ được chứa hình vector cục bộ, không có script hay liên kết ngoài.');
}

function checkFont(buffer) {
  const signature = buffer.subarray(0, 4).toString('binary');
  if (!(signature === '\u0000\u0001\u0000\u0000' || signature === 'OTTO' || signature === 'wOF2' || signature === 'true')) throw new Error('Tệp font không có chữ ký TTF/OTF/WOFF2 hợp lệ.');
}

export async function saveUploadedAsset({ type, fileName, mimeType, buffer, fontFamily }) {
  if (!['background', 'character', 'logo', 'font', 'icon', 'thumbnail'].includes(type)) throw new Error('Loại asset không được hỗ trợ.');
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > 15 * 1024 * 1024) throw new Error('Tệp phải có dung lượng từ 64 byte đến 15 MB.');
  const cleanName = cleanFileName(fileName);
  const ext = path.extname(cleanName).toLowerCase();
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = readCatalog().find((record) => record.sha256 === hash);
  if (existing) return { ...existing, duplicate: true };
  const builtin = baseAssets(readVisualTemplate()).find((item) => {
    const absolute = resolveBrandingAsset(item.file);
    return fs.existsSync(absolute) && crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') === hash;
  });
  if (builtin) return { ...builtin, sha256: hash, bytes: buffer.length, duplicate: true };

  let file;
  let previewFile = null;
  let width = null; let height = null; let hasAlpha = null;
  if (type === 'font') {
    if (!['.ttf', '.otf', '.woff2'].includes(ext)) throw new Error('Font chỉ nhận TTF, OTF hoặc WOFF2.');
    checkFont(buffer);
    file = `fonts/uploads/${hash.slice(0, 16)}${ext}`;
    const absolute = resolveBrandingAsset(file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer, { flag: 'wx' });
  } else if (ext === '.svg' && ['logo', 'icon'].includes(type)) {
    validateSvg(buffer);
    const svgFile = `uploads/${type}-${hash.slice(0, 16)}.svg`;
    const pngFile = `uploads/${type}-${hash.slice(0, 16)}.png`;
    const svgPath = resolveBrandingAsset(svgFile);
    const pngPath = resolveBrandingAsset(pngFile);
    fs.writeFileSync(svgPath, buffer, { flag: 'wx' });
    await sharp(buffer, { density: 160 }).resize({ width: 960, height: 420, fit: 'inside', withoutEnlargement: true }).png().toFile(pngPath);
    file = svgFile; previewFile = pngFile;
  } else {
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Ảnh chỉ nhận PNG, JPG hoặc WebP.');
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000) throw new Error('Không đọc được kích thước ảnh hoặc kích thước vượt quá 10000 px.');
    if (type === 'background' && (metadata.width < 540 || metadata.height < 960)) throw new Error('Ảnh nền cần tối thiểu 540×960 pixels.');
    if (type === 'character' && (metadata.width < 256 || metadata.height < 256)) throw new Error('Nhân vật cần tối thiểu 256×256 pixels.');
    file = `uploads/${type}-${hash.slice(0, 16)}.png`;
    previewFile = file;
    const absolute = resolveBrandingAsset(file);
    await sharp(buffer).png({ compressionLevel: 9 }).toFile(absolute);
    const converted = await sharp(absolute).metadata();
    width = converted.width; height = converted.height; hasAlpha = Boolean(converted.hasAlpha);
    previewFile = `uploads/previews/${type}-${hash.slice(0, 16)}.png`;
    const previewPath = resolveBrandingAsset(previewFile);
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    await sharp(absolute).resize({ width: 480, height: 800, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(previewPath);
  }
  const record = {
    id: `${type}-${hash.slice(0, 16)}`, type, name: cleanName, file, previewFile,
    mimeType: mimeType || 'application/octet-stream', bytes: buffer.length, sha256: hash,
    width, height, hasAlpha, fontFamily: type === 'font' ? String(fontFamily || path.parse(cleanName).name).slice(0, 100) : null,
    createdAt: new Date().toISOString(), isDefault: false
  };
  const records = readCatalog(); records.push(record); writeCatalog(records);
  return record;
}

export function setDefaultAsset(id) {
  const template = readVisualTemplate();
  const record = [...baseAssets(template), ...readCatalog()].find((asset) => asset.id === id);
  if (!record) throw new Error('Không tìm thấy asset.');
  const activePath = record.file;
  if (record.type === 'font') {
    template.brand.fontFamily = record.fontFamily || 'Be Vietnam Pro';
    template.brand.fontFile = record.file;
  } else {
    const layerId = record.type === 'background' ? 'background' : record.type === 'character' ? 'character' : record.type === 'logo' ? 'logo' : null;
    if (layerId) template.layers.find((layer) => layer.id === layerId).asset = activePath;
    else if (record.type === 'icon') template.brand.iconFile = activePath;
    else if (record.type === 'thumbnail') template.brand.thumbnailFile = activePath;
    else throw new Error('Asset này chưa thể gắn vào layer mặc định.');
  }
  const saved = saveVisualTemplate(template);
  const active = activeFile(saved, record.type);
  const catalog = readCatalog().map((item) => item.type === record.type ? { ...item, isDefault: item.file === active || item.previewFile === active } : item);
  writeCatalog(catalog);
  return { ...record, isDefault: true };
}

function manifestReferences(fileName) {
  const outputs = PATHS.output;
  if (!fs.existsSync(outputs)) return false;
  for (const item of fs.readdirSync(outputs, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const manifestPath = path.join(outputs, item.name, 'render-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.assetVersions?.some((asset) => asset.file === fileName)) return true;
    } catch { /* An invalid old manifest does not block unrelated cleanup. */ }
  }
  return false;
}

export function deleteAsset(id) {
  const records = readCatalog();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('Chỉ có thể xóa asset đã tải lên.');
  const template = readVisualTemplate();
  if (activeFile(template, record.type) === record.file || activeFile(template, record.type) === record.previewFile) throw new Error('Không thể xóa asset đang đặt mặc định. Hãy chuyển mặc định trước.');
  if (manifestReferences(record.file) || (record.previewFile && manifestReferences(record.previewFile))) throw new Error('Asset đã được dùng trong video đã render và được giữ để có thể dựng lại.');
  for (const file of new Set([record.file, record.previewFile].filter(Boolean))) {
    const absolute = resolveBrandingAsset(file);
    if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
  }
  writeCatalog(records.filter((item) => item.id !== id));
  return { deleted: true, id };
}

export function resetBrandAssets() {
  const templatePath = path.join(BRANDING_DIR, 'visual-template-default.json');
  if (!fs.existsSync(templatePath)) throw new Error('Thiếu template thương hiệu gốc.');
  const template = saveVisualTemplate(JSON.parse(fs.readFileSync(templatePath, 'utf8')));
  const defaults = baseAssets(template);
  const active = new Map(['background', 'character', 'logo', 'font'].map((type) => [type, activeFile(template, type)]));
  writeCatalog(readCatalog().map((record) => ({ ...record, isDefault: active.get(record.type) === record.file || active.get(record.type) === record.previewFile })));
  return { template, defaults: defaults.map(({ id, type, file }) => ({ id, type, file })) };
}

export function assetCatalogPath() { return CATALOG_PATH; }
export { getTemplateAssetVersions };
