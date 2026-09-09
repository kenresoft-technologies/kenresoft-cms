import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import type { FooterLink, FooterSettingsData } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { SettingsSection, SettingsSaveBar } from './shared';

const EMPTY: FooterSettingsData = { description: null, copyrightText: null, links: [] };

interface SectionProps {
  readOnly: boolean;
}

// Structured Settings' `footer` module — a small, fixed set of fields actually used by the
// Kenresoft website's own footer, not a generic footer builder.
export function FooterSection({ readOnly }: SectionProps) {
  const { data: row, isPending } = useStructuredSettings('footer');
  const updateFooter = useUpdateStructuredSettings('footer');

  const saved = (row?.data as FooterSettingsData | undefined) ?? EMPTY;
  const [draft, setDraft] = useState<FooterSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function updateLink(index: number, patch: Partial<FooterLink>) {
    setDraft({ ...draft, links: draft.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });
  }

  function removeLink(index: number) {
    setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) });
  }

  function addLink() {
    setDraft({ ...draft, links: [...draft.links, { label: '', url: '' }] });
  }

  async function handleSave() {
    setError(null);
    try {
      await updateFooter.mutateAsync(draft);
      toast.success('Footer settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save footer settings';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="Footer" description="Site footer content.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Footer"
      description="Site footer content — exposed at GET /api/v1/public/settings/footer."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateFooter.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="footer-description">Description</Label>
        <Textarea
          id="footer-description"
          rows={3}
          disabled={readOnly}
          value={draft.description ?? ''}
          onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="footer-copyright">Copyright text</Label>
        <Input
          id="footer-copyright"
          placeholder="© 2026 Kenresoft Technologies"
          disabled={readOnly}
          value={draft.copyrightText ?? ''}
          onChange={(event) => setDraft({ ...draft, copyrightText: event.target.value || null })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Footer links</Label>
        {draft.links.length === 0 ? <p className="text-sm text-muted-foreground">No footer links yet.</p> : null}
        {draft.links.map((link, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`footer-link-label-${index}`} className="sr-only">
                Label
              </Label>
              <Input
                id={`footer-link-label-${index}`}
                placeholder="Label"
                disabled={readOnly}
                value={link.label}
                onChange={(event) => updateLink(index, { label: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`footer-link-url-${index}`} className="sr-only">
                URL
              </Label>
              <Input
                id={`footer-link-url-${index}`}
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
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
