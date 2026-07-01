import '@testing-library/jest-dom/vitest';
import { ModelCombobox } from './ModelCombobox';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

describe('ModelCombobox', () => {
  it('renders the committed value in the input', () => {
    render(<ModelCombobox value="claude-opus-4-7" options={[]} onCommit={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('claude-opus-4-7');
  });

  it('filters suggestions by case-insensitive substring as the user types', async () => {
    const user = userEvent.setup();
    render(<ModelCombobox value="" options={['gpt-4o', 'gpt-4o-mini', 'claude-opus-4-7']} onCommit={() => {}} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'OPUS');
    expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument();
    // 'gpt-4o' is a substring of 'gpt-4o-mini'; neither matches 'opus'.
    expect(screen.queryByText('gpt-4o')).not.toBeInTheDocument();
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
  });

  it('commits a clicked suggestion', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ModelCombobox value="" options={['gpt-4o', 'gpt-4o-mini']} onCommit={onCommit} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('gpt-4o-mini'));
    expect(onCommit).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('Enter commits the EXACT typed text, not a substring match (regression guard)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    // 'gpt-4o' is a substring of the first option — typing it and pressing
    // Enter (without arrowing) must commit 'gpt-4o', never 'gpt-4o-mini'.
    render(<ModelCombobox value="" options={['gpt-4o-mini', 'gpt-4o']} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'gpt-4o');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('gpt-4o');
  });

  it('Arrow-navigate then Enter commits the highlighted suggestion', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ModelCombobox value="" options={['alpha', 'beta', 'gamma']} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    // Opening highlights index 0 ('alpha'); one ArrowDown moves to 'beta'.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onCommit).toHaveBeenCalledWith('beta');
  });

  it('commits free text that matches nothing (custom model id)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ModelCombobox value="" options={['gpt-4o']} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'my-self-hosted-model');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('my-self-hosted-model');
  });

  it('commits the draft on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <ModelCombobox value="" options={[]} onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'typed-id');
    await user.click(screen.getByText('elsewhere')); // blur
    expect(onCommit).toHaveBeenCalledWith('typed-id');
  });

  it('does not re-commit an unchanged value', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <ModelCombobox value="same" options={[]} onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('elsewhere'));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
