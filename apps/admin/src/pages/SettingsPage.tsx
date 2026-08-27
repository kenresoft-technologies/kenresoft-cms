import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useSettings, useUpdateSettings } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const SOCIAL_PLATFORMS = [
  { key: 'website', label: 'Website' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
] as const;

interface SettingsFormProps {
  settings: Settings | null;
  readOnly: boolean;
}

function SettingsForm({ settings, readOnly }: SettingsFormProps) {
  const updateSettings = useUpdateSettings();

  const [name, setName] = useState(settings?.name ?? '');
  const [contactEmail, setContactEmail] = useState(settings?.contactEmail ?? '');
  const [corsOrigin, setCorsOrigin] = useState(settings?.corsOrigin ?? '');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>(settings?.socialLinks ?? {});
  const [featureFlags, setFeatureFlags] = useState<{ name: string; enabled: boolean }[]>(() =>
    Object.entries(settings?.featureFlags ?? {}).map(([flagName, enabled]) => ({ name: flagName, enabled })),
  );
  const [newFlagName, setNewFlagName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const flagsObject = Object.fromEntries(
      featureFlags.filter((flag) => flag.name.trim()).map((flag) => [flag.name.trim(), flag.enabled]),
    );
    const linksObject = Object.fromEntries(Object.entries(socialLinks).filter(([, value]) => value.trim()));

    try {
      await updateSettings.mutateAsync({
        name,
        contactEmail: contactEmail || null,
        corsOrigin: corsOrigin || null,
        socialLinks: Object.keys(linksObject).length ? linksObject : null,
        featureFlags: Object.keys(flagsObject).length ? flagsObject : null,
      });
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  function addFlag() {
    const trimmed = newFlagName.trim();
    if (!trimmed || featureFlags.some((flag) => flag.name === trimmed)) return;
    setFeatureFlags((prev) => [...prev, { name: trimmed, enabled: true }]);
    setNewFlagName('');
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-name">Site name</Label>
            <Input
              id="settings-name"
              required
              disabled={readOnly}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-contact-email">Contact email</Label>
            <Input
              id="settings-contact-email"
              type="email"
              disabled={readOnly}
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </div>
        </TabsContent>

        <TabsContent value="social" className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-muted-foreground">Links shown wherever this deployment surfaces social profiles.</p>
          {SOCIAL_PLATFORMS.map((platform) => (
            <div key={platform.key} className="flex flex-col gap-2">
              <Label htmlFor={`social-${platform.key}`} className="text-sm font-normal text-muted-foreground">
                {platform.label}
              </Label>
              <Input
                id={`social-${platform.key}`}
                disabled={readOnly}
                value={socialLinks[platform.key] ?? ''}
                onChange={(event) => setSocialLinks((prev) => ({ ...prev, [platform.key]: event.target.value }))}
              />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="advanced" className="flex flex-col gap-6 pt-4">
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

          <div className="flex flex-col gap-3">
            <Label>Feature flags</Label>
            {featureFlags.length === 0 ? <p className="text-sm text-muted-foreground">No feature flags yet.</p> : null}
            {featureFlags.map((flag, index) => (
              <div key={flag.name} className="flex items-center gap-2">
                <Checkbox
                  checked={flag.enabled}
                  disabled={readOnly}
                  onCheckedChange={(checked) =>
                    setFeatureFlags((prev) => prev.map((f, i) => (i === index ? { ...f, enabled: checked === true } : f)))
                  }
                />
                <span className="flex-1 font-mono text-sm">{flag.name}</span>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${flag.name}`}
                    onClick={() => setFeatureFlags((prev) => prev.filter((_, i) => i !== index))}
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
        </TabsContent>
      </Tabs>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!readOnly ? (
        <div>
          <Button type="submit" disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: settings, isPending } = useSettings();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Settings' }]} />

      <PageHeader
        title="Settings"
        description={`Site-wide configuration for this deployment (§6, §11).${!isOwner ? ' Only owners can make changes.' : ''}`}
      />

      {isPending ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : null}

      {!isPending ? (
        <Card>
          <CardContent>
            <SettingsForm key={settings?.updatedAt ?? 'new'} settings={settings ?? null} readOnly={!isOwner} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
