import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FieldInput } from '@/components/field-input';
import type { FieldDefinition } from '@/lib/types';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, post: postMock } };
});

function baseField(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: 'f-1',
    contentTypeId: 'ct-1',
    name: 'field',
    label: 'Field',
    fieldType: 'text',
    required: false,
    sortOrder: 0,
    config: null,
    presentation: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderField(field: FieldDefinition, value: unknown, onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FieldInput field={field} value={value} onChange={onChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('FieldInput', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('renders a real dropdown for a select field with configured options', async () => {
    const field = baseField({ fieldType: 'select', config: { options: ['open', 'closed'] } });
    const { onChange } = renderField(field, '');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'closed' }));

    expect(onChange).toHaveBeenCalledWith('closed');
  });

  it('falls back to a plain text input when a select field has no configured options', () => {
    const field = baseField({ fieldType: 'select', config: null });
    renderField(field, '');

    expect(screen.getByLabelText('Field')).toHaveAttribute('type', 'text');
  });

  it('renders a checkbox per option for multi_select and tracks multiple selections', async () => {
    const field = baseField({ fieldType: 'multi_select', config: { options: ['red', 'green', 'blue'] } });
    const { onChange } = renderField(field, ['red']);

    expect(screen.getByLabelText('red')).toBeChecked();
    expect(screen.getByLabelText('green')).not.toBeChecked();

    await userEvent.click(screen.getByLabelText('green'));
    expect(onChange).toHaveBeenCalledWith(['red', 'green']);
  });

  it('renders a media picker dialog for a media field', async () => {
    getMock.mockResolvedValue([
      { id: 'm-1', filename: 'photo.png', contentType: 'image/png', size: 100, width: 10, height: 10, altText: null },
    ]);
    const field = baseField({ fieldType: 'media' });
    const { onChange } = renderField(field, null);

    await userEvent.click(screen.getByRole('button', { name: 'Choose media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByAltText('photo.png'));

    expect(onChange).toHaveBeenCalledWith('m-1');
  });

  it('imports an image from Picsum via the media picker\'s "From Picsum" tab', async () => {
    getMock.mockResolvedValue([]);
    postMock.mockResolvedValue({
      id: 'm-picsum-1',
      filename: 'picsum-x-800x600.jpg',
      altText: 'A random photo',
      width: 800,
      height: 600,
    });
    const field = baseField({ fieldType: 'media' });
    const { onChange } = renderField(field, null);

    await userEvent.click(screen.getByRole('button', { name: 'Choose media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'From Picsum' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import from Picsum' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('m-picsum-1'));
    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/admin/media/import-external',
      expect.objectContaining({ source: 'picsum', width: 800, height: 600 }),
    );
  });

  it('lets a url field pick a media file, filling the input with its public URL', async () => {
    getMock.mockResolvedValue([
      { id: 'm-1', filename: 'photo.png', contentType: 'image/png', size: 100, width: 10, height: 10, altText: null },
    ]);
    const field = baseField({ fieldType: 'url' });
    const { onChange } = renderField(field, '');

    expect(screen.getByLabelText('Field')).toHaveAttribute('type', 'url');

    await userEvent.click(screen.getByRole('button', { name: 'Choose from Media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByAltText('photo.png'));

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('/api/v1/public/media/m-1/file'));
  });

  it('lets a url field still be typed into directly, without opening the picker', async () => {
    const field = baseField({ fieldType: 'url' });
    const { onChange } = renderField(field, '');

    await userEvent.type(screen.getByLabelText('Field'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a searchable combobox for a reference field targeting another content type', async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/entries')) {
        return Promise.resolve([{ id: 'e-1', slug: 'hello-world', status: 'published' }]);
      }
      return Promise.resolve({ id: 'ct-2', name: 'Author' });
    });
    const field = baseField({ fieldType: 'reference', config: { targetContentTypeId: 'ct-2' } });
    const { onChange } = renderField(field, null);

    await waitFor(() => expect(screen.getByText('Select a Author…')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByText('hello-world')).toBeInTheDocument());
    await userEvent.click(screen.getByText('hello-world'));

    expect(onChange).toHaveBeenCalledWith('e-1');
  });

  it('shows a message instead of a picker when a reference field has no target configured', () => {
    const field = baseField({ fieldType: 'reference', config: null });
    renderField(field, null);

    expect(screen.getByText('This field has no target content type configured yet.')).toBeInTheDocument();
  });
});
