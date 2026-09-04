import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from '@/layouts/AppLayout';
import { ThemeProvider } from '@/lib/theme';
import { TooltipProvider } from '@/components/ui/tooltip';

const { useSessionMock, signOutMock, getMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    signOut: signOutMock,
  },
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

function renderAppLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/login" element={<div>Login placeholder</div>} />
              <Route path="/" element={<AppLayout />}>
                <Route index element={<div>Protected content</div>} />
                <Route path="content-types" element={<div>Content types page</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signOutMock.mockReset();
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/dashboard')) {
        return Promise.resolve({
          contentTypeCount: 0,
          entryCounts: { draft: 0, published: 0 },
          mediaCount: 0,
          mediaStorageBytes: 0,
          recentEntries: [],
        });
      }
      if (path.startsWith('/api/v1/admin/plugins')) {
        return Promise.resolve([
          { id: 'hello', name: 'Hello', description: null, version: '0.1.0', enabled: true },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it('shows a loading state while the session check is pending', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: true });

    renderAppLayout();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('redirects to /login once pending resolves with no session', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });

    renderAppLayout();

    expect(screen.getByText('Login placeholder')).toBeInTheDocument();
  });

  it('renders the outlet and user email when a session exists', () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });

    renderAppLayout();

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
  });

  it('opens the command palette from the header button and navigates from it', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });

    renderAppLayout();

    await userEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(screen.getByPlaceholderText('Jump to…')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('option', { name: 'Content types' }));
    await waitFor(() => expect(screen.getByText('Content types page')).toBeInTheDocument());
  });

  it('renders the Plugins nav group with the hello plugin entry, and an admin-only Installed Plugins link', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });

    renderAppLayout();

    expect(screen.getByText('Plugins')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Hello' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Installed Plugins' })).toBeInTheDocument();
  });

  it('hides a disabled plugin from the sidebar once its live enabled state loads', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/dashboard')) {
        return Promise.resolve({
          contentTypeCount: 0,
          entryCounts: { draft: 0, published: 0 },
          mediaCount: 0,
          mediaStorageBytes: 0,
          recentEntries: [],
        });
      }
      if (path.startsWith('/api/v1/admin/plugins')) {
        return Promise.resolve([
          { id: 'hello', name: 'Hello', description: null, version: '0.1.0', enabled: false },
        ]);
      }
      return Promise.resolve([]);
    });

    renderAppLayout();

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Hello' })).not.toBeInTheDocument());
  });

  it('toggles the command palette with ctrl+k', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'admin@example.test', role: 'admin' } },
      isPending: false,
    });

    renderAppLayout();

    expect(screen.queryByPlaceholderText('Jump to…')).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByPlaceholderText('Jump to…')).toBeInTheDocument());
  });
});
