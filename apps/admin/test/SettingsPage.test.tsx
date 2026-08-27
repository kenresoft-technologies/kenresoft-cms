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

  it('lets an owner fill in and save the General section', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({
      id: 's-1',
      name: 'Pathvera Group',
      contactEmail: null,
      socialLinks: null,
      corsOrigin: null,
      featureFlags: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Site name'), 'Pathvera Group');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/admin/settings', {
        name: 'Pathvera Group',
        contactEmail: null,
        corsOrigin: null,
        socialLinks: null,
        featureFlags: null,
      }),
    );
  });

  it('disables Save until a change is made, then adds and removes a feature flag before saving', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({ id: 's-1', name: 'x', updatedAt: '2026-01-01T00:00:00.000Z' });

    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

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

  it('navigates between sections, including Appearance and the not-yet-available ones', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'owner', email: 'owner@pathvera.test' } } });
    getMock.mockResolvedValue(null);

    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Site name')).toBeInTheDocument());

    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Social' }));
    expect(screen.getByLabelText('Website')).toBeInTheDocument();

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
    useSessionMock.mockReturnValue({ data: { user: { role: 'editor', email: 'editor@pathvera.test' } } });
    getMock.mockResolvedValue({
      id: 's-1',
      name: 'Pathvera Group',
      contactEmail: 'hello@pathvera.test',
      socialLinks: null,
      corsOrigin: null,
      featureFlags: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Site name')).toHaveValue('Pathvera Group'));
    expect(screen.getByLabelText('Site name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Only owners can make changes.', { exact: false })).toBeInTheDocument();
  });
});
