import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from '@/pages/UsersPage';

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

const users = [
  {
    id: 'u-1',
    name: 'Owner User',
    email: 'owner@pathvera.test',
    role: 'owner' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'u-2',
    name: 'Editor User',
    email: 'editor@pathvera.test',
    role: 'editor' as const,
    createdAt: '2026-01-02T00:00:00.000Z',
    lastActiveAt: null,
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    useSessionMock.mockReset();
  });

  it('lists users with their role, last active, and joined date', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();

    await waitFor(() => expect(screen.getByText('Owner User')).toBeInTheDocument());
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    expect(screen.getByText('editor@pathvera.test')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows role as a read-only badge for an editor viewer', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'editor', email: 'editor@pathvera.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();

    await waitFor(() => expect(screen.getByText('Owner User')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
  });

  it('lets an owner change another user\'s role via the inline select', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue(users);
    patchMock.mockResolvedValue({ ...users[1], role: 'owner' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    await userEvent.click(selects[1]!);
    await userEvent.click(await screen.findByRole('option', { name: 'Owner' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/users/u-2/role', { role: 'owner' }),
    );
  });

  it('shows an empty state when there are no users', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No users yet')).toBeInTheDocument());
  });
});
