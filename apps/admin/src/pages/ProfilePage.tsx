import { useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import {
  useGenerateRecoveryCodes,
  useRecoveryCodesStatus,
  useRevokeRecoveryCodes,
  useTransferOwnership,
  useUsers,
} from '@/lib/queries/users';
import { AvatarPickerDialog } from '@/components/avatar-picker-dialog';
import { ElevateDialog } from '@/components/elevate-dialog';
import { TwoFactorSettings } from '@/components/two-factor-settings';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const chars = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name.slice(0, 2)];
  return chars.join('').toUpperCase();
}

function ProfileTab({ user }: { user: { name: string; email: string; role: string; createdAt: Date } }) {
  const [name, setName] = useState(user.name);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const { error } = await authClient.updateUser({ name });
    setIsSubmitting(false);

    if (error) {
      toast.error(error.message ?? 'Failed to update profile');
    } else {
      toast.success('Profile updated');
    }
  }

  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input id="profile-name" required value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={user.email} disabled />
      </div>
      <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Role</span>
          <Badge variant="secondary" className="capitalize">
            {user.role}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Member since</span>
          <span>{user.createdAt.toLocaleDateString()}</span>
        </div>
      </div>
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

// Owner-only — an admin never sees this control at all, matching the API's own gate
// (requireRole('owner') on POST /security/ownership/transfer, checked before the elevation
// requirement even runs). A swap, not a grant: the acting owner becomes admin exactly as the
// target becomes owner, so there's never a moment with zero or two owners. Lives on the current
// user's own Profile → Security tab, not Settings — it only ever acts on the signed-in owner's
// own account (moved here from a former standalone "Users & Permissions" Settings section, which
// duplicated the real Users page for everything else it covered).
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

// Owner-only, self-only — these always act on the caller's own account (there's no "generate
// codes for someone else"). Regenerating fully replaces the set (server-side), which doubles
// as revoke; the separate revoke button below is for "I think these leaked" without wanting a
// fresh batch yet. Both are elevation-gated, same tier as ownership transfer: a valid code can
// reset this account's password with no email access at all, so minting or clearing a batch is
// exactly as sensitive as changing the password directly.
function RecoveryCodesControl() {
  const { data: status } = useRecoveryCodesStatus();
  const generateCodes = useGenerateRecoveryCodes();
  const revokeCodes = useRevokeRecoveryCodes();
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [elevateAction, setElevateAction] = useState<'generate' | 'revoke' | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function performGenerate() {
    try {
      const result = await generateCodes.mutateAsync();
      setNewCodes(result.codes);
      setSaved(false);
      setCopied(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to generate recovery codes');
    }
  }

  async function performRevoke() {
    try {
      await revokeCodes.mutateAsync();
      toast.success('Recovery codes revoked');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to revoke recovery codes');
    }
  }

  async function copyAll() {
    if (!newCodes) return;
    await navigator.clipboard.writeText(newCodes.join('\n'));
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Recovery codes</p>
        <p className="text-sm text-muted-foreground">
          One-time codes that reset your password without needing email access — for when you're locked out and
          can't receive a reset link.{' '}
          {status ? (
            <span className="font-medium text-foreground">
              {status.remaining} unused code{status.remaining === 1 ? '' : 's'} remaining.
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={generateCodes.isPending}
          onClick={() => setElevateAction('generate')}
        >
          {status?.remaining ? 'Regenerate codes' : 'Generate codes'}
        </Button>
        {status?.remaining ? (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevokeConfirmOpen(true)}>
            Revoke all codes
          </Button>
        ) : null}
      </div>

      <AlertDialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all recovery codes?</AlertDialogTitle>
            <AlertDialogDescription>
              Every existing code stops working immediately. You won't have this fallback until you generate a new
              set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setRevokeConfirmOpen(false);
                setElevateAction('revoke');
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ElevateDialog
        open={elevateAction !== null}
        onOpenChange={(open) => {
          if (!open) setElevateAction(null);
        }}
        onElevated={() => {
          if (elevateAction === 'generate') void performGenerate();
          if (elevateAction === 'revoke') void performRevoke();
          setElevateAction(null);
        }}
        description="Minting or clearing recovery codes is a security-sensitive action — re-enter your password to continue."
      />

      <Dialog open={newCodes !== null} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Save your recovery codes</DialogTitle>
            <DialogDescription>
              Each code works once. Store them somewhere safe — this is the only time they'll ever be shown.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
            {newCodes?.map((code) => <div key={code}>{code}</div>)}
          </div>
          <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => void copyAll()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I've saved these codes somewhere safe
            </label>
            <Button
              disabled={!saved}
              onClick={() => {
                setNewCodes(null);
                toast.success('Recovery codes generated');
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecurityTab({ twoFactorEnabled, isOwner }: { twoFactorEnabled: boolean; isOwner: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword });
    setIsSubmitting(false);

    if (error) {
      toast.error(error.message ?? 'Failed to change password');
    } else {
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <form className="flex max-w-md flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
      <TwoFactorSettings enabled={twoFactorEnabled} />

      {isOwner ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Owner recovery</p>
            <p className="text-sm text-muted-foreground">
              These actions apply only to your own account, as this deployment's owner. To manage other
              people's roles and access, see{' '}
              <Link to="/users" className="font-medium text-primary hover:underline">
                Users
              </Link>
              .
            </p>
          </div>
          <RecoveryCodesControl />
          <TransferOwnershipControl />
        </div>
      ) : null}
    </div>
  );
}

export function ProfilePage() {
  const { data: session, isPending } = authClient.useSession();

  async function handleAvatarSelect(url: string) {
    const { error } = await authClient.updateUser({ image: url });
    if (error) {
      toast.error(error.message ?? 'Failed to update avatar');
    } else {
      toast.success('Avatar updated');
    }
  }

  // Previously `if (!session) return null` — a blank page with zero feedback while the session
  // loads, which is exactly when this route's own lazy chunk (plus its now-deferred qrcode/media
  // fetches) is still settling. A skeleton at least shows something happened.
  if (isPending || !session) {
    return (
      <div className="flex flex-col gap-6">
        <PageBreadcrumb items={[{ label: 'Profile' }]} />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  const user = session.user;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Profile' }]} />

      <div className="flex items-center gap-4">
        <Avatar size="lg">
          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
          <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="ml-auto">
          <AvatarPickerDialog onSelect={handleAvatarSelect} />
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab
            key={user.name}
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              createdAt: new Date(user.createdAt),
            }}
          />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab twoFactorEnabled={Boolean(user.twoFactorEnabled)} isOwner={user.role === 'owner'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
