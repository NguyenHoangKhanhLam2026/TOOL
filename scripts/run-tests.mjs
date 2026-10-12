import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(ROOT, 'tests');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.name.endsWith('.test.mjs')) files.push(file);
  }
}
walk(testRoot);
files.sort((a, b) => a.localeCompare(b));
for (const file of files) await import(pathToFileURL(file).href);
if (!files.length) throw new Error('Không tìm thấy test file.');
