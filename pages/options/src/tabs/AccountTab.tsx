import { useStorage } from '@doeverything/shared';
import { connectionStorage } from '@doeverything/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@doeverything/ui';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Plug,
  RotateCw,
  Unplug,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const DEFAULT_RELAY_URL: string = process.env['DOE_RELAY_BASE_URL'] || '';

// ─── Platform guide ──────────────────────────────────────────────────────────

type PlatformId =
  | 'claude-web'
  | 'claude-desktop'
  | 'claude-code'
  | 'chatgpt'
  | 'mistral'
  | 'gemini-cli'
  | 'codex'
  | 'amazonq'
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'cline'
  | 'continue'
  | 'zed'
  | 'jetbrains'
  | 'lmstudio'
  | 'jan'
  | 'raycast'
  | 'librechat'
  | 'anythingllm'
  | 'openwebui';

const PLATFORMS: Array<{ id: PlatformId; label: string; plan?: string; group: string }> = [
  // ── AI chats ─────────────────────────────────────────────────────────────────
  { id: 'claude-web', label: 'claude.ai', plan: 'Pro/Max', group: 'AI chats' },
  { id: 'chatgpt', label: 'ChatGPT', plan: 'Plus+', group: 'AI chats' },
  { id: 'mistral', label: 'Mistral', group: 'AI chats' },
  // ── Code editors / extensions / CLIs ─────────────────────────────────────────
  { id: 'claude-code', label: 'Claude Code', group: 'Editors' },
  { id: 'cursor', label: 'Cursor', group: 'Editors' },
  { id: 'windsurf', label: 'Windsurf', group: 'Editors' },
  { id: 'vscode', label: 'VS Code', plan: 'Copilot', group: 'Editors' },
  { id: 'cline', label: 'Cline', group: 'Editors' },
  { id: 'continue', label: 'Continue', group: 'Editors' },
  { id: 'zed', label: 'Zed', group: 'Editors' },
  { id: 'jetbrains', label: 'JetBrains', group: 'Editors' },
  { id: 'gemini-cli', label: 'Gemini CLI', group: 'Editors' },
  { id: 'codex', label: 'Codex', group: 'Editors' },
  { id: 'amazonq', label: 'Amazon Q', group: 'Editors' },
  // ── Desktop AI apps ──────────────────────────────────────────────────────────
  { id: 'claude-desktop', label: 'Claude Desktop', group: 'Desktop apps' },
  { id: 'lmstudio', label: 'LM Studio', group: 'Desktop apps' },
  { id: 'jan', label: 'Jan', group: 'Desktop apps' },
  { id: 'raycast', label: 'Raycast', plan: 'Mac', group: 'Desktop apps' },
  // ── Self-hosted ───────────────────────────────────────────────────────────────
  { id: 'librechat', label: 'LibreChat', group: 'Self-hosted' },
  { id: 'anythingllm', label: 'AnythingLLM', group: 'Self-hosted' },
  { id: 'openwebui', label: 'Open WebUI', group: 'Self-hosted' },
];

// ─── AccountTab ──────────────────────────────────────────────────────────────

export function AccountTab() {
  const connection = useStorage(connectionStorage);
  const isConnected = connection.status === 'connected';
  const connectorUrl =
    connection.token && connection.relayBaseUrl
      ? `${connection.relayBaseUrl}/mcp/${connection.token}`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Connection</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          doeverything exposes its browser tools as an MCP server. Pair an MCP client with the
          connector URL below and the client runs the model, billed on its own plan. Prefer a direct
          API key instead? Configure it on the LLM tab.
        </p>
      </div>

      <McpConnectionCard
        token={connection.token}
        relayBaseUrl={connection.relayBaseUrl}
        status={connection.status}
        lastError={connection.lastError}
        isConnected={isConnected}
        connectorUrl={connectorUrl}
      />

      <ConnectorGuideCard connectorUrl={connectorUrl} />
    </div>
  );
}

// ─── McpConnectionCard ───────────────────────────────────────────────────────

interface McpConnectionCardProps {
  token: string | null;
  relayBaseUrl: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError: string | null;
  isConnected: boolean;
  connectorUrl: string | null;
}

const isLocalUrl = (url: string | null) =>
  !!url && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);

