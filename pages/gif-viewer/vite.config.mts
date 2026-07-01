import { resolve } from 'node:path';
import { withPageConfig } from '@doeverything/vite-config';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');

export default withPageConfig({
  resolve: { alias: { '@src': srcDir } },
  build: { outDir: resolve(rootDir, '..', '..', 'dist', 'gif-viewer') },
});
