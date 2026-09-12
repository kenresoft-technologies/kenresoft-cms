import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationSection } from '@/pages/settings/NavigationSection';

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, put: putMock } };
});

function renderSection(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationSection readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('NavigationSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
  });

  it('adds a new item as a plain URL target by default', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/pages') return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderSection();

    await waitFor(() => expect(screen.getByText('No navigation items yet.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page')).not.toBeInTheDocument();
  });

  it('switches an item to a Page reference and lets the editor pick one of the admin pages', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/pages') {
        return Promise.resolve([
          { id: 'page-1', route: '/about', title: 'About us', status: 'published' },
          { id: 'page-2', route: '/contact', title: 'Contact', status: 'published' },
        ]);
      }
      return Promise.resolve(null);
    });
    putMock.mockResolvedValue({ id: 'nav-1', module: 'navigation', data: { items: [] }, updatedAt: '2026-01-01' });

    renderSection();

    await waitFor(() => expect(screen.getByText('No navigation items yet.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await userEvent.click(screen.getByLabelText('Target'));
    await userEvent.click(await screen.findByRole('option', { name: 'Page' }));

    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Page')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Label'), 'About');
    await userEvent.click(screen.getByLabelText('Page'));
    await userEvent.click(await screen.findByRole('option', { name: 'Contact (/contact)' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        '/api/v1/admin/structured-settings/navigation',
        expect.objectContaining({
          items: [expect.objectContaining({ label: 'About', pageId: 'page-2' })],
        }),
      ),
    );
  });

  it('preserves an existing legacy url-only item unmodified until edited', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/pages') return Promise.resolve([]);
      if (path === '/api/v1/admin/structured-settings/navigation') {
        return Promise.resolve({
          id: 'nav-1',
          module: 'navigation',
          data: {
            items: [
              { label: 'Home', url: '/', visible: true, order: 0, external: false, newTab: false },
            ],
          },
          updatedAt: '2026-01-01',
        });
      }
      return Promise.resolve(null);
    });

    renderSection();

    await waitFor(() => expect(screen.getByDisplayValue('Home')).toBeInTheDocument());
    expect(screen.getByLabelText('URL')).toHaveValue('/');
  });
});
