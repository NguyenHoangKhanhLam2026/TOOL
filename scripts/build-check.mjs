import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from '../src/config.mjs';

const roots = ['src', 'packages', 'scripts', 'tests'];
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.mjs') || item.name.endsWith('.js')) files.push(full);
  }
}
for (const dir of roots) walk(path.join(ROOT, dir));
walk(path.join(ROOT, 'public'));
const unique = [...new Set(files)];
let failed = false;
for (const file of unique) {
  try { new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file }); }
  catch (error) { failed = true; console.error(`\n${path.relative(ROOT, file)}\n${error.message}`); }
}
if (failed) process.exitCode = 1;
else console.log(`Kiểm tra cú pháp thành công: ${unique.length} tệp JavaScript.`);
