import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormDetailPage } from '@/pages/FormDetailPage';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, post: postMock } };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forms/f-1']}>
        <Routes>
          <Route path="/forms/:formId" element={<FormDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FormDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('fetches the form and its fields scoped by formId', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) {
        return Promise.resolve([
          { id: 'ff-1', name: 'email', label: 'Email', fieldType: 'email', required: true },
        ]);
      }
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument());
    expect(screen.getAllByText('email')).toHaveLength(2); // field-name cell + type badge
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/fields');
    expect(getMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1');
  });

  it('adds a field through the dialog, defaulting to type=text and required=false', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });
    postMock.mockResolvedValue({ id: 'ff-1', name: 'email', label: 'Email', fieldType: 'text', required: false });

    renderPage();
    await waitFor(() => expect(screen.getByText('No fields yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'email');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/fields', {
        name: 'email',
        label: 'Email',
        fieldType: 'text',
        required: false,
        config: null,
      }),
    );
  });

  it('adds a select field with configured options', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });
    postMock.mockResolvedValue({
      id: 'ff-1',
      name: 'topic',
      label: 'Topic',
      fieldType: 'select',
      required: false,
      config: { options: ['sales', 'support'] },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('No fields yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'topic');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Topic');

    await userEvent.click(within(dialog).getByLabelText('Type'));
    await userEvent.click(screen.getByRole('option', { name: 'select' }));

    await userEvent.type(within(dialog).getByPlaceholderText('option value'), 'sales');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await userEvent.type(within(dialog).getByPlaceholderText('option value'), 'support');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/forms/f-1/fields', {
        name: 'topic',
        label: 'Topic',
        fieldType: 'select',
        required: false,
        config: { options: ['sales', 'support'] },
      }),
    );
  });

  it('links to the submissions page', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/fields')) return Promise.resolve([]);
      return Promise.resolve({ id: 'f-1', name: 'Contact', slug: 'contact' });
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'View submissions' })).toHaveAttribute(
      'href',
      '/forms/f-1/submissions',
    );
  });
});
