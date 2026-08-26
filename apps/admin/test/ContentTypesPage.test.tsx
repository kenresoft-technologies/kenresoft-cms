import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTypesPage } from '@/pages/ContentTypesPage';

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContentTypesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContentTypesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'owner@pathvera.test', role: 'owner' } },
      isPending: false,
    });
  });

  it('lists content types returned by the API', async () => {
    getMock.mockResolvedValue([{ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' }]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Blog Post')).toBeInTheDocument());
    expect(screen.getByText('blog-post')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/content-types');
  });

  it('shows an empty state when there are no content types', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No content types yet')).toBeInTheDocument());
  });

  it('hides the New content type action for an editor, since only owners can create them', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'editor@pathvera.test', role: 'editor' } },
      isPending: false,
    });
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No content types yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New content type' })).not.toBeInTheDocument();
  });

  it('creates a content type through the dialog and refetches the list', async () => {
    getMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' }]);
    postMock.mockResolvedValue({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No content types yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New content type' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Blog Post');
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'blog-post');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create content type' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/content-types', {
        name: 'Blog Post',
        slug: 'blog-post',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
