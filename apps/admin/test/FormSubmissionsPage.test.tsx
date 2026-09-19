import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormSubmissionsPage } from '@/pages/FormSubmissionsPage';
import { SubmissionDetailPage } from '@/pages/SubmissionDetailPage';

const { getMock, patchMock, deleteMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, patch: patchMock, delete: deleteMock, post: postMock },
  };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { name: 'Admin', role: 'admin', preferredMailClient: null } } }) },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forms/f-1/submissions']}>
        <Routes>
          <Route path="/forms/:formId/submissions" element={<FormSubmissionsPage />} />
          <Route path="/forms/:formId/submissions/:submissionId" element={<SubmissionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const submission = {
  id: 'sub-1',
  formId: 'f-1',
  data: { email: 'jane@example.com' },
  status: 'new' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('FormSubmissionsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    postMock.mockReset();
  });

  it('lists submissions with their status', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions');
  });

  it('shows an empty state when there are no submissions', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('No submissions yet')).toBeInTheDocument());
  });

  it('navigates to the submission detail page with the submission data, labeled by the matching field', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) {
        return Promise.resolve([{ id: 'ff-1', name: 'email', label: 'Email address', fieldType: 'email' }]);
      }
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());

    await userEvent.click(screen.getByText(/2026/));

    await waitFor(() => expect(screen.getByText('Email address')).toBeInTheDocument());
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
  });

  it('shows the sender name and email at a glance in the table', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) {
        return Promise.resolve([{ ...submission, data: { name: 'Jane Doe', email: 'jane@example.com' } }]);
      }
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('deletes a submission after confirming', async () => {
    deleteMock.mockResolvedValue(undefined);
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Submission actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions/sub-1'),
    );
  });

  it('filters submissions by status', async () => {
    const readSubmission = { ...submission, id: 'sub-2', status: 'read' as const };
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission, readSubmission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());
    expect(screen.getByText('Read')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(screen.getByRole('option', { name: 'New' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('New')).toBeInTheDocument();
    expect(within(table).queryByText('Read')).not.toBeInTheDocument();
  });

  it('offers a "Reply in email app" action linking to the sender\'s mailto when an email field was submitted', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Submission actions' }));
    const replyLink = await screen.findByRole('menuitem', { name: 'Reply in email app' });
    expect(replyLink).toHaveAttribute(
      'href',
      'mailto:jane@example.com?subject=Re%3A+submission+from+jane%40example.com',
    );
  });

  it('shows an attachment count for a submission with a file-type field', async () => {
    const withAttachment = {
      ...submission,
      data: { resume: { key: 'form-uploads/x.pdf', filename: 'resume.pdf', size: 1024, contentType: 'application/pdf' } },
    };
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([withAttachment]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Job Application', slug: 'job-application' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByTitle('resume.pdf')).toBeInTheDocument());
    expect(within(screen.getByTitle('resume.pdf')).getByText('1')).toBeInTheDocument();
  });

  it('shows an existing reply thread and a compose box when opening a submission with a sender email', async () => {
    const reply = {
      id: 'reply-1',
      submissionId: 'sub-1',
      authorUserId: 'u-1',
      authorName: 'Admin',
      to: 'jane@example.com',
      subject: 'Re: Contact submission',
      bodyHtml: '<p>Thanks for reaching out!</p>',
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([reply]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());
    await userEvent.click(screen.getByText(/2026/));

    await waitFor(() => expect(screen.getByText('Thanks for reaching out!')).toBeInTheDocument());
    expect(screen.getByText('Admin')).toBeInTheDocument();
    // Subject is pre-filled from the form's own name, ready to send without typing it first.
    expect(screen.getByLabelText('Subject')).toHaveValue('Re: Contact submission');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  });

  it('marks a submission read via the row action menu', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      if (path.endsWith('/replies')) return Promise.resolve([]);
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 1, maxFiles: 1 });
      if (path.includes('/media')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });
    patchMock.mockResolvedValue({ ...submission, status: 'read' });

    renderPage();
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Submission actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark read' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions/sub-1', { status: 'read' }),
    );
  });
});
