import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { zipBundle } from './lib/index.js';

const rootPkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf-8'),
) as { name: string; version: string };
const fileName = `${rootPkg.name}-${rootPkg.version}`;

await zipBundle({
  distDirectory: resolve(import.meta.dirname, '..', '..', '..', 'dist'),
  buildDirectory: resolve(import.meta.dirname, '..', '..', '..', 'dist-zip'),
  archiveName: `${fileName}.zip`,
});
