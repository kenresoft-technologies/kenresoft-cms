import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormTestDialog } from '@/components/form-test-dialog';
import type { FormField } from '@/lib/types';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, upload: uploadMock } };
});

const fields: FormField[] = [
  {
    id: 'ff-1',
    formId: 'f-1',
    name: 'name',
    label: 'Name',
    fieldType: 'text',
    required: true,
    sortOrder: 0,
    config: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'ff-2',
    formId: 'f-1',
    name: 'topic',
    label: 'Topic',
    fieldType: 'select',
    required: false,
    sortOrder: 1,
    config: { options: ['sales', 'support'] },
    createdAt: '',
    updatedAt: '',
  },
];

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FormTestDialog formId="f-1" fields={fields} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FormTestDialog', () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it('renders an input per field, from the real field definitions', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Preview & Test' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Name/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Topic')).toBeInTheDocument();
  });

  it('submits through apiClient.upload as multipart form data, and shows a success state', async () => {
    uploadMock.mockResolvedValue({ id: 'sub-1', isTest: true });
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Preview & Test' }));

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Jane Doe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit test' }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [path, formData] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/api/v1/admin/forms/f-1/test-submissions');
    expect(formData.get('name')).toBe('Jane Doe');

    await waitFor(() => expect(screen.getByText('Test submission created')).toBeInTheDocument());
  });

  it('shows an error message when the test submission is rejected', async () => {
    uploadMock.mockRejectedValue(new Error('Validation failed'));
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Preview & Test' }));

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Jane Doe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit test' }));

    await waitFor(() => expect(screen.getByText('Test submission failed')).toBeInTheDocument());
  });
});
