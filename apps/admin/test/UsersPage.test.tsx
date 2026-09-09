import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from '@/pages/UsersPage';

const { getMock, patchMock, useSessionMock, getSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  useSessionMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock, getSession: getSessionMock },
}));

const users = [
  {
    id: 'u-1',
    name: 'Admin User',
    email: 'admin@example.test',
    role: 'admin' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'u-2',
    name: 'Editor User',
    email: 'editor@example.test',
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
    getSessionMock.mockReset();
  });

  it('lists users with their role, last active, and joined date', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();

    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    expect(screen.getByText('editor@example.test')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows the stat cards derived from the user list', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();

    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());
    expect(screen.getByText('Total users')).toBeInTheDocument();
    // 2 total, 1 with a non-null lastActiveAt, 1 admin.
    expect(screen.getByText('Active users').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Administrators').nextElementSibling).toHaveTextContent('1');
  });

  it('shows role as a read-only badge for an editor viewer', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'editor', email: 'editor@example.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();

    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());
    // Scoped to the table itself — DataTable's own "Per page" selector, and this page's
    // own role/status filter selects, are comboboxes too, but none of them are a
    // role-editing control on a specific row.
    expect(within(screen.getByRole('table')).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('lets an admin change another user\'s role via the inline select', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(users);
    patchMock.mockResolvedValue({ ...users[1], role: 'admin' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument());

    const editorRow = screen.getByRole('row', { name: /Editor User/ });
    await userEvent.click(within(editorRow).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/users/u-2/role', { role: 'admin' }),
    );
  });

  // Regression test: an admin demoting themselves via this same select updated the users
  // list correctly but left every admin-gated UI affordance (this page's own Add User button,
  // other pages' isAdmin/canManageFields checks) stuck showing admin-level access until a full
  // reload — those all read authClient.useSession()'s client-cached session, which nothing in
  // the role-change mutation used to refresh.
  it("refreshes the cached session after a role change, so a self-demotion doesn't need a manual reload", async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(users);
    patchMock.mockResolvedValue({ ...users[0], role: 'editor' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());

    const adminRow = screen.getByRole('row', { name: /Admin User/ });
    await userEvent.click(within(adminRow).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Editor' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/users/u-1/role', { role: 'editor' }),
    );
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
  });

  it('filters the list by role', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(users);

    renderPage();
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Editor' }));

    await waitFor(() => expect(screen.queryByText('Admin User')).not.toBeInTheDocument());
    expect(screen.getByText('Editor User')).toBeInTheDocument();
  });

  it('shows an empty state when there are no users', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No users yet')).toBeInTheDocument());
  });
});
