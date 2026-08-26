import { Navigate, Outlet } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <div className="flex min-h-svh items-center justify-center">Loading…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-svh">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Kenresoft CMS</span>
        <div className="flex items-center gap-3 text-sm">
          <span>{session.user.email}</span>
          <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
