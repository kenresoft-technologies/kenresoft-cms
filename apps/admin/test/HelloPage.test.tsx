import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HelloPage } from '@/plugins/hello/HelloPage';

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HelloPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HelloPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
  });

  it('lists greetings returned by the API', async () => {
    getMock.mockResolvedValue([{ id: 'g-1', message: 'Hello, World', createdAt: '2026-01-01T00:00:00.000Z' }]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Hello, World')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/plugins/hello/v1/greetings');
  });

  it('shows an empty state when there are no greetings', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No greetings yet')).toBeInTheDocument());
  });

  it('hides the create form for a viewer', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'viewer@example.test', role: 'viewer' } },
      isPending: false,
    });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No greetings yet')).toBeInTheDocument());
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('creates a greeting through the form and refetches the list', async () => {
    getMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'g-1', message: 'Hello, World', createdAt: '2026-01-01T00:00:00.000Z' }]);
    postMock.mockResolvedValue({ id: 'g-1', message: 'Hello, World', createdAt: '2026-01-01T00:00:00.000Z' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No greetings yet')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Message'), 'World');
    await userEvent.click(screen.getByRole('button', { name: 'Create greeting' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/plugins/hello/v1/greetings', { message: 'World' }),
    );
  });
});
