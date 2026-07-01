import type { Plugin } from 'vite';

/**
 * Wraps the given JS code string in an outer arrow-function IIFE.
 *
 * esbuild emits helper variables (e.g. `var ve`, `var ye`) outside the
 * lib-mode IIFE, leaking them into the global scope. Sites like Wikipedia
 * define `window.ve` as an object (VisualEditor namespace), overwriting our
 * helper and crashing the content script. This wrapper scopes every helper
 * to the closure without affecting the content script's own API surface.
 */
export function wrapInIife(code: string): string {
  return `(()=>{\n${code}\n})();`;
}

/**
 * Vite plugin that post-processes every chunk by wrapping it in an outer
 * IIFE. Apply only in production builds (esbuild minification is what
 * triggers the global helper-variable leak).
 */
export function scopeIifeHelpersPlugin(): Plugin {
  return {
    name: 'scope-iife-helpers',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const key in bundle) {
        const chunk = bundle[key];
        if (chunk.type === 'chunk') {
          chunk.code = wrapInIife(chunk.code);
        }
      }
    },
  };
}
