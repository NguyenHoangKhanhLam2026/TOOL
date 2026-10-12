import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import './build-check.mjs';
// The runtime is JavaScript-only; this target verifies every module parses before launch.
console.log(`TypeScript is not used; parsed JavaScript modules under ${ROOT}.`);
