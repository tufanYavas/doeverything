import { ManifestParser } from '@doeverything/dev-utils';
import { IS_DEV } from '@doeverything/env';
import { colorfulLog } from '@doeverything/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:process';
import { pathToFileURL } from 'node:url';
import type { ManifestType } from '@doeverything/shared';
import type { PluginOption } from 'vite';

const manifestFile = resolve(import.meta.dirname, '..', '..', 'manifest.js');
const refreshFilePath = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'hmr',
  'dist',
  'lib',
  'injections',
  'refresh.js',
);

const withHMRId = (code: string) => `(function() {let __HMR_ID = 'chrome-extension-hmr';${code}\n})();`;

const getManifestWithCacheBurst = async () => {
  const withCacheBurst = (path: string) => `${path}?${Date.now().toString()}`;

  /**
   * In Windows, import() doesn't work without file:// protocol.
   * So, we need to convert path to file:// protocol. (url.pathToFileURL)
   */
  if (platform === 'win32') {
    return (await import(withCacheBurst(pathToFileURL(manifestFile).href))).default;
  } else {
    return (await import(withCacheBurst(manifestFile))).default;
  }
};

export default (config: { outDir: string }): PluginOption => {
  const makeManifest = (manifest: ManifestType, to: string) => {
    if (!existsSync(to)) {
      mkdirSync(to);
    }

    const manifestPath = resolve(to, 'manifest.json');

    // Ã–NEMLÄ°: DEV mode'da `<all_urls>` matcher'lÄ± bir refresh content_script
    // ENJEKTE ETME. Eski kod bunu yapÄ±yordu ve kullanÄ±cÄ±nÄ±n aÃ§Ä±k her web
    // tab'Ä±na ve her iframe'ine refresh.js enjekte oluyordu â€” tek bir kod
    // kaydÄ±nda 30+ tab Ã— N iframe paralel `window.location.reload()` ve
    // V8 isolate spawning Chrome'un browser process'ini Ã§Ã¶kertiyordu.
    // Extension'Ä±n kendi page'leri (popup, side-panel, options, devtools,
    // new-tab vb.) refresh kodunu zaten kendi bundle'larÄ±ndan alÄ±r
    // (`watchRebuildPlugin({ refresh: true })` enjekte ediyor), yani bu
    // manifest manipÃ¼lasyonu gereksizdi.

    writeFileSync(manifestPath, ManifestParser.convertManifestToString(manifest));

    if (IS_DEV) {
      // refresh.js dosyasÄ±nÄ± dist'e yazmaya artÄ±k gerek yok (manifest'te
      // referans yok), ancak eski geliÅŸtirici alÄ±ÅŸkanlÄ±ÄŸÄ±nÄ± kÄ±rmamak iÃ§in
      // dosya hÃ¢lÃ¢ Ã¼retiliyor â€” yalnÄ±zca dosya, manifest'e iÃ§erik enjekte
      // EDÄ°LMÄ°YOR.
      const refreshFileString = readFileSync(refreshFilePath, 'utf-8');
      writeFileSync(resolve(to, 'refresh.js'), withHMRId(refreshFileString));
    }

    colorfulLog(`Manifest file copy complete: ${manifestPath}`, 'success');
  };

  return {
    name: 'make-manifest',
    buildStart() {
      this.addWatchFile(manifestFile);
    },
    async writeBundle() {
      const outDir = config.outDir;
      const manifest = await getManifestWithCacheBurst();
      makeManifest(manifest, outDir);
    },
  };
};
