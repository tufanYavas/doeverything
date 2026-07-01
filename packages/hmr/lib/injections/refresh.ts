import initClient from '../initializers/init-client.js';

(() => {
  let pendingReload = false;
  let reloading = false;

  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    pendingReload = false;
    // Kısa gecikme: birden fazla chunk'tan gelen DO_UPDATE veya hızlı
    // ardışık build'ler tek bir reload'a kollabe olsun.
    setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        /* navigation engellenmiş olabilir */
      }
    }, 150);
  };

  initClient({
    // @ts-expect-error That's because of the dynamic code loading
    id: __HMR_ID,
    onUpdate: () => {
      if (document.hidden) {
        pendingReload = true;
        return;
      }
      reload();
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingReload) {
      reload();
    }
  });
})();
