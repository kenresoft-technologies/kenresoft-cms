import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Mode = 'sign-in' | 'sign-up';

export function LoginPage() {
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</CardTitle>
          <CardDescription>
            Kenresoft CMS admin
            {mode === 'sign-up' ? ' — the first account created becomes the owner.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {mode === 'sign-up' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (mode === 'sign-in' ? 'Signing in…' : 'Creating account…') : mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => {
                setMode((prev) => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
                setError(null);
              }}
            >
              {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
