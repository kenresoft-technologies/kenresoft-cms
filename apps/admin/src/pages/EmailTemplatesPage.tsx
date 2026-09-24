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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

// ---------------------------------------------------------------------------------------------
// Design — the reusable, deployment-wide visual system every system email renders through.
// Deliberately separate from System Email Settings below: the design a card renders ("how does
// an email look") never depends on, or duplicates, which system email type it's a preview of
// ("what is this email"). Choosing "Modern Minimal" here means every current and future system
// email uses it — never three copies of the same design, one per email type.
// ---------------------------------------------------------------------------------------------

// Fetches every design's own rendering of the currently-selected email type's real content, in
// parallel — one real preview call per design, never a static swatch. A card's thumbnail and the
// large "Selected design" preview below both read from this same result set, so what a card
// shows in miniature is pixel-identical to what the big preview shows at full size, just scaled.
function useDesignPreviews(designs: EmailDesign[], previewKey: string, subject: string, content: EmailTemplateContent) {
  return useQueries({
    queries: designs.map((design) => ({
      queryKey: ['email-templates', 'design-preview', design.id, previewKey, subject, content] as const,
      queryFn: () =>
        apiClient.post<{ subject: string; html: string; text: string }>(`/api/v1/admin/email-templates/${previewKey}/preview`, {
          mode: 'standard',
          subject,
          content,
          designId: design.id,
        }),
      staleTime: 60_000,
    })),
  });
}

