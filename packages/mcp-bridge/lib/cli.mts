#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runLocalBridge } from './bridge.mjs';

const HELP = `
doeverything MCP bridge — connects any stdio MCP client to your browser extension.

  npx @doeverything/mcp-bridge [--port 49463]

  The bridge starts a local server. Then go to extension Options → MCP connection
  → Relay base URL → http://localhost:<port> → Save. No rebuild required.

  MCP client config:
    {
      "mcpServers": {
        "doeverything": {
          "command": "npx",
          "args": ["-y", "@doeverything/mcp-bridge"]
        }
      }
    }

Options:
  --port <n>   Port for local server (default: 49463)
  --help       Show this message
`.trim();

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stderr.write(HELP + '\n');
  process.exit(0);
}

const port = values.port ? parseInt(values.port, 10) : 49463;
if (isNaN(port) || port < 1 || port > 65535) {
  process.stderr.write('Error: --port must be a valid port number (1–65535).\n');
  process.exit(1);
}

const { LocalBridgeServer } = await import('./local-server.mjs');
const server = new LocalBridgeServer();

try {
  await server.listen(port);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: could not start local server on port ${port}: ${msg}\n`);
  process.stderr.write(`Try a different port with --port <number>.\n`);
  process.exit(1);
}

process.stderr.write(`doeverything-mcp bridge listening on http://127.0.0.1:${server.port}\n`);
process.stderr.write(`Extension: Options → MCP connection → Relay base URL → http://localhost:${server.port} → Save\n`);

await runLocalBridge(server);
process.exit(0);
