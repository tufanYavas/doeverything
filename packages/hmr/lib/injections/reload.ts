import initClient from '../initializers/init-client.js';

(() => {
  let reloading = false;

  // MV3'te `chrome.debugger` ile attach edilmiş bir tab varken
  // `chrome.runtime.reload()` çağrılırsa Chrome'un CDP backend'i orphaned
  // target'larla baş edemiyor — renderer/browser process çöküyor.
  // Reload'dan önce kendi attach ettiğimiz tüm session'ları detach edip
  // Chrome'a temizlik için kısa bir süre veriyoruz.
  const detachAllDebuggerSessions = async (): Promise<void> => {
    const dbg: typeof chrome.debugger | undefined =
      typeof chrome !== 'undefined' ? chrome.debugger : undefined;
    if (!dbg || typeof dbg.getTargets !== 'function') return;

    let targets: chrome.debugger.TargetInfo[] = [];
    try {
      targets = await dbg.getTargets();
    } catch {
      return;
    }

    await Promise.all(
      targets
        .filter(t => t.attached && typeof t.tabId === 'number')
        .map(t =>
          dbg.detach({ tabId: t.tabId as number }).catch(() => {
            /* başka bir extension veya zaten detach */
          }),
        ),
    );
  };

  const reload = () => {
    if (reloading) return;
    reloading = true;

    // 1) Debugger detach (async)
    // 2) Kısa gecikme: aynı build'den birden fazla DO_UPDATE veya hızlı
    //    ardışık BUILD_COMPLETE tek bir reload'a kollabe olsun, ayrıca
    //    Chrome CDP backend'i temizliği bitirebilsin.
    void (async () => {
      try {
        await detachAllDebuggerSessions();
      } catch {
        /* noop */
      }
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch {
          /* uzantı zaten kapanıyor olabilir */
        }
      }, 200);
    })();
  };

  initClient({
    // @ts-expect-error That's because of the dynamic code loading
    id: __HMR_ID,
    onUpdate: reload,
  });
})();