function ScaledEmailPreview({ html, scale, minHeight }: { html: string | undefined; scale: number; minHeight: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-white" style={{ height: minHeight }}>
      {html ? (
        <iframe
          title="Email preview"
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

function DesignCard({
  design,
  html,
  active,
  browsing,
  onBrowse,
}: {
  design: EmailDesign;
  html: string | undefined;
  active: boolean;
  browsing: boolean;
  onBrowse: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onBrowse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onBrowse();
      }}
      className={`cursor-pointer transition-colors ${browsing ? 'border-primary' : 'hover:border-primary/50'}`}
    >
      <CardContent className="flex flex-col gap-3 py-4">
        <ScaledEmailPreview html={html} scale={0.32} minHeight={150} />
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{design.name}</p>
            {active ? <Badge className="font-normal">Active</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{design.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Outer data-loading gate — the inner EmailDesignFields is keyed by the loaded row's own
// identity (or the fixed sentinel 'none' before anything has ever been saved), so it remounts
// and its useState calls re-initialize from fresh data on load, rather than an effect calling
// setState after the fact (the same split EntryEditorPage's own EntryForm already established,
// for the same React Compiler purity reason).
function EmailDesignSection({ templates }: { templates: EmailTemplate[] }) {
  const { data: designs } = useEmailDesigns();
  const { data: brandingRow } = useStructuredSettings('emailBranding');
  return (
    <EmailDesignFields
      key={brandingRow?.updatedAt ?? 'none'}
      designs={designs ?? []}
      brandingRow={brandingRow ?? null}
      templates={templates}
    />
  );
}

function EmailDesignFields({
  designs,
  brandingRow,
  templates,
}: {
  designs: EmailDesign[];
  brandingRow: { data: unknown; updatedAt: string } | null;
  templates: EmailTemplate[];
}) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const updateBranding = useUpdateStructuredSettings('emailBranding');

  const [footerText, setFooterText] = useState(branding.footerText ?? '');
  const [brandColor, setBrandColor] = useState(branding.brandColor ?? '#6366f1');

  const activeDesignId = branding.designId ?? 'modern-minimal';
  const developerModeEnabled = branding.developerModeEnabled ?? false;

  // Which design the gallery/big preview are currently showing — defaults to whatever's active,
  // but clicking a different card "browses" it without changing anything until "Use this
  // design" is clicked. Which email TYPE the preview renders as is a fully independent choice
  // (previewKey below) — switching one never resets the other.
  const [browsingDesignId, setBrowsingDesignId] = useState(activeDesignId);
  const [previewKey, setPreviewKey] = useState<string>(templates[0]?.key ?? 'email_verification');

  const previewTemplate = templates.find((t) => t.key === previewKey) ?? templates[0] ?? null;
  const previewContent = previewTemplate?.content ?? emptyContent();
  const previewSubject = previewTemplate?.subject ?? '';

  const previewResults = useDesignPreviews(designs, previewKey, previewSubject, previewContent);
  const htmlByDesignId = Object.fromEntries(designs.map((design, index) => [design.id, previewResults[index]?.data?.html]));

  const browsingDesign = designs.find((d) => d.id === browsingDesignId);

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
      {
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save'),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Design</CardTitle>
          <CardDescription>
            The reusable visual system every system email renders through — chosen once, used by email verification, staff
            verification, password reset, and any future system email alike.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((design) => (
              <DesignCard
                key={design.id}
                design={design}
                html={htmlByDesignId[design.id]}
                active={design.id === activeDesignId}
                browsing={design.id === browsingDesignId}
                onBrowse={() => setBrowsingDesignId(design.id)}
              />
            ))}
          </div>

          <div className="border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{browsingDesign?.name ?? 'Selected design'}</p>
                <p className="text-sm text-muted-foreground">
                  {browsingDesignId === activeDesignId ? 'Currently active.' : 'Not yet in use — click "Use this design" below to switch.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="preview-as-select" className="text-xs font-normal text-muted-foreground">
                  Preview email as
                </Label>
                <Select value={previewKey} onValueChange={setPreviewKey}>
                  <SelectTrigger id="preview-as-select" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4">
              <ScaledEmailPreview html={htmlByDesignId[browsingDesignId]} scale={1} minHeight={480} />
            </div>

            {browsingDesignId !== activeDesignId ? (
              <Button
                type="button"
                className="mt-4"
                disabled={updateBranding.isPending}
                onClick={() => save({ designId: browsingDesignId as EmailBrandingSettingsData['designId'] })}
              >
                Use this design
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Used automatically by every design above. Leave a field unset to use your site's own branding.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <MediaReferenceField
            label="Logo"
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
            <Label htmlFor="email-footer-text">Footer text</Label>
            <Input
              id="email-footer-text"
              placeholder="Sent by your site. If you weren't expecting this, ignore it."
              value={footerText}
              onChange={(event) => setFooterText(event.target.value)}
              onBlur={() => save({ footerText: footerText || null })}
            />
            <p className="text-xs text-muted-foreground">Leave blank to use the default.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="developer-mode-toggle" className="font-medium">
                Developer Customization
              </Label>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Let advanced users edit the raw HTML and template variables of an individual system email directly, instead
                of the plain fields below. Not the normal workflow — most changes belong above.
              </p>
            </div>
            <Switch
              id="developer-mode-toggle"
              checked={developerModeEnabled}
              onCheckedChange={(checked) => save({ developerModeEnabled: checked })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Per-template editor — Standard mode (plain fields, the default) and Developer mode (raw HTML,
// only reachable when Email Design's "Developer Customization" is on, or the template is
// already in Developer mode from before it was turned off).
// ---------------------------------------------------------------------------------------------

function TemplateSummaryCard({
  template,
  selected,
  onSelect,
}: {
  template: EmailTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  const updateTemplate = useUpdateEmailTemplate(template.key);

  async function handleToggleEnabled(enabled: boolean) {
    try {
      await updateTemplate.mutateAsync({ enabled });
      toast.success(enabled ? 'Template enabled' : 'Template disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update template');
    }
  }

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
      <CardContent className="flex items-start justify-between gap-4 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{template.name}</p>
            {template.isCustomized ? (
              <Badge variant="outline" className="font-normal">
                Customized
              </Badge>
            ) : (
              <Badge variant="secondary" className="font-normal">
                Default
              </Badge>
            )}
            {template.mode === 'developer' ? (
              <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 font-normal text-sky-700 dark:text-sky-400">
                Developer HTML
              </Badge>
            ) : null}
            {!template.enabled ? (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400">
                Disabled
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <Label htmlFor={`enabled-${template.key}`} className="text-xs font-normal text-muted-foreground">
            Enabled
          </Label>
          <Switch
            id={`enabled-${template.key}`}
            checked={template.enabled}
            onCheckedChange={(enabled) => void handleToggleEnabled(enabled)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StandardContentFields({ content, onChange }: { content: EmailTemplateContent; onChange: (content: EmailTemplateContent) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-heading">Heading</Label>
        <Input id="content-heading" value={content.heading} onChange={(event) => onChange({ ...content, heading: event.target.value })} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-body">Message</Label>
        <Textarea
          id="content-body"
          value={content.bodyText}
          onChange={(event) => onChange({ ...content, bodyText: event.target.value })}
          className="min-h-28"
          placeholder="What this email is telling the recipient. The greeting and button link are added automatically."
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-cta">Button label</Label>
        <Input id="content-cta" value={content.ctaLabel} onChange={(event) => onChange({ ...content, ctaLabel: event.target.value })} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-fineprint">Fine print</Label>
        <Textarea
          id="content-fineprint"
          value={content.fineprint}
          onChange={(event) => onChange({ ...content, fineprint: event.target.value })}
          className="min-h-16"
        />
      </div>
    </div>
  );
}

function TemplateEditor({ template, developerModeAllowed }: { template: EmailTemplate; developerModeAllowed: boolean }) {
  const [mode, setMode] = useState<EmailTemplateMode>(template.mode);
  const [subject, setSubject] = useState(template.subject);
  const [content, setContent] = useState<EmailTemplateContent>(template.content ?? emptyContent());
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [plainText, setPlainText] = useState(template.plainText ?? '');
  const [usePlainTextOverride, setUsePlainTextOverride] = useState(template.plainText !== null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const updateTemplate = useUpdateEmailTemplate(template.key);
  const restoreDefault = useRestoreEmailTemplateDefault(template.key);
  const previewTemplate = usePreviewEmailTemplate(template.key);
  const sendTest = useSendTestEmailTemplate(template.key);

  // No effect needed to re-sync local state when a different (or freshly saved/restored)
  // template loads — the parent remounts this component via `key={template.key}-
  // ${template.updatedAt}`, so each of the useState calls above already re-initializes from
  // the new `template` prop on mount, the same pattern EntryEditorPage's own EntryForm uses.
  useEffect(() => {
    const handle = setTimeout(() => {
      const plainTextValue = usePlainTextOverride ? plainText : null;
      const input =
        mode === 'standard'
          ? ({ mode: 'standard', subject, content, plainText: plainTextValue } as const)
          : ({ mode: 'developer', subject, bodyHtml, plainText: plainTextValue } as const);
      previewTemplate.mutate(input, { onSuccess: setPreview });
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewTemplate is a fresh mutation object every render; including it would re-trigger the debounce on every keystroke's own render, not just on content changes.
  }, [mode, subject, content, bodyHtml, plainText, usePlainTextOverride]);

  const isDirty =
    mode !== template.mode ||
    subject !== template.subject ||
    JSON.stringify(content) !== JSON.stringify(template.content) ||
    (mode === 'developer' && bodyHtml !== template.bodyHtml) ||
    (usePlainTextOverride ? plainText : null) !== template.plainText;

  async function handleSave() {
    try {
      await updateTemplate.mutateAsync(
        mode === 'standard'
          ? { mode, subject, content, plainText: usePlainTextOverride ? plainText : null }
          : { mode, subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null },
      );
      toast.success('Template saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save template');
    }
  }

  async function handleRestore() {
    try {
      await restoreDefault.mutateAsync();
      toast.success('Restored to the default template');
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

  const canShowModeToggle = developerModeAllowed || template.mode === 'developer';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Edit — {template.name}</CardTitle>
          {canShowModeToggle ? (
            <div className="flex items-center gap-2 pt-2">
              <Label htmlFor="template-mode-toggle" className="text-xs font-normal text-muted-foreground">
                Developer mode (raw HTML)
              </Label>
              <Switch
                id="template-mode-toggle"
                checked={mode === 'developer'}
                onCheckedChange={(checked) => setMode(checked ? 'developer' : 'standard')}
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-subject">Subject</Label>
            <Input id="template-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>

          {mode === 'standard' ? (
            <StandardContentFields content={content} onChange={setContent} />
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
              <Switch
                id="use-plaintext-override"
                checked={usePlainTextOverride}
                onCheckedChange={setUsePlainTextOverride}
              />
            </div>
            {usePlainTextOverride ? (
              <Textarea
                id="template-plaintext"
                value={plainText}
                onChange={(event) => setPlainText(event.target.value)}
                className="min-h-24"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Derived automatically on every send. Turn this on to write your own.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => void handleSave()} disabled={!isDirty || updateTemplate.isPending}>
              {updateTemplate.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!template.isCustomized}
              onClick={() => setConfirmRestore(true)}
            >
              Restore default
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="test-email-to" className="font-normal text-muted-foreground">
                Send test email
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {preview ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Subject: </span>
              {preview.subject}
            </p>
          ) : null}
          <iframe
            title={`${template.name} preview`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={buildPreviewDocument(preview?.html ?? '')}
            className="h-[480px] w-full rounded-md border bg-white"
          />
          <p className="text-xs text-muted-foreground">
            Rendered against sample data — real sends substitute the actual recipient, link and site branding.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the default "{template.name}" template?</AlertDialogTitle>
            <AlertDialogDescription>
              Switches this email back to Standard mode with the shipped design and copy, discarding any custom HTML.
              This can't be undone. The enabled/disabled state is left as-is.
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

// System (transactional) email templates — verification, password reset. Deliberately separated
// into two concerns a non-technical admin should never have to conflate: Design ("how do our
// system emails look" — one reusable choice, above) and System Email Settings ("what does this
// particular email say" — per email type, below). "Developer Customization" (the Design
// section's own Advanced card) is the opt-in escape hatch for raw HTML per template. This is
// deliberately not the general-purpose content/email-template feature — see
// docs/ARCHITECTURE.md §6.2 for that boundary.
export function EmailTemplatesPage() {
  const { data: templates, isPending, error } = useEmailTemplates();
  const { data: brandingRow } = useStructuredSettings('emailBranding');
  const developerModeAllowed = ((brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined)?.developerModeEnabled) ?? false;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = templates?.find((t) => t.key === selectedKey) ?? templates?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Email Templates' }]} />
      <PageHeader
        title="Email Templates"
        description="Create professional system emails for your CMS without editing HTML."
      />

      {templates ? <EmailDesignSection templates={templates} /> : null}

      <div>
        <h2 className="text-lg font-semibold">System Email Settings</h2>
        <p className="text-sm text-muted-foreground">
          What each system email says. The design above controls how it looks; this is what it says.
        </p>
      </div>

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {templates?.map((template) => (
            <TemplateSummaryCard
              key={template.key}
              template={template}
              selected={selected?.key === template.key}
              onSelect={() => setSelectedKey(template.key)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <TemplateEditor key={`${selected.key}-${selected.updatedAt}`} template={selected} developerModeAllowed={developerModeAllowed} />
      ) : null}
    </div>
  );
}
