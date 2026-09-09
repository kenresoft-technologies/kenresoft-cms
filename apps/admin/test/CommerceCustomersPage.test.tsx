import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomersPage } from '@/plugins/commerce/CustomersPage';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

const customer = {
  id: 'c-1',
  email: 'alice@example.test',
  name: 'Alice Anderson',
  phone: null,
  emailVerified: true,
  disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomersPage', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('lists customers returned by the API', async () => {
    getMock.mockResolvedValue([customer]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Alice Anderson')).toBeInTheDocument());
    expect(screen.getByText('alice@example.test')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/customers?');
  });

  it('shows an empty state when there are no customers', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No customers yet')).toBeInTheDocument());
  });
});
