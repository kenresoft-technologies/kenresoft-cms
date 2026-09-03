import type { ReactNode } from 'react';

import type { SettingsInput } from '@/lib/queries/settings';
import type { Settings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// Every section PUTs the whole Settings row (it's a singleton, upserted wholesale — see
// packages/database/schema/settings.ts) even though each section only edits a couple of its
// fields. This seeds the fields a section doesn't own from the last-fetched row so saving one
// section never clobbers another's already-saved values.
//
// `name` falls back to a placeholder rather than '' when there's no row yet — upsertSettingsSchema
// requires a non-empty name, and GeneralSection is the only section that guards for that
// client-side. Without this fallback, saving any other section first (e.g. this Developer Mode
// toggle, or CORS origin) on a brand-new deployment 400s with an opaque "Validation failed"
// before General has ever been touched. The placeholder is a normal, renameable value — visiting
// General afterward corrects it same as always.
export function toSettingsInput(settings: Settings | null): SettingsInput {
  return {
    name: settings?.name ?? 'My deployment',
    contactEmail: settings?.contactEmail ?? null,
    socialLinks: settings?.socialLinks ?? null,
    corsOrigin: settings?.corsOrigin ?? null,
    featureFlags: settings?.featureFlags ?? null,
    previewUrl: settings?.previewUrl ?? null,
  };
}

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function SettingsSection({ title, description, children, footer }: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-2">{children}</CardContent>
      {footer}
    </Card>
  );
}

interface SettingsSaveBarProps {
  dirty: boolean;
  pending: boolean;
  readOnly: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function SettingsSaveBar({ dirty, pending, readOnly, onSave, onDiscard }: SettingsSaveBarProps) {
  if (readOnly) return null;

  return (
    <CardFooter className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">
        {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
      </span>
      <div className="flex items-center gap-2">
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={pending}>
            Discard
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={!dirty || pending} onClick={onSave}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </CardFooter>
  );
}
