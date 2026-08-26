import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryEditorPage } from '@/pages/EntryEditorPage';

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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/content-types/:contentTypeId/entries/:entryId"
            element={<EntryEditorPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntryEditorPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
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
});
