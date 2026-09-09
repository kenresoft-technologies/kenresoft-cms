import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import type { NavigationItem, NavigationSettingsData } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection, SettingsSaveBar } from './shared';

const EMPTY: NavigationSettingsData = { items: [] };

function withNormalizedOrder(items: NavigationItem[]): NavigationItem[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

interface SectionProps {
  readOnly: boolean;
}

// Structured Settings' `navigation` module — intentionally simple: one flat, orderable list,
// no nested menus, no localization, no per-item permissions (docs/ARCHITECTURE.md §6).
export function NavigationSection({ readOnly }: SectionProps) {
  const { data: row, isPending } = useStructuredSettings('navigation');
  const updateNavigation = useUpdateStructuredSettings('navigation');

  const saved = (row?.data as NavigationSettingsData | undefined) ?? EMPTY;
  const [draft, setDraft] = useState<NavigationSettingsData>(saved);
  const [loadedFromRow, setLoadedFromRow] = useState(row?.id);
  const [error, setError] = useState<string | null>(null);

  if (row?.id !== loadedFromRow && !isPending) {
    setLoadedFromRow(row?.id);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function updateItem(index: number, patch: Partial<NavigationItem>) {
    setDraft({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }

  function removeItem(index: number) {
    setDraft({ items: withNormalizedOrder(draft.items.filter((_, i) => i !== index)) });
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.items.length) return;
    const items = [...draft.items];
    [items[index], items[target]] = [items[target]!, items[index]!];
    setDraft({ items: withNormalizedOrder(items) });
  }

  function addItem() {
    setDraft({
      items: [
        ...draft.items,
        { label: '', url: '', visible: true, order: draft.items.length, external: false, newTab: false },
      ],
    });
  }

  async function handleSave() {
    setError(null);
    try {
      await updateNavigation.mutateAsync(draft);
      toast.success('Navigation settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save navigation settings';
      setError(message);
      toast.error(message);
    }
  }

  if (isPending) {
    return (
      <SettingsSection title="Navigation" description="Primary site navigation.">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Navigation"
      description="Primary site navigation — exposed at GET /api/v1/public/settings/navigation as { items: [...] }."
      footer={
        <SettingsSaveBar
          dirty={dirty}
          pending={updateNavigation.isPending}
          readOnly={readOnly}
          onSave={() => void handleSave()}
          onDiscard={() => setDraft(saved)}
        />
      }
    >
      {draft.items.length === 0 ? <p className="text-sm text-muted-foreground">No navigation items yet.</p> : null}

      {draft.items.map((item, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`nav-label-${index}`}>Label</Label>
              <Input
                id={`nav-label-${index}`}
                disabled={readOnly}
                value={item.label}
                onChange={(event) => updateItem(index, { label: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`nav-url-${index}`}>URL</Label>
              <Input
                id={`nav-url-${index}`}
                placeholder="/about or https://..."
                disabled={readOnly}
                value={item.url}
                onChange={(event) => updateItem(index, { url: event.target.value })}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move up"
                disabled={readOnly || index === 0}
                onClick={() => moveItem(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move down"
                disabled={readOnly || index === draft.items.length - 1}
                onClick={() => moveItem(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove item"
                disabled={readOnly}
                onClick={() => removeItem(index)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`nav-visible-${index}`}
                checked={item.visible}
                disabled={readOnly}
                onCheckedChange={(checked) => updateItem(index, { visible: checked === true })}
              />
              <Label htmlFor={`nav-visible-${index}`}>Visible</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`nav-external-${index}`}
                checked={item.external}
                disabled={readOnly}
                onCheckedChange={(checked) => updateItem(index, { external: checked === true })}
              />
              <Label htmlFor={`nav-external-${index}`}>External</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`nav-newtab-${index}`}
                checked={item.newTab}
                disabled={readOnly}
                onCheckedChange={(checked) => updateItem(index, { newTab: checked === true })}
              />
              <Label htmlFor={`nav-newtab-${index}`}>Open in new tab</Label>
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" disabled={readOnly} onClick={addItem} className="self-start">
        Add item
      </Button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
