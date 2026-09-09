import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import type { ContactSettingsData } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection, SettingsSaveBar } from './shared';

const EMPTY: ContactSettingsData = { email: null, phone: null, address: null };

interface SectionProps {
  readOnly: boolean;
}

// Structured Settings' `contact` module (docs/ARCHITECTURE.md §6) — a real, typed,
// publicly-readable Contact editor, replacing the earlier redirect to Global Variables.
export function ContactSection({ readOnly }: SectionProps) {
  const { data: row, isPending } = useStructuredSettings('contact');
  const updateContact = useUpdateStructuredSettings('contact');

  const saved = (row?.data as ContactSettingsData | undefined) ?? EMPTY;
  const [draft, setDraft] = useState<ContactSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  // Reset local draft state once the real row arrives (first load), without clobbering
  // in-progress edits on a later refetch.
  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function handleSave() {
    setError(null);
    try {
      await updateContact.mutateAsync(draft);
      toast.success('Contact settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save contact settings';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="Contact" description="Publicly readable contact details for this site.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Contact"
      description="Publicly readable contact details for this site — exposed at GET /api/v1/public/settings/contact."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateContact.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          disabled={readOnly}
          value={draft.email ?? ''}
          onChange={(event) => setDraft({ ...draft, email: event.target.value || null })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="contact-phone">Phone</Label>
        <Input
          id="contact-phone"
          disabled={readOnly}
          value={draft.phone ?? ''}
          onChange={(event) => setDraft({ ...draft, phone: event.target.value || null })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="contact-address">Address</Label>
        <Input
          id="contact-address"
          disabled={readOnly}
          value={draft.address ?? ''}
          onChange={(event) => setDraft({ ...draft, address: event.target.value || null })}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
