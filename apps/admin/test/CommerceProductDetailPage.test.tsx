import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductDetailPage } from '@/plugins/commerce/ProductDetailPage';

const { getMock, patchMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
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
  status: 'draft',
  productType: 'physical',
  basePrice: 1000,
  currency: 'USD',
  sku: null,
  categoryId: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  images: [],
};

function mockGet() {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/plugins/commerce/v1/products/p-1') return Promise.resolve(product);
    if (path.startsWith('/api/plugins/commerce/v1/categories')) return Promise.resolve([]);
    if (path === '/api/v1/admin/media') return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/plugins/commerce/products/:productId', element: <ProductDetailPage /> }], {
    initialEntries: ['/plugins/commerce/products/p-1'],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
  });

  it('renders the product fields and saves an edit', async () => {
    mockGet();
    patchMock.mockResolvedValue({ ...product, name: 'Renamed widget' });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Widget')).toBeInTheDocument());
    expect(screen.getByDisplayValue('widget')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed widget');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        '/api/plugins/commerce/v1/products/p-1',
        expect.objectContaining({ name: 'Renamed widget' }),
      ),
    );
  });

  it('disables fields and hides Save/Danger zone for a viewer', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'viewer@example.test', role: 'viewer' } },
      isPending: false,
    });
    mockGet();

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Widget')).toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
  });

  it('shows no-variants/no-images placeholders when both are empty', async () => {
    mockGet();

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Widget')).toBeInTheDocument());
    expect(screen.getByText(/No variants yet/)).toBeInTheDocument();
    expect(screen.getByText('No images yet.')).toBeInTheDocument();
  });
});
