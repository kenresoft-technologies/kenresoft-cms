import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductsPage } from '@/plugins/commerce/ProductsPage';

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

const product = {
  id: 'p-1',
  name: 'Widget',
  slug: 'widget',
  description: null,
  shortDescription: null,
  status: 'published',
  productType: 'physical',
  basePrice: 1000,
  currency: 'USD',
  sku: null,
  categoryId: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mockGet(products: unknown[] = [], categories: unknown[] = []) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/plugins/commerce/v1/products')) return Promise.resolve(products);
    if (path.startsWith('/api/plugins/commerce/v1/categories')) return Promise.resolve(categories);
    return Promise.resolve([]);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
  });

  it('lists products returned by the API', async () => {
    mockGet([product]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    // basePrice is minor units (1000 = $10.00) — currency symbol/prefix is locale-dependent,
    // so this only asserts the formatted numeric amount is present.
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no products', async () => {
    mockGet([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No products yet')).toBeInTheDocument());
  });

  it('hides the New product action for an author', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'author@example.test', role: 'author' } },
      isPending: false,
    });
    mockGet([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No products yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
  });

  it('creates a product through the dialog', async () => {
    mockGet([]);
    postMock.mockResolvedValue({ ...product, id: 'p-2' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No products yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New product' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Widget');
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'widget');
    await userEvent.type(within(dialog).getByLabelText('Base price'), '10');
    await userEvent.clear(within(dialog).getByLabelText('Currency'));
    await userEvent.type(within(dialog).getByLabelText('Currency'), 'USD');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create product' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/products', {
        name: 'Widget',
        slug: 'widget',
        basePrice: 1000,
        currency: 'USD',
      }),
    );
  });
});
