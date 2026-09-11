import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import kenresoftLogoMark from '@/assets/kenresoft-cms-logo-mark.svg';
import { authClient } from '@/lib/auth-client';
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
      <img src={kenresoftLogoMark} alt="" className="size-5 brightness-0 invert" />
    </div>
  );
}

type VerifyState = 'loading' | 'success' | 'invalid' | 'missing-token';
type ResendState = 'idle' | 'sending' | 'sent' | 'failed';

// Lands here from the link in the verification email (apps/api/src/lib/auth.ts's
// emailVerification.sendVerificationEmail deliberately points here, not at the API's own
// baseURL-based redirect endpoint) — this page consumes the token itself and renders a real
// success/failure UI, rather than relying on an ambiguous "redirect landed with no error query
// param means success" signal.
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'missing-token');
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState<ResendState>('idle');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function verify() {
      // better-auth's own inferred client action for GET /verify-email — resolves
      // { status: true } on success (including re-visiting an already-verified, still-valid
      // link, which better-auth treats as idempotent success) or an error with `code` set to
      // e.g. TOKEN_EXPIRED/INVALID_TOKEN/USER_NOT_FOUND.
      const { error } = await authClient.verifyEmail({ query: { token: token! } });
      if (cancelled) return;
      setState(error ? 'invalid' : 'success');
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendState('sending');
    try {
      // Deliberately generic — better-auth's own unauthenticated resend endpoint is
      // enumeration-safe (same response whether the address exists or is already verified),
      // so this can't claim more than "if that email needs verifying, it's on its way."
      await authClient.sendVerificationEmail({ email: resendEmail });
      setResendState('sent');
    } catch {
      setResendState('failed');
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

        {state === 'loading' ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying your email…</p>
          </div>
        ) : state === 'missing-token' ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>This verification link is missing its token.</span>
            </div>
            <Button asChild className={`${FIELD_CLASS} text-base`}>
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : state === 'success' ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
                <CheckCircle2 className="size-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Your email has been verified</h2>
              <p className="text-base text-muted-foreground">You can now sign in with your password.</p>
            </div>
            <Button asChild className={`${FIELD_CLASS} text-base`}>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        ) : (
          // Invalid or expired — never surfaces the raw error code or token to the user.
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">Link invalid or expired</h2>
              <p className="text-base text-muted-foreground">
                This verification link is invalid or has expired. Enter your email to get a new one.
              </p>
            </div>

            {resendState === 'sent' ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/10 px-4 py-3 text-sm text-success">
                <MailCheck className="mt-0.5 size-4 shrink-0" />
                <span>If that email needs verifying, we've sent a new link — check your inbox.</span>
              </div>
            ) : (
              <form className="flex flex-col gap-5" onSubmit={handleResend}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="resend-email" className="text-sm">
                    Email
                  </Label>
                  <Input
                    id="resend-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={resendEmail}
                    onChange={(event) => setResendEmail(event.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>

                {resendState === 'failed' ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>Could not reach the server. Check your connection and try again.</span>
                  </div>
                ) : null}

                <Button type="submit" disabled={resendState === 'sending'} className={`${FIELD_CLASS} mt-1 gap-2 text-base`}>
                  {resendState === 'sending' ? <Loader2 className="size-5 animate-spin" /> : null}
                  {resendState === 'sending' ? 'Sending…' : 'Send a new verification email'}
                </Button>
              </form>
            )}

            <Link to="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
