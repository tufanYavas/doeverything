import { createInterface } from 'node:readline';
import type { LocalBridgeServer } from './local-server.mjs';

type Frame = Record<string, unknown>;

export async function runLocalBridge(server: LocalBridgeServer): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let frame: Frame;
    try { frame = JSON.parse(trimmed) as Frame; } catch { continue; }

    // Process concurrently — do NOT await here. This is critical so that
    // notifications/cancelled (and other notifications) can be processed
    // immediately even while a long-running tool call is in flight.
    void handleFrame(server, frame);
  }
}

async function handleFrame(server: LocalBridgeServer, frame: Frame): Promise<void> {
  try {
    const response = await server.forward(frame);
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    const id = frame['id'] ?? null;
    if (id !== null) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `Bridge error: ${msg}` } }) + '\n',
      );
    }
  }
}
