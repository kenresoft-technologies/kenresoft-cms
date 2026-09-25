import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
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
import type {
  EmailBrandingSettingsData,
  EmailDesign,
  EmailTemplate,
  EmailTemplateContent,
  EmailTemplateMode,
  GeneralSettingsData,
} from '@/lib/types';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_DESIGN_ID = 'modern-minimal';

// Fixed sample content, deliberately unrelated to any real system email's own subject/content —
// the design gallery is choosing a visual STYLE, not previewing a specific email, so its
// thumbnails render the same sample copy regardless of which email an administrator opened the
// gallery from (or if they opened it straight from the management page, with no email selected
// at all).
const DESIGN_GALLERY_SAMPLE_CONTENT: EmailTemplateContent = {
  heading: 'Verify your email address',
  bodyText: "You're almost there. Verify your email address to finish setting up your account.",
  ctaLabel: 'Verify email',
  fineprint: 'This link expires in 24 hours.',
};
const DESIGN_GALLERY_SAMPLE_SUBJECT = 'Verify your email address';

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

function findDesign(designs: EmailDesign[], id: string): EmailDesign | undefined {
  return designs.find((design) => design.id === id);
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

function brandingPatch(branding: Partial<EmailBrandingSettingsData>, patch: Partial<EmailBrandingSettingsData>) {
  return {
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
  };
}

// Real server-rendered thumbnails (never icons/swatches), fetched once when the gallery opens
// against fixed sample content — not the currently-edited email's own content, since this
// gallery is a global, standalone design choice, not a second preview of any one email. Cached
// indefinitely for the session: the same five renderings never need to be re-fetched just
// because an administrator closes and reopens the dialog.
function useDesignGalleryThumbnails(designs: EmailDesign[], previewKey: string | undefined, enabled: boolean) {
  return useQueries({
    queries: designs.map((design) => ({
      queryKey: ['email-templates', 'design-gallery-thumbnail', design.id] as const,
      queryFn: () =>
        apiClient.post<{ subject: string; html: string; text: string }>(`/api/v1/admin/email-templates/${previewKey}/preview`, {
          mode: 'standard',
          subject: DESIGN_GALLERY_SAMPLE_SUBJECT,
          content: DESIGN_GALLERY_SAMPLE_CONTENT,
          designId: design.id,
        }),
      enabled: enabled && Boolean(previewKey),
      staleTime: Infinity,
    })),
  });
}

// Standalone modal: choosing a visual design for every system email at once. Never opened from
// inside an individual email's own editor — this is the ONE place a design is picked, reached
// from the management page's "Change design" action.
function ChangeDesignDialog({
  open,
  onOpenChange,
  designs,
  activeDesignId,
  anyTemplateKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designs: EmailDesign[];
  activeDesignId: string;
  anyTemplateKey: string | undefined;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { data: brandingRow } = useStructuredSettings('emailBranding');
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const updateBranding = useUpdateStructuredSettings('emailBranding');

  const thumbnails = useDesignGalleryThumbnails(designs, anyTemplateKey, open);
  const htmlByDesignId = Object.fromEntries(designs.map((design, index) => [design.id, thumbnails[index]?.data?.html]));

  function close() {
    onOpenChange(false);
    setPendingId(null);
    setConfirming(false);
  }

  async function confirmUseDesign() {
    if (!pendingId) return;
    try {
      await updateBranding.mutateAsync(
        brandingPatch(branding, { designId: pendingId as EmailBrandingSettingsData['designId'] }),
      );
      toast.success('Design applied to every system email');
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to apply design');
    }
  }

  const pendingDesign = pendingId ? findDesign(designs, pendingId) : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="xl" className="max-h-[85vh] overflow-y-auto">
        {confirming && pendingDesign ? (
          <>
            <DialogHeader>
              <DialogTitle>Use {pendingDesign.name}?</DialogTitle>
              <DialogDescription>This design will be used by all standard system emails.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void confirmUseDesign()} disabled={updateBranding.isPending}>
                {updateBranding.isPending ? 'Applying…' : `Use ${pendingDesign.name}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Choose email design</DialogTitle>
              <DialogDescription>Select the visual style used across your system emails.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {designs.map((design) => {
                const selected = (pendingId ?? activeDesignId) === design.id;
                return (
                  <Card
                    key={design.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPendingId(design.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setPendingId(design.id);
                    }}
                    className={`cursor-pointer transition-colors ${selected ? 'border-primary' : 'hover:border-primary/50'}`}
                  >
                    <CardContent className="flex flex-col gap-3 py-4">
                      <ScaledEmailPreview html={htmlByDesignId[design.id]} scale={0.32} minHeight={150} title={`${design.name} thumbnail`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{design.name}</p>
                          {design.id === activeDesignId ? <Badge className="font-normal">In use</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{design.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!pendingId || pendingId === activeDesignId}
                onClick={() => setConfirming(true)}
              >
                Use design
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// A small, secondary strip inside an individual editor — toggles JUST this email between
// Standard content and raw custom HTML. Deliberately not a prominent control, and deliberately
// never a place to change the visual design (that's the one global "Change design" action on the
// management page).
function DeveloperModeRow({
  usingCustomHtml,
  onToggle,
}: {
  usingCustomHtml: boolean;
  onToggle: (usingCustomHtml: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
      <Switch id="template-mode-toggle" checked={usingCustomHtml} onCheckedChange={onToggle} />
      <Label htmlFor="template-mode-toggle" className="text-xs font-normal text-muted-foreground">
        Use custom HTML for this email instead of the fields below
      </Label>
    </div>
  );
}

// Bottom-of-editor card. Below the deployment-wide "Developer options" gate, this is purely
// explanatory with a single action to turn that gate on — no HTML editing happens here. Once the
// gate is on (deployment-wide, or because this specific email is already in Developer mode from
// before), it's replaced by the actual per-email switch above.
function DeveloperOptionsCard({
  gateOn,
  usingCustomHtml,
  onEnableGate,
  onToggleMode,
  enabling,
}: {
  gateOn: boolean;
  usingCustomHtml: boolean;
  onEnableGate: () => void;
  onToggleMode: (usingCustomHtml: boolean) => void;
  enabling: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Developer options</CardTitle>
      </CardHeader>
      <CardContent>
        {gateOn ? (
          <DeveloperModeRow usingCustomHtml={usingCustomHtml} onToggle={onToggleMode} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Advanced HTML customization is available for developers who need complete control over the email markup.
              Most administrators never need this.
            </p>
            <Button type="button" variant="outline" size="sm" disabled={enabling} onClick={onEnableGate}>
              {enabling ? 'Enabling…' : 'Enable developer mode'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// The editor for a single system email: content only. No design selection here — the design is
// a single, global choice made from the management page's "Change design" action; this editor
// only ever shows an informational line naming which one is currently active. There is exactly
// one live preview, driven by this email's own (possibly unsaved) content, the deployment's one
// active design, and current branding — never a second, competing rendering of anything.
function EmailEditor({
  template,
  designs,
  brandingRow,
  developerOptionsOn,
  onBack,
  onRequestChangeDesign,
}: {
  template: EmailTemplate;
  designs: EmailDesign[];
  brandingRow: { data: unknown } | null;
  developerOptionsOn: boolean;
  onBack: () => void;
  onRequestChangeDesign: () => void;
}) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const activeDesignId = branding.designId ?? DEFAULT_DESIGN_ID;
  const activeDesign = findDesign(designs, activeDesignId);

  const [mode, setMode] = useState<EmailTemplateMode>(template.mode);
  const [subject, setSubject] = useState(template.subject);
  const [content, setContent] = useState<EmailTemplateContent>(template.content ?? emptyContent());
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [plainText, setPlainText] = useState(template.plainText ?? '');
  const [usePlainTextOverride, setUsePlainTextOverride] = useState(template.plainText !== null);
  const [enabled, setEnabled] = useState(template.enabled);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const updateTemplate = useUpdateEmailTemplate(template.key);
  const updateBranding = useUpdateStructuredSettings('emailBranding');
  const restoreDefault = useRestoreEmailTemplateDefault(template.key);
  const previewMutation = usePreviewEmailTemplate(template.key);
  const sendTest = useSendTestEmailTemplate(template.key);

  // ONE authoritative preview, debounced against content changes (fires on mount too, after the
  // same 500ms settle) — never one request per design, since there is only ever one design to
  // render against here, and never one request per keystroke either.
  useEffect(() => {
    const handle = setTimeout(() => {
      previewMutation.mutate(
        mode === 'standard'
          ? { mode: 'standard', subject, content, plainText: usePlainTextOverride ? plainText : null }
          : { mode: 'developer', subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null },
        { onSuccess: setPreview },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewMutation is a fresh mutation object every render; including it would re-trigger the debounce on every keystroke's own render, not just on content changes.
  }, [mode, subject, content, bodyHtml, plainText, usePlainTextOverride]);

  const isContentDirty =
    mode !== template.mode ||
    subject !== template.subject ||
    JSON.stringify(content) !== JSON.stringify(template.content) ||
    (mode === 'developer' && bodyHtml !== template.bodyHtml) ||
    (usePlainTextOverride ? plainText : null) !== template.plainText;

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

  async function handleEnableDeveloperGate() {
    try {
      await updateBranding.mutateAsync(brandingPatch(branding, { developerModeEnabled: true }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    }
  }

  const showDeveloperGateOn = developerOptionsOn || template.mode === 'developer';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Email Templates
        </Button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{template.name}</h1>
        <p className="text-sm text-muted-foreground">{template.description}</p>
      </div>

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

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => void handleSaveContent()} disabled={!isContentDirty || updateTemplate.isPending}>
              {updateTemplate.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" variant="outline" disabled={!template.isCustomized} onClick={() => setConfirmRestore(true)}>
              Restore default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            {mode === 'standard' ? (
              <>
                Using the <span className="font-medium text-foreground">{activeDesign?.name ?? 'active'}</span> design.{' '}
                <button type="button" onClick={onRequestChangeDesign} className="text-primary hover:underline">
                  Change design
                </button>
              </>
            ) : (
              "This email uses custom HTML, so it doesn't use the system design."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ScaledEmailPreview html={preview?.html} scale={1} minHeight={520} title="Email preview" />
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
              {sendTest.isPending ? 'Sending…' : 'Send test email'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DeveloperOptionsCard
        gateOn={showDeveloperGateOn}
        usingCustomHtml={mode === 'developer'}
        onEnableGate={() => void handleEnableDeveloperGate()}
        onToggleMode={(usingCustomHtml) => setMode(usingCustomHtml ? 'developer' : 'standard')}
        enabling={updateBranding.isPending}
      />

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the default "{template.name}" email?</AlertDialogTitle>
            <AlertDialogDescription>
              Replaces the subject and content with what ships with the CMS and switches this email back to the system
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

function TransactionalEmailRow({ template, onEdit }: { template: EmailTemplate; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium">{template.name}</p>
          {!template.enabled ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400">
              Disabled
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{template.description}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Edit →
      </Button>
    </div>
  );
}

function SystemEmailDesignSection({
  activeDesign,
  onChangeDesign,
}: {
  activeDesign: EmailDesign | undefined;
  onChangeDesign: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System Email Design</CardTitle>
        <CardDescription>Choose the visual style used across your system emails.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{activeDesign?.name ?? 'Modern Minimal'}</p>
              <Badge className="font-normal">In use</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{activeDesign?.description}</p>
          </div>
          <Button type="button" variant="outline" onClick={onChangeDesign}>
            Change design
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionalEmailsSection({ templates, onEdit }: { templates: EmailTemplate[]; onEdit: (key: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactional Emails</CardTitle>
        <CardDescription>The automated emails your CMS sends. Select one to customize its content.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {templates.map((template) => (
          <TransactionalEmailRow key={template.key} template={template} onEdit={() => onEdit(template.key)} />
        ))}
      </CardContent>
    </Card>
  );
}

// Shows whether each branded element is currently inherited from the site's own branding/the
// design's own defaults, or explicitly overridden for email specifically — never a hardcoded
// fallback value presented as if it were the active setting (a fallback color previously shown
// here made an inherited/default value look like a deliberate customization).
function EmailBrandingSection({
  brandingRow,
  generalRow,
}: {
  brandingRow: { data: unknown } | null;
  generalRow: { data: unknown } | null;
}) {
  const [customizing, setCustomizing] = useState(false);
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const general = (generalRow?.data as Partial<GeneralSettingsData> | undefined) ?? {};

  const logoStatus = branding.logoMediaId
    ? 'Custom email logo'
    : general.logoMediaId
      ? 'Using site logo'
      : 'No logo set';
  const colorStatus = branding.brandColor ? `Custom color override (${branding.brandColor})` : "Using the design's own colors";
  const footerStatus = branding.footerText ? 'Custom footer text' : "Using your site's name in the default footer";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Branding</CardTitle>
        <CardDescription>Your system emails use your site's branding automatically.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Logo</dt>
            <dd className="text-sm">{logoStatus}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Colors</dt>
            <dd className="text-sm">{colorStatus}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Footer</dt>
            <dd className="text-sm">{footerStatus}</dd>
          </div>
        </dl>
        {customizing ? (
          <BrandingCustomizeFields brandingRow={brandingRow} onDone={() => setCustomizing(false)} />
        ) : (
          <Button type="button" variant="outline" className="self-start" onClick={() => setCustomizing(true)}>
            Customize email branding →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function BrandingCustomizeFields({ brandingRow, onDone }: { brandingRow: { data: unknown } | null; onDone: () => void }) {
  return <BrandingCustomizeFieldsInner key={JSON.stringify(brandingRow?.data ?? null)} brandingRow={brandingRow} onDone={onDone} />;
}

function BrandingCustomizeFieldsInner({ brandingRow, onDone }: { brandingRow: { data: unknown } | null; onDone: () => void }) {
  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const updateBranding = useUpdateStructuredSettings('emailBranding');

  const [footerText, setFooterText] = useState(branding.footerText ?? '');
  const [brandColor, setBrandColor] = useState(branding.brandColor ?? '');

  function save(patch: Partial<EmailBrandingSettingsData>) {
    updateBranding.mutate(brandingPatch(branding, patch), {
      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save'),
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-dashed p-4">
      <MediaReferenceField
        label="Logo override"
        mediaId={branding.logoMediaId ?? null}
        readOnly={false}
        onChange={(mediaId) => save({ logoMediaId: mediaId })}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email-brand-color">Primary &amp; button color override</Label>
        <div className="flex items-center gap-2">
          <Input
            id="email-brand-color"
            type="color"
            value={brandColor || '#6366f1'}
            onChange={(event) => {
              setBrandColor(event.target.value);
              save({ brandColor: event.target.value });
            }}
            className="h-9 w-14 p-1"
          />
          <Input
            value={brandColor}
            placeholder="Using the design's own colors"
            onChange={(event) => setBrandColor(event.target.value)}
            onBlur={() => save({ brandColor: brandColor || null })}
            className="font-mono text-sm"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
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
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
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
          Allow custom HTML when an email needs full control over its markup, instead of the plain fields. Most
          administrators never need this.
        </p>
      </div>
      <Switch
        id="developer-mode-toggle"
        checked={developerModeEnabled}
        onCheckedChange={(checked) =>
          updateBranding.mutate(brandingPatch(branding, { developerModeEnabled: checked }), {
            onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save'),
          })
        }
      />
    </div>
  );
}

// System (transactional) emails — email verification, staff verification, password reset. The
// landing view is a management page: the global design (chosen once, for every email), the list
// of fixed system email types, and branding inheritance. Selecting an email opens its own
// content editor with exactly one live preview — never a second design gallery duplicating the
// one above. See docs/ARCHITECTURE.md §6.2 for the boundary with the general-purpose content/
// email-template feature this deliberately isn't.
export function EmailTemplatesPage() {
  const { data: templates, isPending, error } = useEmailTemplates();
  const { data: designs } = useEmailDesigns();
  const { data: brandingRow } = useStructuredSettings('emailBranding');
  const { data: generalRow } = useStructuredSettings('general');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [changeDesignOpen, setChangeDesignOpen] = useState(false);

  const branding = (brandingRow?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  const activeDesignId = branding.designId ?? DEFAULT_DESIGN_ID;
  const activeDesign = findDesign(designs ?? [], activeDesignId);

  const selected = selectedKey ? (templates?.find((t) => t.key === selectedKey) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Email Templates' }]} />

      {selected ? null : (
        <PageHeader title="Email Templates" description="Configure the automated emails sent by your CMS." />
      )}

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending || !templates ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : selected ? (
        <EmailEditor
          key={`${selected.key}-${selected.updatedAt}`}
          template={selected}
          designs={designs ?? []}
          brandingRow={brandingRow ?? null}
          developerOptionsOn={branding.developerModeEnabled ?? false}
          onBack={() => setSelectedKey(null)}
          onRequestChangeDesign={() => setChangeDesignOpen(true)}
        />
      ) : (
        <>
          <SystemEmailDesignSection activeDesign={activeDesign} onChangeDesign={() => setChangeDesignOpen(true)} />
          <TransactionalEmailsSection templates={templates} onEdit={setSelectedKey} />
          <EmailBrandingSection brandingRow={brandingRow ?? null} generalRow={generalRow ?? null} />
          <DeveloperOptionsSection brandingRow={brandingRow ?? null} />
        </>
      )}

      <ChangeDesignDialog
        open={changeDesignOpen}
        onOpenChange={setChangeDesignOpen}
        designs={designs ?? []}
        activeDesignId={activeDesignId}
        anyTemplateKey={templates?.[0]?.key}
      />
    </div>
  );
}
