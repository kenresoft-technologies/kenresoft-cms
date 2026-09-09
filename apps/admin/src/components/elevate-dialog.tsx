import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api-client';
import { useElevate } from '@/lib/queries/users';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// A password re-check that unlocks a security-sensitive action for a few minutes
// (apps/api/src/middleware/require-elevated-session.ts) — the caller controls when this opens
// and what happens once elevation succeeds, so the same dialog covers every gated action
// (disabling an admin, transferring ownership) without each one reimplementing the form.
export function ElevateDialog({
  open,
  onOpenChange,
  onElevated,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onElevated: () => void;
  description?: string;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const elevate = useElevate();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setPassword('');
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await elevate.mutateAsync(password);
      setPassword('');
      onOpenChange(false);
      onElevated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Incorrect password');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm your password</DialogTitle>
          <DialogDescription>
            {description ?? 'This is a security-sensitive action — re-enter your password to continue.'}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="elevate-password">Password</Label>
            <Input
              id="elevate-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={elevate.isPending}>
              {elevate.isPending ? 'Confirming…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
