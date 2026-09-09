import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSaveBar, SettingsSection, toSettingsInput } from './shared';

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
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
    <SettingsSection
      title="General"
      description="The identity of this deployment — used across the admin and wherever the site references itself."
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
  );
}
