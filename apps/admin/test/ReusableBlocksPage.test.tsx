import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReusableBlocksPage } from '@/pages/ReusableBlocksPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, post: postMock } };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReusableBlocksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReusableBlocksPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('lists reusable blocks returned by the API', async () => {
    getMock.mockResolvedValue([
      { id: 'rb-1', name: 'Global CTA', type: 'cta', config: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Global CTA')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/reusable-blocks');
  });

  it('shows an empty state when there are no reusable blocks', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No reusable blocks yet')).toBeInTheDocument());
  });

  it('creates a reusable block through the dialog, defaulting to the first block type', async () => {
    getMock.mockResolvedValue([]);
    postMock.mockResolvedValue({
      id: 'rb-1',
      name: 'Global CTA',
      type: 'hero',
      config: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No reusable blocks yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New reusable block' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Global CTA');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/reusable-blocks', {
        name: 'Global CTA',
        type: 'hero',
        config: {},
      }),
    );
  });
});
