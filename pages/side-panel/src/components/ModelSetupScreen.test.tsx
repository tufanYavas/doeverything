import '@testing-library/jest-dom/vitest';
import { ModelSetupScreen } from './ModelSetupScreen';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `useConnection` is the only provider hook ModelSetupScreen consumes. We mock
 * it through a mutable holder so individual tests can flip between the
 * "no connector URL yet" CTA state and the "connector URL minted" state
 * without re-mocking the module.
 */
interface MockConnection {
  token?: string;
  relayBaseUrl?: string;
}
const connectionHolder: {
  connection: MockConnection;
  isConnected: boolean;
  connect: ReturnType<typeof vi.fn>;
} = {
  connection: {},
  isConnected: false,
  connect: vi.fn(),
};

vi.mock('@src/providers/Providers', () => ({
  useConnection: () => connectionHolder,
}));

beforeEach(() => {
  connectionHolder.connection = {};
  connectionHolder.isConnected = false;
  connectionHolder.connect = vi.fn().mockResolvedValue(undefined);
});

describe('ModelSetupScreen', () => {
  it('renders both onboarding cards', () => {
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    expect(screen.getByText('MCP connection')).toBeInTheDocument();
    expect(screen.getByText('Use an API key')).toBeInTheDocument();
    expect(screen.getByText('Pay-per-use')).toBeInTheDocument();
  });

  it('"Skip for now" calls onDismiss callback', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ModelSetupScreen onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Open Settings → LLM" opens the LLM tab and skips', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ModelSetupScreen onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: /open settings/i }));
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('#llm') }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the MCP generate CTA when no connector URL exists, and calls connect()', async () => {
    const user = userEvent.setup();
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    const generate = screen.getByRole('button', { name: /generate mcp server url/i });
    await user.click(generate);
    expect(connectionHolder.connect).toHaveBeenCalledTimes(1);
  });

  it('renders the minted connector URL once token + relay are present', () => {
    connectionHolder.connection = { token: 'tok123', relayBaseUrl: 'https://relay.test' };
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    expect(screen.getByText('https://relay.test/mcp/tok123')).toBeInTheDocument();
    // The generate CTA is replaced by the URL + copy affordance.
    expect(screen.queryByRole('button', { name: /generate mcp server url/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy mcp server url/i })).toBeInTheDocument();
  });

  it('reflects the offline waiting state when not connected', () => {
    connectionHolder.connection = { token: 'tok123', relayBaseUrl: 'https://relay.test' };
    connectionHolder.isConnected = false;
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    expect(screen.getByText(/waiting for the mcp client to connect/i)).toBeInTheDocument();
  });

  it('reflects the online state when connected', () => {
    connectionHolder.connection = { token: 'tok123', relayBaseUrl: 'https://relay.test' };
    connectionHolder.isConnected = true;
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    expect(screen.getByText(/online — extension is reachable/i)).toBeInTheDocument();
  });

  it('copies the connector URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Define our spy before userEvent.setup() so its own clipboard wiring
    // doesn't shadow it, then drive clicks with fireEvent (no clipboard stub).
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    connectionHolder.connection = { token: 'tok123', relayBaseUrl: 'https://relay.test' };
    render(<ModelSetupScreen onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy mcp server url/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://relay.test/mcp/tok123'));
  });
});
