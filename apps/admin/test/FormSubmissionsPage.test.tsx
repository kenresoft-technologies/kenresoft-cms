import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormSubmissionsPage } from '@/pages/FormSubmissionsPage';

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forms/f-1/submissions']}>
        <Routes>
          <Route path="/forms/:formId/submissions" element={<FormSubmissionsPage />} />
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
  });

  it('lists submissions with their status', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions');
  });

  it('shows an empty state when there are no submissions', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('No submissions yet')).toBeInTheDocument());
  });

  it('opens a dialog with the submission data, labeled by the matching field', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) {
        return Promise.resolve([{ id: 'ff-1', name: 'email', label: 'Email address', fieldType: 'email' }]);
      }
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /2026/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Email address');
    expect(dialog).toHaveTextContent('jane@example.com');
  });

  it('marks a submission read via the row action menu', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/submissions')) return Promise.resolve([submission]);
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });
    patchMock.mockResolvedValue({ ...submission, status: 'read' });

    renderPage();
    await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Submission actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark read' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions/sub-1', { status: 'read' }),
    );
  });
});
