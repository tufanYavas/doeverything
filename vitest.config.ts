import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config for the doeverything monorepo.
 *
 * Projects, split by environment and framework:
 *
 *   - `node`    — pure logic and Chrome-API-backed background code.
 *   - `dom`     — React components, hooks, zustand store, and React integration tests.
 *   - `angular` — Angular integration tests for dom-processor (isolated deps in
 *                 tests/angular-integration/package.json).
 *   - `vue`     — Vue integration tests for dom-processor (isolated deps in
 *                 tests/vue-integration/package.json).
 *
 * Framework testing libraries for Angular and Vue live only in their respective
 * test packages and are never installed in the root project.
 *
 * E2E (tests/e2e, WebdriverIO) is a separate world and is intentionally excluded.
 */
const root = __dirname;

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      // Side panel uses @src to reference its own source tree.
      '@src': resolve(root, 'pages/side-panel/src'),
      // Integration tests import dom-processor by package name; resolve to
      // source directly so Vite doesn't need a node_modules symlink.
      '@doeverything/dom-processor': resolve(root, 'packages/dom-processor/lib/index.ts'),
      // Resolve llm-providers from source so registry.ts changes are visible without a rebuild.
      '@doeverything/llm-providers': resolve(root, 'packages/llm-providers/index.mts'),
    },
  },
  test: {
    // Keep WebdriverIO e2e specs out of the unit runner.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          setupFiles: [resolve(root, 'tests/unit/setup/node.ts'), resolve(root, 'tests/unit/setup/chrome-mock.ts')],
          include: [
            'chrome-extension/src/**/*.test.ts',
            'packages/llm-providers/**/*.test.ts',
            'packages/storage/**/*.test.ts',
            'packages/shared/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          globals: true,
          setupFiles: [
            resolve(root, 'tests/unit/setup/chrome-mock.ts'),
            resolve(root, 'tests/unit/setup/dom.ts'),
          ],
          include: [
            'pages/**/*.test.ts',
            'pages/**/*.test.tsx',
            'packages/ui/**/*.test.ts',
            'packages/ui/**/*.test.tsx',
            // dom-processor manipulates real DOM nodes → needs happy-dom.
            'packages/dom-processor/**/*.test.ts',
            // Cross-package integration tests (React + dom-processor).
            'tests/integration/**/*.test.ts',
            'tests/integration/**/*.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'angular',
          environment: 'happy-dom',
          globals: true,
          setupFiles: [
            resolve(root, 'tests/unit/setup/chrome-mock.ts'),
            resolve(root, 'tests/angular-integration/setup.ts'),
          ],
          include: ['tests/angular-integration/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'vue',
          environment: 'happy-dom',
          globals: true,
          setupFiles: [
            resolve(root, 'tests/unit/setup/chrome-mock.ts'),
            resolve(root, 'tests/unit/setup/dom.ts'),
          ],
          include: ['tests/vue-integration/**/*.test.ts'],
        },
      },
    ],
  },
});
