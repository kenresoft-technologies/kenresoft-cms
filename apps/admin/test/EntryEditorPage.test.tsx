import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryEditorPage } from '@/pages/EntryEditorPage';

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, post: postMock, patch: patchMock, delete: deleteMock },
  };
});

const fields = [
  { id: 'f-1', name: 'title', label: 'Title', fieldType: 'text', required: true, sortOrder: 0 },
  {
    id: 'f-2',
    name: 'featured',
    label: 'Featured',
    fieldType: 'boolean',
    required: false,
    sortOrder: 1,
  },
];

function renderEditor(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // useBlocker (unsaved-changes navigation guard) requires a data router, not the plain
  // <MemoryRouter>/<Routes> pairing used elsewhere in this test suite.
  const router = createMemoryRouter(
    [
      { path: '/content-types/:contentTypeId/entries/:entryId', element: <EntryEditorPage /> },
      { path: '/content-types/:contentTypeId/entries', element: <div>Entries list placeholder</div> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('EntryEditorPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
  });

  it('creates a new entry, defaulting field values by type, and posts the built data object', async () => {
    getMock.mockResolvedValue(fields);
    postMock.mockResolvedValue({ id: 'e-1' });

    renderEditor('/content-types/ct-1/entries/new');

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument());
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Featured')).not.toBeChecked();

    await userEvent.type(screen.getByLabelText('Slug'), 'hello-world');
    await userEvent.type(screen.getByLabelText('Title'), 'Hello World');
    await userEvent.click(screen.getByLabelText('Featured'));
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/entries?contentTypeId=ct-1', {
        slug: 'hello-world',
        status: 'draft',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      }),
    );
  });

  it('prefills the form from the existing entry when editing and PATCHes on save', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });
    patchMock.mockResolvedValue({ id: 'e-1' });

    renderEditor('/content-types/ct-1/entries/e-1');

    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));
    expect(screen.getByLabelText('Title')).toHaveValue('Hello World');
    expect(screen.getByLabelText('Featured')).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1', {
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      }),
    );
  });

  it('shows an unsaved-changes indicator once a field is edited, and clears it after saving', async () => {
    getMock.mockResolvedValue(fields);
    postMock.mockResolvedValue({ id: 'e-1' });

    renderEditor('/content-types/ct-1/entries/new');

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Slug'), 'hello-world');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Title'), 'Hello World');
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(screen.getByText('Entries list placeholder')).toBeInTheDocument());
  });

  it('blocks in-app navigation away from unsaved changes until the user confirms', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });

    renderEditor('/content-types/ct-1/entries/e-1');
    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));

    await userEvent.clear(screen.getByLabelText('Slug'));
    await userEvent.type(screen.getByLabelText('Slug'), 'changed-slug');

    await userEvent.click(screen.getByRole('link', { name: 'Entries' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave without saving?')).toBeInTheDocument();
    expect(screen.queryByText('Entries list placeholder')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByText('Entries list placeholder')).toBeInTheDocument());
  });

  it('shows current field values in the Preview tab', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });

    renderEditor('/content-types/ct-1/entries/e-1');
    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));

    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }));

    expect(screen.getByText('Hello World')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument(); // Featured: true
  });

  it('deletes the entry after confirming in the alert dialog', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });
    deleteMock.mockResolvedValue(undefined);

    renderEditor('/content-types/ct-1/entries/e-1');
    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));

    await userEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Delete "hello-world"?')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1'));
  });

  it('generates a preview token and opens the built preview URL in a new tab', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path.endsWith('/preview-token')) {
        return Promise.resolve({ token: 'tok-123', expiresAt: new Date(Date.now() + 900_000).toISOString() });
      }
      if (path === '/api/v1/admin/content-types/ct-1') {
        return Promise.resolve({ id: 'ct-1', slug: 'blog-post', name: 'Blog Post' });
      }
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({ previewUrl: 'http://localhost:4321/{contentType}/{slug}' });
      }
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderEditor('/content-types/ct-1/entries/e-1');
    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));

    await userEvent.click(screen.getByRole('button', { name: 'Live Preview' }));

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1/preview-token'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'http://localhost:4321/blog-post/hello-world?preview_token=tok-123',
        '_blank',
        'noopener,noreferrer',
      ),
    );
  });

  it('asks to save first instead of previewing when there are unsaved changes', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve(fields);
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path === '/api/v1/admin/content-types/ct-1') {
        return Promise.resolve({ id: 'ct-1', slug: 'blog-post', name: 'Blog Post' });
      }
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({ previewUrl: 'http://localhost:4321/{contentType}/{slug}' });
      }
      return Promise.resolve({
        id: 'e-1',
        slug: 'hello-world',
        status: 'published',
        data: { title: 'Hello World', featured: true },
        publishAt: null,
      });
    });

    renderEditor('/content-types/ct-1/entries/e-1');
    await waitFor(() => expect(screen.getByLabelText('Slug')).toHaveValue('hello-world'));

    await userEvent.type(screen.getByLabelText('Slug'), '-edited');
    await userEvent.click(screen.getByRole('button', { name: 'Live Preview' }));

    expect(getMock).not.toHaveBeenCalledWith('/api/v1/admin/entries/e-1/preview-token');
  });
});
