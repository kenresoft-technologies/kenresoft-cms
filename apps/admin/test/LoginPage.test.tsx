import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from '@/pages/LoginPage';

const { useSessionMock, signInEmailMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signInEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    signIn: { email: signInEmailMock },
  },
}));

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Dashboard placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signInEmailMock.mockReset();
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
});
