import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSaveBar, SettingsSection, toSettingsInput } from './shared';

const SOCIAL_PLATFORMS = [
  { key: 'website', label: 'Website' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
] as const;

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
}

function isValidUrl(value: string): boolean {
  return /^https?:\/\/.+/i.test(value);
}

export function SocialSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [links, setLinks] = useState<Record<string, string>>(settings?.socialLinks ?? {});
  const [savedLinks, setSavedLinks] = useState<Record<string, string>>(settings?.socialLinks ?? {});
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(links) !== JSON.stringify(savedLinks);

  async function handleSave() {
    setError(null);

    const invalid = SOCIAL_PLATFORMS.find((platform) => {
      const value = links[platform.key]?.trim();
      return value && !isValidUrl(value);
    });
    if (invalid) {
      setError(`${invalid.label} must be a full URL starting with http:// or https://`);
      return;
    }

    const cleaned = Object.fromEntries(
      Object.entries(links)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value),
    );

    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        socialLinks: Object.keys(cleaned).length ? cleaned : null,
      });
      setLinks(cleaned);
      setSavedLinks(cleaned);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  function handleDiscard() {
    setLinks(savedLinks);
    setError(null);
  }

  return (
    <SettingsSection
      title="Social"
      description="Links shown wherever this deployment surfaces social profiles."
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
      {SOCIAL_PLATFORMS.map((platform) => (
        <div key={platform.key} className="flex flex-col gap-2">
          <Label htmlFor={`social-${platform.key}`}>{platform.label}</Label>
          <Input
            id={`social-${platform.key}`}
            placeholder="https://"
            disabled={readOnly}
            value={links[platform.key] ?? ''}
            onChange={(event) => setLinks((prev) => ({ ...prev, [platform.key]: event.target.value }))}
          />
        </div>
      ))}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
