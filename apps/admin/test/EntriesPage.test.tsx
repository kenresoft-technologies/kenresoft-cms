import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntriesPage } from '@/pages/EntriesPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/proj-1/content-types/ct-1/entries']}>
        <Routes>
          <Route
            path="/projects/:projectId/content-types/:contentTypeId/entries"
            element={<EntriesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntriesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('lists entries scoped to the content type, with a status badge', async () => {
    getMock.mockImplementation((path: string) =>
      path.startsWith('/api/v1/admin/content-types/')
        ? Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' })
        : Promise.resolve([
            {
              id: 'e-1',
              slug: 'hello-world',
              status: 'published',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());
    expect(screen.getByText('published')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/entries?contentTypeId=ct-1');
  });

  it('shows an empty state and a New entry link pointing at the create route', async () => {
    getMock.mockImplementation((path: string) =>
      path.startsWith('/api/v1/admin/content-types/')
        ? Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' })
        : Promise.resolve([]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('No entries yet')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'New entry' })).toHaveAttribute(
      'href',
      '/projects/proj-1/content-types/ct-1/entries/new',
    );
  });
});
