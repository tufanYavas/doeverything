import setRelatedLocaleImports from './set-related-locale-import.js';
import { IS_DEV } from '@doeverything/env';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Locale build pipeline.
 *
 *   1. Copy the active i18n implementation (dev/prod) into `lib/i18n.ts`.
 *   2. Merge every non-en locale (in the source tree) with the en
 *      superset. Translators only need to provide the keys they've
 *      localised; the rest fall back to the English message. Without this
 *      step, Chrome would silently fall back to `default_locale` (en) but
 *      our TypeScript types would complain when set-related-locale-import
 *      wires a partial locale into the dev import â€” that's what was
 *      breaking the i18n build before.
 *   3. Copy the (now-complete) `locales/` into `dist/_locales/` so Chrome's
 *      i18n picks them up.
 *   4. In dev mode, set the `localeJSON` import in `lib/i18n.ts` to the
 *      user's UI locale.
 */

(() => {
  const i18nPath = IS_DEV ? 'lib/i18n-dev.ts' : 'lib/i18n-prod.ts';
  cpSync(i18nPath, resolve('lib', 'i18n.ts'));

  const sourceLocalesDir = resolve('locales');
  const en = JSON.parse(readFileSync(resolve(sourceLocalesDir, 'en', 'messages.json'), 'utf-8')) as Record<
    string,
    { description?: string; message: string; placeholders?: unknown }
  >;

  for (const langDir of readdirSync(sourceLocalesDir)) {
    if (langDir === 'en') continue;
    const filePath = resolve(sourceLocalesDir, langDir, 'messages.json');
    if (!existsSync(filePath)) continue;
    let raw: Record<string, { description?: string; message: string; placeholders?: unknown }>;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      continue;
    }
    let mutated = false;
    for (const key of Object.keys(en)) {
      if (!raw[key]) {
        raw[key] = en[key];
        mutated = true;
      }
    }
    if (mutated) {
      writeFileSync(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    }
  }

  const outDir = resolve(import.meta.dirname, '..', '..', '..', '..', 'dist');
  if (!existsSync(outDir)) mkdirSync(outDir);
  const distLocalesDir = resolve(outDir, '_locales');
  cpSync(sourceLocalesDir, distLocalesDir, { recursive: true });

  if (IS_DEV) setRelatedLocaleImports();
  console.log('I18n build complete');
})();
