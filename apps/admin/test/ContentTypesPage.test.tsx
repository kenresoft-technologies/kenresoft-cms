import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTypesPage } from '@/pages/ContentTypesPage';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, post: postMock },
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/proj-1/content-types']}>
        <Routes>
          <Route path="/projects/:projectId/content-types" element={<ContentTypesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContentTypesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('fetches content types scoped to the project in the URL', async () => {
    getMock.mockImplementation((path: string) =>
      path.startsWith('/api/v1/admin/projects/')
        ? Promise.resolve({ id: 'proj-1', name: 'Pathvera Group', slug: 'pathvera' })
        : Promise.resolve([
            { id: 'ct-1', projectId: 'proj-1', name: 'Blog Post', slug: 'blog-post' },
          ]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Blog Post')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/content-types?projectId=proj-1');
    expect(screen.getByRole('heading', { name: 'Content types' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Pathvera Group' })).toBeInTheDocument(),
    );
  });

  it('creates a content type through the dialog with the projectId attached', async () => {
    getMock.mockImplementation((path: string) =>
      path.startsWith('/api/v1/admin/projects/')
        ? Promise.resolve({ id: 'proj-1', name: 'Pathvera Group', slug: 'pathvera' })
        : Promise.resolve([]),
    );
    postMock.mockResolvedValue({ id: 'ct-1', projectId: 'proj-1', name: 'Blog Post', slug: 'blog-post' });

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
        projectId: 'proj-1',
      }),
    );
  });
});
