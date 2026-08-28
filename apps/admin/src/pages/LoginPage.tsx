import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Layers, Loader2 } from 'lucide-react';
import { Navigate } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'sign-in' | 'sign-up';

// This page's own larger scale, not a change to the shared Input/Button components (which
// stay their normal size for the dozens of dense, data-table-heavy screens elsewhere in the
// admin) — an auth screen is the one place in a CMS that's supposed to feel spacious and
// premium rather than compact and information-dense.
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

export function LoginPage() {
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reacts to the same session store AppLayout redirects from — sign-in resolves the HTTP
  // call before the client's session store finishes its own follow-up refresh, so navigating
  // immediately on submit would race AppLayout's session check and bounce back here.
  if (!isPending && session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // Wrapped in try/catch (missing before, and not just theoretical — this is exactly what
    // left the submit button stuck on "Signing in…" forever the first time this app was
    // pointed at a real deployment: a CORS-rejected request throws instead of resolving to
    // `{ error }`, and with no catch here that left isSubmitting stuck true with no feedback).
    try {
      const { error: authError } =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });

      if (authError) {
        setError(authError.message ?? (mode === 'sign-in' ? 'Sign in failed' : 'Sign up failed'));
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode() {
    setMode((prev) => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
    setError(null);
    setShowPassword(false);
  }

  return (
    <div className="flex min-h-svh">
      {/* Branding panel — the form-only view on small screens gets its own compact mark
          instead of this, so the identity is never missing, just presented differently. */}
      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:w-[45%] lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="bg-primary-foreground/15" />
          <span className="text-xl font-semibold">Kenresoft CMS</span>
        </div>
        <div className="relative flex max-w-md flex-col gap-5">
          <h1 className="text-4xl leading-tight font-semibold text-balance">
            A Cloudflare-native, API-first content platform.
          </h1>
          <p className="text-lg text-primary-foreground/75">
            Model content, manage entries and media, and publish to any frontend — Astro,
            Next.js, or your own — through one clean REST API.
          </p>
        </div>
        <p className="relative text-sm text-primary-foreground/60">
          Reusable, open-source-ready, single-site-per-deployment.
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8 p-6">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          <BrandMark />
          <span className="text-xl font-semibold">Kenresoft CMS</span>
        </div>

        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-semibold tracking-tight">
              {mode === 'sign-in' ? 'Sign in' : 'Create your account'}
            </h2>
            <p className="text-base text-muted-foreground">
              {mode === 'sign-in'
                ? 'Welcome back — enter your credentials to continue.'
                : 'The first account created on this deployment becomes its owner.'}
            </p>
          </div>

          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            {mode === 'sign-up' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-sm">
                  Name
                </Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            ) : null}

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
              <Label htmlFor="password" className="text-sm">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
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

            {error ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button type="submit" disabled={isSubmitting} className={`${FIELD_CLASS} mt-1 gap-2 text-base`}>
              {isSubmitting ? <Loader2 className="size-5 animate-spin" /> : null}
              {isSubmitting
                ? mode === 'sign-in'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'sign-in'
                  ? 'Sign in'
                  : 'Create account'}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-sm">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground">
              {mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" onClick={switchMode} className={`${FIELD_CLASS} text-base`}>
            {mode === 'sign-in' ? 'Create an account' : 'Sign in instead'}
          </Button>
        </div>
      </div>
    </div>
  );
}
