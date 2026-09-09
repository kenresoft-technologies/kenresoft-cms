import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdateSettings } from '@/lib/queries/settings';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import type { GeneralSettingsData, Settings } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaReferenceField, SettingsSaveBar, SettingsSection, toSettingsInput } from './shared';

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
}

const EMPTY_BRANDING: GeneralSettingsData = { siteName: '', tagline: null, logoMediaId: null };

// The public site's own branding — distinct from Settings.name below (this deployment's admin
// identity: sidebar/browser tab). A deployment's admin label and its public site name are
// allowed to differ; Structured Settings' `general` module (docs/ARCHITECTURE.md §6) is the
// public-API-exposed one.
function SiteBrandingSection({ readOnly }: { readOnly: boolean }) {
  const { data: row, isPending } = useStructuredSettings('general');
  const updateGeneral = useUpdateStructuredSettings('general');

  const saved = (row?.data as GeneralSettingsData | undefined) ?? EMPTY_BRANDING;
  const [draft, setDraft] = useState<GeneralSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function handleSave() {
    setError(null);
    if (!draft.siteName.trim()) {
      setError('Site name is required.');
      return;
    }

    try {
      await updateGeneral.mutateAsync({ ...draft, siteName: draft.siteName.trim() });
      toast.success('Site branding saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save site branding';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="Site branding" description="The public site's own name, tagline, and logo.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Site branding"
      description="The public site's own name, tagline, and logo — exposed at GET /api/v1/public/settings/general."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateGeneral.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="general-site-name">Public site name</Label>
        <Input
          id="general-site-name"
          required
          disabled={readOnly}
          value={draft.siteName}
          onChange={(event) => setDraft({ ...draft, siteName: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="general-tagline">Tagline</Label>
        <Input
          id="general-tagline"
          disabled={readOnly}
          value={draft.tagline ?? ''}
          onChange={(event) => setDraft({ ...draft, tagline: event.target.value || null })}
        />
      </div>
      <MediaReferenceField
        label="Logo"
        mediaId={draft.logoMediaId}
        readOnly={readOnly}
        onChange={(mediaId) => setDraft({ ...draft, logoMediaId: mediaId })}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}

export function GeneralSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [name, setName] = useState(settings?.name ?? '');
  const [savedName, setSavedName] = useState(settings?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== savedName;

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError('Site name is required.');
      return;
    }

    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        name: name.trim(),
      });
      setSavedName(name.trim());
      setName(name.trim());
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  function handleDiscard() {
    setName(savedName);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Deployment identity"
        description="The identity of this deployment — used across the admin, never exposed to the public API."
        footer={
          <SettingsSaveBar
            dirty={dirty}
            pending={updateSettings.isPending}
            readOnly={readOnly}
            onSave={() => void handleSave()}
            onDiscard={handleDiscard}
          />
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-name">Site name</Label>
          <Input
            id="settings-name"
            required
            disabled={readOnly}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">Shown in the admin sidebar and browser tab.</p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </SettingsSection>

      <SiteBrandingSection readOnly={readOnly} />
    </div>
  );
}
