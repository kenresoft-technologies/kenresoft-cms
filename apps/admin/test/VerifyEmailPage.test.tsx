import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { ThemeProvider } from '@/lib/theme';

const { verifyEmailMock, sendVerificationEmailMock } = vi.hoisted(() => ({
  verifyEmailMock: vi.fn(),
  sendVerificationEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    verifyEmail: verifyEmailMock,
    sendVerificationEmail: sendVerificationEmailMock,
  },
}));

function renderVerifyEmailPage(search = '?token=real-token') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/verify-email${search}`]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/login" element={<div>Login placeholder</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    verifyEmailMock.mockReset();
    sendVerificationEmailMock.mockReset();
  });

  it('shows a missing-token state with no verify call when the URL has no token', () => {
    renderVerifyEmailPage('');

    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it('shows success and a Sign in link once the token verifies', async () => {
    verifyEmailMock.mockResolvedValue({ error: null });

    renderVerifyEmailPage();

    expect(verifyEmailMock).toHaveBeenCalledWith({ query: { token: 'real-token' } });
    await waitFor(() => expect(screen.getByText('Your email has been verified')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows an invalid/expired state and lets the user request a new link', async () => {
    verifyEmailMock.mockResolvedValue({ error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } });
    sendVerificationEmailMock.mockResolvedValue({ error: null });

    renderVerifyEmailPage();

    await waitFor(() => expect(screen.getByText('Link invalid or expired')).toBeInTheDocument());
    // Never surfaces the raw error code to the user.
    expect(screen.queryByText('TOKEN_EXPIRED')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send a new verification email' }));

    expect(sendVerificationEmailMock).toHaveBeenCalledWith({ email: 'someone@example.test' });
    await waitFor(() => expect(screen.getByText(/we've sent a new link/i)).toBeInTheDocument());
  });

  it('shows a resend-failure state without crashing when resend throws', async () => {
    verifyEmailMock.mockResolvedValue({ error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
    sendVerificationEmailMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderVerifyEmailPage();

    await waitFor(() => expect(screen.getByText('Link invalid or expired')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send a new verification email' }));

    await waitFor(() =>
      expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeInTheDocument(),
    );
  });
});
