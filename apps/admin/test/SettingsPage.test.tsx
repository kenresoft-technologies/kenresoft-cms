import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '@/pages/SettingsPage';
import { ThemeProvider } from '@/lib/theme';

const { getMock, putMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, put: putMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    useSessionMock.mockReset();
  });

  it('lets an admin fill in and save the General section', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({
      id: 's-1',
      name: 'Acme Corp',
      corsOrigin: null,
      featureFlags: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Site name'), 'Acme Corp');
    // Two "Save changes" buttons render on this page now (Deployment identity + Site branding);
    // the deployment identity card's own is first in the DOM.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]!);

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/admin/settings', {
        name: 'Acme Corp',
        corsOrigin: null,
        featureFlags: null,
        previewUrl: null,
      }),
    );
  });

  it('disables Save until a change is made, then adds and removes a feature flag before saving', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({ id: 's-1', name: 'x', updatedAt: '2026-01-01T00:00:00.000Z' });

    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Save changes' })[0]).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    await userEvent.type(screen.getByPlaceholderText('flag-name'), 'newsletter-signup');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('newsletter-signup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        '/api/v1/admin/settings',
        expect.objectContaining({ featureFlags: { 'newsletter-signup': true } }),
      ),
    );
  });

  it('navigates between sections, including the new Structured Settings modules and the not-yet-available ones', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockResolvedValue(null);

    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Contact' }));
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Social' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add link' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Navigation' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Footer' }));
    await waitFor(() => expect(screen.getByLabelText('Copyright text')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'SEO' }));
    await waitFor(() => expect(screen.getByLabelText('Default title')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'API' }));
    expect(screen.getByLabelText('CORS origin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /API reference/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Security/ }));
    expect(screen.getByText('Not yet available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('renders read-only, with no save button, for an editor', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'editor', email: 'editor@example.test' } } });
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/settings') {
        return Promise.resolve({
          id: 's-1',
          name: 'Acme Corp',
          corsOrigin: null,
          featureFlags: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }
      if (path === '/api/v1/admin/media') return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Site name')).toHaveValue('Acme Corp'));
    expect(screen.getByLabelText('Site name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Only admins can make changes.', { exact: false })).toBeInTheDocument();
  });

  it('saves site branding (Structured Settings general module) separately from deployment identity', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin', email: 'admin@example.test' } } });
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/media') return Promise.resolve([]);
      return Promise.resolve(null);
    });
    putMock.mockImplementation((path: string, body: unknown) => {
      if (path === '/api/v1/admin/structured-settings/general') {
        return Promise.resolve({ id: 'gen-1', module: 'general', data: body, updatedAt: '2026-01-01T00:00:00.000Z' });
      }
      return Promise.resolve({ id: 's-1', name: 'x', updatedAt: '2026-01-01T00:00:00.000Z' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Public site name')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Public site name'), 'Kenresoft');
    const saveButtons = screen.getAllByRole('button', { name: 'Save changes' });
    // The Site branding card's own save bar — the second one on this page.
    await userEvent.click(saveButtons[saveButtons.length - 1]!);

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        '/api/v1/admin/structured-settings/general',
        expect.objectContaining({ siteName: 'Kenresoft' }),
      ),
    );
  });
});
