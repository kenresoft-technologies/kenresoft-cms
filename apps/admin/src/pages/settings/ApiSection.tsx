import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { API_URL, ApiError } from '@/lib/api-client';
import { useSystemStatus } from '@/lib/queries/password-recovery';
import { useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
            Owner and Admin always see it once this is on. For Editor and Author, grant it per
            person from the Users page — never to Viewer.
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

// Read-only status, not a control — EMAIL_PROVIDER is a Worker var/secret set at deploy time
// (docs/DEPLOYMENT.md's recovery section), not something the admin UI can change. Surfacing it
// here closes the gap where an owner enables password reset in their head but never actually
// sets EMAIL_PROVIDER, then gets a support request wondering why reset emails never arrive.
function EmailDeliverySection() {
  const { data: status, isPending } = useSystemStatus();

  return (
    <SettingsSection
      title="Email delivery"
      description="Whether this deployment can actually send password-reset emails."
    >
      <div className="flex items-center justify-between gap-4">
        {isPending ? (
          <>
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
          </>
        ) : (
          <>
            <p className="max-w-md text-sm text-muted-foreground">
              {status?.emailConfigured
                ? 'A real email provider is configured — password-reset requests deliver normally.'
                : "No EMAIL_PROVIDER is set for this deployment. Password-reset requests still succeed, but no email is actually sent — set EMAIL_PROVIDER in wrangler.toml (see docs/DEPLOYMENT.md) to enable delivery."}
            </p>
            <Badge
              variant="outline"
              className={
                status?.emailConfigured
                  ? 'shrink-0 border-success/30 bg-success/10 text-success'
                  : 'shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              }
            >
              {status?.emailConfigured ? 'Configured' : 'Not configured'}
            </Badge>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

// Same mechanism/UI shape as DeveloperExperienceSection above (a dedicated card over one
// Settings.featureFlags key), for the same reason: recordAudit() (apps/api/src/lib/audit.ts)
// has no retention/pruning, so this table grows forever unless an owner opts out here.
function AuditLoggingSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();
  const initial = settings?.featureFlags?.auditLoggingEnabled !== false;
  const [enabled, setEnabled] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== saved;

  async function handleSave() {
    setError(null);
    try {
      await updateSettings.mutateAsync({
        ...toSettingsInput(settings),
        featureFlags: { ...(settings?.featureFlags ?? {}), auditLoggingEnabled: enabled },
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
      title="Audit logging"
      description="Records every role change, structural write, and auth event to a permanent log."
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
          <Label htmlFor="settings-audit-logging">Audit logging</Label>
          <p className="max-w-md text-sm text-muted-foreground">
            The audit log has no automatic pruning — every recorded event stays in the database
            forever, which is exactly what you want for accountability, but does mean it grows
            without bound over time. Turning this off stops new events from being recorded; it
            doesn't delete what's already there.
          </p>
        </div>
        <Switch
          id="settings-audit-logging"
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={setEnabled}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}

// The CMS is frontend-agnostic (docs/ARCHITECTURE.md §15) and has no way to know an arbitrary
// frontend's own URL routing, so the operator supplies the pattern their own site actually uses
// — substituted verbatim, no templating engine, by EntryEditorPage.tsx when building a link.
function LivePreviewSection({ settings, readOnly }: SectionProps) {
  const updateSettings = useUpdateSettings();

  const [previewUrl, setPreviewUrl] = useState(settings?.previewUrl ?? '');
  const [savedPreviewUrl, setSavedPreviewUrl] = useState(settings?.previewUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const dirty = previewUrl !== savedPreviewUrl;

  async function handleSave() {
    setError(null);
    const trimmed = previewUrl.trim();
    if (trimmed && !trimmed.includes('{slug}')) {
      setError('The template must include a {slug} placeholder');
      return;
    }

    try {
      await updateSettings.mutateAsync({ ...toSettingsInput(settings), previewUrl: trimmed || null });
      setPreviewUrl(trimmed);
      setSavedPreviewUrl(trimmed);
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <SettingsSection
      title="Live Preview"
      description="The URL template your frontend uses to render one entry, so the Entry Editor's Preview button can open it."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateSettings.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => {
            setPreviewUrl(savedPreviewUrl);
            setError(null);
          }}
        />
      }
    >
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How this works</p>
        <p className="mt-1">
          Live Preview lets you view a draft (or any unpublished change) exactly as it'll look on
          your real site, before you publish it. It needs your frontend to have a page for
          rendering one entry, and for that page to check for a <code className="rounded bg-muted px-1 py-0.5 text-xs">preview_token</code>{' '}
          link parameter — when present, it fetches the entry through the preview endpoint
          instead of the normal public one, which is the only way this works for a draft that
          isn't published yet. Below, tell us the URL pattern that page uses on your site.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-preview-url">Preview URL template</Label>
        <Input
          id="settings-preview-url"
          placeholder="http://localhost:4321/{contentType}/{slug}"
          disabled={readOnly}
          value={previewUrl}
          onChange={(event) => setPreviewUrl(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{contentType}'}</code> and{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{slug}'}</code> are replaced with the
          entry's own values — for <code className="rounded bg-muted px-1 py-0.5 text-xs">examples/astro-site</code>{' '}
          running locally, that's <code className="rounded bg-muted px-1 py-0.5 text-xs">http://localhost:4321/blog/{'{slug}'}</code>{' '}
          (this example only reads <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{slug}'}</code>, since it
          has one content type hardcoded to the <code className="rounded bg-muted px-1 py-0.5 text-xs">/blog</code>{' '}
          path).
        </p>
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
            placeholder="https://cms.example.com"
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

      <EmailDeliverySection />

      <LivePreviewSection settings={settings} readOnly={readOnly} />

      {/* The two most delicate, "don't toggle casually" controls in this section go last,
          deliberately de-prioritized below the more expected/benign API settings above. */}
      <AuditLoggingSection settings={settings} readOnly={readOnly} />

      <DeveloperExperienceSection settings={settings} readOnly={readOnly} />
    </div>
  );
}
