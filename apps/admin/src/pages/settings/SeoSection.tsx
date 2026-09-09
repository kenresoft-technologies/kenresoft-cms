import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import type { SeoSettingsData } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { MediaReferenceField, SettingsSection, SettingsSaveBar } from './shared';

const EMPTY: SeoSettingsData = {
  defaultTitle: null,
  defaultDescription: null,
  defaultOgImageMediaId: null,
  googleSiteVerification: null,
};

interface SectionProps {
  readOnly: boolean;
}

// Structured Settings' `seo` module — site-default fallbacks only; page/entry-specific SEO
// belongs on the relevant content type/entry, never here (docs/ARCHITECTURE.md §6).
export function SeoSection({ readOnly }: SectionProps) {
  const { data: row, isPending } = useStructuredSettings('seo');
  const updateSeo = useUpdateStructuredSettings('seo');

  const saved = (row?.data as SeoSettingsData | undefined) ?? EMPTY;
  const [draft, setDraft] = useState<SeoSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function handleSave() {
    setError(null);
    try {
      await updateSeo.mutateAsync(draft);
      toast.success('SEO settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save SEO settings';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="SEO" description="Site-default SEO fallbacks.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="SEO"
      description="Site-default SEO fallbacks — exposed at GET /api/v1/public/settings/seo. Page-specific SEO belongs on the relevant content type or entry, not here."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateSeo.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="seo-default-title">Default title</Label>
        <Input
          id="seo-default-title"
          disabled={readOnly}
          value={draft.defaultTitle ?? ''}
          onChange={(event) => setDraft({ ...draft, defaultTitle: event.target.value || null })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seo-default-description">Default description</Label>
        <Textarea
          id="seo-default-description"
          rows={3}
          disabled={readOnly}
          value={draft.defaultDescription ?? ''}
          onChange={(event) => setDraft({ ...draft, defaultDescription: event.target.value || null })}
        />
      </div>
      <MediaReferenceField
        label="Default social share image"
        mediaId={draft.defaultOgImageMediaId}
        readOnly={readOnly}
        onChange={(mediaId) => setDraft({ ...draft, defaultOgImageMediaId: mediaId })}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="seo-google-verification">Google site verification</Label>
        <Input
          id="seo-google-verification"
          disabled={readOnly}
          value={draft.googleSiteVerification ?? ''}
          onChange={(event) => setDraft({ ...draft, googleSiteVerification: event.target.value || null })}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
