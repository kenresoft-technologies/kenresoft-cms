import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from '@/layouts/AppLayout';
import { TooltipProvider } from '@/components/ui/tooltip';

const { useSessionMock, signOutMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionMock,
    signOut: signOutMock,
  },
}));

function renderAppLayout() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login placeholder</div>} />
          <Route path="/" element={<AppLayout />}>
            <Route index element={<div>Protected content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signOutMock.mockReset();
  });

  it('shows a loading state while the session check is pending', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: true });

    renderAppLayout();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('redirects to /login once pending resolves with no session', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });

    renderAppLayout();

    expect(screen.getByText('Login placeholder')).toBeInTheDocument();
  });

  it('renders the outlet and user email when a session exists', () => {
    useSessionMock.mockReturnValue({
      data: { user: { email: 'owner@pathvera.test', role: 'owner' } },
      isPending: false,
    });

    renderAppLayout();

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.getByText('owner@pathvera.test')).toBeInTheDocument();
  });
});
