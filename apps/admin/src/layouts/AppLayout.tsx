import { Navigate, NavLink, Outlet } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/projects', label: 'Projects', end: false },
];

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
        <div className="flex items-center gap-6">
          <span className="font-semibold">Kenresoft CMS</span>
          <nav className="flex items-center gap-4 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground font-medium')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
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
