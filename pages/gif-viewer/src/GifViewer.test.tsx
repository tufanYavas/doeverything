import '@testing-library/jest-dom/vitest';
import GifViewer from './GifViewer';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

/** Drive the page's URL params (read once in a useEffect on mount). */
function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

describe('GifViewer', () => {
  // chrome.storage is reset per-test by the shared setup; just reset the URL.
  beforeEach(() => setSearch(''));

  it('shows the empty state when no id/src param is present', async () => {
    setSearch('');
    render(<GifViewer />);
    expect(await screen.findByText(/no recording loaded yet/i)).toBeInTheDocument();
  });

  it('renders a directly-passed ?src= data URL', async () => {
    const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    setSearch(`?src=${encodeURIComponent(dataUrl)}`);
    render(<GifViewer />);
    const img = await screen.findByRole('img', { name: /doeverything recording/i });
    expect(img).toHaveAttribute('src', dataUrl);
  });

  it('loads a recording by ?id= from chrome.storage.local and wires the download name', async () => {
    const id = 'rec-123';
    const dataUrl = 'data:image/gif;base64,SOMEBYTES=';
    await chrome.storage.local.set({ [`doe/recording/${id}`]: { dataUrl, name: 'my-flow.gif' } });
    setSearch(`?id=${id}`);

    render(<GifViewer />);

    const img = await screen.findByRole('img', { name: /doeverything recording/i });
    expect(img).toHaveAttribute('src', dataUrl);
    const link = screen.getByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', dataUrl);
    expect(link).toHaveAttribute('download', 'my-flow.gif');
  });

  it('stays on the empty state when the ?id= record is missing', async () => {
    setSearch('?id=does-not-exist');
    render(<GifViewer />);
    await waitFor(() => expect(screen.getByText(/no recording loaded yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: /doeverything recording/i })).not.toBeInTheDocument();
  });
});
