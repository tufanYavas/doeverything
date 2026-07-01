import globalConfig from '@doeverything/tailwindcss-config';
import type { Config } from 'tailwindcss';

export default {
  content: ['lib/**/*.tsx'],
  presets: [globalConfig],
} satisfies Config;
