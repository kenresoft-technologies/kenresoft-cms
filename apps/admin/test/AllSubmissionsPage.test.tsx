import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllSubmissionsPage } from '@/pages/AllSubmissionsPage';

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock } };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AllSubmissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const forms = [
  { id: 'f-1', name: 'Contact', slug: 'contact' },
  { id: 'f-2', name: 'Newsletter', slug: 'newsletter' },
];

const allSubmissions = [
  {
    id: 's-1',
    formId: 'f-1',
    data: { name: 'Jane' },
    status: 'new',
    createdAt: '2026-01-02T00:00:00.000Z',
    formName: 'Contact',
    formSlug: 'contact',
  },
  {
    id: 's-2',
    formId: 'f-2',
    data: { email: 'jane@example.com' },
    status: 'archived',
    createdAt: '2026-01-01T00:00:00.000Z',
    formName: 'Newsletter',
    formSlug: 'newsletter',
  },
];

function mockGet(submissions: unknown[]) {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/submissions') return Promise.resolve(submissions);
    if (path === '/api/v1/admin/forms') return Promise.resolve(forms);
    return Promise.resolve([]);
  });
}

describe('AllSubmissionsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset().mockResolvedValue({});
  });

  it('lists submissions from multiple forms, with form and status', async () => {
    mockGet(allSubmissions);

    renderPage();

    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());
    expect(screen.getByText('Newsletter')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/submissions');
  });

  it('shows an empty state when there are no submissions', async () => {
    mockGet([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No submissions yet')).toBeInTheDocument());
  });

  it('filters by form', async () => {
    mockGet(allSubmissions);

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by form' }));
    await userEvent.click(screen.getByRole('option', { name: 'Newsletter' }));

    expect(screen.queryByRole('link', { name: 'Contact' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newsletter' })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockGet(allSubmissions);

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Archived' }));

    expect(screen.queryByRole('link', { name: 'Contact' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newsletter' })).toBeInTheDocument();
  });

  it("updates a submission's status from its row actions menu", async () => {
    mockGet(allSubmissions);

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());

    const row = screen.getByText('Contact').closest('tr');
    await userEvent.click(within(row!).getByRole('button', { name: 'Submission actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark read' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions/s-1', { status: 'read' }),
    );
  });

  it('opens the view dialog and resolves field labels for that submission\'s own form', async () => {
    mockGet(allSubmissions);
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/submissions') return Promise.resolve(allSubmissions);
      if (path === '/api/v1/admin/forms') return Promise.resolve(forms);
      if (path === '/api/v1/admin/forms/f-1/fields') {
        return Promise.resolve([{ name: 'name', label: 'Full name' }]);
      }
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());

    const row = screen.getByRole('link', { name: 'Contact' }).closest('tr');
    await userEvent.click(within(row!).getByRole('button', { name: /2026/ }));

    await waitFor(() => expect(screen.getByText('Full name')).toBeInTheDocument());
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('bulk-marks selected submissions as archived, spanning different forms', async () => {
    mockGet(allSubmissions);

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact')).toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(2));
    expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/submissions/s-1', { status: 'archived' });
    expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-2/submissions/s-2', { status: 'archived' });
  });
});
