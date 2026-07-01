import { DO_UPDATE, DONE_UPDATE, LOCAL_RELOAD_SOCKET_URL } from '../consts.js';
import MessageInterpreter from '../interpreter/index.js';

export default ({ id, onUpdate }: { id: string; onUpdate: () => void }) => {
  let ws: WebSocket | null = null;
  let didFire = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (didFire) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    try {
      ws = new WebSocket(LOCAL_RELOAD_SOCKET_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      attempt = 0;
    });

    ws.addEventListener('message', event => {
      if (didFire) return;
      let message: ReturnType<typeof MessageInterpreter.receive>;
      try {
        message = MessageInterpreter.receive(String(event.data));
      } catch {
        return;
      }

      if (message.type === DO_UPDATE && message.id === id) {
        // Tek seferlik: aynı build için ikinci DO_UPDATE veya başka bir
        // chunk'tan gelen tetikleme reload'u tekrar çağırmasın.
        didFire = true;
        try {
          ws?.send(MessageInterpreter.send({ type: DONE_UPDATE }));
        } catch {
          /* server zaten kapanmış olabilir */
        }
        try {
          ws?.close();
        } catch {
          /* noop */
        }
        ws = null;
        onUpdate();
      }
    });

    ws.addEventListener('close', () => {
      ws = null;
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      ws = null;
      scheduleReconnect();
    });
  };

  const scheduleReconnect = () => {
    if (didFire || reconnectTimer) return;
    // Exponential backoff: 500ms → 1s → 2s → 4s → cap 5s.
    const delay = Math.min(500 * 2 ** attempt, 5_000);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();
};
