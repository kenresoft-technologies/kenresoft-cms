import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { useStructuredSettings, useUpdateStructuredSettings } from '@/lib/queries/structured-settings';
import {
  useEmailDesigns,
  useEmailTemplates,
  usePreviewEmailTemplate,
  useRestoreEmailTemplateDefault,
  useSendTestEmailTemplate,
  useUpdateEmailTemplate,
} from '@/lib/queries/email-templates';
import type { EmailBrandingSettingsData, EmailDesign, EmailTemplate, EmailTemplateContent, EmailTemplateMode } from '@/lib/types';
import { MediaReferenceField } from '@/pages/settings/shared';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

function buildPreviewDocument(html: string) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http:; style-src \'unsafe-inline\'">' +
    '</head><body>' +
    html +
    '</body></html>'
  );
}

function emptyContent(): EmailTemplateContent {
  return { heading: '', bodyText: '', ctaLabel: '', fineprint: '' };
}

function ScaledEmailPreview({
  html,
  scale,
  minHeight,
  title,
}: {
  html: string | undefined;
  scale: number;
  minHeight: number;
  title: string;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-white" style={{ height: minHeight }}>
      {html ? (
        <iframe
          title={title}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={buildPreviewDocument(html)}
          style={{
            width: `${100 / scale}%`,
            height: `${100 / scale}%`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 0,
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading preview…</div>
      )}
    </div>
  );
}

// Fetches every design's own rendering of the CURRENT (possibly unsaved) subject/content, in
// parallel — real previews, never static swatches. Feeds both the design gallery's own
// thumbnails and the one primary Live Preview below (same result set, so a thumbnail and the
// full-size preview are pixel-identical, just scaled), which is what makes "click a design,
// the one preview updates" true rather than two separate rendering paths that could drift.
// Skipped entirely (`enabled: false` per query) once the email has custom HTML — no design
// applies to it, so there is nothing to render five times over.
function useDesignPreviews(designs: EmailDesign[], key: string, subject: string, content: EmailTemplateContent, enabled: boolean) {
  return useQueries({
    queries: designs.map((design) => ({
      queryKey: ['email-templates', 'design-preview', design.id, key, subject, content] as const,
      queryFn: () =>
        apiClient.post<{ subject: string; html: string; text: string }>(`/api/v1/admin/email-templates/${key}/preview`, {
          mode: 'standard',
          subject,
          content,
          designId: design.id,
        }),
      enabled,
      staleTime: 10_000,
    })),
  });
}

function DesignCard({
  design,
  html,
  active,
  selected,
  onSelect,
}: {
  design: EmailDesign;
  html: string | undefined;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      className={`cursor-pointer transition-colors ${selected ? 'border-primary' : 'hover:border-primary/50'}`}
    >
      <CardContent className="flex flex-col gap-3 py-4">
        <ScaledEmailPreview html={html} scale={0.32} minHeight={150} title={`${design.name} thumbnail`} />
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{design.name}</p>
            {active ? <Badge className="font-normal">In use</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{design.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// A small, secondary strip of email-specific fields — enabled toggle and, only once "Developer
// options" (bottom of page) has been turned on for the deployment or this specific email already
// has custom HTML, the switch into/out of custom HTML for this one email. Deliberately not a
// prominent control: most administrators should never need it.
function DeveloperModeRow({
  visible,
  usingCustomHtml,
  onToggle,
}: {
  visible: boolean;
  usingCustomHtml: boolean;
  onToggle: (usingCustomHtml: boolean) => void;
}) {
  if (!visible) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
      <Switch id="template-mode-toggle" checked={usingCustomHtml} onCheckedChange={onToggle} />
      <Label htmlFor="template-mode-toggle" className="text-xs font-normal text-muted-foreground">
        Use custom HTML for this email instead of the fields below
      </Label>
    </div>
  );
}

// The one editor for a single system email — Design, Content, and one primary Live Preview, all
// driven by the same in-progress edit so every one of them always agrees with the others: change
// the design, the preview updates; change the content, the preview updates; nothing here is a
// second, competing preview of anything. Remounted (via the parent's `key`) whenever a different
// email is selected or this one is saved/restored, so every useState below simply initializes
// fresh from the current `template`/`designs`/`brandingRow` props — no effect needed to keep
// local state in sync with a prop that changed out from under it.
function EmailEditor({
  template,
  designs,
  brandingRow,
  developerOptionsOn,
}: {
  template: EmailTemplate;
  designs: EmailDesign[];
  brandingRow: { data: unknown } | null;
  developerOptionsOn: boolean;
}) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const activeDesignId = branding.designId ?? 'modern-minimal';

  const [mode, setMode] = useState<EmailTemplateMode>(template.mode);
  const [subject, setSubject] = useState(template.subject);
  const [content, setContent] = useState<EmailTemplateContent>(template.content ?? emptyContent());
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [plainText, setPlainText] = useState(template.plainText ?? '');
  const [usePlainTextOverride, setUsePlainTextOverride] = useState(template.plainText !== null);
  const [selectedDesignId, setSelectedDesignId] = useState(activeDesignId);
  const [enabled, setEnabled] = useState(template.enabled);
  const [developerPreview, setDeveloperPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const updateTemplate = useUpdateEmailTemplate(template.key);
  const updateBranding = useUpdateStructuredSettings('emailBranding');
  const restoreDefault = useRestoreEmailTemplateDefault(template.key);
  const developerPreviewMutation = usePreviewEmailTemplate(template.key);
  const sendTest = useSendTestEmailTemplate(template.key);

  const designPreviews = useDesignPreviews(designs, template.key, subject, content, mode === 'standard');
  const htmlByDesignId = Object.fromEntries(designs.map((design, index) => [design.id, designPreviews[index]?.data?.html]));

  // Debounced developer-mode preview only — the standard-mode preview above is already live via
  // useQueries (each keystroke changes the query key, react-query handles the rest), so this
  // effect only needs to exist for the one case a plain query key can't drive automatically.
  useEffect(() => {
    if (mode !== 'developer') return;
    const handle = setTimeout(() => {
      developerPreviewMutation.mutate(
        { mode: 'developer', subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null },
        { onSuccess: setDeveloperPreview },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- developerPreviewMutation is a fresh mutation object every render; including it would re-trigger the debounce on every keystroke's own render, not just on content changes.
  }, [mode, subject, bodyHtml, plainText, usePlainTextOverride]);

  const mainPreviewHtml = mode === 'standard' ? htmlByDesignId[selectedDesignId] : developerPreview?.html;

  const isContentDirty =
    mode !== template.mode ||
    subject !== template.subject ||
    JSON.stringify(content) !== JSON.stringify(template.content) ||
    (mode === 'developer' && bodyHtml !== template.bodyHtml) ||
    (usePlainTextOverride ? plainText : null) !== template.plainText;
  const isDesignDirty = mode === 'standard' && selectedDesignId !== activeDesignId;

  async function handleSaveContent() {
    try {
      await updateTemplate.mutateAsync(
        mode === 'standard'
          ? { mode, subject, content, plainText: usePlainTextOverride ? plainText : null }
          : { mode, subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null },
      );
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    }
  }

  async function handleSaveEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    try {
      await updateTemplate.mutateAsync({ enabled: nextEnabled });
      toast.success(nextEnabled ? 'Enabled' : 'Disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update');
      setEnabled(!nextEnabled);
    }
  }

  function handleUseDesign() {
    updateBranding.mutate(
      {
        brandColor: branding.brandColor ?? null,
        pageBackground: branding.pageBackground ?? null,
        contentBackground: branding.contentBackground ?? null,
        textColor: branding.textColor ?? null,
        mutedTextColor: branding.mutedTextColor ?? null,
        buttonTextColor: branding.buttonTextColor ?? null,
        logoMediaId: branding.logoMediaId ?? null,
        footerText: branding.footerText ?? null,
        designId: selectedDesignId as EmailBrandingSettingsData['designId'],
        developerModeEnabled: branding.developerModeEnabled ?? null,
      },
      {
        onSuccess: () => toast.success('Design applied to every system email'),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to apply design'),
      },
    );
  }

  async function handleRestore() {
    try {
      await restoreDefault.mutateAsync();
      toast.success('Restored to the default');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to restore default');
    } finally {
      setConfirmRestore(false);
    }
  }

  async function handleSendTest() {
    if (!testTo) return;
    try {
      await sendTest.mutateAsync(testTo);
      toast.success(`Test email sent to ${testTo}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send test email');
    }
  }

  const showDeveloperRow = developerOptionsOn || template.mode === 'developer';

  return (
    <div className="flex flex-col gap-6">
      {mode === 'standard' ? (
        <Card>
          <CardHeader>
            <CardTitle>Design</CardTitle>
            <CardDescription>How this email looks. This design applies to all system emails, not just this one.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {designs.map((design) => (
                <DesignCard
                  key={design.id}
                  design={design}
                  html={htmlByDesignId[design.id]}
                  active={design.id === activeDesignId}
                  selected={design.id === selectedDesignId}
                  onSelect={() => setSelectedDesignId(design.id)}
                />
              ))}
            </div>
            {isDesignDirty ? (
              <Button type="button" className="self-start" disabled={updateBranding.isPending} onClick={handleUseDesign}>
                Use this design
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Design</CardTitle>
            <CardDescription>
              This email uses custom HTML, so it doesn't use one of the built-in designs. Turn off "Use custom HTML" below to
              go back to choosing a design.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Content</CardTitle>
              <CardDescription>What this email says.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="template-enabled" className="text-xs font-normal text-muted-foreground">
                Enabled
              </Label>
              <Switch id="template-enabled" checked={enabled} onCheckedChange={(next) => void handleSaveEnabled(next)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-subject">Subject</Label>
            <Input id="template-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>

          {mode === 'standard' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="content-heading">Heading</Label>
                <Input
                  id="content-heading"
                  value={content.heading}
                  onChange={(event) => setContent({ ...content, heading: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="content-body">Message</Label>
                <Textarea
                  id="content-body"
                  value={content.bodyText}
                  onChange={(event) => setContent({ ...content, bodyText: event.target.value })}
                  className="min-h-28"
                  placeholder="What this email is telling the recipient. The greeting and button link are added automatically."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="content-cta">Button label</Label>
                <Input
                  id="content-cta"
                  value={content.ctaLabel}
                  onChange={(event) => setContent({ ...content, ctaLabel: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="content-fineprint">Fine print</Label>
                <Textarea
                  id="content-fineprint"
                  value={content.fineprint}
                  onChange={(event) => setContent({ ...content, fineprint: event.target.value })}
                  className="min-h-16"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="template-body">Body HTML</Label>
              <Textarea
                id="template-body"
                value={bodyHtml}
                onChange={(event) => setBodyHtml(event.target.value)}
                className="min-h-64 font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Custom HTML requires knowledge of HTML and email template variables. Incorrect changes may affect how emails
                are displayed.
              </p>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Available variables</p>
                <div className="flex flex-wrap gap-1.5">
                  {template.availableVariables.map((variable) => (
                    <code key={variable} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {`{{${variable}}}`}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="template-plaintext" className="font-normal">
                Custom plain-text version
              </Label>
              <Switch id="use-plaintext-override" checked={usePlainTextOverride} onCheckedChange={setUsePlainTextOverride} />
            </div>
            {usePlainTextOverride ? (
              <Textarea
                id="template-plaintext"
                value={plainText}
                onChange={(event) => setPlainText(event.target.value)}
                className="min-h-24"
              />
            ) : (
              <p className="text-xs text-muted-foreground">Derived automatically on every send. Turn this on to write your own.</p>
            )}
          </div>

          <DeveloperModeRow
            visible={showDeveloperRow}
            usingCustomHtml={mode === 'developer'}
            onToggle={(usingCustomHtml) => setMode(usingCustomHtml ? 'developer' : 'standard')}
          />

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => void handleSaveContent()} disabled={!isContentDirty || updateTemplate.isPending}>
              {updateTemplate.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" disabled={!template.isCustomized} onClick={() => setConfirmRestore(true)}>
              Restore default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Preview</CardTitle>
          <CardDescription>Exactly how this email will look to recipients, with sample data.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ScaledEmailPreview html={mainPreviewHtml} scale={1} minHeight={520} title="Email preview" />
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="test-email-to" className="font-normal text-muted-foreground">
                Send a test email
              </Label>
              <Input
                id="test-email-to"
                type="email"
                placeholder="you@example.com"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" disabled={!testTo || sendTest.isPending} onClick={() => void handleSendTest()}>
              {sendTest.isPending ? 'Sending…' : 'Send test'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the default "{template.name}" email?</AlertDialogTitle>
            <AlertDialogDescription>
              Replaces the subject and content with what ships with the CMS and switches this email back to the built-in
              design, discarding any custom HTML. This can't be undone. Enabled/disabled is left as-is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRestore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmailTypeTabs({
  templates,
  selectedKey,
  onSelect,
}: {
  templates: EmailTemplate[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {templates.map((template) => (
        <button
          key={template.key}
          type="button"
          onClick={() => onSelect(template.key)}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            template.key === selectedKey ? 'border-primary bg-primary/5 font-medium' : 'hover:border-primary/50'
          }`}
        >
          {template.name}
          {!template.enabled ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400">
              Disabled
            </Badge>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// System (transactional) emails — email verification, staff verification, password reset. One
// primary Live Preview drives the whole page: choosing an email, choosing a design, and editing
// content all update that same preview, rather than being separate rendering experiences an
// administrator has to reconcile in their head. Standard mode's plain fields (heading/message/
// button label/fine print) are the only thing an ordinary admin ever sees; raw HTML stays behind
// an explicit, secondary "Developer options" affordance. Deliberately not the general-purpose
// content/email-template feature — see docs/ARCHITECTURE.md §6.2 for that boundary.
export function EmailTemplatesPage() {
  const { data: templates, isPending, error } = useEmailTemplates();
  const { data: designs } = useEmailDesigns();
  const { data: brandingRow } = useStructuredSettings('emailBranding');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = templates?.find((t) => t.key === selectedKey) ?? templates?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Email Templates' }]} />
      <PageHeader title="Email Templates" description="Configure the emails the CMS sends automatically." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending || !templates ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Choose an email</h2>
            <div className="mt-2">
              <EmailTypeTabs templates={templates} selectedKey={selected?.key ?? templates[0]!.key} onSelect={setSelectedKey} />
            </div>
          </div>

          {selected ? (
            <EmailEditor
              key={`${selected.key}-${selected.updatedAt}`}
              template={selected}
              designs={designs ?? []}
              brandingRow={brandingRow ?? null}
              developerOptionsOn={((brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined)?.developerModeEnabled) ?? false}
            />
          ) : null}
        </>
      )}

      <BrandingSection brandingRow={brandingRow ?? null} />
      <DeveloperOptionsSection brandingRow={brandingRow ?? null} />
    </div>
  );
}

function BrandingSection({ brandingRow }: { brandingRow: { data: unknown; updatedAt?: string } | null }) {
  return <BrandingFields key={brandingRow?.updatedAt ?? 'none'} brandingRow={brandingRow} />;
}

function BrandingFields({ brandingRow }: { brandingRow: { data: unknown } | null }) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const updateBranding = useUpdateStructuredSettings('emailBranding');

  const [footerText, setFooterText] = useState(branding.footerText ?? '');
  const [brandColor, setBrandColor] = useState(branding.brandColor ?? '#6366f1');

  function save(patch: Partial<EmailBrandingSettingsData>) {
    updateBranding.mutate(
      {
        brandColor: branding.brandColor ?? null,
        pageBackground: branding.pageBackground ?? null,
        contentBackground: branding.contentBackground ?? null,
        textColor: branding.textColor ?? null,
        mutedTextColor: branding.mutedTextColor ?? null,
        buttonTextColor: branding.buttonTextColor ?? null,
        logoMediaId: branding.logoMediaId ?? null,
        footerText: branding.footerText ?? null,
        designId: branding.designId ?? null,
        developerModeEnabled: branding.developerModeEnabled ?? null,
        ...patch,
      },
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save') },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Uses your site's branding automatically. Override the logo, color or footer here only for system emails
          specifically.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <MediaReferenceField
          label="Logo override"
          mediaId={branding.logoMediaId ?? null}
          readOnly={false}
          onChange={(mediaId) => save({ logoMediaId: mediaId })}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email-brand-color">Primary &amp; button color</Label>
          <div className="flex items-center gap-2">
            <Input
              id="email-brand-color"
              type="color"
              value={brandColor}
              onChange={(event) => setBrandColor(event.target.value)}
              className="h-9 w-14 p-1"
            />
            <Input
              value={brandColor}
              onChange={(event) => setBrandColor(event.target.value)}
              onBlur={() => save({ brandColor })}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="email-footer-text">Footer text override</Label>
          <Input
            id="email-footer-text"
            placeholder="Sent by your site. If you weren't expecting this, ignore it."
            value={footerText}
            onChange={(event) => setFooterText(event.target.value)}
            onBlur={() => save({ footerText: footerText || null })}
          />
          <p className="text-xs text-muted-foreground">Leave blank to use your site's own footer text.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Kept minimal and out of the way on purpose — a single deployment-wide switch, not a card full
// of controls, since most administrators never need to open this at all.
function DeveloperOptionsSection({ brandingRow }: { brandingRow: { data: unknown } | null }) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const updateBranding = useUpdateStructuredSettings('emailBranding');
  const developerModeEnabled = branding.developerModeEnabled ?? false;

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-dashed px-4 py-3">
      <div>
        <Label htmlFor="developer-mode-toggle" className="font-medium">
          Developer options
        </Label>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Use custom HTML when you need full control over an email's markup, instead of the plain fields above. Most
          administrators never need this.
        </p>
      </div>
      <Switch
        id="developer-mode-toggle"
        checked={developerModeEnabled}
        onCheckedChange={(checked) =>
          updateBranding.mutate(
            {
              brandColor: branding.brandColor ?? null,
              pageBackground: branding.pageBackground ?? null,
              contentBackground: branding.contentBackground ?? null,
              textColor: branding.textColor ?? null,
              mutedTextColor: branding.mutedTextColor ?? null,
              buttonTextColor: branding.buttonTextColor ?? null,
              logoMediaId: branding.logoMediaId ?? null,
              footerText: branding.footerText ?? null,
              designId: branding.designId ?? null,
              developerModeEnabled: checked,
            },
            { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save') },
          )
        }
      />
    </div>
  );
}
