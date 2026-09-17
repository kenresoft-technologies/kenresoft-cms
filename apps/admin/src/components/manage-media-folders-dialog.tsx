import { useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import {
  useCreateMediaFolder,
  useDeleteMediaFolder,
  useMediaFolders,
  useUpdateMediaFolder,
} from '@/lib/queries/media';
import type { MediaFolder } from '@/lib/types';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function FolderRow({ folder }: { folder: MediaFolder }) {
  const updateFolder = useUpdateMediaFolder();
  const deleteFolder = useDeleteMediaFolder();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await updateFolder.mutateAsync({ id: folder.id, name, slug: slugify(name) });
      setEditing(false);
      toast.success('Folder renamed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rename folder');
    }
  }

  async function handleDelete() {
    try {
      await deleteFolder.mutateAsync(folder.id);
      toast.success('Folder deleted — its media is now unfiled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete folder');
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 rounded-md border p-2">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" autoFocus />
          <Button size="sm" onClick={() => void handleSave()} disabled={updateFolder.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{folder.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{folder.slug}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Rename ${folder.name}`} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${folder.name}`} className="text-destructive">
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{folder.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                The folder is removed. Media inside it is never deleted — it becomes unfiled.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function ManageMediaFoldersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: folders } = useMediaFolders();
  const createFolder = useCreateMediaFolder();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const slug = slugify(newName);
    if (!slug) {
      setError('Enter a folder name');
      return;
    }
    try {
      await createFolder.mutateAsync({ name: newName, slug });
      setNewName('');
      toast.success('Folder created');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create folder');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Media folders</DialogTitle>
          <DialogDescription>
            Organize media into named collections, e.g. "home-page-hero" — a frontend can fetch
            a folder's media explicitly by its slug.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor="new-folder-name" className="text-xs text-muted-foreground">
              New folder
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-folder-name"
                placeholder="Home page hero"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
              />
              <Button onClick={() => void handleCreate()} disabled={createFolder.isPending}>
                <FolderPlus />
                Add
              </Button>
            </div>
            {newName ? <p className="text-xs text-muted-foreground">Slug: {slugify(newName) || '—'}</p> : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>

          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {!folders || folders.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No folders yet.</p>
            ) : (
              folders.map((folder) => <FolderRow key={folder.id} folder={folder} />)
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
