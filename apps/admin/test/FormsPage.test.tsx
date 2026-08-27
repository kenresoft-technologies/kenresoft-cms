import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormsPage } from '@/pages/FormsPage';

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
        <FormsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FormsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'owner@pathvera.test', role: 'owner' } },
      isPending: false,
    });
  });

  it('lists forms returned by the API', async () => {
    getMock.mockResolvedValue([{ id: 'f-1', name: 'Contact', slug: 'contact' }]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/forms');
  });

  it('shows an empty state when there are no forms', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No forms yet')).toBeInTheDocument());
  });

  it('hides the New form action for an editor', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'editor@pathvera.test', role: 'editor' } },
      isPending: false,
    });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No forms yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New form' })).not.toBeInTheDocument();
  });

  it('creates a form through the dialog and refetches the list', async () => {
    getMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'f-1', name: 'Contact', slug: 'contact' }]);
    postMock.mockResolvedValue({ id: 'f-1', name: 'Contact', slug: 'contact' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No forms yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New form' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Contact');
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'contact');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create form' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/forms', { name: 'Contact', slug: 'contact' }),
    );
  });
});
