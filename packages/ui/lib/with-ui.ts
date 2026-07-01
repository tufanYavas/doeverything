import globalConfig from '@doeverything/tailwindcss-config';
import deepmerge from 'deepmerge';
import type { Config } from 'tailwindcss';

/**
 * `withUI` is the single entry point page-level Tailwind configs use.
 * It adds:
 *   1. The shared doeverything preset (HSL design tokens, brand colors,
 *      animations, dark-mode strategy) defined in
 *      `packages/tailwindcss-config/tailwind.config.ts`.
 *   2. The `@doeverything/ui` library's component sources to `content` so any
 *      Tailwind class used inside `<Button>`, `<Card>`, etc. is included
 *      in the page's compiled CSS.
 */
export const withUI = (tailwindConfig: Config): Config =>
  deepmerge(
    {
      presets: [globalConfig],
      content: ['../../packages/ui/lib/**/*.tsx'],
    },
    tailwindConfig,
  );
