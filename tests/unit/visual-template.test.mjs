import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneSvg, readVisualTemplate, rasterizeScene, validateVisualTemplate, wrapText
} from '../../packages/video-engine/visual-template-engine.mjs';
const { default: sharp } = await import('sharp');

const script = {
  title: 'At the coffee shop',
  topic: 'Ordering a drink',
  dialogues: [
    { vietnamese: 'Cho mình một ly cà phê sữa đá, ít đường nhé.', english: 'Could I have an iced milk coffee with less sugar, please?', term: 'less sugar', meaningVi: 'ít đường' },
    { vietnamese: 'Bạn có thể cho thêm một ống hút không?', english: 'Could you add one more straw?', term: 'one more', meaningVi: 'thêm một cái nữa' },
    { vietnamese: 'Cảm ơn bạn, mình sẽ ngồi ở bàn gần cửa sổ.', english: 'Thanks, I will sit at the table by the window.', term: 'by the window', meaningVi: 'gần cửa sổ' }
  ]
};

test('V2 template keeps the branded 1080x1920 scene and all standard layers', () => {
  const template = readVisualTemplate();
  assert.equal(template.canvas.width, 1080);
  assert.equal(template.canvas.height, 1920);
  assert.equal(template.canvas.fps, 30);
  assert.equal(template.layers.length, 10);
  assert.equal(template.brand.pageName, 'Sinh ra để nói tiếng Anh');
  assert.doesNotThrow(() => validateVisualTemplate(template));
});

test('scene renderer selects the right dialogue states and escapes script text', async () => {
  const template = readVisualTemplate();
  const vi = await buildSceneSvg({ template, script, state: 'vietnamese', index: 0 });
  const en = await buildSceneSvg({ template, script, state: 'bilingual', index: 0 });
  const cta = await buildSceneSvg({ template, script, state: 'cta', index: 0 });
  assert.match(vi, /data-layer-id="vietnamese-card"/);
  assert.doesNotMatch(vi, /data-layer-id="english-card"/);
  assert.match(en, /data-layer-id="english-card"/);
  assert.match(cta, /data-layer-id="cta"/);
  const isolated = await buildSceneSvg({ template, script, state: 'bilingual', index: 0, includeBackground: false, includeLayers: ['english-card'] });
  assert.match(isolated, /data-layer-id="english-card"/);
  assert.doesNotMatch(isolated, /data-layer-id="background"|data-layer-id="vietnamese-card"/);
  const escaped = await buildSceneSvg({ template, script: { ...script, title: '<script>alert(1)</script>' }, state: 'intro' });
  assert.doesNotMatch(escaped, /<script>alert/);
  assert.match(escaped, /&lt;script&gt;/);
});

test('scene rasterizes as portrait PNG and wraps long Vietnamese dialogue', async () => {
  const template = readVisualTemplate();
  const png = await rasterizeScene({ template, script, state: 'bilingual', index: 0 });
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.ok(wrapText('Một câu hội thoại tiếng Việt dài để kiểm tra cách tự động xuống dòng trong thẻ nội dung.', 540, 48).length > 1);
});

test('template rejects wrong output dimensions and assets outside branding directory', () => {
  const template = structuredClone(readVisualTemplate());
  template.canvas.width = 720;
  assert.throws(() => validateVisualTemplate(template), /1080/);
  const unsafe = structuredClone(readVisualTemplate());
  unsafe.layers.find((layer) => layer.id === 'background').asset = '../private/token.png';
  assert.throws(() => validateVisualTemplate(unsafe), /assets\/branding/);
});
