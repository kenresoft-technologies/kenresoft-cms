import { useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useEmailLimits, useSendEmail } from '@/lib/queries/email';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { EmailAttachments } from '@/components/email-attachments';
import { emptyAttachments } from '@/lib/queries/email';
import { EmailSenderSettings } from '@/components/email-sender-settings';
import { PageHeader } from '@/components/page-header';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function getPlainTextFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
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
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachments, setAttachments] = useState(emptyAttachments);

  const fromLabel = settings?.emailSenderEmail
    ? settings.emailSenderName
      ? `${settings.emailSenderName} <${settings.emailSenderEmail}>`
      : settings.emailSenderEmail
    : "Deployment default sender (system 'no-reply' address)";
  const canSend =
    limits?.configured !== false &&
    to.trim() !== '' &&
    subject.trim() !== '' &&
    getPlainTextFromHtml(bodyHtml).trim() !== '' &&
    !sendEmail.isPending;

  async function handleSend() {
    try {
      await sendEmail.mutateAsync({ to: to.trim(), subject: subject.trim(), bodyHtml, ...attachments });
      toast.success(`Email sent to ${to.trim()}`);
      setTo('');
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
            <p className="text-xs text-muted-foreground">
              Replies go to {session?.user.email ?? 'your email address'}. Change the sender below.
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
          <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Write your message…" />
          <EmailAttachments value={attachments} onChange={setAttachments} />
          <div>
            <Button type="button" disabled={!canSend} onClick={() => void handleSend()}>
              <Send />
              {sendEmail.isPending ? 'Sending…' : 'Send email'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <EmailSenderSettings settings={settings ?? null} readOnly={!isAdmin} />
    </div>
  );
}
