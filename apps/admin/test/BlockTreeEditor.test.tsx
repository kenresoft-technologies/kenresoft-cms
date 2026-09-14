import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockTreeEditor } from '@/pages/blocks/BlockTreeEditor';
import type { BlockInstance } from '@/lib/types';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock } };
});

function Harness({ initial = [] as BlockInstance[] }) {
  const [blocks, setBlocks] = useState<BlockInstance[]>(initial);
  return <BlockTreeEditor blocks={blocks} onChange={setBlocks} />;
}

function renderEditor(initial: BlockInstance[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness initial={initial} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// A block card's own title renders as a <p> — distinct from the "Add block" Select's own
// trigger, which also displays the selected type's label as plain text (e.g. "Hero").
function cardTitles(): string[] {
  return Array.from(document.querySelectorAll('p.font-medium')).map((el) => el.textContent ?? '');
}

// Phase 8 of the schema-driven frontend work (docs/SITE_BUILDER.md §14 decision #3) added
// drag-and-drop reordering, duplicate, and undo/redo on top of Phase 3's add/remove editor.
// Drag-and-drop itself isn't exercised here — matching this codebase's own existing precedent
// (ContentTypeDetailPage's dnd-kit field-reorder list has no such test either), since
// jsdom can't drive dnd-kit's real pointer-sensor drag sequence; these tests instead cover the
// actual controlled-component contract (`blocks` in, `onChange` out) plus the new
// button-clickable duplicate/undo/redo affordances.
describe('BlockTreeEditor', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it('adds a block via the default (Hero) type and shows it in the list', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /add block/i }));

    expect(cardTitles()).toEqual(['Hero']);
    expect(screen.getByLabelText('Heading')).toBeInTheDocument();
  });

  it('removes a block', async () => {
    renderEditor([{ id: 'b-1', type: 'hero', config: {} }]);

    expect(cardTitles()).toEqual(['Hero']);
    const [removeButton] = screen.getAllByRole('button').filter((button) => button.querySelector('svg.lucide-trash2'));
    await userEvent.click(removeButton!);

    expect(cardTitles()).toEqual([]);
  });

  it('duplicates a block, inserting the copy right after the original', async () => {
    renderEditor([{ id: 'b-1', type: 'hero', config: { heading: 'First' } }]);

    expect(cardTitles()).toEqual(['Hero']);
    await userEvent.click(screen.getByRole('button', { name: /duplicate hero/i }));

    expect(cardTitles()).toEqual(['Hero', 'Hero']);
  });

  it('undoes and redoes a remove', async () => {
    renderEditor([{ id: 'b-1', type: 'hero', config: {} }]);

    expect(cardTitles()).toEqual(['Hero']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    const [removeButton] = screen.getAllByRole('button').filter((button) => button.querySelector('svg.lucide-trash2'));
    await userEvent.click(removeButton!);
    expect(cardTitles()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cardTitles()).toEqual(['Hero']);
    expect(screen.getByRole('button', { name: 'Redo' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(cardTitles()).toEqual([]);
  });

  it('adds a nested child block only inside a Columns block', async () => {
    renderEditor([{ id: 'columns-1', type: 'columns', config: {} }]);

    expect(cardTitles()).toEqual(['Columns']);
    // Two "Add block" controls: one at the top level, one nested inside Columns.
    const addButtons = screen.getAllByRole('button', { name: /add block/i });
    expect(addButtons).toHaveLength(2);

    await userEvent.click(addButtons[1]!);

    // The nested child (default Hero) now has its own config form rendered inside the card.
    expect(cardTitles()).toEqual(['Columns', 'Hero']);
    expect(screen.getAllByLabelText('Heading')).toHaveLength(1);
  });

  it('does not offer nested children for a leaf block type like Spacer', () => {
    renderEditor([{ id: 'spacer-1', type: 'spacer', config: {} }]);

    expect(screen.getAllByRole('button', { name: /add block/i })).toHaveLength(1);
  });

  it("renders a media picker for the Hero block's image field", () => {
    renderEditor([{ id: 'hero-1', type: 'hero', config: {} }]);

    expect(screen.getByRole('button', { name: 'Choose' })).toBeInTheDocument();
  });

  it('renders a reusable-block picker for a "reusableBlockRef" block, populated from the API', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/reusable-blocks') {
        return Promise.resolve([
          { id: 'rb-1', name: 'Global CTA', type: 'cta', config: {}, createdAt: '', updatedAt: '' },
        ]);
      }
      return Promise.resolve([]);
    });

    renderEditor([{ id: 'ref-1', type: 'reusableBlockRef', config: {} }]);

    expect(cardTitles()).toEqual(['Reusable block']);
    // Two comboboxes exist once the reusable-blocks list has loaded: the block's own field,
    // and the "Add block" type picker further down — before that, the field renders a plain
    // "no reusable blocks yet" message instead of a Select at all.
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    await userEvent.click(screen.getAllByRole('combobox')[0]!);
    expect(await screen.findByRole('option', { name: 'Global CTA' })).toBeInTheDocument();
  });
});
