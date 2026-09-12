import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PagesPage } from '@/pages/PagesPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, post: postMock } };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PagesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PagesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('lists pages returned by the API', async () => {
    getMock.mockResolvedValue([
      { id: 'p-1', route: '/about', title: 'About us', status: 'draft', publishAt: null, blocks: [], seo: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('About us')).toBeInTheDocument());
    expect(screen.getByText('/about')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/pages');
  });

  it('shows an empty state when there are no pages', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No pages yet')).toBeInTheDocument());
  });

  it('creates a page through the dialog', async () => {
    getMock.mockResolvedValue([]);
    postMock.mockResolvedValue({
      id: 'p-1',
      route: '/about',
      title: 'About us',
      status: 'draft',
      publishAt: null,
      blocks: [],
      seo: null,
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No pages yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New page' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'About us');
    await userEvent.type(within(dialog).getByLabelText('Route'), '/about');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create page' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/pages', { title: 'About us', route: '/about', blocks: [] }),
    );
  });
});
