import { useState } from 'react';
import { Send } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useEmailLimits, useSendEmail } from '@/lib/queries/email';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { EmailAttachments } from '@/components/email-attachments';
import { emptyAttachments } from '@/lib/queries/email';
import { PageHeader } from '@/components/page-header';
import { SanitizedHtmlPreview } from '@/components/sanitized-html-preview';
import { RichTextEditor } from '@/components/rich-text-editor';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

function getPlainTextFromHtml(html: string) {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current.replace(/&nbsp;/g, ' ');
}

// A first-class place to send email from the CMS: compose to any recipient, from the configured
// sender identity (or the deployment's default), with replies routed to the sender's own
// mailbox. Submission replies use the same server-side sending path.
export function EmailPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  const { data: settings } = useSettings();
  const { data: limits } = useEmailLimits();
  const sendEmail = useSendEmail();

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  // Blank = the server's default: the configured Email sender address, else the staff member's own.
  const [replyTo, setReplyTo] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachments, setAttachments] = useState(emptyAttachments);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 'design' = paste a finished HTML template and send it with its layout intact (admin/owner only).
  const [mode, setMode] = useState<'message' | 'design'>('message');
  const designMode = isAdmin && mode === 'design';

  const fromLabel = settings?.emailSenderEmail
    ? settings.emailSenderName
      ? `${settings.emailSenderName} <${settings.emailSenderEmail}>`
      : settings.emailSenderEmail
    : "Deployment default sender (system 'no-reply' address)";
  const defaultReplyTo = settings?.emailSenderEmail ?? session?.user.email ?? 'your own address';
  const canSend =
    limits?.configured !== false &&
    to.trim() !== '' &&
    subject.trim() !== '' &&
    (designMode ? bodyHtml.trim() !== '' : getPlainTextFromHtml(bodyHtml).trim() !== '') &&
    !sendEmail.isPending;

  async function handleSend() {
    try {
      await sendEmail.mutateAsync({
        to: to.trim(),
        subject: subject.trim(),
        ...(replyTo.trim() !== '' ? { replyTo: replyTo.trim() } : {}),
        bodyHtml,
        ...attachments,
        ...(designMode ? { designHtml: true } : {}),
      });
      toast.success(`Email sent to ${to.trim()}`);
      setTo('');
      setReplyTo('');
      setSubject('');
      setBodyHtml('');
      setAttachments(emptyAttachments);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send email');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email"
        description="Send email to anyone directly from the CMS. Replies arrive in your own mailbox."
      />

      {limits?.configured === false ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          This deployment has no email provider configured, so sending is unavailable. See the
          deployment docs to set up Resend or Cloudflare Email Service.
        </p>
      ) : null}


      <Card>
        <CardHeader>
          <CardTitle className="text-sm">New email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <p className="truncate rounded-md border bg-muted/30 px-3 py-2 text-sm">{fromLabel}</p>
            {isAdmin ? (
              <p className="text-xs text-muted-foreground">
                Change the sender in{' '}
                <Link to="/profile" className="text-primary hover:underline">
                  Profile → Email sender
                </Link>
                .
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-reply-to">Reply-To</Label>
            <Input
              id="email-reply-to"
              type="email"
              value={replyTo}
              placeholder={defaultReplyTo}
              onChange={(event) => setReplyTo(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Leave blank to receive replies at {defaultReplyTo} (your Email sender address).
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-to">To</Label>
            <Input id="email-to" type="email" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-subject">Subject</Label>
            <Input id="email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          {isAdmin ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-mode">Format</Label>
              <Select
                value={mode}
                onValueChange={(next) => {
                  setMode(next as 'message' | 'design');
                  setBodyHtml('');
                }}
              >
                <SelectTrigger id="email-mode" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message">Message (rich text)</SelectItem>
                  <SelectItem value="design">Design HTML (paste a template)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {designMode ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-design-html">HTML template</Label>
              <Textarea
                id="email-design-html"
                value={bodyHtml}
                spellCheck={false}
                placeholder="Paste the full HTML of your email template (for example exported from Canva)"
                className="field-sizing-fixed h-72 max-h-[28rem] resize-y overflow-y-auto font-mono text-sm"
                onChange={(event) => setBodyHtml(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Layout, inline styles and https images are kept. Scripts, forms, style blocks, relative
                links and embedded (data:) images are removed. Images must be hosted at a public https
                address. The preview shows what will actually be sent.
              </p>
              <SanitizedHtmlPreview html={bodyHtml} endpoint="/api/v1/admin/email/sanitize-preview" heightClass="h-96" />
            </div>
          ) : (
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Write your message…" />
          )}
          <EmailAttachments value={attachments} onChange={setAttachments} />
          <div>
            <Button type="button" disabled={!canSend} onClick={() => (designMode ? setConfirmOpen(true) : void handleSend())}>
              <Send />
              {sendEmail.isPending ? 'Sending…' : 'Send email'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* A designed email is sent exactly as pasted (styled, image-rich), which makes it convincing
          to a recipient — so it always needs a deliberate second step naming who gets it and from what. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this designed email?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be sent to {to.trim() || 'the recipient'} from {fromLabel}, looking exactly like the
              preview. Only send content you are authorised to send in this organisation&apos;s name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSend()}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
