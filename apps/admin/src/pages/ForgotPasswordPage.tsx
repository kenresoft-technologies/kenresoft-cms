import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, KeyRound, Layers, Loader2, MailCheck } from 'lucide-react';
import { Link } from 'react-router';

import { useRequestPasswordReset, useSystemStatus } from '@/lib/queries/password-recovery';
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

// Always shows the same success state regardless of whether the email matched an account —
// mirrors the API's own generic response (docs/ARCHITECTURE.md's recovery section), so this
// page can't be used to enumerate accounts either.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const requestReset = useRequestPasswordReset();
  const { data: systemStatus } = useSystemStatus();
  const emailNotConfigured = systemStatus?.emailConfigured === false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await requestReset.mutateAsync(email);
      setSent(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
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

        {sent ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MailCheck className="size-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Check your email</h2>
              {emailNotConfigured ? (
                <p className="text-base text-muted-foreground">
                  This deployment doesn't have email delivery configured yet, so no reset link was actually
                  sent to <span className="font-medium text-foreground">{email}</span>. Ask whoever manages this
                  CMS to reset your password directly, or use a recovery code if you have one.
                </p>
              ) : (
                <p className="text-base text-muted-foreground">
                  If an account exists for <span className="font-medium text-foreground">{email}</span>, we've sent a
                  link to reset your password. It expires in 1 hour.
                </p>
              )}
            </div>
            <Button asChild variant="outline" className={`${FIELD_CLASS} gap-2 text-base`}>
              <Link to="/login">
                <ArrowLeft className="size-4" />
                Back to sign in
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-semibold tracking-tight">Forgot your password?</h2>
              <p className="text-base text-muted-foreground">
                Enter your email and we'll send you a link to reset it.
              </p>
            </div>

            {emailNotConfigured ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Email delivery isn't configured for this deployment — a reset link won't actually be sent.
                  Ask whoever manages this CMS to reset your password directly, or use a recovery code below.
                </span>
              </div>
            ) : null}

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

              {error ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" disabled={requestReset.isPending} className={`${FIELD_CLASS} mt-1 gap-2 text-base`}>
                {requestReset.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
                {requestReset.isPending ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>

            <div className="flex flex-col items-center gap-3 text-sm">
              <Link to="/login" className="text-muted-foreground hover:text-foreground">
                Back to sign in
              </Link>
              <Link
                to="/recover-with-code"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <KeyRound className="size-3.5" />
                Have a recovery code instead?
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
