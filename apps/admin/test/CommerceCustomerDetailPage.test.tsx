import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerDetailPage } from '@/plugins/commerce/CustomerDetailPage';

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

const customer = {
  id: 'c-1',
  email: 'alice@example.test',
  name: 'Alice Anderson',
  phone: '+1-555-0100',
  emailVerified: true,
  disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  addresses: [
    {
      id: 'a-1',
      label: 'Home',
      recipientName: 'Alice Anderson',
      line1: '123 Main St',
      line2: null,
      city: 'Lagos',
      region: null,
      postalCode: '100001',
      country: 'NG',
      phone: null,
      isDefault: true,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/plugins/commerce/customers/:customerId', element: <CustomerDetailPage /> }], {
    initialEntries: ['/plugins/commerce/customers/c-1'],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('CustomerDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('renders profile fields and the address list', async () => {
    getMock.mockResolvedValue(customer);

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Alice Anderson' })).toBeInTheDocument());
    expect(screen.getByText('alice@example.test')).toBeInTheDocument();
    expect(screen.getByText('123 Main St, Lagos 100001, NG', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('disables the customer via the danger-zone confirm flow', async () => {
    getMock.mockResolvedValue(customer);
    patchMock.mockResolvedValue({ ...customer, disabled: true });

    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Alice Anderson' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Disable customer' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/customers/c-1', { disabled: true }));
  });
});
