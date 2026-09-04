import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { AvatarPickerDialog } from '@/components/avatar-picker-dialog';
import { TwoFactorSettings } from '@/components/two-factor-settings';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function SecurityTab({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
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
    <div className="flex max-w-md flex-col gap-6">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
          <SecurityTab twoFactorEnabled={Boolean(user.twoFactorEnabled)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
