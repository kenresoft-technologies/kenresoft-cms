import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

// A plain prev/next + "page X of Y" bar, shared by any client-side-paginated list (Media
// Library, media pickers) — deliberately not DataTable's own pagination, since these are grids
// of cards, not tabular rows.
export function PaginationControls({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-sm text-muted-foreground">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" /> Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {pageCount}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
