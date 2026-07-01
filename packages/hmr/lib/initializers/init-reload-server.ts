import {
  BUILD_COMPLETE,
  DO_UPDATE,
  DONE_UPDATE,
  LOCAL_RELOAD_SOCKET_PORT,
  LOCAL_RELOAD_SOCKET_URL,
} from '../consts.js';
import MessageInterpreter from '../interpreter/index.js';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

type ClientInfo = { alive: boolean };

const clients: Map<WebSocket, ClientInfo> = new Map();

// Background HMR id'si — bu id geldiğinde extension komple reload olur,
// yani open page'lerin ayrı window.location.reload() yapmasına gerek YOK
// (Chrome zaten hepsini kapatır). Page'lerin ayrıca reload olması Chrome
// browser process'inin IPC backend'inde CHECK panic'e yol açıyor.
const BACKGROUND_ID = 'chrome-extension-hmr';

// BUILD_COMPLETE coalescing/serialize: Tek bir dosya değişimi monorepo'da
// 10-15 paketin eşzamanlı rebuild'ini tetikleyebiliyor. Hepsini doğrudan
// fan-out edersek 15+ extension context (background + page'ler + content
// scriptler + iframe'ler) aynı anda reload olur ve Chrome'un IPC katmanı
// CrashForExceptionInNonABICompliantCodeRange ile çöküyor (browser ana
// process). Bu yüzden gelen ID'leri bir window'da topluyoruz, dedupe
// ediyoruz, sonra aralarında gecikmeli olarak gönderiyoruz.
const COALESCE_WINDOW_MS = 800;
const INTER_RELOAD_DELAY_MS = 250;

const pendingIds: Set<string> = new Set();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let dispatching = false;

const sendPayloadToClients = (payload: string, exclude?: WebSocket) => {
  for (const client of clients.keys()) {
    if (client === exclude) continue;
    if (client.readyState !== client.OPEN) continue;
    try {
      client.send(payload);
    } catch {
      clients.delete(client);
    }
  }
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const dispatchPending = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    while (pendingIds.size > 0) {
      const ids = [...pendingIds];
      pendingIds.clear();

      // Background varsa, page reload'larını bastır — extension reload
      // zaten tüm page'leri kapatır; ek page reload IPC patlamasına yol
      // açıyor.
      if (ids.includes(BACKGROUND_ID)) {
        const payload = MessageInterpreter.send({ type: DO_UPDATE, id: BACKGROUND_ID });
        sendPayloadToClients(payload);
        // Background reload Chrome'un kendisine yeterince yük; bir sonraki
        // batch için yeterli boşluk bırak.
        await sleep(1_000);
        continue;
      }

      // Sadece page id'leri varsa: sırayla, aralarında küçük gecikmeyle
      // gönder. Bu, popup/options/devtools vs. aynı anda reload olup
      // IPC patlatmasını engelliyor.
      for (const id of ids) {
        const payload = MessageInterpreter.send({ type: DO_UPDATE, id });
        sendPayloadToClients(payload);
        if (ids.length > 1) await sleep(INTER_RELOAD_DELAY_MS);
      }
    }
  } finally {
    dispatching = false;
  }
};

const enqueueBuildComplete = (id: string) => {
  pendingIds.add(id);
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    void dispatchPending();
  }, COALESCE_WINDOW_MS);
};

(() => {
  const wss = new WebSocketServer({ port: LOCAL_RELOAD_SOCKET_PORT });

  // Heartbeat: kopmuş/zombie bağlantıları temizle. MV3 service worker
  // askıya alındığında WebSocket OS-level "open" görünebiliyor.
  const heartbeat = setInterval(() => {
    for (const [ws, info] of clients.entries()) {
      if (!info.alive) {
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
        clients.delete(ws);
        continue;
      }
      info.alive = false;
      try {
        ws.ping();
      } catch {
        clients.delete(ws);
      }
    }
  }, 15_000);

  wss.on('listening', () => {
    console.log(`[HMR] Server listening at ${LOCAL_RELOAD_SOCKET_URL}`);
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  wss.on('connection', ws => {
    clients.set(ws, { alive: true });

    ws.on('pong', () => {
      const info = clients.get(ws);
      if (info) info.alive = true;
    });

    ws.addEventListener('close', () => {
      clients.delete(ws);
    });

    ws.addEventListener('error', () => {
      clients.delete(ws);
    });

    ws.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;

      let message: ReturnType<typeof MessageInterpreter.receive>;
      try {
        message = MessageInterpreter.receive(event.data);
      } catch {
        return;
      }

      if (message.type === DONE_UPDATE) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        clients.delete(ws);
        return;
      }

      if (message.type === BUILD_COMPLETE) {
        enqueueBuildComplete(message.id);
      }
    });
  });

  wss.on('error', (error: Error & { code: string }) => {
    if (error.code === 'EADDRINUSE') {
      console.info(`[HMR] Server already running at ${LOCAL_RELOAD_SOCKET_URL}, skipping reload server initialization`);
    } else {
      console.error(`[HMR] Failed to start server at ${LOCAL_RELOAD_SOCKET_URL}`);
      throw error;
    }
  });
})();
