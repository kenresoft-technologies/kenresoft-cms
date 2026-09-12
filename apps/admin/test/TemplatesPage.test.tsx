import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatesPage } from '@/pages/TemplatesPage';

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
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TemplatesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it('lists templates returned by the API', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/templates') {
        return Promise.resolve([
          {
            id: 't-1',
            name: 'Landing page',
            contentTypeId: null,
            blocks: [],
            isDefault: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Landing page')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/templates');
  });

  it('shows an empty state when there are no templates', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('No templates yet')).toBeInTheDocument());
  });

  it('creates a general-purpose template through the dialog', async () => {
    postMock.mockResolvedValue({
      id: 't-1',
      name: 'Landing page',
      contentTypeId: null,
      blocks: [],
      isDefault: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No templates yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New template' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Landing page');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/templates', {
        name: 'Landing page',
        contentTypeId: null,
        isDefault: false,
        blocks: [],
      }),
    );
  });
});
