import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, FileText, Images, Inbox, LayoutDashboard, LayoutList, Settings, Users } from 'lucide-react';

import { useContentTypes } from '@/lib/queries/content-types';
import { useDashboardStats } from '@/lib/queries/dashboard';
import { useForms } from '@/lib/queries/forms';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Global cmd+k / ctrl+k shortcut, matching the convention Linear/Vercel/GitHub use — held
// open state lives in AppLayout so the header's search button can toggle the same instance.
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: contentTypes } = useContentTypes();
  const { data: forms } = useForms();
  const { data: stats } = useDashboardStats();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  function go(to: string) {
    onOpenChange(false);
    void navigate(to);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* shadcn's generated CommandDialog doesn't establish cmdk's own Command context —
          it just wraps a Dialog, so CommandInput/List/Item need an explicit <Command> here. */}
      <Command>
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem value="Dashboard" onSelect={() => go('/')}>
              <LayoutDashboard />
              Dashboard
            </CommandItem>
            <CommandItem value="Content types" onSelect={() => go('/content-types')}>
              <LayoutList />
              Content types
            </CommandItem>
            <CommandItem value="Entries" onSelect={() => go('/entries')}>
              <FileText />
              Entries
            </CommandItem>
            <CommandItem value="Media" onSelect={() => go('/media')}>
              <Images />
              Media
            </CommandItem>
            <CommandItem value="Forms" onSelect={() => go('/forms')}>
              <ClipboardList />
              Forms
            </CommandItem>
            <CommandItem value="Submissions" onSelect={() => go('/submissions')}>
              <Inbox />
              Submissions
            </CommandItem>
            <CommandItem value="Users" onSelect={() => go('/users')}>
              <Users />
              Users
            </CommandItem>
            <CommandItem value="Settings" onSelect={() => go('/settings')}>
              <Settings />
              Settings
            </CommandItem>
          </CommandGroup>
          {contentTypes && contentTypes.length > 0 ? (
            <CommandGroup heading="Content types">
              {contentTypes.map((contentType) => (
                <CommandItem
                  key={contentType.id}
                  value={contentType.name}
                  onSelect={() => go(`/content-types/${contentType.id}`)}
                >
                  <LayoutList />
                  {contentType.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {forms && forms.length > 0 ? (
            <CommandGroup heading="Forms">
              {forms.map((form) => (
                <CommandItem key={form.id} value={form.name} onSelect={() => go(`/forms/${form.id}`)}>
                  <ClipboardList />
                  {form.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {stats && stats.recentEntries.length > 0 ? (
            <CommandGroup heading="Recent entries">
              {stats.recentEntries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`${entry.slug} ${entry.contentTypeName}`}
                  onSelect={() => go(`/content-types/${entry.contentTypeId}/entries/${entry.id}`)}
                >
                  <FileText />
                  {entry.slug}
                  <span className="ml-auto text-xs text-muted-foreground">{entry.contentTypeName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
