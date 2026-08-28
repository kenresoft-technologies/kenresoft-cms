import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from '@/pages/LoginPage';
import { ThemeProvider } from '@/lib/theme';

const { useSessionMock, signInEmailMock, signUpEmailMock, getSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signInEmailMock: vi.fn(),
  signUpEmailMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    signIn: { email: signInEmailMock },
    signUp: { email: signUpEmailMock },
    getSession: getSessionMock,
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
    signUpEmailMock.mockReset();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { user: { email: 'user@pathvera.test' } } });
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

    await userEvent.type(screen.getByLabelText('Email'), 'user@pathvera.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: 'user@pathvera.test',
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

    await userEvent.type(screen.getByLabelText('Email'), 'user@pathvera.test');
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

    await userEvent.type(screen.getByLabelText('Email'), 'user@pathvera.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByText(/your browser blocked the session cookie/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('switches to sign-up mode, collects a name, and submits without a client-set role', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    signUpEmailMock.mockResolvedValue({ error: null });

    renderLoginPage();

    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByText('Create your account')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@pathvera.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(signUpEmailMock).toHaveBeenCalledWith({
      email: 'ada@pathvera.test',
      password: 'correct horse battery staple',
      name: 'Ada Lovelace',
    });
  });

  it('toggles back to sign-in mode', async () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });

    renderLoginPage();

    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });
});
