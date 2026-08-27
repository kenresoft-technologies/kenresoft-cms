import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntriesPage } from '@/pages/EntriesPage';

const { getMock, deleteMock, patchMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  deleteMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, delete: deleteMock, patch: patchMock, post: postMock },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/content-types/ct-1/entries']}>
        <Routes>
          <Route path="/content-types/:contentTypeId/entries" element={<EntriesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockEntries(entries: unknown[]) {
  getMock.mockImplementation((path: string) =>
    path.startsWith('/api/v1/admin/content-types/')
      ? Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' })
      : Promise.resolve(entries),
  );
}

describe('EntriesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    patchMock.mockReset().mockResolvedValue({});
    postMock.mockReset().mockResolvedValue({ id: 'e-copy' });
  });

  it('lists entries scoped to the content type, with a status badge', async () => {
    mockEntries([
      { id: 'e-1', slug: 'hello-world', status: 'published', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/entries?contentTypeId=ct-1');
  });

  it('shows an empty state and a New entry link pointing at the create route', async () => {
    mockEntries([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No entries yet')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'New entry' })).toHaveAttribute(
      'href',
      '/content-types/ct-1/entries/new',
    );
  });

  it('filters the list by status', async () => {
    mockEntries([
      { id: 'e-1', slug: 'hello-world', status: 'published', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'e-2', slug: 'draft-post', status: 'draft', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());
    expect(screen.getByText('draft-post')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Published' }));

    expect(screen.getByText('hello-world')).toBeInTheDocument();
    expect(screen.queryByText('draft-post')).not.toBeInTheDocument();
  });

  it('deletes an entry from its row actions menu after confirming', async () => {
    mockEntries([
      { id: 'e-1', slug: 'hello-world', status: 'published', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Entry actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1'));
  });

  it('duplicates an entry and navigates to the new copy', async () => {
    mockEntries([
      { id: 'e-1', slug: 'hello-world', status: 'published', data: { title: 'Hi' }, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Entry actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/admin/entries?contentTypeId=ct-1',
        expect.objectContaining({ slug: 'hello-world-copy', status: 'draft' }),
      ),
    );
  });

  it('bulk-deletes selected rows', async () => {
    mockEntries([
      { id: 'e-1', slug: 'hello-world', status: 'published', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'e-2', slug: 'draft-post', status: 'draft', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2));
    expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1');
    expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-2');
  });
});
