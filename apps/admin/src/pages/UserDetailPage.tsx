import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useUpdateUserNotes, useUsers } from '@/lib/queries/users';
import { usePlugins } from '@/lib/queries/plugins';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import {
  accountType,
  ACCOUNT_TYPE_BADGE_TONE,
  ACCOUNT_TYPE_LABEL,
  DeveloperToolsCell,
  DisableUserControl,
  initials,
  RoleCell,
  SessionsDialog,
} from '@/pages/UsersPage';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

// Staff-only note about the account (a support ticket reference, why it was disabled, ...) —
// never visible to the account owner themselves (PATCH .../notes, never routed through
// better-auth's own client-facing updateUser). Local textarea state with an explicit Save,
// not autosave-on-blur, so a half-finished note isn't silently persisted on an accidental click
// away.
function InternalNotesCard({ userId, initialNotes }: { userId: string; initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes ?? '');
  const updateNotes = useUpdateUserNotes();
  const dirty = notes !== (initialNotes ?? '');

  function handleSave() {
    updateNotes.mutate(
      { id: userId, internalNotes: notes.trim() || null },
      {
        onSuccess: () => toast.success('Note saved'),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save note'),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Visible only to CMS staff — never shown to this account's own owner. Useful for support context: why an
          account was disabled, a ticket reference, anything worth remembering next time.
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="No notes yet."
          rows={4}
        />
        <Button type="button" size="sm" className="self-start" disabled={!dirty || updateNotes.isPending} onClick={handleSave}>
          {updateNotes.isPending ? 'Saving…' : 'Save note'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { data: users, isPending } = useUsers();
  const { data: session } = authClient.useSession();
  const { data: plugins } = usePlugins();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');

  const user = users?.find((u) => u.id === userId);
  const commerceEnabled = plugins?.find((p) => p.id === 'commerce')?.enabled ?? false;

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageBreadcrumb items={[{ label: 'Users', to: '/users' }, { label: '…' }]} />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <PageBreadcrumb items={[{ label: 'Users', to: '/users' }, { label: 'Not found' }]} />
        <p className="text-sm text-muted-foreground">
          That account doesn't exist, or you don't have permission to see it.{' '}
          <button type="button" className="underline" onClick={() => navigate('/users')}>
            Back to Users
          </button>
        </p>
      </div>
    );
  }

  const type = accountType(user);

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Users', to: '/users' }, { label: user.name }]} />
      <PageHeader title={user.name} description={user.email} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="size-14">
                <AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{user.name}</CardTitle>
                  <Badge variant="outline" className={ACCOUNT_TYPE_BADGE_TONE[type]}>
                    {ACCOUNT_TYPE_LABEL[type]}
                  </Badge>
                  {!user.emailVerified ? (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      Unverified
                    </Badge>
                  ) : null}
                  {user.disabled ? (
                    <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                      Disabled
                    </Badge>
                  ) : null}
                </div>
                <span className="text-sm text-muted-foreground">{user.email}</span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-0">
              <DetailRow label="Role" value={<RoleCell user={user} canEdit={isAdmin} />} />
              <DetailRow
                label="Account type"
                value={
                  <span>
                    {ACCOUNT_TYPE_LABEL[type]}
                    {type === 'cms_staff' && user.isCommerceCustomer ? ' (also a Commerce customer)' : ''}
                  </span>
                }
              />
              <DetailRow label="Developer panel" value={<DeveloperToolsCell user={user} canEdit={isAdmin} />} />
              <DetailRow label="Phone" value={user.phone ?? <span className="text-muted-foreground">Not set</span>} />
              <DetailRow label="Joined" value={new Date(user.createdAt).toLocaleString()} />
              <DetailRow
                label="Last active"
                value={user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : 'Never'}
              />
              {user.isCommerceCustomer && commerceEnabled ? (
                <DetailRow
                  label="Commerce"
                  value={
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => navigate(`/plugins/commerce/customers/${user.id}`)}
                    >
                      View Commerce profile <ExternalLink className="size-3.5" />
                    </Button>
                  }
                />
              ) : null}
            </CardContent>
          </Card>

          <InternalNotesCard userId={user.id} initialNotes={user.internalNotes} />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Every device currently signed in as this account, and when each was last active.
              </p>
              <SessionsDialog user={user} />
            </CardContent>
          </Card>

          {isAdmin && user.role !== 'owner' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Danger zone</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {user.disabled ? 'This account is disabled.' : 'Disable this account and sign it out everywhere.'}
                </span>
                <DisableUserControl user={user} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
