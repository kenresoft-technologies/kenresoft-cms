import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSaveBar, SettingsSection, toSettingsInput } from './shared';

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
}

const FLAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

function flagsToList(flags: Record<string, boolean> | null | undefined) {
  return Object.entries(flags ?? {}).map(([name, enabled]) => ({ name, enabled }));
}

export function AdvancedSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [flags, setFlags] = useState(() => flagsToList(settings?.featureFlags));
  const [savedFlags, setSavedFlags] = useState(() => flagsToList(settings?.featureFlags));
  const [newFlagName, setNewFlagName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(flags) !== JSON.stringify(savedFlags);

  function addFlag() {
    const trimmed = newFlagName.trim();
    if (!trimmed) return;
    if (flags.some((flag) => flag.name === trimmed)) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    if (!FLAG_NAME_PATTERN.test(trimmed)) {
      setError('Flag names may only contain letters, numbers, hyphens and underscores.');
      return;
    }
    setError(null);
    setFlags((prev) => [...prev, { name: trimmed, enabled: true }]);
    setNewFlagName('');
  }

  async function handleSave() {
    setError(null);
    const flagsObject = Object.fromEntries(flags.map((flag) => [flag.name, flag.enabled]));

    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        featureFlags: Object.keys(flagsObject).length ? flagsObject : null,
      });
      setSavedFlags(flags);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  function handleDiscard() {
    setFlags(savedFlags);
    setError(null);
  }

  return (
    <SettingsSection
      title="Advanced"
      description="Feature flags for this deployment. Toggling one here doesn't change API behavior unless code checks for it."
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
      <div className="flex flex-col gap-3">
        <Label>Feature flags</Label>
        {flags.length === 0 ? <p className="text-sm text-muted-foreground">No feature flags yet.</p> : null}
        {flags.map((flag, index) => (
          <div key={flag.name} className="flex items-center gap-2">
            <Checkbox
              checked={flag.enabled}
              disabled={readOnly}
              onCheckedChange={(checked) =>
                setFlags((prev) => prev.map((f, i) => (i === index ? { ...f, enabled: checked === true } : f)))
              }
            />
            <span className="flex-1 font-mono text-sm">{flag.name}</span>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${flag.name}`}
                onClick={() => setFlags((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <div className="flex gap-2">
            <Input
              placeholder="flag-name"
              value={newFlagName}
              onChange={(event) => setNewFlagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addFlag();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addFlag}>
              Add
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
