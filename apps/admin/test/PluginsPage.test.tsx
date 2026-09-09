import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginsPage } from '@/pages/PluginsPage';

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PluginsPage />
    </QueryClientProvider>,
  );
}

describe('PluginsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('lists bundled plugins with their manifest metadata and live enabled state', async () => {
    getMock.mockResolvedValue([
      { id: 'hello', name: 'Hello', description: 'Says hello.', version: '0.1.0', enabled: true },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
    expect(screen.getByText('Says hello.')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/plugins');
  });

  it('shows an empty state when nothing is bundled', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No plugins bundled')).toBeInTheDocument());
  });

  it('toggles a plugin off via the switch', async () => {
    getMock
      .mockResolvedValueOnce([{ id: 'hello', name: 'Hello', description: null, version: '0.1.0', enabled: true }])
      .mockResolvedValueOnce([{ id: 'hello', name: 'Hello', description: null, version: '0.1.0', enabled: false }]);
    patchMock.mockResolvedValue({ id: 'hello', name: 'Hello', description: null, version: '0.1.0', enabled: false });

    renderPage();
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/plugins/hello', { enabled: false }),
    );
  });
});
