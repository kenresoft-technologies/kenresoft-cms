import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useDeletePageById, usePage, usePageRevisions, useRestorePageRevision, useUpdatePage } from '@/lib/queries/pages';
import type { BlockInstance, EntryStatus, Page } from '@/lib/types';
import { BlockTreeEditor } from '@/pages/blocks/BlockTreeEditor';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';

function RevisionHistoryPanel({ pageId }: { pageId: string }) {
  const { data: revisions } = usePageRevisions(pageId);
  const restoreRevision = useRestorePageRevision(pageId);

  async function handleRestore(revisionId: string) {
    try {
      await restoreRevision.mutateAsync(revisionId);
      toast.success('Page restored to that revision');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to restore revision');
    }
  }

  if (!revisions || revisions.length === 0) {
    return <p className="text-sm text-muted-foreground">No revisions yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {revisions.map((revision) => (
        <li key={revision.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <div>
            <p className="font-medium">{revision.title}</p>
            <p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleRestore(revision.id)}>
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}

interface PageFormProps {
  page: Page;
}

// Mounted only once `page` has loaded (see the loading gate in PageEditorPage below) — local
// state is initialized once via useState's lazy initializer instead of syncing it in from a
// query with useEffect + setState, the same pattern EntryEditorPage's own EntryForm already
// establishes (eslint-plugin-react-hooks flags the effect-based version: react.dev/learn/
// you-might-not-need-an-effect).
function PageForm({ page }: PageFormProps) {
  const navigate = useNavigate();
  const updatePage = useUpdatePage(page.id);
  const deletePage = useDeletePageById();

  const [title, setTitle] = useState(page.title);
  const [route, setRoute] = useState(page.route);
  const [status, setStatus] = useState<EntryStatus>(page.status);
  const [blocks, setBlocks] = useState<BlockInstance[]>(page.blocks);

  async function handleSave() {
    try {
      await updatePage.mutateAsync({ title, route, status, blocks });
      toast.success('Page saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save page');
    }
  }

  async function handleDelete() {
    try {
      await deletePage.mutateAsync(page.id);
      toast.success('Page deleted');
      void navigate('/pages');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete page');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Pages', to: '/pages' }, { label: page.title }]} />

      <PageHeader
        title={page.title}
        description={page.route}
        actions={
          <>
            <StatusBadge status={status} />
            <Button type="button" onClick={() => void handleSave()} disabled={updatePage.isPending}>
              {updatePage.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="page-editor-title">Title</Label>
                <Input id="page-editor-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="page-editor-route">Route</Label>
                <Input id="page-editor-route" value={route} onChange={(event) => setRoute(event.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Blocks</h2>
            <BlockTreeEditor blocks={blocks} onChange={setBlocks} />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border p-4">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Publishing</h2>
            <div className="flex flex-col gap-2">
              <Label htmlFor="page-editor-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as EntryStatus)}>
                <SelectTrigger id="page-editor-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">History</h2>
            <RevisionHistoryPanel pageId={page.id} />
          </div>

          <div className="rounded-xl border border-destructive/30 p-4">
            <h2 className="mb-3 text-sm font-medium text-destructive">Danger zone</h2>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm">
                  Delete page
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{page.title}"?</AlertDialogTitle>
                  <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md §14 decision #3): a
// structured editor (title/route/status fields, plus BlockTreeEditor's add/remove/reorder
// blocks) — deliberately not a drag-and-drop canvas yet (that's Phase 8, replacing only this
// component's editing UI, never the underlying Page/Block model this page already saves
// through the same admin API a Phase 8 editor would also call).
export function PageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { data: page, isPending } = usePage(pageId!);

  if (isPending || !page) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  return <PageForm key={page.id} page={page} />;
}
