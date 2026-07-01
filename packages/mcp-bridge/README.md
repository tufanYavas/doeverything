# @doeverything/mcp-bridge

Stdio adapter that connects any stdio MCP client (Claude Code, Cursor, VS Code, Zed, …) to the doeverything Chrome extension over a local WebSocket — no Cloudflare account needed.

```
MCP Client ──stdio──▶ [mcp-bridge] ◀──WebSocket── Chrome Extension
```

> **HTTP-based clients** (claude.ai web, ChatGPT, …) connect directly to the relay at `relay.doeverythi.ng` — no bridge needed. The connector URL is shown in the extension side panel under **MCP connection**.

---

## Quick start

### 1. Add to your MCP client config

```json
{
  "mcpServers": {
    "doeverything": {
      "command": "npx",
      "args": ["-y", "@doeverything/mcp-bridge"]
    }
  }
}
```

This starts a local server on `http://localhost:49463` by default.

### 2. Point the extension at the bridge

Open the extension's **Options → MCP connection** → set **Relay base URL** to `http://localhost:49463` → click **Save**.

No rebuild required. The extension reconnects immediately.

> **First launch:** On the very first connection attempt the extension may log a `ERR_CONNECTION_REFUSED` error. This is expected — `npx` takes a few seconds to start the bridge, and the extension tries to connect before it's ready. The extension retries automatically and connects once the bridge is up. Subsequent launches are faster because `npx` caches the package locally.

---

## Custom port

```json
{
  "args": ["-y", "@doeverything/mcp-bridge", "--port", "4000"]
}
```

Then set `http://localhost:4000` in Options → MCP connection → Relay base URL.

---

## CLI reference

```
Options:
  --port <n>   Port for local server (default: 49463)
  --help       Show help
```
