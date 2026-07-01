import { resolve } from 'node:path';
import { makeEntryPointPlugin } from '@doeverything/hmr';
import { getContentScriptEntries, withPageConfig } from '@doeverything/vite-config';
import { IS_DEV } from '@doeverything/env';
import { build } from 'vite';
import { scopeIifeHelpersPlugin } from './src/plugins/scope-iife-helpers.js';

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, 'src');
const matchesDir = resolve(srcDir, 'matches');

const configs = Object.entries(getContentScriptEntries(matchesDir)).map(([name, entry]) =>
  withPageConfig({
    mode: IS_DEV ? 'development' : undefined,
    resolve: {
      alias: {
        '@src': srcDir,
      },
    },
    publicDir: resolve(rootDir, 'public'),
    plugins: [IS_DEV && makeEntryPointPlugin(), scopeIifeHelpersPlugin()],
    build: {
      lib: {
        name: name,
        formats: ['iife'],
        entry,
        fileName: name,
      },
      outDir: resolve(rootDir, '..', '..', 'dist', 'content'),
      // All content scripts share the same outDir. The default
      // `emptyOutDir: IS_PROD` from withPageConfig wipes dist/content/
      // on every build, leaving only the last-written .iife.js. We must
      // never empty the dir here â€” each build adds its own file.
      emptyOutDir: false,
    },
  }),
);

// Run builds sequentially: parallel `await Promise.all(...)` over Vite
// `build()` calls all targeting the same outDir races on Windows â€” the
// last finisher's lib-mode bundle ends up alone in dist/content/, with
// every other entry deleted. Serial execution guarantees all .iife.js
// files survive in dist/content/.
for (const config of configs) {
  //@ts-expect-error This is hidden property into vite's resolveConfig()
  config.configFile = false;
  await build(config);
}
