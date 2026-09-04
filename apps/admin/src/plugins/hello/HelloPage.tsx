import { useState } from 'react';
import type { FormEvent } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { ApiError } from '@/lib/api-client';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateHelloGreeting, useHelloGreetings } from './queries';

// The Phase 1 plugin-platform proof-of-concept's admin page (docs/PLUGINS.md) — deliberately
// trivial. Demonstrates the same idioms every real plugin page would use: a TanStack Query hook
// for data, an empty state, and a role-gated create affordance (hidden below editor, matching
// FormsPage.tsx's "hide the affordance, not the page" convention) — not a new pattern of its own.
export function HelloPage() {
  const { data: session } = authClient.useSession();
  const canCreate = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: greetings, isPending, error } = useHelloGreetings();
  const createGreeting = useCreateHelloGreeting();
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await createGreeting.mutateAsync(message);
      setMessage('');
      toast.success('Greeting created');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create greeting');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Hello' }]} />
      <PageHeader
        title="Hello"
        description="The Phase 1 plugin-platform proof-of-concept — see docs/PLUGINS.md."
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {canCreate ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="hello-message">Message</Label>
            <Input
              id="hello-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Say something…"
              required
            />
          </div>
          <Button type="submit" disabled={createGreeting.isPending}>
            Create greeting
          </Button>
        </form>
      ) : null}

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}

      {greetings && greetings.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="No greetings yet"
          description="Create one above to see the hello plugin's full round trip."
        />
      ) : null}

      {greetings && greetings.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {greetings.map((greeting) => (
            <li key={greeting.id} className="rounded-lg border px-4 py-2 text-sm">
              {greeting.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
