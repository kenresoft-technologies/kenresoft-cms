import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Layers, Loader2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import { ApiError } from '@/lib/api-client';
import { useConfirmPasswordReset } from '@/lib/queries/password-recovery';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FIELD_CLASS = 'h-12 px-4 text-base';

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground ${className ?? ''}`}
    >
      <Layers className="size-5" />
    </div>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirmReset = useConfirmPasswordReset();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!token) return;

    try {
      await confirmReset.mutateAsync({ token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-xl font-semibold">Kenresoft CMS</span>
        </div>

        {!token ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>This reset link is missing its token. Request a new one to continue.</span>
            </div>
            <Button asChild className={`${FIELD_CLASS} text-base`}>
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </div>
        ) : done ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
                <CheckCircle2 className="size-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Password reset</h2>
              <p className="text-base text-muted-foreground">
                Your password has been changed and you've been signed out everywhere. Sign in with your new password.
              </p>
            </div>
            <Button asChild className={`${FIELD_CLASS} text-base`}>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-semibold tracking-tight">Choose a new password</h2>
              <p className="text-base text-muted-foreground">
                This will sign you out of every device — sign back in with your new password afterward.
              </p>
            </div>

            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password" className="text-sm">
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className={`${FIELD_CLASS} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password" className="text-sm">
                  Confirm new password
                </Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              {error ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" disabled={confirmReset.isPending} className={`${FIELD_CLASS} mt-1 gap-2 text-base`}>
                {confirmReset.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
                {confirmReset.isPending ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>

            <Link to="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
