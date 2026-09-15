import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageEditorPage } from '@/pages/PageEditorPage';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

const basePage = {
  id: 'p-1',
  route: '/about',
  title: 'About us',
  status: 'published',
  publishAt: null,
  templateId: null,
  blocks: [],
  seo: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pages/p-1']}>
        <Routes>
          <Route path="/pages/:pageId" element={<PageEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageEditorPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('generates a preview token and opens the built preview URL in a new tab', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path.endsWith('/preview-token')) {
        return Promise.resolve({ token: 'tok-123', expiresAt: new Date(Date.now() + 900_000).toISOString() });
      }
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({ pagePreviewUrl: 'http://localhost:4321{route}' });
      }
      return Promise.resolve(basePage);
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderEditor();
    await waitFor(() => expect(screen.getByDisplayValue('About us')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Live Preview' }));

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/admin/pages/p-1/preview-token'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'http://localhost:4321/about?preview_token=tok-123',
        '_blank',
        'noopener,noreferrer',
      ),
    );
  });

  it('asks to save first instead of previewing when there are unsaved changes', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({ pagePreviewUrl: 'http://localhost:4321{route}' });
      }
      return Promise.resolve(basePage);
    });

    renderEditor();
    await waitFor(() => expect(screen.getByDisplayValue('About us')).toBeInTheDocument());

    await userEvent.type(screen.getByDisplayValue('About us'), ' (draft)');
    await userEvent.click(screen.getByRole('button', { name: 'Live Preview' }));

    expect(getMock).not.toHaveBeenCalledWith('/api/v1/admin/pages/p-1/preview-token');
  });

  it('allows Live Preview again right after saving an edit, instead of staying permanently dirty', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path.endsWith('/preview-token')) {
        return Promise.resolve({ token: 'tok-123', expiresAt: new Date(Date.now() + 900_000).toISOString() });
      }
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({ pagePreviewUrl: 'http://localhost:4321{route}' });
      }
      return Promise.resolve(basePage);
    });
    patchMock.mockResolvedValue(basePage);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderEditor();
    await waitFor(() => expect(screen.getByDisplayValue('About us')).toBeInTheDocument());

    await userEvent.type(screen.getByDisplayValue('About us'), ' (v2)');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Live Preview' }));

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/admin/pages/p-1/preview-token'));
    expect(openSpy).toHaveBeenCalled();
  });

  it('saves title/route/status/blocks through the admin API', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/revisions')) return Promise.resolve([]);
      if (path === '/api/v1/admin/settings') return Promise.resolve(null);
      return Promise.resolve(basePage);
    });
    patchMock.mockResolvedValue(basePage);

    renderEditor();
    await waitFor(() => expect(screen.getByDisplayValue('About us')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/pages/p-1', {
        title: 'About us',
        route: '/about',
        status: 'published',
        blocks: [],
      }),
    );
  });
});
