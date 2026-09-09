import { Copy, MoreHorizontal, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useCreateEntry, useUpdateEntryStatusById } from '@/lib/queries/entries';
import type { Entry, EntryStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function slugCopy(slug: string) {
  return `${slug}-copy`;
}

// Reused by both EntriesPage (scoped to one content type) and AllEntriesPage (spans every
// content type) — each row already carries its own contentTypeId, so this component's own
// per-content-type hooks (useCreateEntry/useUpdateEntryStatusById) work correctly in either
// context without the caller needing to know which page it's rendering in.
//
// Generic over the row's own entry type (plain Entry on EntriesPage, the richer
// EntryWithContentType on AllEntriesPage) so onRequestDelete can be typed as that same
// caller-specific shape — AllEntriesPage's delete-confirmation state needs the extra
// contentTypeName/authorName fields it already has on hand, not just the Entry subset.
export function EntryRowActions<TEntry extends Entry>({
  entry,
  contentTypeId,
  onRequestDelete,
}: {
  entry: TEntry;
  contentTypeId: string;
  onRequestDelete: (entry: TEntry) => void;
}) {
  const navigate = useNavigate();
  const createEntry = useCreateEntry(contentTypeId);
  const updateStatus = useUpdateEntryStatusById(contentTypeId);
  const nextStatus: EntryStatus = entry.status === 'published' ? 'draft' : 'published';

  async function handleDuplicate() {
    try {
      const created = await createEntry.mutateAsync({
        slug: slugCopy(entry.slug),
        status: 'draft',
        data: entry.data,
        publishAt: null,
      });
      toast.success('Entry duplicated');
      void navigate(`/content-types/${contentTypeId}/entries/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate entry');
    }
  }

  function handleToggleStatus() {
    updateStatus.mutate(
      { id: entry.id, status: nextStatus },
      {
        onSuccess: () => toast.success(nextStatus === 'published' ? 'Entry published' : 'Entry unpublished'),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update status'),
      },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Entry actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/content-types/${contentTypeId}/entries/${entry.id}`}>Edit</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDuplicate} disabled={createEntry.isPending}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleStatus} disabled={updateStatus.isPending}>
          {nextStatus === 'published' ? 'Publish' : 'Unpublish'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(entry)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
