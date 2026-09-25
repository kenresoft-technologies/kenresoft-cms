import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmissionDetailPage } from '@/pages/SubmissionDetailPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { role: 'admin', name: 'Staff', email: 'staff@example.test' } } }) },
}));

const form = {
  id: 'f-1',
  name: 'Student Support',
  slug: 'student-support',
  notificationEmails: ['staff@example.test'],
  requiresAccount: true,
  stages: ['Submitted', 'Under Review', 'Completed'],
  accountSubmissionUrl: 'https://site.example/requests/{id}',
};

const baseSubmission = {
  id: 's-1',
  formId: 'f-1',
  formName: 'Student Support',
  formSlug: 'student-support',
  data: { name: 'Ada Student', email: 'ada@example.test', details: 'Please review my CV.' },
  status: 'new',
  isTest: false,
  stage: 'Submitted',
  createdAt: '2026-09-20T10:00:00.000Z',
};

function mockApi(submission: Record<string, unknown>) {
  getMock.mockImplementation((requested?: string) => {
    const path = requested ?? '';
    if (path === '/api/v1/admin/forms/f-1') return Promise.resolve(form);
    if (path.endsWith('/fields')) {
      return Promise.resolve([
        { id: 'ff-1', name: 'name', label: 'Name', fieldType: 'text', required: true },
        { id: 'ff-2', name: 'email', label: 'Email', fieldType: 'email', required: true },
      ]);
    }
    if (path.endsWith('/submissions')) return Promise.resolve([submission]);
    if (path.endsWith('/replies')) {
      return Promise.resolve([
        {
          id: 'r-1',
          submissionId: 's-1',
          authorUserId: null,
          authorName: null,
          direction: 'inbound',
          to: null,
          subject: null,
          bodyHtml: '<p>Here is my cover letter.</p>',
          attachments: [],
          createdAt: '2026-09-21T10:00:00.000Z',
        },
      ]);
    }
    if (path.endsWith('/stage-history')) return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forms/f-1/submissions/s-1']}>
        <Routes>
          <Route path="/forms/:formId/submissions/:submissionId" element={<SubmissionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SubmissionDetailPage website account', () => {
  beforeEach(() => getMock.mockReset());

  it('links to the owning website account', async () => {
    mockApi({
      ...baseSubmission,
      accountUserId: 'u-1',
      account: { id: 'u-1', name: 'Ada Student', email: 'ada@example.test' },
    });
    renderPage();

    await waitFor(() => expect(document.querySelector('a[href="/users/u-1"]')).toHaveTextContent('Ada Student'));
    expect(screen.queryByText('No longer available')).not.toBeInTheDocument();
  });

  it('says the account is no longer available once it was deleted, and keeps the request workable', async () => {
    mockApi({ ...baseSubmission, accountUserId: null, account: null });
    renderPage();

    await waitFor(() => expect(screen.getByText('No longer available')).toBeInTheDocument());
    expect(screen.getByText(/replies go to ada@example\.test/)).toBeInTheDocument();
    // The student's earlier message is still shown, attributed without a broken name.
    expect(screen.getByText('Former website account')).toBeInTheDocument();
    expect(screen.getByText('Here is my cover letter.')).toBeInTheDocument();
    // Nothing links to a user that no longer exists, and nothing reads "undefined".
    expect(document.querySelector('a[href^="/users/"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
    // Staff can still move it through its stages.
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
  });
});
