import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import { KNOWN_SOCIAL_PLATFORMS } from '@/lib/types';
import type { SocialLink, SocialPlatform, SocialSettingsData } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection, SettingsSaveBar } from './shared';

const EMPTY: SocialSettingsData = { links: [] };

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  instagram: 'Instagram',
  facebook: 'Facebook',
  medium: 'Medium',
  hashnode: 'Hashnode',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  discord: 'Discord',
  custom: 'Other',
};

interface SectionProps {
  readOnly: boolean;
}

// Structured Settings' `social` module: a links collection rather than one field per platform,
// so a new platform never needs a migration — pick "Other" and supply your own label.
export function SocialSection({ readOnly }: SectionProps) {
  const { data: row, isPending } = useStructuredSettings('social');
  const updateSocial = useUpdateStructuredSettings('social');

  const saved = (row?.data as SocialSettingsData | undefined) ?? EMPTY;
  const [draft, setDraft] = useState<SocialSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function updateLink(index: number, patch: Partial<SocialLink>) {
    setDraft({ links: draft.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });
  }

  function removeLink(index: number) {
    setDraft({ links: draft.links.filter((_, i) => i !== index) });
  }

  function addLink() {
    setDraft({ links: [...draft.links, { platform: 'twitter', label: PLATFORM_LABELS.twitter, url: '' }] });
  }

  async function handleSave() {
    setError(null);
    try {
      await updateSocial.mutateAsync(draft);
      toast.success('Social settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save social settings';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="Social" description="Social links for this site.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Social"
      description="Social links for this site — exposed at GET /api/v1/public/settings/social as { links: [...] }."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateSocial.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      {draft.links.length === 0 ? <p className="text-sm text-muted-foreground">No social links yet.</p> : null}

      {draft.links.map((link, index) => (
        <div key={index} className="flex items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`social-platform-${index}`}>Platform</Label>
            <Select
              value={link.platform}
              disabled={readOnly}
              onValueChange={(value) =>
                updateLink(index, {
                  platform: value as SocialPlatform,
                  label: link.label || PLATFORM_LABELS[value as SocialPlatform],
                })
              }
            >
              <SelectTrigger id={`social-platform-${index}`} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...KNOWN_SOCIAL_PLATFORMS, 'custom' as const].map((platform) => (
                  <SelectItem key={platform} value={platform}>
                    {PLATFORM_LABELS[platform]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`social-label-${index}`}>Label</Label>
            <Input
              id={`social-label-${index}`}
              disabled={readOnly}
              value={link.label}
              onChange={(event) => updateLink(index, { label: event.target.value })}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`social-url-${index}`}>URL</Label>
            <Input
              id={`social-url-${index}`}
              placeholder="https://..."
              disabled={readOnly}
              value={link.url}
              onChange={(event) => updateLink(index, { url: event.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove link"
            disabled={readOnly}
            onClick={() => removeLink(index)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" disabled={readOnly} onClick={addLink} className="self-start">
        Add link
      </Button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
