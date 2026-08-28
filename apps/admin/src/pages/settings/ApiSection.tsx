import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { API_URL, ApiError } from '@/lib/api-client';
import { DEVELOPER_MODE_ROLES } from '@/lib/developer-mode';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsSaveBar, SettingsSection, toSettingsInput } from './shared';

interface SectionProps {
  settings: Settings | null;
  readOnly: boolean;
}

// A dedicated, labeled control over the same Settings.featureFlags.developerMode key the
// generic flag editor in Advanced could also toggle by name — this one is the discoverable,
// premium surface for it; Advanced stays the raw escape hatch.
function DeveloperExperienceSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();
  const initial = settings?.featureFlags?.developerMode ?? false;
  const [enabled, setEnabled] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== saved;

  async function handleSave() {
    setError(null);
    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        featureFlags: { ...(settings?.featureFlags ?? {}), developerMode: enabled },
      });
      setSaved(enabled);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <SettingsSection
      title="Developer experience"
      description="Contextual API documentation and integration snippets across the CMS."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateSettings.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => {
            setEnabled(saved);
            setError(null);
          }}
        />
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="settings-developer-mode">Developer Mode</Label>
          <p className="max-w-md text-sm text-muted-foreground">
            Adds a "Developer" action to Content Types, Entries, Forms, and Media — endpoints,
            example requests/responses, and ready-to-copy Astro/TypeScript/JavaScript/React/
            Next.js/cURL snippets. Off by default so content managers see a purely
            content-focused CMS.
          </p>
          <p className="text-xs text-muted-foreground">
            Visible to {DEVELOPER_MODE_ROLES.join(', ')} when on — never to Viewer.
          </p>
        </div>
        <Switch
          id="settings-developer-mode"
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={setEnabled}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}

export function ApiSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [corsOrigin, setCorsOrigin] = useState(settings?.corsOrigin ?? '');
  const [savedCorsOrigin, setSavedCorsOrigin] = useState(settings?.corsOrigin ?? '');
  const [error, setError] = useState<string | null>(null);

  const dirty = corsOrigin !== savedCorsOrigin;

  async function handleSave() {
    setError(null);
    const trimmed = corsOrigin.trim();
    if (trimmed && !/^https?:\/\/.+/i.test(trimmed)) {
      setError('CORS origin must be a full URL starting with http:// or https://');
      return;
    }

    try {
      await updateSettings.mutateAsync({ ...toSettingsInput(settings), corsOrigin: trimmed || null });
      setCorsOrigin(trimmed);
      setSavedCorsOrigin(trimmed);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  function handleDiscard() {
    setCorsOrigin(savedCorsOrigin);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <DeveloperExperienceSection settings={settings} readOnly={readOnly} />

      <SettingsSection
        title="API access"
        description="Controls how external origins are allowed to call this deployment's API."
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
          <Label htmlFor="settings-cors-origin">CORS origin</Label>
          <Input
            id="settings-cors-origin"
            placeholder="https://pathvera.com"
            disabled={readOnly}
            value={corsOrigin}
            onChange={(event) => setCorsOrigin(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Informational reference only — the actual allow-list is configured via the
            CORS_ORIGINS environment binding (§9).
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </SettingsSection>

      <SettingsSection title="API reference" description="Live documentation for this deployment's REST API.">
        <div className="flex flex-col gap-3">
          <a
            href={`${API_URL}/api/v1/docs`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            API reference (Scalar)
            <ExternalLink className="size-3.5" />
          </a>
          <a
            href={`${API_URL}/api/v1/openapi.json`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            OpenAPI document (JSON)
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </SettingsSection>
    </div>
  );
}
