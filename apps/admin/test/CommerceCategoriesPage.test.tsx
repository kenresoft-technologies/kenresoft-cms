import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoriesPage } from '@/plugins/commerce/CategoriesPage';

const { getMock, postMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, post: postMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock },
}));

const category = {
  id: 'c-1',
  name: 'Gadgets',
  slug: 'gadgets',
  description: null,
  parentId: null,
  imageId: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
  });

  it('lists categories returned by the API', async () => {
    getMock.mockResolvedValue([category]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Gadgets')).toBeInTheDocument());
    expect(screen.getByText('gadgets')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/categories');
  });

  it('shows an empty state when there are no categories', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No categories yet')).toBeInTheDocument());
  });

  it('hides the New category action for a viewer', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'viewer@example.test', role: 'viewer' } },
      isPending: false,
    });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No categories yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
  });

  it('creates a category through the dialog', async () => {
    getMock.mockResolvedValue([]);
    postMock.mockResolvedValue({ ...category, id: 'c-2' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No categories yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Gadgets');
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'gadgets');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/categories', {
        name: 'Gadgets',
        slug: 'gadgets',
        description: null,
        parentId: null,
        status: 'active',
      }),
    );
  });
});
