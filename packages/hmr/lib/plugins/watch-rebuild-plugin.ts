import { BUILD_COMPLETE, LOCAL_RELOAD_SOCKET_URL } from '../consts.js';
import MessageInterpreter from '../interpreter/index.js';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginConfigType } from '../types.js';
import type { PluginOption } from 'vite';

const injectionsPath = resolve(import.meta.dirname, '..', 'injections');

const refreshCode = readFileSync(resolve(injectionsPath, 'refresh.js'), 'utf-8');
const reloadCode = readFileSync(resolve(injectionsPath, 'reload.js'), 'utf-8');

export const watchRebuildPlugin = (config: PluginConfigType): PluginOption => {
  const { refresh, reload, id: _id, onStart } = config;
  const hmrCode = (refresh ? refreshCode : '') + (reload ? reloadCode : '');

  let ws: WebSocket | null = null;
  let connecting = false;
  let pendingNotify = false;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;

  const id = _id ?? Math.random().toString(36);

  const initializeWebSocket = (): Promise<void> =>
    new Promise(resolvePromise => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        resolvePromise();
        return;
      }
      if (connecting) {
        resolvePromise();
        return;
      }
      connecting = true;

      const socket = new WebSocket(LOCAL_RELOAD_SOCKET_URL);
      ws = socket;

      socket.on('open', () => {
        connecting = false;
        console.log(`[HMR] (${id}) connected to dev-server`);
        resolvePromise();
      });

      socket.on('error', () => {
        // İlk bağlantı denemesinde sunucu hazır değilse — turbo dev sunucuyu
        // birkaç saniye sonra başlatır. Sonsuz arka plan retry yerine,
        // bir sonraki closeBundle'da yeniden deneriz.
        connecting = false;
        ws = null;
        resolvePromise();
      });

      socket.on('close', () => {
        if (ws === socket) ws = null;
        connecting = false;
      });
    });

  const sendBuildComplete = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(MessageInterpreter.send({ type: BUILD_COMPLETE, id }));
      return true;
    } catch {
      return false;
    }
  };

  const scheduleNotify = () => {
    pendingNotify = true;
    if (notifyTimer) return;
    // Debounce: turbo monorepo'da bir dosya değişimi birden fazla paketin
    // ardışık `closeBundle`'ını tetikleyebilir. Hepsini tek bir
    // BUILD_COMPLETE'e indirgeyerek arka arkaya `chrome.runtime.reload`
    // tetiklemesini önlüyoruz — bu, Chrome'un MV3 service worker'ı
    // disable etmesinin (ve bazı sürümlerde browser'ın çökmesinin) ana
    // sebebiydi.
    notifyTimer = setTimeout(async () => {
      notifyTimer = null;
      if (!pendingNotify) return;
      pendingNotify = false;

      await initializeWebSocket();
      if (!sendBuildComplete()) {
        // Bağlantı kurulamadıysa, bir sonraki closeBundle'da tekrar denenir.
      }
    }, 200);
  };

  return {
    name: 'watch-rebuild',
    closeBundle() {
      onStart?.();
      scheduleNotify();
    },
    generateBundle(_options, bundle) {
      // HMR client kodunu SADECE entry chunk'a enjekte et. Aksi halde her
      // shared chunk kendi WebSocket'ini açıp kendi reload'unu tetikliyor;
      // bu da background için aynı build içinde 5-10 ardışık
      // `chrome.runtime.reload()` çağrısına yol açıp Chrome'u kilitliyordu.
      for (const module of Object.values(bundle)) {
        if (module.type === 'chunk' && module.isEntry) {
          module.code = `(function() {let __HMR_ID = "${id}";\n` + hmrCode + '\n' + '})();' + '\n' + module.code;
        }
      }
    },
  };
};
