import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from '@/pages/LoginPage';
import { ThemeProvider } from '@/lib/theme';

const {
  useSessionMock,
  signInEmailMock,
  getSessionMock,
  signOutMock,
  verifyTotpMock,
  verifyBackupCodeMock,
  sendVerificationEmailMock,
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signInEmailMock: vi.fn(),
  getSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  verifyBackupCodeMock: vi.fn(),
  sendVerificationEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    signIn: { email: signInEmailMock },
    signOut: signOutMock,
    getSession: getSessionMock,
    twoFactor: { verifyTotp: verifyTotpMock, verifyBackupCode: verifyBackupCodeMock },
    sendVerificationEmail: sendVerificationEmailMock,
  },
}));

function renderLoginPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard placeholder</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signInEmailMock.mockReset();
    signOutMock.mockReset();
    getSessionMock.mockReset();
    verifyTotpMock.mockReset();
    verifyBackupCodeMock.mockReset();
    sendVerificationEmailMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { user: { email: 'user@example.test', role: 'editor' } } });
  });

  it('redirects to / when a session already exists', () => {
    useSessionMock.mockReturnValue({ data: { user: { email: 'a@b.com' } }, isPending: false });

    renderLoginPage();

    expect(screen.getByText('Dashboard placeholder')).toBeInTheDocument();
  });

  it('does not redirect while the session check is pending', () => {
    // Regression guard: navigating right after signIn.email() resolves — instead of
    // reacting to the session store — races the store's own follow-up refresh (see
    // AppLayout.tsx and this component's use of authClient.useSession()).
    useSessionMock.mockReturnValue({ data: null, isPending: true });

    renderLoginPage();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('submits credentials and surfaces an error on failure', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ error: { message: 'Invalid credentials' } });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'user@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'wrong-password',
    });
    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
  });

  it('shows a real error instead of hanging forever when the request throws', async () => {
    // Regression guard for the exact bug that left the button stuck on "Signing in…"
    // indefinitely against a real deployment: a CORS-rejected request throws rather than
    // resolving to { error }, and the submit handler used to have no try/catch around it.
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'user@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('tells the user their browser blocked the session cookie instead of failing silently', async () => {
    // Regression guard for the real bug this covers: a cross-site deployment (admin and API on
    // different sites — this happened with the admin's own dev:live mode pointed at a deployed
    // API) makes the session cookie third-party, which some browsers block by default. The
    // sign-in call itself still resolves with no error, so without this check the user was left
    // staring at an unchanged login screen with zero feedback.
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({ data: null });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'user@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByText(/your browser blocked the session cookie/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('is the CMS entry point only: it offers no self-registration', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });

    renderLoginPage();

    expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.getByText(/CMS accounts are created by an administrator/i)).toBeInTheDocument();
  });

  it('signs out and explains when the account is valid but has no CMS role (e.g. a website user)', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({ data: { user: { email: 'shopper@example.test', role: 'none' } } });
    signOutMock.mockResolvedValue({});

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'shopper@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText(/does not have access to the CMS/i)).toBeInTheDocument());
    expect(signOutMock).toHaveBeenCalled();
  });

  it('prompts for a 2FA code when sign-in reports twoFactorRedirect, then verifies it', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyTotpMock.mockResolvedValue({ error: null });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'user@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Two-factor verification')).toBeInTheDocument());
    // A real session check must not have run yet off the sign-in call itself — only after
    // the 2FA code is verified — otherwise "signed in but blocked cookie" would misfire here.
    expect(getSessionMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(verifyTotpMock).toHaveBeenCalledWith({ code: '123456' });
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
  });

  it('falls back to a backup code on the 2FA step', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyBackupCodeMock.mockResolvedValue({ error: null });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'user@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Two-factor verification')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.type(screen.getByLabelText('Backup code'), 'abcd1-efgh2');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(verifyBackupCodeMock).toHaveBeenCalledWith({ code: 'abcd1-efgh2' });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it('shows a verify-your-email state on EMAIL_NOT_VERIFIED, with a working resend button', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } });
    sendVerificationEmailMock.mockResolvedValue({ error: null });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'unverified@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());
    // Not the generic red error banner — the dedicated state instead.
    expect(screen.queryByText('Email not verified')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    expect(sendVerificationEmailMock).toHaveBeenCalledWith({ email: 'unverified@example.test' });
    await waitFor(() =>
      expect(screen.getByText(/we've sent a new link/i)).toBeInTheDocument(),
    );
  });

  it('goes back to the sign-in form from the verify-your-email state', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signInEmailMock.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'unverified@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
