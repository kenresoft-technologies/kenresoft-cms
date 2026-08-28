import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useTransferOwnership, useUsers } from '@/lib/queries/users';
import { ElevateDialog } from '@/components/elevate-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Owner-only — an admin never sees this control at all, matching the API's own gate
// (requireRole('owner') on POST /security/ownership/transfer, checked before the
// elevation requirement even runs). A swap, not a grant: the acting owner becomes admin
// exactly as the target becomes owner, so there's never a moment with zero or two owners.
function TransferOwnershipControl() {
  const { data: users } = useUsers();
  const { data: session } = authClient.useSession();
  const transferOwnership = useTransferOwnership();
  const [targetId, setTargetId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elevateOpen, setElevateOpen] = useState(false);

  const candidates = (users ?? []).filter((user) => user.id !== session?.user.id && user.role !== 'owner');
  const target = candidates.find((user) => user.id === targetId);

  async function performTransfer() {
    if (!targetId) return;
    try {
      await transferOwnership.mutateAsync(targetId);
      toast.success('Ownership transferred');
      setTargetId('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to transfer ownership');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4">
      <div>
        <p className="text-sm font-medium">Transfer ownership</p>
        <p className="text-sm text-muted-foreground">
          Moves ownership of this installation to another user. You become an admin; they become
          the owner. Requires re-entering your password.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger size="sm" className="w-64">
            <SelectValue placeholder="Choose a user…" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name} ({user.email})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="destructive" size="sm" disabled={!targetId} onClick={() => setConfirmOpen(true)}>
          Transfer ownership
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership to {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will become an admin and lose owner-only privileges, including the ability to
              transfer ownership back without {target?.name ?? 'their'} cooperation. This cannot
              be undone by you alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                setElevateOpen(true);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ElevateDialog
        open={elevateOpen}
        onOpenChange={setElevateOpen}
        onElevated={() => void performTransfer()}
        description="Transferring ownership is irreversible without the new owner's cooperation — re-enter your password to continue."
      />
    </div>
  );
}

// User/role management already has its own full page (Users, admin-gated role changes) —
// this section is a pointer to it plus an accurate description of the role model, not a
// duplicate of that page's logic.
export function UsersPermissionsSection() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-lg">Users &amp; permissions</CardTitle>
        <CardDescription>Who can access this deployment and what they can do.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Kenresoft CMS has five roles: <span className="font-medium text-foreground">owner</span>,{' '}
            <span className="font-medium text-foreground">admin</span>,{' '}
            <span className="font-medium text-foreground">editor</span>,{' '}
            <span className="font-medium text-foreground">author</span>, and{' '}
            <span className="font-medium text-foreground">viewer</span>. The first person to sign up on a
            deployment becomes its owner; everyone after defaults to editor.
          </p>
          <p>
            The owner represents ownership of this specific installation — not a Kenresoft account, just
            the first person here. Admins can do everything an owner can day-to-day (create content types
            and forms, change other users&apos; roles, add, remove, or disable users, and edit these
            settings), except touch the owner: an admin can never demote, delete, or disable the owner, and
            role changes and account deletion always leave at least one owner or admin in place. Only the
            current owner can transfer ownership, and doing so requires re-entering their password.
          </p>
          <p>
            Editors can manage any entry, media, and form submissions, plus content-type and form fields,
            but can&apos;t change structure-level records, roles, or the user list. Authors can create
            entries and edit or delete only the ones they created. Viewers can read everything but make no
            changes.
          </p>
        </div>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link to="/users">
              Manage users
              <ArrowRight />
            </Link>
          </Button>
        </div>

        {isOwner ? <TransferOwnershipControl /> : null}
      </CardContent>
    </Card>
  );
}
