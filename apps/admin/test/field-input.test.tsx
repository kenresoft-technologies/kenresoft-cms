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
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FieldInput field={field} value={value} onChange={onChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    onChange,
    rerender: (nextValue: unknown) =>
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <FieldInput field={field} value={nextValue} onChange={onChange} />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  };
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

  it('shows a preview immediately for a freshly Picsum-imported item, even though it is never in the media list query', async () => {
    // The media list mock never includes the imported item — reproduces the real race: a
    // freshly imported item's list-invalidation refetch hasn't resolved by the time the picker
    // dialog closes, which previously left the field showing "None" until (if ever) it caught up.
    getMock.mockResolvedValue([]);
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ id: '0', author: 'Alejandro Escamilla', width: 5000, height: 3333 }],
    } as Response);
    postMock.mockResolvedValue({
      id: 'm-picsum-1',
      filename: 'picsum-0-5000x3333.jpg',
      altText: 'Photo by Alejandro Escamilla via Picsum',
      width: 5000,
      height: 3333,
    });
    const field = baseField({ fieldType: 'media' });
    const { rerender, onChange } = renderField(field, null);

    await userEvent.click(screen.getByRole('button', { name: 'Choose media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'From Picsum' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Photo by Alejandro Escamilla/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Photo by Alejandro Escamilla/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Import this photo' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('m-picsum-1'));

    // Simulate the parent re-rendering with the newly chosen value, as EntryEditorPage's own
    // handleFieldChange does synchronously on selection — the media list query is still empty.
    rerender('m-picsum-1');
    expect(screen.getByAltText('Photo by Alejandro Escamilla via Picsum')).toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it('browses, previews, and imports a specific photo from Picsum via the media picker\'s "From Picsum" tab', async () => {
    getMock.mockResolvedValue([]);
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '0', author: 'Alejandro Escamilla', width: 5000, height: 3333 },
        { id: '1', author: 'Alejandro Escamilla', width: 5000, height: 3333 },
      ],
    } as Response);
    postMock.mockResolvedValue({
      id: 'm-picsum-1',
      filename: 'picsum-0-900x600.jpg',
      altText: 'Photo by Alejandro Escamilla via Picsum',
      width: 900,
      height: 600,
    });
    const field = baseField({ fieldType: 'media' });
    const { onChange } = renderField(field, null);

    await userEvent.click(screen.getByRole('button', { name: 'Choose media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'From Picsum' }));

    // Real photos are browsed and picked, not a blind width/height/seed guess.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('https://picsum.photos/v2/list'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Photo by Alejandro Escamilla/ })).toHaveLength(2));
    await userEvent.click(screen.getAllByRole('button', { name: /Photo by Alejandro Escamilla/ })[0]!);

    // A full-size preview of the actual chosen photo, not an unseen import — defaulted to the
    // photo's own real resolution (quality preservation), not an arbitrary downscale.
    expect(screen.getByAltText('Selected preview')).toBeInTheDocument();
    expect(screen.getByText(/original 5000×3333px/)).toBeInTheDocument();
    expect(screen.getByLabelText('Import width')).toHaveValue(5000);
    expect(screen.getByLabelText('Import height')).toHaveValue(3333);
    await userEvent.click(screen.getByRole('button', { name: 'Import this photo' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('m-picsum-1'));
    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/admin/media/import-external',
      expect.objectContaining({ source: 'picsum', pictureId: '0', width: 5000, height: 3333 }),
    );
    fetchMock.mockRestore();
  });

  it('lets Picsum be searched by seed for a specific, repeatable photo, without browsing the catalog', async () => {
    getMock.mockResolvedValue([]);
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response);
    postMock.mockResolvedValue({
      id: 'm-seed-1',
      filename: 'picsum-mountains-1600x1200.jpg',
      altText: '"mountains" via Picsum',
      width: 1600,
      height: 1200,
    });
    const field = baseField({ fieldType: 'media' });
    const { onChange } = renderField(field, null);

    await userEvent.click(screen.getByRole('button', { name: 'Choose media' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'From Picsum' }));
    await userEvent.type(screen.getByLabelText('Search Picsum by seed'), 'mountains');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('Seed "mountains"')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import this photo' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('m-seed-1'));
    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/admin/media/import-external',
      expect.objectContaining({ source: 'picsum', seed: 'mountains' }),
    );
    fetchMock.mockRestore();
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
