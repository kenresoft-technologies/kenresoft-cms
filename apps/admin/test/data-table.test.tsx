import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/data-table';

interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'id', header: 'ID' },
];

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r-${i}`, name: `Row ${i}` }));
}

describe('DataTable', () => {
  it('renders every row when data fits on one page', () => {
    render(<DataTable columns={columns} data={rows(3)} />);

    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(screen.getByText('Row 2')).toBeInTheDocument();
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });

  it('filters rows via the search input', async () => {
    render(<DataTable columns={columns} data={rows(5)} searchPlaceholder="Search rows…" />);

    await userEvent.type(screen.getByPlaceholderText('Search rows…'), 'Row 3');

    expect(screen.getByText('Row 3')).toBeInTheDocument();
    expect(screen.queryByText('Row 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Row 1')).not.toBeInTheDocument();
  });

  it('shows a "No results" row when the search matches nothing', async () => {
    render(<DataTable columns={columns} data={rows(3)} searchPlaceholder="Search rows…" />);

    await userEvent.type(screen.getByPlaceholderText('Search rows…'), 'nonexistent');

    expect(screen.getByText('No results.')).toBeInTheDocument();
  });

  it('sorts rows when a sortable header is clicked', async () => {
    render(<DataTable columns={columns} data={rows(3)} />);
    const firstNameCell = () => screen.getAllByRole('cell')[0]?.textContent;

    // Unsorted (insertion order) already happens to read as ascending, so sort explicitly
    // twice and check the second (descending) click actually reverses row order.
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(firstNameCell()).toBe('Row 0');

    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(firstNameCell()).toBe('Row 2');
  });

  it('paginates when data exceeds the page size', async () => {
    render(<DataTable columns={columns} data={rows(15)} />);

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.queryByText('Row 10')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Row 10')).toBeInTheDocument();
    expect(screen.queryByText('Row 0')).not.toBeInTheDocument();
  });

  it('calls onRowClick with the row data when a row is clicked', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows(3)} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByText('Row 1'));

    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows(3)[1]);
  });

  it('does not double-fire onRowClick when clicking a link inside a cell', async () => {
    const onRowClick = vi.fn();
    const linkColumns: ColumnDef<Row>[] = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <a href={`/${row.original.id}`} onClick={(event) => event.preventDefault()}>
            {row.original.name}
          </a>
        ),
      },
      { accessorKey: 'id', header: 'ID' },
    ];
    render(<DataTable columns={linkColumns} data={rows(3)} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByRole('link', { name: 'Row 1' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('does not call onRowClick when the click follows a text selection', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows(3)} onRowClick={onRowClick} />);

    const cell = screen.getByText('Row 1');
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // fireEvent (unlike userEvent) doesn't mimic a browser's mousedown-collapses-selection
    // behavior, so the selection set above survives until this click — matching the real
    // scenario of a click landing right after a drag-to-select gesture.
    fireEvent.click(cell);

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
