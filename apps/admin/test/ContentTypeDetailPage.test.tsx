import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { ContentTypeDetailPage } from '@/pages/ContentTypeDetailPage';

const { getMock, postMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, post: postMock, patch: patchMock },
  };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { role: 'admin' } } }) },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/content-types/ct-1']}>
        <Routes>
          <Route path="/content-types/:contentTypeId" element={<ContentTypeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContentTypeDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
  });

  it('fetches the content type and its fields scoped by contentTypeId', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) {
        return Promise.resolve([
          { id: 'f-1', name: 'title', label: 'Title', fieldType: 'text', required: true },
        ]);
      }
      return Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' });
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Blog Post' })).toBeInTheDocument(),
    );
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/content-types/ct-1/fields');
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/content-types/ct-1');
  });

  it('adds a field through the dialog, defaulting to type=text and required=false', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' });
    });
    postMock.mockResolvedValue({
      id: 'f-1',
      name: 'title',
      label: 'Title',
      fieldType: 'text',
      required: false,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No fields yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'title');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/content-types/ct-1/fields', {
        name: 'title',
        label: 'Title',
        fieldType: 'text',
        required: false,
        config: null,
      }),
    );
  });

  it('adds a select field with configured options', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path === '/api/v1/admin/content-types') return Promise.resolve([]);
      return Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post' });
    });
    postMock.mockResolvedValue({
      id: 'f-1',
      name: 'status',
      label: 'Status',
      fieldType: 'select',
      required: false,
      config: { options: ['open', 'closed'] },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No fields yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'status');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Status');

    await userEvent.click(within(dialog).getByLabelText('Type'));
    await userEvent.click(screen.getByRole('option', { name: 'select' }));

    await userEvent.type(within(dialog).getByPlaceholderText('option value'), 'open');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await userEvent.type(within(dialog).getByPlaceholderText('option value'), 'closed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/content-types/ct-1/fields', {
        name: 'status',
        label: 'Status',
        fieldType: 'select',
        required: false,
        config: { options: ['open', 'closed'] },
      }),
    );
  });

  it('edits a content type, including its route pattern, through the edit dialog', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post', routePattern: null });
    });
    patchMock.mockResolvedValue({
      id: 'ct-1',
      name: 'Blog Post',
      slug: 'blog-post',
      routePattern: '/blog/{slug}',
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Blog Post' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    // userEvent.type interprets a bare "{" as special-key syntax (closing "}" alone is
    // literal), so a real "{slug}" is typed as "{{slug}" — see testing-library/user-event's
    // own docs on escaping curly braces.
    await userEvent.type(within(dialog).getByLabelText('Route pattern'), '/blog/{{slug}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/content-types/ct-1', {
        name: 'Blog Post',
        slug: 'blog-post',
        description: null,
        routePattern: '/blog/{slug}',
      }),
    );
  });

  it('surfaces the server-side collision error when saving a duplicate route pattern', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'ct-1', name: 'Blog Post', slug: 'blog-post', routePattern: null });
    });
    patchMock.mockRejectedValue(
      new ApiError(400, 'That route pattern is already used by another content type.'),
    );

    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Blog Post' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    // userEvent.type interprets a bare "{" as special-key syntax (closing "}" alone is
    // literal), so a real "{slug}" is typed as "{{slug}" — see testing-library/user-event's
    // own docs on escaping curly braces.
    await userEvent.type(within(dialog).getByLabelText('Route pattern'), '/blog/{{slug}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText('That route pattern is already used by another content type.')).toBeInTheDocument(),
    );
  });
});
