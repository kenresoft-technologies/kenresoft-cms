import { useState } from 'react';
import {
  ClipboardList,
  FileText,
  Images,
  Inbox,
  LayoutDashboard,
  LayoutList,
  LogOut,
  Puzzle,
  ScrollText,
  Search,
  Settings,
  User,
  Users,
  Variable,
} from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { usePlugins } from '@/lib/queries/plugins';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { pluginNavItems } from '@/plugins/registry';
import { CommandPalette } from '@/components/command-palette';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

const overviewItems = [{ to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard }];

const contentItems = [
  { to: '/content-types', label: 'Content types', end: false, icon: LayoutList },
  { to: '/entries', label: 'Entries', end: false, icon: FileText },
  { to: '/global-variables', label: 'Global variables', end: false, icon: Variable },
];

const engagementItems = [
  { to: '/media', label: 'Media', end: false, icon: Images },
  { to: '/forms', label: 'Forms', end: false, icon: ClipboardList },
  { to: '/submissions', label: 'Submissions', end: false, icon: Inbox },
];

const adminItems = [
  { to: '/users', label: 'Users', end: false, icon: Users },
  { to: '/settings', label: 'Settings', end: false, icon: Settings },
];

// Hidden below admin rather than shown-then-403ing on click — unlike Users/Settings, there's no
// meaningful read-only view of the audit log for a lower role (the API rejects the request
// outright, requireRole('admin') in routes/admin/audit-log.ts), so surfacing the link at all
// would just be a dead end for editor/author/viewer.
const auditLogItem = { to: '/audit-log', label: 'Audit log', end: false, icon: ScrollText };

// Same reasoning as auditLogItem — only admin can toggle a plugin (routes/admin/plugins.ts),
// so there's nothing a lower role could do with this page. Labeled "Installed Plugins" rather
// than bare "Plugins" so it doesn't collide with the "Plugins" SidebarGroupLabel below (the
// group of per-plugin nav entries) in either the rendered DOM or test queries.
const pluginsItem = { to: '/plugins', label: 'Installed Plugins', end: false, icon: Puzzle };

function initials(label: string) {
  const parts = label.trim().split(/\s+/);
  if (parts.length > 1) return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

type NavItem = { to: string; label: string; end: boolean; icon: typeof LayoutDashboard };

function NavItems({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
              <NavLink to={item.to} end={item.end}>
                <item.icon />
                <span>{item.label}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { data: plugins } = usePlugins();

  if (isPending) {
    return <div className="flex min-h-svh items-center justify-center">Loading…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const visibleAdminItems = roleAtLeast(session.user.role as UserRole, 'admin')
    ? [...adminItems, auditLogItem, pluginsItem]
    : adminItems;

  // Defaults to visible while the list is still loading (isPending), then corrects itself once
  // real data arrives — matches the rest of this app's "don't gate on load state, just fix up
  // once resolved" idiom rather than flashing every plugin link hidden on first paint.
  const visiblePluginNavItems = pluginNavItems.filter(
    (item) => (plugins?.find((plugin) => plugin.id === item.pluginId)?.enabled ?? true),
  );

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-3">
          <span className="truncate text-lg font-semibold group-data-[collapsible=icon]:hidden">
            Kenresoft CMS
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <NavItems items={overviewItems} pathname={location.pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Content</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={contentItems} pathname={location.pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Media &amp; Forms</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={engagementItems} pathname={location.pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={visibleAdminItems} pathname={location.pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          {visiblePluginNavItems.length > 0 ? (
            <SidebarGroup>
              <SidebarGroupLabel>Plugins</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavItems items={visiblePluginNavItems} pathname={location.pathname} />
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback>{initials(session.user.name || session.user.email)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm group-data-[collapsible=icon]:hidden">
                  {session.user.name || session.user.email}
                </span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{session.user.name || session.user.email}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {session.user.role}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile">
                  <User />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => authClient.signOut()}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <SidebarTrigger />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCommandPaletteOpen(true)}>
              <Search />
              Search
              <kbd className="ml-1 rounded border bg-muted px-1.5 font-mono text-xs">⌘K</kbd>
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </SidebarProvider>
  );
}
