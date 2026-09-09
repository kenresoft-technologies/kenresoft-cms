import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommerceSettingsPage } from '@/plugins/commerce/SettingsPage';

const { getMock, putMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, put: putMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CommerceSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommerceSettingsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
  });

  it('shows the current settings and saves an edit', async () => {
    getMock.mockResolvedValue({ storeName: 'My Store', defaultCurrency: 'NGN' });
    putMock.mockResolvedValue({ storeName: 'New Name', defaultCurrency: 'USD' });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('My Store')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/settings');

    const nameInput = screen.getByLabelText('Store name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');
    const currencyInput = screen.getByLabelText('Default currency');
    await userEvent.clear(currencyInput);
    await userEvent.type(currencyInput, 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/plugins/commerce/v1/settings', {
        storeName: 'New Name',
        defaultCurrency: 'USD',
      }),
    );
  });

  it('disables inputs and hides Save for a viewer', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'viewer@example.test', role: 'viewer' } },
      isPending: false,
    });
    getMock.mockResolvedValue({ storeName: 'My Store', defaultCurrency: 'NGN' });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('My Store')).toBeInTheDocument());
    expect(screen.getByLabelText('Store name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
