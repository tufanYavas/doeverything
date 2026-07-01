import '@testing-library/jest-dom/vitest';
import { ContextStrip } from './ContextStrip';
import { useChatStore } from '../stores/chat-store';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

const set = useChatStore.setState;

beforeEach(() => {
  set({ lastCompaction: null, contextUsage: null });
});

describe('ContextStrip', () => {
  it('renders nothing when idle (no compaction, low usage)', () => {
    set({ contextUsage: { estimatedTokens: 10_000, contextWindow: 200_000 } });
    const { container } = render(<ContextStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the compaction notice with a fill badge', () => {
    set({
      lastCompaction: {
        stage: 'warn',
        estimatedTokens: 150_000,
        contextWindow: 200_000,
        at: Date.now(),
        dismissed: false,
      },
    });
    render(<ContextStrip />);
    expect(screen.getByText(/Context compacted/i)).toBeInTheDocument();
    expect(screen.getByText('75% full')).toBeInTheDocument();
  });

  it('dismiss button hides the compaction notice', async () => {
    const user = userEvent.setup();
    set({
      lastCompaction: { stage: 'warn', estimatedTokens: 150_000, contextWindow: 200_000, at: Date.now(), dismissed: false },
    });
    const { container } = render(<ContextStrip />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(useChatStore.getState().lastCompaction?.dismissed).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the fill indicator at ≥75% when there is no pending compaction', () => {
    set({ contextUsage: { estimatedTokens: 180_000, contextWindow: 200_000 } });
    render(<ContextStrip />);
    expect(screen.getByText(/90% full/)).toBeInTheDocument();
  });

  it('prefers the compaction notice over the fill indicator', () => {
    set({
      lastCompaction: { stage: 'warn', estimatedTokens: 150_000, contextWindow: 200_000, at: Date.now(), dismissed: false },
      contextUsage: { estimatedTokens: 180_000, contextWindow: 200_000 },
    });
    render(<ContextStrip />);
    expect(screen.getByText(/Context compacted/i)).toBeInTheDocument();
  });
});
