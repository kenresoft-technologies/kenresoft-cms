import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Layers, Loader2 } from 'lucide-react';
import { Link } from 'react-router';

import { ApiError } from '@/lib/api-client';
import { useRedeemRecoveryCode } from '@/lib/queries/password-recovery';
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

// The fallback for "forgot my password AND lost access to my email" — redeems one of the
// owner's pre-generated one-time recovery codes (Settings → Users & Permissions) instead of an
// emailed link. A wrong email, wrong code, or already-used code all show the same generic
// error, matching the API's own response (docs/ARCHITECTURE.md's recovery section).
export function RecoverWithCodePage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const redeemCode = useRedeemRecoveryCode();

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

    try {
      await redeemCode.mutateAsync({ email, code, newPassword });
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

        {done ? (
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
              <h2 className="text-3xl font-semibold tracking-tight">Recover with a code</h2>
              <p className="text-base text-muted-foreground">
                Use one of your saved one-time recovery codes to reset your password directly.
              </p>
            </div>

            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="code" className="text-sm">
                  Recovery code
                </Label>
                <Input
                  id="code"
                  autoComplete="off"
                  required
                  placeholder="XXXXX-XXXXX"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className={`${FIELD_CLASS} font-mono uppercase`}
                />
              </div>

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

              <Button type="submit" disabled={redeemCode.isPending} className={`${FIELD_CLASS} mt-1 gap-2 text-base`}>
                {redeemCode.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
                {redeemCode.isPending ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>

            <Link to="/forgot-password" className="text-center text-sm text-muted-foreground hover:text-foreground">
              Back to forgot password
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
