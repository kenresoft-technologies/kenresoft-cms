import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserDetailPage } from '@/pages/UserDetailPage';

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

const editorUser = {
  id: 'u-2',
  name: 'Editor User',
  email: 'editor@example.test',
  role: 'editor' as const,
  disabled: false,
  emailVerified: true,
  developerToolsAccess: false,
  isCommerceCustomer: false,
  phone: null,
  internalNotes: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  lastActiveAt: null,
};

function renderPage(userId = 'u-2') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${userId}`]}>
        <Routes>
          <Route path="/users/:userId" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    useSessionMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/plugins')) return Promise.resolve([]);
      if (path.startsWith('/api/v1/admin/users/')) return Promise.resolve([]);
      return Promise.resolve([editorUser]);
    });
  });

  it("shows the account's role, type, and details", async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Editor User', level: 1 })).toBeInTheDocument());
    expect(screen.getAllByText('CMS Staff').length).toBeGreaterThan(0);
  });

  it('lets an admin toggle developer tools access from the detail page (not the table)', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    patchMock.mockResolvedValue({ ...editorUser, developerToolsAccess: true });

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Editor User', level: 1 })).toBeInTheDocument());
    const toggle = screen.getByRole('switch', { name: 'Developer tools access for Editor User' });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/users/u-2/developer-tools-access', {
        developerToolsAccess: true,
      }),
    );
  });

  it('shows an explanation and a link back to Users for an unknown or inaccessible account', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });

    renderPage('does-not-exist');

    await waitFor(() => expect(screen.getByText(/doesn't exist/)).toBeInTheDocument());
  });

  it('lets staff save an internal note that is never shown to the account owner', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    patchMock.mockResolvedValue({ ...editorUser, internalNotes: 'Reset password on 2026-01-10 per support ticket #42' });

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Editor User', level: 1 })).toBeInTheDocument());
    const notesField = screen.getByPlaceholderText('No notes yet.');
    await userEvent.type(notesField, 'Reset password on 2026-01-10 per support ticket #42');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/users/u-2/notes', {
        internalNotes: 'Reset password on 2026-01-10 per support ticket #42',
      }),
    );
  });
});
