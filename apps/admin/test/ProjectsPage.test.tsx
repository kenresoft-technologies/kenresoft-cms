import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsPage } from '@/pages/ProjectsPage';

const { getMock, postMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, post: postMock },
  };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock },
}));

function renderProjectsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'owner@pathvera.test', role: 'owner' } },
      isPending: false,
    });
  });

  it('lists projects returned by the API', async () => {
    getMock.mockResolvedValue([
      { id: '1', name: 'Pathvera Group', slug: 'pathvera', createdAt: '', updatedAt: '' },
    ]);

    renderProjectsPage();

    await waitFor(() => expect(screen.getByText('Pathvera Group')).toBeInTheDocument());
    expect(screen.getByText('pathvera')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/projects');
  });

  it('shows an empty state when there are no projects', async () => {
    getMock.mockResolvedValue([]);

    renderProjectsPage();

    await waitFor(() => expect(screen.getByText('No projects yet')).toBeInTheDocument());
  });

  it('hides the New project action for an editor, since only owners can create projects', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'editor@pathvera.test', role: 'editor' } },
      isPending: false,
    });
    getMock.mockResolvedValue([]);

    renderProjectsPage();

    await waitFor(() => expect(screen.getByText('No projects yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('creates a project through the dialog and refetches the list', async () => {
    getMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: '1', name: 'Pathvera Group', slug: 'pathvera', createdAt: '', updatedAt: '' },
    ]);
    postMock.mockResolvedValue({
      id: '1',
      name: 'Pathvera Group',
      slug: 'pathvera',
      createdAt: '',
      updatedAt: '',
    });

    renderProjectsPage();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Pathvera Group');
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'pathvera');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/projects', {
        name: 'Pathvera Group',
        slug: 'pathvera',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });
});
