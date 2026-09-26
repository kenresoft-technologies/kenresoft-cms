import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatesSection } from '@/pages/settings/UpdatesSection';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

function renderSection(readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UpdatesSection readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('Settings → Updates', () => {
  beforeEach(() => getMock.mockReset());

  it('shows the running version and a newer release with how to update and its notes', async () => {
    getMock.mockResolvedValue({
      version: '0.9.0',
      latest: { version: '0.9.1', url: 'https://github.com/o/r/releases/tag/v0.9.1', publishedAt: '2026-10-01T00:00:00Z' },
      updateAvailable: true,
      updateCheck: 'ok',
    });
    renderSection();

    expect(await screen.findByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(screen.getByText('v0.9.1')).toBeInTheDocument();
    expect(screen.getByText('pnpm run update')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Release notes/ })).toHaveAttribute('href', 'https://github.com/o/r/releases/tag/v0.9.1');
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/system/version');
  });

  it('says up to date when the running version is the latest', async () => {
    getMock.mockResolvedValue({
      version: '0.9.1',
      latest: { version: '0.9.1', url: 'https://github.com/o/r/releases/tag/v0.9.1', publishedAt: null },
      updateAvailable: false,
      updateCheck: 'ok',
    });
    renderSection();

    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('explains when the update check is off or unreachable, still showing the version', async () => {
    getMock.mockResolvedValue({ version: '0.9.0', latest: null, updateAvailable: false, updateCheck: 'disabled' });
    const { unmount } = renderSection();
    expect(await screen.findByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText(/turned off for this deployment/)).toBeInTheDocument();
    unmount();

    getMock.mockResolvedValue({ version: '0.9.0', latest: null, updateAvailable: false, updateCheck: 'unavailable' });
    renderSection();
    expect(await screen.findByText(/Couldn't check for a newer release/)).toBeInTheDocument();
  });

  it("doesn't request anything for someone who isn't an Admin or Owner", () => {
    renderSection(true);
    expect(screen.getByText(/Only Admins and Owners/)).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });
});
