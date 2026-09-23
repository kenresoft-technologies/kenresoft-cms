import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import {
  useEmailTemplates,
  usePreviewEmailTemplate,
  useRestoreEmailTemplateDefault,
  useSendTestEmailTemplate,
  useUpdateEmailTemplate,
} from '@/lib/queries/email-templates';
import type { EmailTemplate } from '@/lib/types';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

// Backs the template list at the top of the page — a compact card per template rather than a
// dense table, since there are only ever three (EMAIL_TEMPLATE_KEYS) and each one benefits from
// showing its description inline.
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

// The editor for one template — subject/HTML/plain-text-override fields, a live preview
// (debounced round trip to the server's own render pipeline, so what's shown is exactly what a
// real send would sanitize/substitute), the variable reference, restore-default, and send-test.
// Advanced HTML only (no structured block builder) — deliberately: these are three fixed
// table-based email layouts, not open-ended page content, and a raw-HTML-plus-live-preview loop
// is what apps/admin/src/pages/EmailPage.tsx's own "Design HTML" mode already established for
// exactly this kind of content.
function TemplateEditor({ template }: { template: EmailTemplate }) {
  const [subject, setSubject] = useState(template.subject);
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
      previewTemplate.mutate(
        { subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null },
        { onSuccess: setPreview },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewTemplate is a fresh mutation object every render; including it would re-trigger the debounce on every keystroke's own render, not just on content changes.
  }, [subject, bodyHtml, plainText, usePlainTextOverride]);

  const isDirty =
    subject !== template.subject || bodyHtml !== template.bodyHtml || (usePlainTextOverride ? plainText : null) !== template.plainText;

  async function handleSave() {
    try {
      await updateTemplate.mutateAsync({ subject, bodyHtml, plainText: usePlainTextOverride ? plainText : null });
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Edit — {template.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-subject">Subject</Label>
            <Input id="template-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-body">Body HTML (Advanced)</Label>
            <Textarea
              id="template-body"
              value={bodyHtml}
              onChange={(event) => setBodyHtml(event.target.value)}
              className="min-h-64 font-mono text-xs"
              spellCheck={false}
            />
          </div>
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
                Derived automatically from the HTML above on every send. Turn this on to write your own.
              </p>
            )}
          </div>

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
              Replaces the subject, HTML and any custom plain-text version with what ships with the CMS. This
              can't be undone. The enabled/disabled state is left as-is.
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

// Transactional email templates (verification, password reset) — subject/HTML/plain-text are
// CMS-managed rather than hardcoded in the auth flow, with a shared, brand-token-driven design
// (Settings > the emailBranding Structured Settings module, not surfaced as its own page yet —
// edit brandColor/pageBackground/etc. tokens directly in a template's own Advanced HTML for
// now, e.g. {{design.brandColor}}). Admin-only, matching every route in
// routes/admin/email-templates.ts.
export function EmailTemplatesPage() {
  const { data: templates, isPending, error } = useEmailTemplates();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = templates?.find((t) => t.key === selectedKey) ?? templates?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Email Templates' }]} />
      <PageHeader
        title="Email Templates"
        description="Subject, HTML and plain-text for verification and password-reset emails — no hardcoded copy."
      />

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

      {selected ? <TemplateEditor key={`${selected.key}-${selected.updatedAt}`} template={selected} /> : null}
    </div>
  );
}
