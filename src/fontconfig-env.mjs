import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontConfigDirectory = path.join(root, 'tools', 'fontconfig');
const fontConfigFile = path.join(fontConfigDirectory, 'fonts.conf');

if (process.platform === 'win32' && fs.existsSync(fontConfigFile)) {
  process.env.FONTCONFIG_PATH = fontConfigDirectory;
  process.env.FONTCONFIG_FILE = fontConfigFile;
}
