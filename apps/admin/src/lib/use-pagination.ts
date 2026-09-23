import { useMemo, useState } from 'react';

// A small, generic client-side paginator — this codebase's standing precedent (Users, Entries,
// DataTable's own built-in pagination) is to fetch a deployment's full list in one request and
// paginate/filter it in the browser rather than adding server-side offset/limit params, since a
// single-site-per-deployment install's own record counts stay well within what that costs. Media
// is no different: `GET /api/v1/admin/media` already returns every item unbounded.
export function usePagination<T>(items: T[], pageSize = 24) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamped during render, not via a setState-in-effect round trip — e.g. a search/type filter
  // narrows the list, or the folder changes, and the previously-requested page number is now
  // past the end. A stale `requestedPage` naturally self-corrects the next time the list grows
  // back (nothing here ever needs to distinguish "clamped" from "chosen").
  const page = Math.min(requestedPage, pageCount);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, pageCount, paged, total: items.length };
}
