import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import './build-check.mjs';
const publicFiles = fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true }).filter((item) => item.isFile()).map((item) => path.join(ROOT, 'public', item.name));
const css = publicFiles.filter((file) => file.endsWith('.css')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const html = publicFiles.filter((file) => file.endsWith('.html')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
if (/https?:\/\//.test(css) || /<script[^>]+src=["']https?:/i.test(html)) {
  console.error('Không cho phép tài nguyên frontend tải từ CDN bên ngoài.');
  process.exitCode = 1;
} else console.log('Kiểm tra tài nguyên frontend: không phụ thuộc CDN ngoài.');
