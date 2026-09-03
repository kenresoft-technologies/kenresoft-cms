import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilePage } from '@/pages/ProfilePage';

const {
  getMock,
  useSessionMock,
  updateUserMock,
  changePasswordMock,
  enableTwoFactorMock,
  verifyTotpMock,
  disableTwoFactorMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  useSessionMock: vi.fn(),
  updateUserMock: vi.fn(),
  changePasswordMock: vi.fn(),
  enableTwoFactorMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  disableTwoFactorMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    updateUser: updateUserMock,
    changePassword: changePasswordMock,
    twoFactor: {
      enable: enableTwoFactorMock,
      verifyTotp: verifyTotpMock,
      disable: disableTwoFactorMock,
    },
  },
}));

// qrcode renders to a canvas/data-URL synchronously in the browser, but jsdom has no canvas —
// only the resulting <img src> matters for this component, not how it got generated.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,fake') } }));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
    useSessionMock.mockReset();
    updateUserMock.mockReset();
    changePasswordMock.mockReset();
    enableTwoFactorMock.mockReset();
    verifyTotpMock.mockReset();
    disableTwoFactorMock.mockReset();
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Pathvera Admin',
          email: 'admin@pathvera.test',
          role: 'admin',
          image: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          twoFactorEnabled: false,
        },
      },
      isPending: false,
    });
  });

  it('shows the signed-in user\'s name, email, role, and member-since date', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Pathvera Admin' })).toBeInTheDocument();
    expect(screen.getByText('admin@pathvera.test')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-01-01T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
  });

  it('has no fabricated phone or bio inputs', () => {
    renderPage();

    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/bio/i)).not.toBeInTheDocument();
  });

  it('updates the name through the Profile tab', async () => {
    updateUserMock.mockResolvedValue({ error: null });

    renderPage();
    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ name: 'New Name' }));
  });

  it('changes the password through the Security tab', async () => {
    changePasswordMock.mockResolvedValue({ error: null });

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(changePasswordMock).toHaveBeenCalledWith({
        currentPassword: 'old-password',
        newPassword: 'new-password-123',
      }),
    );
  });

  it('shows two-factor authentication as not enabled by default', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));

    expect(screen.getByText('Not enabled')).toBeInTheDocument();
  });

  it('enables two-factor authentication through the password-then-verify flow', async () => {
    enableTwoFactorMock.mockResolvedValue({
      data: {
        method: 'totp',
        totpURI: 'otpauth://totp/Kenresoft%20CMS:a@b.com?secret=ABC123&issuer=Kenresoft',
        backupCodes: ['aaaaa-11111'],
      },
      error: null,
    });
    verifyTotpMock.mockResolvedValue({ error: null });

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));

    await userEvent.type(screen.getByLabelText('Password'), 'my-password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(enableTwoFactorMock).toHaveBeenCalledWith({ password: 'my-password', issuer: 'Kenresoft CMS' });
    await waitFor(() => expect(screen.getByText('aaaaa-11111')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Code from your app'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));

    await waitFor(() => expect(verifyTotpMock).toHaveBeenCalledWith({ code: '654321' }));
  });

  it('disables two-factor authentication with a password confirmation', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Pathvera Admin',
          email: 'admin@pathvera.test',
          role: 'admin',
          image: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          twoFactorEnabled: true,
        },
      },
      isPending: false,
    });
    disableTwoFactorMock.mockResolvedValue({ error: null });

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await userEvent.type(screen.getByLabelText('Password'), 'my-password');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }));

    await waitFor(() => expect(disableTwoFactorMock).toHaveBeenCalledWith({ password: 'my-password' }));
  });
});
