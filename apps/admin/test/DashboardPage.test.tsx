import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '@/pages/DashboardPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockGetByPath(dashboard: object, forms: unknown[] = [], users: unknown[] = []) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/dashboard')) return Promise.resolve(dashboard);
    if (path.startsWith('/api/v1/admin/forms')) return Promise.resolve(forms);
    if (path.startsWith('/api/v1/admin/users')) return Promise.resolve(users);
    return Promise.resolve([]);
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('shows the onboarding card when there are no content types yet', async () => {
    mockGetByPath({
      contentTypeCount: 0,
      entryCounts: { draft: 0, published: 0 },
      mediaCount: 0,
      mediaStorageBytes: 0,
      recentEntries: [],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Start with a content type')).toBeInTheDocument());
    expect(screen.queryByText('Content types')).not.toBeInTheDocument();
  });

  it('shows stat cards, quick actions, and recent activity once there is data', async () => {
    mockGetByPath(
      {
        contentTypeCount: 3,
        entryCounts: { draft: 2, published: 5 },
        mediaCount: 4,
        mediaStorageBytes: 2048,
        recentEntries: [
          {
            id: 'e-1',
            slug: 'hello-world',
            status: 'published',
            contentTypeId: 'ct-1',
            contentTypeName: 'Blog Post',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      [{ id: 'f-1' }, { id: 'f-2' }],
      [{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }, { id: 'u-4' }, { id: 'u-5' }, { id: 'u-6' }],
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Content types')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // total entries
    expect(screen.getByText('5 published, 2 draft')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    // Shown twice now: the Media stat card's hint, and the Storage Usage card's own media row.
    expect(screen.getAllByText('2 KB')).toHaveLength(2);
    expect(screen.getByText('hello-world')).toBeInTheDocument();
    expect(screen.getByText('Blog Post')).toBeInTheDocument();
    expect(screen.queryByText('Start with a content type')).not.toBeInTheDocument();

    // Forms/users counts, sourced from the already-existing useForms/useUsers hooks.
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.getByText('Forms')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();

    expect(screen.getByText('Quick actions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New content type/ })).toBeInTheDocument();

    // The one entry is published, so it shows under Recent activity, not Drafts.
    expect(screen.getByText('No drafts among recently updated entries.')).toBeInTheDocument();
  });

  it('shows an empty recent-activity message when there are content types but no entries', async () => {
    mockGetByPath({
      contentTypeCount: 1,
      entryCounts: { draft: 0, published: 0 },
      mediaCount: 0,
      mediaStorageBytes: 0,
      recentEntries: [],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Nothing yet.')).toBeInTheDocument());
    expect(screen.getByText('No entries yet.')).toBeInTheDocument();
  });
});
