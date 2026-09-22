import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLogPage } from '@/pages/AuditLogPage';

const { getMock, deleteMock, useSessionMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  deleteMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, delete: deleteMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: useSessionMock },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditLogPage />
    </QueryClientProvider>,
  );
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({ data: { user: { role: 'admin' } } });
  });

  it('shows a human-readable detail view instead of raw JSON when a row has metadata', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/users')) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'a-1',
          actorUserId: 'u-1',
          actorName: 'Alice Admin',
          actorEmail: 'alice@example.test',
          actorLabel: null,
          action: 'user.role_changed',
          targetType: 'user',
          targetId: 'u-2',
          metadata: { previousRole: 'editor', newRole: 'admin' },
          createdAt: '2026-01-05T12:00:00.000Z',
        },
      ]);
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Role Changed')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    // A previousRole/newRole pair renders as one visual before → after diff, not two unrelated
    // key/value rows.
    expect(screen.getByText('What changed')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    // Target identity is shown too, not just the metadata blob.
    expect(screen.getByText('Target id')).toBeInTheDocument();
    expect(screen.getByText('u-2')).toBeInTheDocument();
    // No literal curly braces from a stringified object anywhere in the sheet.
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('shows unpaired metadata as plain key/value rows, and can copy the raw entry as JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/users')) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'a-2',
          actorUserId: 'u-1',
          actorName: 'Alice Admin',
          actorEmail: 'alice@example.test',
          actorLabel: null,
          action: 'media.imported',
          targetType: 'media',
          targetId: 'm-1',
          metadata: { source: 'picsum', filename: 'photo.jpg' },
          createdAt: '2026-01-05T12:00:00.000Z',
        },
      ]);
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Imported')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(screen.queryByText('What changed')).not.toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('picsum')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Copy as JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"media.imported"')));
  });
});