function McpConnectionCard({
  token,
  relayBaseUrl,
  status,
  lastError,
  isConnected,
  connectorUrl,
}: McpConnectionCardProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isLocal = isLocalUrl(connectorUrl);
  const isConnecting = busy || status === 'connecting';
  const [relayDraft, setRelayDraft] = useState(relayBaseUrl ?? DEFAULT_RELAY_URL);

  useEffect(() => {
    setRelayDraft(relayBaseUrl ?? DEFAULT_RELAY_URL);
  }, [relayBaseUrl]);

  const send = async (type: string) => {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ type });
    } finally {
      setBusy(false);
    }
  };

  const onCopy = () => {
    if (!connectorUrl) return;
    void navigator.clipboard.writeText(connectorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onSaveRelay = async () => {
    const trimmed = relayDraft.trim();
    await connectionStorage.setRelayBaseUrl(trimmed || null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="text-primary h-4 w-4" /> MCP connection
          <StatusBadge status={status} />
        </CardTitle>
        <CardDescription>
          Pair any MCP client with this extension using the connector URL below. The client runs the
          model and only calls doeverything's browser tools; its subscription quota is what's billed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="relay-url">Relay base URL</Label>
          <div className="flex gap-2">
            <Input
              id="relay-url"
              value={relayDraft}
              placeholder={DEFAULT_RELAY_URL || 'https://relay.your-domain.com'}
              onChange={e => setRelayDraft(e.target.value)}
              className="flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={onSaveRelay}>
              Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Leave blank to use the default ({DEFAULT_RELAY_URL || 'build-time default'}).
          </p>
        </div>

        {!isLocal && (connectorUrl ? (
          <div className="space-y-2">
            <Label>Connector URL</Label>
            <div className="border-border/70 bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2">
              <code
                className={cn(
                  'text-foreground/90 flex-1 truncate font-mono text-xs transition-all',
                  !revealed && 'blur-md select-none',
                )}>
                {connectorUrl}
              </code>
              <button
                type="button"
                onClick={() => setRevealed(r => !r)}
                aria-label={revealed ? 'Hide URL' : 'Reveal URL'}
                className="text-muted-foreground hover:text-foreground rounded p-1">
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={onCopy}
                aria-label="Copy connector URL"
                className="text-muted-foreground hover:text-foreground rounded p-1">
                {copied ? (
                  <Check className="text-success h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Paste this URL into your MCP client. See the <strong>How to connect</strong> guide
              below for platform-specific steps.
            </p>
          </div>
        ) : (
          <div className="border-warning/25 bg-warning/10 text-warning rounded-lg border p-3 text-xs">
            Save a relay base URL above then click <strong>Connect</strong> to get the connector
            URL.
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {!isConnected ? (
            <Button
              onClick={() => void send('doe/connection/connect')}
              disabled={isConnecting}
              className="gap-2">
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              {isConnecting ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void send('doe/connection/disconnect')}
              disabled={busy}
              className="gap-2">
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          )}
          {!isLocal && (
            <Button
              variant="outline"
              onClick={() => void send('doe/connection/rotate-token')}
              disabled={busy || !token}
              className="gap-2">
              <RotateCw className="h-4 w-4" /> Rotate token
            </Button>
          )}
        </div>

        {lastError && (
          <Note tone="warning">
            Last error: <code className="break-all">{lastError}</code>
          </Note>
        )}
        {!isLocal && (
          <Note>
            The connector URL contains a bearer token. Don't share it. Rotate the token if leaked —
            old URL stops working immediately, paste the new one into your MCP client.
          </Note>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ConnectorGuideCard ──────────────────────────────────────────────────────

function ConnectorGuideCard({ connectorUrl }: { connectorUrl: string | null }) {
  const [platform, setPlatform] = useState<PlatformId>('claude-web');
  const [copied, setCopied] = useState(false);
  const [urlRevealed, setUrlRevealed] = useState(false);
  const isLocal = isLocalUrl(connectorUrl);

  const fallbackUrl = `${DEFAULT_RELAY_URL || 'https://relay.your-domain.com'}/mcp/your-token`;
  const urlDisplay = connectorUrl ?? fallbackUrl;

  const copyUrl = () => {
    if (!connectorUrl) return;
    void navigator.clipboard.writeText(connectorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="text-primary h-4 w-4" /> How to connect
        </CardTitle>
        <CardDescription>
          Step-by-step setup guide for each MCP client. Select your platform, copy your connector
          URL, then follow the steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Platform selector — grouped */}
        {(['AI chats', 'Editors', 'Desktop apps', 'Self-hosted'] as const).map(
          group => (
            <div key={group} className="space-y-1.5">
              <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">
                {group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.filter(p => p.group === group).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      platform === p.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border bg-transparent hover:bg-accent text-foreground',
                    )}>
                    {p.label}
                    {p.plan && <span className="ml-1 font-normal opacity-50">· {p.plan}</span>}
                  </button>
                ))}
              </div>
            </div>
          ),
        )}

        {/* Connector URL — only shown in relay mode */}
        {!isLocal && (
          <>
            <div className="border-border/70 bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2">
              <span className="text-muted-foreground shrink-0 text-xs">Your URL</span>
              <span className="bg-border/60 mx-1 h-3 w-px shrink-0" />
              <code
                className={cn(
                  'flex-1 truncate font-mono text-xs transition-all',
                  !urlRevealed && connectorUrl && 'blur-md select-none',
                )}>
                {urlDisplay}
              </code>
              <button
                type="button"
                onClick={() => setUrlRevealed(r => !r)}
                aria-label={urlRevealed ? 'Hide URL' : 'Reveal URL'}
                className="text-muted-foreground hover:text-foreground rounded p-1">
                {urlRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={copyUrl}
                disabled={!connectorUrl}
                aria-label="Copy connector URL"
                className="text-muted-foreground hover:text-foreground rounded p-1 disabled:opacity-40">
                {copied ? (
                  <Check className="text-success h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {!connectorUrl && (
              <Note tone="warning">
                Connect first (in the card above) to get your real connector URL.
              </Note>
            )}
          </>
        )}

        {/* Platform-specific steps */}
        <PlatformInstructions
          platform={platform}
          urlDisplay={urlDisplay}
          urlRevealed={urlRevealed}
          isLocal={isLocal}
        />
      </CardContent>
    </Card>
  );
}

// ─── Platform instructions ───────────────────────────────────────────────────

function PlatformInstructions({
  platform,
  urlDisplay,
  urlRevealed,
  isLocal,
}: {
  platform: PlatformId;
  urlDisplay: string;
  urlRevealed: boolean;
  isLocal: boolean;
}) {
  // ── Relay-mode (HTTP) configs ─────────────────────────────────────────────
  const claudeCodeJson = JSON.stringify(
    { mcpServers: { doeverything: { type: 'http', url: urlDisplay } } },
    null,
    2,
  );
  const geminiJson = JSON.stringify(
    { mcpServers: { doeverything: { httpUrl: urlDisplay } } },
    null,
    2,
  );
  const codexJson = JSON.stringify(
    { mcpServers: { doeverything: { type: 'http', url: urlDisplay } } },
    null,
    2,
  );
  const amazonqJson = JSON.stringify(
    { mcpServers: { doeverything: { type: 'http', url: urlDisplay } } },
    null,
    2,
  );
  const cursorJson = JSON.stringify({ mcpServers: { doeverything: { url: urlDisplay } } }, null, 2);
  const windsurfJson = JSON.stringify(
    { mcpServers: { doeverything: { serverUrl: urlDisplay } } },
    null,
    2,
  );
  const vscodeJson = JSON.stringify(
    { servers: { doeverything: { type: 'http', url: urlDisplay } } },
    null,
    2,
  );
  const zedJson = JSON.stringify(
    { context_servers: { doeverything: { url: urlDisplay } } },
    null,
    2,
  );
  const clineJson = JSON.stringify(
    {
      mcpServers: {
        doeverything: { type: 'streamableHttp', url: urlDisplay, disabled: false, autoApprove: [] },
      },
    },
    null,
    2,
  );
  const continueYaml = [
    'mcpServers:',
    '  - name: doeverything',
    '    type: streamable-http',
    `    url: "${urlDisplay}"`,
  ].join('\n');
  const lmstudioJson = JSON.stringify(
    { mcpServers: { doeverything: { url: urlDisplay } } },
    null,
    2,
  );
  const anythingllmJson = JSON.stringify(
    { mcpServers: { doeverything: { type: 'streamable', url: urlDisplay } } },
    null,
    2,
  );
  const librechatYaml = [
    'mcpServers:',
    '  doeverything:',
    '    type: streamable-http',
    `    url: "${urlDisplay}"`,
  ].join('\n');
  const claudeCodeCmd = `claude mcp add doeverything --transport http --url "${urlDisplay}"`;
  const codexCmd = `codex mcp add --name doeverything --transport http --url "${urlDisplay}"`;
  const mask = (code: string) => code.replace(urlDisplay, '<YOUR_CONNECTOR_URL>');

  // ── Local-mode (stdio / npx) configs ─────────────────────────────────────
  const npxArgs = ['-y', '@doeverything/mcp-bridge'];
  const localNpxJson = JSON.stringify(
    { mcpServers: { doeverything: { command: 'npx', args: npxArgs } } },
    null,
    2,
  );
  const localClaudeDesktopJson = localNpxJson;
  const localVscodeJson = JSON.stringify(
    { servers: { doeverything: { type: 'stdio', command: 'npx', args: npxArgs } } },
    null,
    2,
  );
  const localContinueYaml = [
    'mcpServers:',
    '  - name: doeverything',
    '    type: stdio',
    '    command: npx',
    '    args: ["-y", "@doeverything/mcp-bridge"]',
  ].join('\n');
  const localZedJson = JSON.stringify(
    { context_servers: { doeverything: { command: { path: 'npx', args: npxArgs } } } },
    null,
    2,
  );
  const localClaudeCodeCmd = 'claude mcp add doeverything npx -- -y @doeverything/mcp-bridge';
  const localClaudeCodeJson = localNpxJson;

  // Web-only platforms: local mode is unavailable (they can't reach localhost)
  const WEB_ONLY: PlatformId[] = ['claude-web', 'chatgpt', 'mistral', 'librechat', 'anythingllm', 'openwebui'];
  if (isLocal && WEB_ONLY.includes(platform)) {
    return (
      <Note tone="warning">
        Local mode uses stdio transport and runs on your machine — this client connects over HTTP
        only and cannot reach a localhost server. Use the cloud relay instead: remove the custom
        Relay base URL in <strong>Options → MCP connection</strong> to get a connector URL you can
        paste here.
      </Note>
    );
  }

  if (platform === 'claude-web') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Go to <strong>claude.ai</strong> → click your <strong>profile photo</strong> (top-right)
          → <strong>Settings</strong>
        </GuideStep>
        <GuideStep n={2}>
          In the left sidebar, click <strong>Connectors</strong>
        </GuideStep>
        <GuideStep n={3}>
          Click <strong>+ Add custom connector</strong>
        </GuideStep>
        <GuideStep n={4}>
          Paste your connector URL into the <strong>"MCP Server URL"</strong> field → click{' '}
          <strong>Save</strong>
        </GuideStep>
        <GuideStep n={5}>
          To use in a chat: click <strong>+</strong> in the chat input →{' '}
          <strong>Connectors</strong> → toggle <em>doeverything</em> on
        </GuideStep>
        <Note>
          Requires <strong>Pro or Max plan</strong>. Connectors can't be edited after saving —
          delete and re-add if you rotate your token.
        </Note>
      </div>
    );
  }

  if (platform === 'claude-desktop') {
    if (isLocal) {
      return (
        <div className="space-y-3">
          <GuideStep n={1}>
            Edit{' '}
            <code className="bg-muted rounded px-1">~/Library/Application Support/Claude/claude_desktop_config.json</code>{' '}
            (Mac) or{' '}
            <code className="bg-muted rounded px-1">%APPDATA%\Claude\claude_desktop_config.json</code>{' '}
            (Windows):
          </GuideStep>
          <GuideCode code={localClaudeDesktopJson} />
          <GuideStep n={2}>
            Fully quit Claude Desktop <Kbd>⌘Q</Kbd> / <Kbd>Alt+F4</Kbd> and relaunch — MCP servers
            are loaded on startup.
          </GuideStep>
          <Note>Works on the free plan (limited to one MCP server on free; unlimited on Pro+).</Note>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>Claude Desktop</strong> → <strong>Settings</strong> <Kbd>⌘,</Kbd> on Mac ·{' '}
          <Kbd>Ctrl+,</Kbd> on Windows
        </GuideStep>
        <GuideStep n={2}>
          Click the <strong>Connectors</strong> tab
        </GuideStep>
        <GuideStep n={3}>
          Click <strong>+ Add custom connector</strong> → paste your connector URL → click{' '}
          <strong>Add</strong>
        </GuideStep>
        <GuideStep n={4}>
          The connector loads immediately. If tools don't appear after a few seconds, try fully
          quitting <Kbd>⌘Q</Kbd> / <Kbd>Alt+F4</Kbd> and relaunching.
        </GuideStep>
        <Note>Works on the free plan (limited to one MCP server on free; unlimited on Pro+).</Note>
      </div>
    );
  }

  if (platform === 'chatgpt') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Go to <strong>chatgpt.com</strong> → click your <strong>profile photo</strong> (top-right)
          → <strong>Settings</strong>
        </GuideStep>
        <GuideStep n={2}>
          In the left sidebar, click <strong>Connectors</strong>
        </GuideStep>
        <GuideStep n={3}>
          Enable <strong>Developer Mode</strong> (toggle at the top of the Connectors page)
        </GuideStep>
        <GuideStep n={4}>
          Click <strong>+ Add MCP server</strong> → paste your connector URL → click{' '}
          <strong>Save</strong>
        </GuideStep>
        <GuideStep n={5}>
          Start a new chat → click the <strong>tools icon</strong> in the composer → enable{' '}
          <em>doeverything</em> tools
        </GuideStep>
        <Note>
          <strong>Plus / Pro:</strong> read-only tools (navigate, read page content).{' '}
          <strong>Business / Enterprise / Edu:</strong> full access including click, type, and form
          fill. MCP support launched March 2025.
        </Note>
      </div>
    );
  }

  if (platform === 'mistral') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Go to <strong>chat.mistral.ai</strong> → click your <strong>profile photo</strong> →{' '}
          <strong>Settings</strong>
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>Connectors</strong> in the left sidebar
        </GuideStep>
        <GuideStep n={3}>
          Click <strong>+ Add custom connector</strong> → paste your connector URL → Save
        </GuideStep>
        <GuideStep n={4}>
          In a new chat, click <strong>+</strong> in the composer → enable the{' '}
          <em>doeverything</em> connector
        </GuideStep>
        <Note>
          Available on the <strong>free tier</strong> — no paid plan required. Custom MCP servers
          are supported alongside 20+ built-in connectors (GitHub, Notion, Jira, Stripe…).
        </Note>
      </div>
    );
  }

  if (platform === 'claude-code') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Add via CLI — run in your terminal:
          <GuideCode
            code={isLocal ? localClaudeCodeCmd : claudeCodeCmd}
            maskedCode={isLocal ? undefined : mask(claudeCodeCmd)}
            revealed={isLocal || urlRevealed}
          />
        </GuideStep>
        <GuideStep n={2}>
          Or edit the config file directly. Global:{' '}
          <code className="bg-muted rounded px-1">~/.claude.json</code> · Project:{' '}
          <code className="bg-muted rounded px-1">.mcp.json</code> in the project root:
        </GuideStep>
        <GuideCode
          code={isLocal ? localClaudeCodeJson : claudeCodeJson}
          maskedCode={isLocal ? undefined : mask(claudeCodeJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={3}>
          Start a new <code className="bg-muted rounded px-1 text-xs">claude</code> session — MCP
          servers are picked up automatically, <strong>no restart needed</strong>
        </GuideStep>
        <Note>
          Works on all Claude Code plans. Project-level <code className="text-xs">.mcp.json</code>{' '}
          takes precedence over the global config; useful for repo-specific setups.
        </Note>
      </div>
    );
  }

  if (platform === 'gemini-cli') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Edit <code className="bg-muted rounded px-1">~/.gemini/settings.json</code> (create it if
          it doesn't exist):
        </GuideStep>
        <GuideCode
          code={isLocal ? localNpxJson : geminiJson}
          maskedCode={isLocal ? undefined : mask(geminiJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={2}>
          Save the file and start a new{' '}
          <code className="bg-muted rounded px-1 text-xs">gemini</code> session — Gemini CLI reads
          the config on launch, <strong>no restart of a running session applies config</strong>
        </GuideStep>
        <GuideStep n={3}>
          In the session, doeverything tools are available automatically. Type{' '}
          <code className="bg-muted rounded px-1 text-xs">/mcp</code> to list connected servers.
        </GuideStep>
        <Note>
          Gemini CLI uses <code className="text-xs">httpUrl</code> (not{' '}
          <code className="text-xs">url</code>) for HTTP MCP servers. Requires Gemini CLI 0.1.6+
          (June 2025).
        </Note>
      </div>
    );
  }

  if (platform === 'codex') {
    return (
      <div className="space-y-3">
        {!isLocal && (
          <GuideStep n={1}>
            Add via CLI — run in your terminal:
            <GuideCode code={codexCmd} maskedCode={mask(codexCmd)} revealed={urlRevealed} />
          </GuideStep>
        )}
        <GuideStep n={isLocal ? 1 : 2}>
          {isLocal ? 'Edit' : 'Or edit'}{' '}
          <code className="bg-muted rounded px-1">~/.codex/config.json</code> directly:
        </GuideStep>
        <GuideCode
          code={isLocal ? localNpxJson : codexJson}
          maskedCode={isLocal ? undefined : mask(codexJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={3}>
          Start a new <code className="bg-muted rounded px-1 text-xs">codex</code> session — MCP
          servers load on startup
        </GuideStep>
        <Note>
          OpenAI's open-source Codex CLI. MCP HTTP support added in 0.1.x (2025). Requires Node
          18+.
        </Note>
      </div>
    );
  }

  if (platform === 'amazonq') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open the Amazon Q Developer chat panel in your IDE (VS Code or JetBrains) or the{' '}
          <code className="bg-muted rounded px-1 text-xs">q</code> CLI
        </GuideStep>
        <GuideStep n={2}>
          Edit <code className="bg-muted rounded px-1">~/.aws/amazonq/mcp.json</code> (create if
          needed):
        </GuideStep>
        <GuideCode
          code={isLocal ? localNpxJson : amazonqJson}
          maskedCode={isLocal ? undefined : mask(amazonqJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={3}>
          Restart Amazon Q Developer in your IDE or relaunch the{' '}
          <code className="bg-muted rounded px-1 text-xs">q</code> CLI session
        </GuideStep>
        <GuideStep n={4}>
          In the chat, type <code className="bg-muted rounded px-1 text-xs">/tools</code> to confirm
          doeverything tools are listed
        </GuideStep>
        <Note>
          Available in Amazon Q Developer Pro (and free tier with limited calls). MCP support added
          April 2025. Requires the Q Developer extension for VS Code / JetBrains.
        </Note>
      </div>
    );
  }

  if (platform === 'cursor') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open Cursor <strong>Settings</strong> <Kbd>⌘,</Kbd> / <Kbd>Ctrl+,</Kbd> → scroll to{' '}
          <strong>Tools &amp; MCP</strong>
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>Add new MCP server</strong> → select transport{' '}
          {isLocal
            ? <><strong>stdio</strong> → enter <code className="bg-muted rounded px-1 text-xs">npx</code> as command and <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> as args</>
            : <><strong>Streamable HTTP</strong> → paste your connector URL</>}
        </GuideStep>
        <GuideStep n={3}>
          Fully quit Cursor <Kbd>⌘Q</Kbd> / <Kbd>Alt+F4</Kbd> and relaunch — a regular window close
          doesn't reload MCP servers
        </GuideStep>
        <p className="text-muted-foreground text-xs font-medium">Or edit the config file directly:</p>
        <p className="text-muted-foreground text-xs">
          Global: <code className="bg-muted rounded px-1">~/.cursor/mcp.json</code> · Project:{' '}
          <code className="bg-muted rounded px-1">.cursor/mcp.json</code>
        </p>
        <GuideCode
          code={isLocal ? localNpxJson : cursorJson}
          maskedCode={isLocal ? undefined : mask(cursorJson)}
          revealed={isLocal || urlRevealed}
        />
        <Note>
          Environment variables use <code className="text-xs">{'${env:NAME}'}</code> syntax inside
          the JSON.
        </Note>
      </div>
    );
  }

  if (platform === 'windsurf') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Click <strong>⚙</strong> (bottom-left) → <strong>Settings</strong> →{' '}
          <strong>MCP</strong> tab (or <em>Cascade → MCP Servers</em>)
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>+ Add server</strong> → select{' '}
          {isLocal
            ? <><strong>stdio</strong> → enter <code className="bg-muted rounded px-1 text-xs">npx</code> as command and <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> as args → Save</>
            : <><strong>Streamable HTTP</strong> → paste your connector URL → Save</>}
        </GuideStep>
        <GuideStep n={3}>
          In the Cascade panel, toggle individual <strong>doeverything tools</strong> on or off as
          needed
        </GuideStep>
        <p className="text-muted-foreground text-xs font-medium">Or edit the config file directly:</p>
        <p className="text-muted-foreground text-xs">
          <code className="bg-muted rounded px-1">~/.codeium/windsurf/mcp_config.json</code>
        </p>
        <GuideCode
          code={isLocal ? localNpxJson : windsurfJson}
          maskedCode={isLocal ? undefined : mask(windsurfJson)}
          revealed={isLocal || urlRevealed}
        />
        <Note>
          Windsurf uses <code className="text-xs">serverUrl</code> (not{' '}
          <code className="text-xs">url</code>) for HTTP servers. Maximum 100 MCP tools across all
          configured servers.
        </Note>
      </div>
    );
  }

  if (platform === 'vscode') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>Command Palette</strong> <Kbd>⌘⇧P</Kbd> / <Kbd>Ctrl+Shift+P</Kbd> → run{' '}
          <strong>MCP: Open User Configuration</strong>
        </GuideStep>
        <GuideStep n={2}>
          Add <code className="bg-muted rounded px-1 text-xs">doeverything</code> to the{' '}
          <code className="bg-muted rounded px-1 text-xs">servers</code> object (VS Code uses{' '}
          <em>servers</em>, not <em>mcpServers</em>):
        </GuideStep>
        <GuideCode
          code={isLocal ? localVscodeJson : vscodeJson}
          maskedCode={isLocal ? undefined : mask(vscodeJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={3}>
          Open <strong>Copilot Chat</strong> → switch the mode dropdown to <strong>Agent</strong>
        </GuideStep>
        <GuideStep n={4}>
          Click the <strong>tools picker</strong> icon in the chat input → enable{' '}
          <em>doeverything</em> tools
        </GuideStep>
        <Note>Requires a GitHub Copilot subscription.</Note>
      </div>
    );
  }

  if (platform === 'cline') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Install the <strong>Cline</strong> extension from the VS Code marketplace (if not already
          installed)
        </GuideStep>
        <GuideStep n={2}>
          In the Cline panel, click the <strong>MCP Servers</strong> icon (plug icon at the top) →
          {isLocal
            ? <> click <strong>Local Servers</strong> tab → <strong>+ Add Local Server</strong></>
            : <> click <strong>Remote Servers</strong> tab → <strong>+ Add Remote Server</strong></>}
        </GuideStep>
        <GuideStep n={3}>
          Enter server name <code className="bg-muted rounded px-1 text-xs">doeverything</code>
          {isLocal
            ? <>, set command to <code className="bg-muted rounded px-1 text-xs">npx</code> and args to <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> → Save</>
            : <> and paste your connector URL → Save</>}
        </GuideStep>
        <p className="text-muted-foreground text-xs font-medium">
          Or edit the MCP settings file directly:
        </p>
        <p className="text-muted-foreground text-xs">
          Mac:{' '}
          <code className="bg-muted rounded px-1 break-all">
            ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
          </code>
        </p>
        <p className="text-muted-foreground text-xs">
          Windows:{' '}
          <code className="bg-muted rounded px-1 break-all">
            %APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
          </code>
        </p>
        <GuideCode
          code={isLocal ? localNpxJson : clineJson}
          maskedCode={isLocal ? undefined : mask(clineJson)}
          revealed={isLocal || urlRevealed}
        />
        <Note>
          Cline uses <code className="text-xs">streamableHttp</code> (camelCase) — unique among
          editors. The <code className="text-xs">autoApprove</code> array lets you whitelist
          specific tool names to skip the confirmation prompt per call.
        </Note>
      </div>
    );
  }

  if (platform === 'continue') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Install the <strong>Continue</strong> extension from VS Code or JetBrains marketplace (if
          not already installed)
        </GuideStep>
        <GuideStep n={2}>
          Open the Continue config: click the <strong>Continue icon</strong> in the sidebar → gear
          icon → <strong>Open config.yaml</strong>
          <br />
          <span className="text-muted-foreground text-xs">
            or edit <code className="bg-muted rounded px-1">~/.continue/config.yaml</code> directly
          </span>
        </GuideStep>
        <GuideStep n={3}>
          Add the <code className="bg-muted rounded px-1 text-xs">mcpServers</code> section (or
          append to it if it already exists):
        </GuideStep>
        <GuideCode
          code={isLocal ? localContinueYaml : continueYaml}
          maskedCode={isLocal ? undefined : mask(continueYaml)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={4}>
          Save the file — Continue reloads automatically. The tools appear in the{' '}
          <strong>@</strong> context menu in the chat input.
        </GuideStep>
        <Note>Works in both VS Code and JetBrains IDEs (IntelliJ, PyCharm, WebStorm…).</Note>
      </div>
    );
  }

  if (platform === 'zed') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open Zed settings: <strong>Zed → Settings → Open Local Settings</strong> or edit{' '}
          <code className="bg-muted rounded px-1 text-xs">~/.config/zed/settings.json</code>{' '}
          directly
        </GuideStep>
        <GuideStep n={2}>
          Add <code className="bg-muted rounded px-1 text-xs">doeverything</code> to{' '}
          <code className="bg-muted rounded px-1 text-xs">context_servers</code>:
        </GuideStep>
        <GuideCode
          code={isLocal ? localZedJson : zedJson}
          maskedCode={isLocal ? undefined : mask(zedJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={3}>
          Save the file — Zed reloads the server automatically, <strong>no restart needed</strong>
        </GuideStep>
        <GuideStep n={4}>
          Open the <strong>Agent Panel</strong> <Kbd>⌘⇧A</Kbd> — a green dot next to doeverything
          confirms it's connected
        </GuideStep>
        <Note>Remote HTTP context server support requires Zed 0.168+ (released early 2025).</Note>
      </div>
    );
  }

  if (platform === 'jetbrains') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>Settings</strong> <Kbd>⌘,</Kbd> / <Kbd>Ctrl+Alt+S</Kbd> → navigate to{' '}
          <strong>Tools → AI Assistant → Model Context Protocol (MCP)</strong>
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>+</strong> → select server type{' '}
          <strong>{isLocal ? 'stdio' : 'HTTP'}</strong>
        </GuideStep>
        <GuideStep n={3}>
          Set Name to <code className="bg-muted rounded px-1 text-xs">doeverything</code>
          {isLocal
            ? <>, set command to <code className="bg-muted rounded px-1 text-xs">npx</code> and args to <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> → click <strong>OK</strong></>
            : <>, paste your connector URL into the URL field → click <strong>OK</strong></>}
        </GuideStep>
        <GuideStep n={4}>
          Click <strong>Apply</strong>. Open the AI Assistant chat — doeverything tools are available
          in the tools picker.
        </GuideStep>
        <Note>
          Requires the <strong>AI Assistant</strong> plugin (bundled in IntelliJ IDEA, PyCharm,
          WebStorm, GoLand, Rider, and other JetBrains IDEs since 2024.3). MCP support added in
          2025.
        </Note>
      </div>
    );
  }

  if (platform === 'lmstudio') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>LM Studio</strong> → click the <strong>Program</strong> tab (terminal icon
          in the right sidebar)
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>Install</strong> → <strong>Edit mcp.json</strong> → dismiss the security
          warning → the config editor opens
        </GuideStep>
        <GuideStep n={3}>
          Add doeverything to the{' '}
          <code className="bg-muted rounded px-1 text-xs">mcpServers</code> object:
        </GuideStep>
        <GuideCode
          code={isLocal ? localNpxJson : lmstudioJson}
          maskedCode={isLocal ? undefined : mask(lmstudioJson)}
          revealed={isLocal || urlRevealed}
        />
        <GuideStep n={4}>
          Save the file — LM Studio reloads MCP servers automatically,{' '}
          <strong>no restart needed</strong>. Load any function-calling capable model and start a
          new chat.
        </GuideStep>
        <Note>
          Requires LM Studio 0.3.17+ (June 2025). Config path:{' '}
          <code className="text-xs">~/.lmstudio/mcp.json</code>. LM Studio shows a confirmation
          dialog before executing each tool call — you can approve once or permanently per tool.
        </Note>
      </div>
    );
  }

  if (platform === 'jan') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>Jan</strong> → click the <strong>Settings</strong> icon (bottom-left) →{' '}
          <strong>MCP Servers</strong>
        </GuideStep>
        <GuideStep n={2}>
          Click <strong>+ Add MCP Server</strong> (top-right of the MCP box)
        </GuideStep>
        <GuideStep n={3}>
          Select transport <strong>{isLocal ? 'stdio' : 'HTTP'}</strong>, enter a name (e.g.{' '}
          <code className="bg-muted rounded px-1 text-xs">doeverything</code>),{' '}
          {isLocal
            ? <>set command to <code className="bg-muted rounded px-1 text-xs">npx</code> and args to <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> → Save</>
            : <>paste your connector URL → Save</>}
        </GuideStep>
        <GuideStep n={4}>
          Toggle the server <strong>ON</strong> (green indicator). Start a chat with a
          tool-capable model — doeverything tools are automatically available.
        </GuideStep>
        <Note>
          Requires Jan v0.6.3+ (June 2025). The model must show a "tools capability" badge in the
          model picker. Jan also supports per-call approval and a configurable tool-call timeout.
        </Note>
      </div>
    );
  }

  if (platform === 'raycast') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open Raycast <Kbd>⌘Space</Kbd> → search for <strong>Install MCP Server</strong> →{' '}
          press <Kbd>Enter</Kbd>
        </GuideStep>
        <GuideStep n={2}>
          Select transport{' '}
          <strong>{isLocal ? 'stdio' : 'HTTP (Streamable HTTP for remote servers)'}</strong>
        </GuideStep>
        <GuideStep n={3}>
          Enter a name (e.g.{' '}
          <code className="bg-muted rounded px-1 text-xs">doeverything</code>),{' '}
          {isLocal
            ? <>set command to <code className="bg-muted rounded px-1 text-xs">npx</code> and args to <code className="bg-muted rounded px-1 text-xs">-y @doeverything/mcp-bridge</code> → click <strong>Install</strong></>
            : <>paste your connector URL → click <strong>Install</strong></>}
        </GuideStep>
        <GuideStep n={4}>
          Raycast connects and pulls the tool list automatically. Open{' '}
          <strong>Raycast AI</strong> — doeverything tools appear in the tools picker.
        </GuideStep>
        <Note>
          Requires Raycast v1.98+ (May 2025, Mac only). Tokens are stored encrypted per server.
          Auth headers can be configured per-server if needed.
        </Note>
      </div>
    );
  }

  if (platform === 'librechat') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open your LibreChat configuration file:{' '}
          <code className="bg-muted rounded px-1">librechat.yaml</code>
        </GuideStep>
        <GuideStep n={2}>
          Add doeverything to the{' '}
          <code className="bg-muted rounded px-1 text-xs">mcpServers</code> section:
        </GuideStep>
        <GuideCode code={librechatYaml} maskedCode={mask(librechatYaml)} revealed={urlRevealed} />
        <GuideStep n={3}>
          Restart LibreChat — MCP tools appear in the chat as <em>doeverything_*</em> actions
        </GuideStep>
        <Note>
          Uses <code className="text-xs">type: streamable-http</code> — not{' '}
          <code className="text-xs">sse</code>, which LibreChat deprecates for production. Requires
          LibreChat v0.7+.
        </Note>
      </div>
    );
  }

  if (platform === 'anythingllm') {
    return (
      <div className="space-y-3">
        <GuideStep n={1}>
          Open <strong>AnythingLLM</strong> desktop app → click <strong>⚙ Settings</strong> →{' '}
          <strong>Agent Skills</strong>
        </GuideStep>
        <GuideStep n={2}>
          In the <strong>MCP Servers</strong> section, open{' '}
          <code className="bg-muted rounded px-1 text-xs">anythingllm_mcp_servers.json</code> in a
          text editor and add the doeverything entry:
        </GuideStep>
        <GuideCode code={anythingllmJson} maskedCode={mask(anythingllmJson)} revealed={urlRevealed} />
        <GuideStep n={3}>
          Save the file, then click <strong>Refresh</strong> in the Agent Skills page — no restart
          needed
        </GuideStep>
        <GuideStep n={4}>
          In a workspace chat, prefix your message with{' '}
          <code className="bg-muted rounded px-1 text-xs">@agent</code> to invoke MCP tools
        </GuideStep>
        <Note>
          Requires AnythingLLM v1.8.0+ (April 2025). Uses{' '}
          <code className="text-xs">"type": "streamable"</code> — unique to AnythingLLM. Not
          available on AnythingLLM Cloud (desktop/Docker only).
        </Note>
      </div>
    );
  }

  // openwebui
  return (
    <div className="space-y-3">
      <GuideStep n={1}>
        Log in as an <strong>admin</strong> → <strong>Admin Panel</strong> →{' '}
        <strong>Settings</strong> → <strong>External Tools</strong>
      </GuideStep>
      <GuideStep n={2}>
        Click <strong>+ Add</strong> → select type <strong>MCP (Streamable HTTP)</strong>
      </GuideStep>
      <GuideStep n={3}>
        Set name to{' '}
        <code className="bg-muted rounded px-1 text-xs">doeverything</code>, paste your connector
        URL into the <strong>URL</strong> field → Save
      </GuideStep>
      <GuideStep n={4}>
        Create or edit a model in <strong>Workspace → Models</strong> → under{' '}
        <strong>Advanced Parameters</strong> set <strong>Function Calling → Native</strong> →
        enable doeverything tools under <strong>Tools</strong> → Save
      </GuideStep>
      <Note>
        Requires Open WebUI v0.6.31+ (mid-2025). Only Streamable HTTP is supported natively —
        stdio/SSE servers require the <code className="text-xs">mcpo</code> proxy. Only admins can
        register MCP servers.
      </Note>
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function GuideStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="bg-primary/10 text-primary mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
        {n}
      </span>
      <div className="flex-1 leading-snug">{children}</div>
    </div>
  );
}

function GuideCode({
  code,
  maskedCode,
  revealed = true,
}: {
  code: string;
  maskedCode?: string;
  revealed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const displayCode = !revealed && maskedCode !== undefined ? maskedCode : code;
  return (
    <div className="relative">
      <pre
        className={cn(
          'bg-muted text-foreground/85 overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed',
          !revealed && maskedCode === undefined && 'blur-sm select-none',
        )}>
        {displayCode}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="text-muted-foreground hover:text-foreground absolute right-2 top-2 rounded p-1">
        {copied ? <Check className="text-success h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted border-border rounded border px-1 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

function StatusBadge({
  status,
}: {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
}) {
  switch (status) {
    case 'connected':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Connected
        </Badge>
      );
    case 'connecting':
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Connecting
        </Badge>
      );
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="outline">Disconnected</Badge>;
  }
}

function Note({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'warning';
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-relaxed',
        tone === 'warning'
          ? 'border-warning/25 bg-warning/10 text-warning'
          : 'border-border/60 bg-muted/30 text-muted-foreground',
      )}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
