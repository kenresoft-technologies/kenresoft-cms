import { useMemo, useState, type FormEvent } from 'react';
import {
  Ban,
  Check,
  Copy,
  Download,
  LogOut,
  Monitor,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import {
  useCreateUser,
  useDeleteUser,
  useRevokeSession,
  useUpdateUserDeveloperToolsAccess,
  useUpdateUserDisabled,
  useUpdateUserRole,
  useUserSessions,
  useUsers,
} from '@/lib/queries/users';
import { roleAtLeast, USER_ROLES, type AdminUser, type Session, type UserRole } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { ElevateDialog } from '@/components/elevate-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { TableSkeleton } from '@/components/table-skeleton';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

const ACTIVE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

type StatusFilter = 'all' | 'active' | 'never';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

function activeThisWeek(user: AdminUser): boolean {
  return user.lastActiveAt !== null && Date.now() - new Date(user.lastActiveAt).getTime() <= ACTIVE_WITHIN_MS;
}

// The CSS `capitalize` class only changes rendering, not the actual text content — screen
// readers and accessible-name-based queries (including this page's own tests) still see the
// raw lowercase role string. Capitalizing the string itself keeps "Editor"/"Admin" as the real
// accessible name, matching what was previously hardcoded per-option.
function capitalizeRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function exportUsersToCsv(users: AdminUser[]) {
  const header = ['Name', 'Email', 'Role', 'Last active', 'Joined'];
  const rows = users.map((user) => [
    user.name,
    user.email,
    user.role,
    user.lastActiveAt ?? '',
    user.createdAt,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Role changes below owner are ordinary Admin work; ownership itself is deliberately not one of
// the choices here — granting it goes through the dedicated Transfer ownership flow (Settings →
// Users & Permissions), which requires re-authentication and can only be initiated by the
// current owner. The API rejects a role: 'owner' PATCH here regardless, but not offering it as
// an option avoids a confusing "why did that fail" for anyone who tries.
const ASSIGNABLE_ROLES = USER_ROLES.filter((role) => role !== 'owner');

function RoleCell({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const updateRole = useUpdateUserRole();

  // The owner's role is never editable through this control, by anyone — matches the API's own
  // immunity guard (apps/api/src/lib/user-guards.ts).
  if (user.role === 'owner') {
    return (
      <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 capitalize text-primary">
        Owner
      </Badge>
    );
  }

  if (!canEdit) {
    return (
      <Badge variant="secondary" className="capitalize">
        {user.role}
      </Badge>
    );
  }

  return (
    <Select
      value={user.role}
      disabled={updateRole.isPending}
      onValueChange={(value) => {
        updateRole.mutate(
          { id: user.id, role: value as UserRole },
          {
            onError: (err) => {
              toast.error(err instanceof ApiError ? err.message : 'Failed to update role');
            },
          },
        );
      }}
    >
      <SelectTrigger size="sm" className="w-28 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {capitalizeRole(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Owner/admin always have Developer panel access once the deployment-wide flag is on
// (apps/admin/src/lib/developer-mode.ts) — this control only matters for editor/author, who
// need it granted per person rather than automatically. Viewer never qualifies regardless, so
// it isn't shown there either.
function DeveloperToolsCell({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const updateAccess = useUpdateUserDeveloperToolsAccess();

  if (user.role !== 'editor' && user.role !== 'author') {
    return <span className="text-muted-foreground">{user.role === 'viewer' ? '—' : 'Always'}</span>;
  }

  if (!canEdit) {
    return <span className="text-muted-foreground">{user.developerToolsAccess ? 'Granted' : '—'}</span>;
  }

  return (
    <Switch
      checked={user.developerToolsAccess}
      disabled={updateAccess.isPending}
      aria-label={`Developer tools access for ${user.name}`}
      onCheckedChange={(checked) => {
        updateAccess.mutate(
          { id: user.id, developerToolsAccess: checked },
          {
            onError: (err) => {
              toast.error(err instanceof ApiError ? err.message : 'Failed to update developer tools access');
            },
          },
        );
      }}
    />
  );
}

// Shown once, right after creation — there's no email sending configured (§9), so this is the
// only place the temporary password is ever visible. Copy-to-clipboard because reading a
// 24-character random string aloud or retyping it is exactly the kind of thing that goes wrong.
function TemporaryPasswordDialog({
  created,
  onClose,
}: {
  created: { user: AdminUser; temporaryPassword: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy the password manually');
    }
  }

  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created?.user.name} was added</DialogTitle>
          <DialogDescription>
            Share this temporary password with them directly — it won't be shown again. They can change
            it from their Profile page after signing in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="temp-password">Temporary password</Label>
          <div className="flex gap-2">
            <Input id="temp-password" readOnly value={created?.temporaryPassword ?? ''} className="font-mono" />
            <Button type="button" variant="outline" size="icon" onClick={() => void handleCopy()} aria-label="Copy password">
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({ onCreated }: { onCreated: (result: { user: AdminUser; temporaryPassword: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createUser = useCreateUser();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createUser.mutateAsync({ name, email });
      toast.success('User created');
      setName('');
      setEmail('');
      setOpen(false);
      onCreated(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create user';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Creates the account directly with a random temporary password, shown once after you submit —
            there's no email invite (no email sending is configured yet). New users default to editor.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-name">Name</Label>
            <Input id="new-user-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionsDialog({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<Session | null>(null);
  const { data: sessions, isPending } = useUserSessions(user.id, open);
  const revokeSession = useRevokeSession(user.id);

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return;
    try {
      await revokeSession.mutateAsync(pendingRevoke.id);
      toast.success('Session revoked');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to revoke session');
    } finally {
      setPendingRevoke(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`View sessions for ${user.name}`}>
            <Monitor />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sessions — {user.name}</DialogTitle>
            <DialogDescription>
              Every device currently signed in as this user. Revoking one signs that device out
              immediately — it will need to sign in again.
            </DialogDescription>
          </DialogHeader>

          {isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {sessions && sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : null}
          {sessions && sessions.length > 0 ? (
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.ipAddress ?? 'Unknown IP'}</p>
                    <p className="truncate text-xs text-muted-foreground">{session.userAgent ?? 'Unknown device'}</p>
                    <p className="text-xs text-muted-foreground">
                      Signed in {new Date(session.createdAt).toLocaleString()} · expires{' '}
                      {new Date(session.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Revoke session"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingRevoke(session)}
                  >
                    <LogOut />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              That device is signed out immediately and will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmRevoke()}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Disabling an admin is security-sensitive enough to require a fresh password re-check
// (apps/api/src/routes/admin/users.ts's PATCH /:id/disabled, admin-target branch only) — this
// mirrors that server-side rule in the UI rather than letting the request round-trip fail with
// a generic 403. Re-enabling is restorative, not destructive, so it skips both the confirm step
// and elevation.
function DisableUserControl({ user }: { user: AdminUser }) {
  const updateDisabled = useUpdateUserDisabled();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elevateOpen, setElevateOpen] = useState(false);

  async function performToggle(disabled: boolean) {
    try {
      await updateDisabled.mutateAsync({ id: user.id, disabled });
      toast.success(disabled ? 'User disabled' : 'User enabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update user');
    }
  }

  function handleConfirmDisable() {
    setConfirmOpen(false);
    if (user.role === 'admin') {
      setElevateOpen(true);
    } else {
      void performToggle(true);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={user.disabled ? `Enable ${user.name}` : `Disable ${user.name}`}
        className={user.disabled ? 'text-muted-foreground' : 'text-muted-foreground hover:text-destructive'}
        onClick={() => (user.disabled ? void performToggle(false) : setConfirmOpen(true))}
      >
        <Ban />
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.role === 'admin'
                ? 'You are about to disable an administrator. This could affect access to this CMS.'
                : 'They immediately lose access and every current session is signed out. You can re-enable them later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmDisable}>
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ElevateDialog
        open={elevateOpen}
        onOpenChange={setElevateOpen}
        onElevated={() => void performToggle(true)}
        description="Disabling an administrator is a security-sensitive action — re-enter your password to continue."
      />
    </>
  );
}

export function UsersPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  const { data: users, isPending, error, refetch } = useUsers();
  const deleteUser = useDeleteUser();
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [created, setCreated] = useState<{ user: AdminUser; temporaryPassword: string } | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const stats = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      active: list.filter((user) => user.lastActiveAt !== null).length,
      // Owner + admin — either can manage users, so this is really "how many people can
      // administer this deployment," not literally a count of the 'admin' role alone.
      admins: list.filter((user) => user.role === 'admin' || user.role === 'owner').length,
      activeThisWeek: list.filter(activeThisWeek).length,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    return (users ?? []).filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && user.lastActiveAt === null) return false;
      if (statusFilter === 'never' && user.lastActiveAt !== null) return false;
      return true;
    });
  }, [users, roleFilter, statusFilter]);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteUser.mutateAsync(pendingDelete.id);
      toast.success('User removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove user');
    } finally {
      setPendingDelete(null);
    }
  }

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar size="sm">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span> },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => <RoleCell user={row.original} canEdit={isAdmin} />,
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.disabled ? (
            <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
              Disabled
            </Badge>
          ) : (
            <StatusBadge status={row.original.lastActiveAt !== null ? 'active' : 'never-active'} />
          ),
      },
      {
        id: 'developerTools',
        header: 'Dev tools',
        enableSorting: false,
        cell: ({ row }) => <DeveloperToolsCell user={row.original} canEdit={isAdmin} />,
      },
      {
        accessorKey: 'lastActiveAt',
        header: 'Last active',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.lastActiveAt ?? 0).getTime() - new Date(rowB.original.lastActiveAt ?? 0).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastActiveAt ? new Date(row.original.lastActiveAt).toLocaleString() : 'Never'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Joined',
        sortingFn: (rowA, rowB) => new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span>
        ),
      },
      ...(isAdmin
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: AdminUser } }) => (
                <div className="flex justify-end gap-1">
                  <SessionsDialog user={row.original} />
                  {/* The owner has no destructive actions here at all — matches the API's own
                      immunity guard, which rejects role/disable/delete against an owner
                      regardless of who's asking. */}
                  {row.original.role !== 'owner' && row.original.id !== session?.user.id ? (
                    <>
                      <DisableUserControl user={row.original} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${row.original.name}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(row.original)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              ),
            } satisfies ColumnDef<AdminUser>,
          ]
        : []),
    ],
    [isAdmin, session?.user],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Users' }]} />

      <PageHeader
        title="Users"
        description={isAdmin ? 'Everyone with access to this admin, and their role.' : 'Everyone with access to this admin.'}
        actions={
          <>
            <Button variant="outline" onClick={() => exportUsersToCsv(filteredUsers)} disabled={!users || users.length === 0}>
              <Download />
              Export
            </Button>
            {isAdmin ? <AddUserDialog onCreated={setCreated} /> : null}
          </>
        }
      />

      {users && users.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={UsersIcon} label="Total users" value={String(stats.total)} />
          <StatCard icon={UserCheck} label="Active users" value={String(stats.active)} hint="Have signed in at least once" />
          <StatCard icon={ShieldCheck} label="Administrators" value={String(stats.admins)} />
          <StatCard icon={Monitor} label="Active this week" value={String(stats.activeThisWeek)} />
        </div>
      ) : null}

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dev tools</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead>Joined</TableHead>
                {isAdmin ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={isAdmin ? 8 : 7} />
          </Table>
        </div>
      ) : null}

      {users && users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users yet" description="Users appear here once they sign up." />
      ) : null}

      {users && users.length > 0 ? (
        <DataTable
          columns={columns}
          data={filteredUsers}
          searchPlaceholder="Search users…"
          onRefresh={() => void refetch()}
          toolbar={
            <>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | UserRole)}>
                <SelectTrigger size="sm" className="w-32" aria-label="Filter by role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {USER_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {capitalizeRole(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="never">Never signed in</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />
      ) : null}

      <TemporaryPasswordDialog created={created} onClose={() => setCreated(null)} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They immediately lose access to this admin. Entries, revisions, and media they created stay in
              place, just no longer attributed to anyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
