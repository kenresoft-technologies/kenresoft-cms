import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllEntriesPage } from '@/pages/AllEntriesPage';

const { getMock, deleteMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  deleteMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, delete: deleteMock, patch: patchMock },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AllEntriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const contentTypes = [
  { id: 'ct-1', name: 'Blog Post', slug: 'blog-post' },
  { id: 'ct-2', name: 'Service', slug: 'service' },
];

const allEntries = [
  {
    id: 'e-1',
    contentTypeId: 'ct-1',
    slug: 'hello-world',
    status: 'published',
    data: {},
    updatedAt: '2026-01-02T00:00:00.000Z',
    contentTypeName: 'Blog Post',
    contentTypeSlug: 'blog-post',
    authorName: 'Jane Doe',
    authorEmail: 'jane@pathvera.test',
  },
  {
    id: 'e-2',
    contentTypeId: 'ct-2',
    slug: 'admissions-support',
    status: 'draft',
    data: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    contentTypeName: 'Service',
    contentTypeSlug: 'service',
    authorName: null,
    authorEmail: null,
  },
];

function mockGet(entries: unknown[]) {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/entries') return Promise.resolve(entries);
    if (path === '/api/v1/admin/content-types') return Promise.resolve(contentTypes);
    return Promise.resolve([]);
  });
}

describe('AllEntriesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    patchMock.mockReset().mockResolvedValue({});
  });

  it('lists entries from multiple content types, with content type, author, and status', async () => {
    mockGet(allEntries);

    renderPage();

    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());
    expect(screen.getByText('admissions-support')).toBeInTheDocument();
    expect(screen.getByText('Blog Post')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/entries');
  });

  it('shows an em dash for entries with no author', async () => {
    mockGet(allEntries);

    renderPage();

    await waitFor(() => expect(screen.getByText('admissions-support')).toBeInTheDocument());
    const row = screen.getByText('admissions-support').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('—')).toBeInTheDocument();
  });

  it('shows an empty state when there are no entries', async () => {
    mockGet([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No entries yet')).toBeInTheDocument());
  });

  it('filters by content type', async () => {
    mockGet(allEntries);

    renderPage();
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by content type' }));
    await userEvent.click(screen.getByRole('option', { name: 'Service' }));

    expect(screen.queryByText('hello-world')).not.toBeInTheDocument();
    expect(screen.getByText('admissions-support')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockGet(allEntries);

    renderPage();
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Draft' }));

    expect(screen.queryByText('hello-world')).not.toBeInTheDocument();
    expect(screen.getByText('admissions-support')).toBeInTheDocument();
  });

  it('the New entry menu links each content type to its own new-entry route', async () => {
    mockGet(allEntries);

    renderPage();
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /New entry/ }));

    expect(screen.getByRole('menuitem', { name: 'Blog Post' })).toHaveAttribute(
      'href',
      '/content-types/ct-1/entries/new',
    );
    expect(screen.getByRole('menuitem', { name: 'Service' })).toHaveAttribute(
      'href',
      '/content-types/ct-2/entries/new',
    );
  });

  it('deletes an entry from its row actions menu after confirming', async () => {
    mockGet(allEntries);

    renderPage();
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    const row = screen.getByText('hello-world').closest('tr');
    await userEvent.click(within(row!).getByRole('button', { name: 'Entry actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1'));
  });

  it('bulk-deletes selected rows spanning different content types', async () => {
    mockGet(allEntries);

    renderPage();
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2));
    expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-1');
    expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/entries/e-2');
  });
});
