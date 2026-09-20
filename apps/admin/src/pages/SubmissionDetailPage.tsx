import { useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Download,
  ExternalLink,
  Inbox,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Send,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { formatBytes } from '@/lib/format';
import { buildReplyLink, opensInNewTab } from '@/lib/mail-compose-links';
import { useForm } from '@/lib/queries/forms';
import { useFormFields } from '@/lib/queries/form-fields';
import { submissionAttachmentUrl, useFormSubmissions } from '@/lib/queries/form-submissions';
import { useDeleteSubmissionGlobal, useUpdateSubmissionStatusGlobal } from '@/lib/queries/all-submissions';
import { EmailAttachments } from '@/components/email-attachments';
import { useSettings } from '@/lib/queries/settings';
import { emptyAttachments } from '@/lib/queries/email';
import { useSendSubmissionReply, useSubmissionReplies } from '@/lib/queries/form-submission-replies';
import { getSubmissionSender } from '@/lib/submission-sender';
import { isSubmissionAttachmentValue, type SubmissionAttachmentValue } from '@/lib/submission-attachments';
import { SubmissionValue } from '@/components/submission-value';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { RichTextEditor } from '@/components/rich-text-editor';
import { StatusBadge } from '@/components/status-badge';
import { TestSubmissionBadge } from '@/components/test-submission-badge';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { FormSubmissionStatus } from '@/lib/types';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name.slice(0, 2)]).join('').toUpperCase();
}

function getPlainTextFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

// The full-page replacement for the old narrow right-side Sheet — a submission plus its
// attachments/replies/reply-composer is a proper record, not something that fits in a slide-
// over. Reachable from both the per-form (FormSubmissionsPage) and unified (AllSubmissionsPage)
// lists, since both already know a submission's formId and this route needs nothing else.
export function SubmissionDetailPage() {
  const { formId, submissionId } = useParams<{ formId: string; submissionId: string }>();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();

  const { data: form } = useForm(formId ?? '');
  const { data: fields } = useFormFields(formId ?? '');
  const { data: submissions, isPending, error } = useFormSubmissions(formId ?? '');
  const { data: replies, isPending: repliesPending } = useSubmissionReplies(formId ?? '', submissionId ?? '');
  const sendReply = useSendSubmissionReply(formId ?? '', submissionId ?? '');
  const updateStatus = useUpdateSubmissionStatusGlobal();
  const deleteSubmission = useDeleteSubmissionGlobal();

  const [pendingDelete, setPendingDelete] = useState(false);
  const [subject, setSubject] = useState(`Re: ${form?.name ?? 'Form'} submission`);
  const [bodyHtml, setBodyHtml] = useState('');
  // Blank = server default: the configured Email sender address, else the staff member's own.
  const [replyTo, setReplyTo] = useState('');
  const { data: settings } = useSettings();
  const defaultReplyTo = settings?.emailSenderEmail ?? session?.user.email ?? 'your own address';
  const [attachments, setAttachments] = useState(emptyAttachments);

  const submission = useMemo(
    () => (submissions ?? []).find((s) => s.id === submissionId) ?? null,
    [submissions, submissionId],
  );
  const fieldLabels = useMemo(() => new Map((fields ?? []).map((field) => [field.name, field.label])), [fields]);
  const sender = submission ? getSubmissionSender(submission.data) : null;
  const preferredMailClient = session?.user.preferredMailClient ?? null;

  const { fieldEntries, attachmentEntries } = useMemo(() => {
    const fieldEntries: [string, unknown][] = [];
    const attachmentEntries: [string, SubmissionAttachmentValue][] = [];
    if (submission) {
      for (const [key, value] of Object.entries(submission.data)) {
        if (isSubmissionAttachmentValue(value)) attachmentEntries.push([key, value]);
        else fieldEntries.push([key, value]);
      }
    }
    return { fieldEntries, attachmentEntries };
  }, [submission]);

  const bodyIsEmpty = getPlainTextFromHtml(bodyHtml).trim().length === 0;

  function setStatus(status: FormSubmissionStatus) {
    if (!formId || !submission) return;
    updateStatus.mutate(
      { formId, id: submission.id, status },
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update submission') },
    );
  }

  async function handleDelete() {
    if (!formId || !submission) return;
    try {
      await deleteSubmission.mutateAsync({ formId, id: submission.id });
      toast.success('Submission deleted');
      navigate(`/forms/${formId}/submissions`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete submission');
    }
    setPendingDelete(false);
  }

  async function handleSend() {
    if (!sender?.email) return;
    try {
      await sendReply.mutateAsync({ to: sender.email, subject, bodyHtml, ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}), ...attachments });
      toast.success(`Reply sent to ${sender.email}`);
      setBodyHtml('');
      setReplyTo('');
      setAttachments(emptyAttachments);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send reply');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Forms', to: '/forms' },
          { label: form?.name ?? '…', to: `/forms/${formId}` },
          { label: 'Submissions', to: `/forms/${formId}/submissions` },
          { label: sender?.name || sender?.email || 'Submission' },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" asChild>
            <Link to={`/forms/${formId}/submissions`}>
              <ArrowLeft />
              Back to submissions
            </Link>
          </Button>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {sender?.name || sender?.email || 'Submission'}
            </h1>
            {submission ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{new Date(submission.createdAt).toLocaleString()}</span>
                <StatusBadge status={submission.status} />
                {submission.isTest ? <TestSubmissionBadge /> : null}
              </div>
            ) : null}
          </div>
        </div>

        {submission ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Submission actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {sender?.email ? (
                <>
                  <DropdownMenuItem asChild>
                    <a
                      href={buildReplyLink(preferredMailClient, {
                        to: sender.email,
                        subject: `Re: submission from ${sender.name ?? sender.email}`,
                      })}
                      target={opensInNewTab(preferredMailClient) ? '_blank' : undefined}
                      rel={opensInNewTab(preferredMailClient) ? 'noreferrer' : undefined}
                    >
                      <ExternalLink />
                      Reply in email app
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {submission.status !== 'new' ? (
                <DropdownMenuItem onClick={() => setStatus('new')}>
                  <Inbox />
                  Mark new
                </DropdownMenuItem>
              ) : null}
              {submission.status !== 'read' ? (
                <DropdownMenuItem onClick={() => setStatus('read')}>
                  <MailOpen />
                  Mark read
                </DropdownMenuItem>
              ) : null}
              {submission.status !== 'archived' ? (
                <DropdownMenuItem onClick={() => setStatus('archived')}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(true)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Skeleton className="h-96 lg:col-span-3" />
          <Skeleton className="h-96 lg:col-span-2" />
        </div>
      ) : null}

      {!isPending && !submission ? (
        <EmptyState
          icon={Inbox}
          title="Submission not found"
          description="It may have been deleted, or the link is no longer valid."
        />
      ) : null}

      {submission ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
            {/* No separate "Applicant" card — Name/Email are just submitted field values like
                any other (sender is only ever derived from this same submission.data to drive
                the page header and the reply recipient), so showing them twice was pure
                duplication rather than a distinct section. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Submission</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {fieldEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="shrink-0 text-xs font-medium text-muted-foreground sm:w-2/5">
                      {fieldLabels.get(key) ?? key}
                    </span>
                    <div className="min-w-0 sm:w-3/5 sm:text-right">
                      <SubmissionValue value={value} />
                    </div>
                  </div>
                ))}
                {fieldEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This submission has no field values.</p>
                ) : null}
              </CardContent>
            </Card>

            {attachmentEntries.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Attachments</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {attachmentEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{value.filename}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {value.contentType} · {formatBytes(value.size)}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0" asChild>
                        <a href={submissionAttachmentUrl(formId ?? '', submission.id, key)} target="_blank" rel="noreferrer">
                          <Download />
                          View
                        </a>
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Conversation</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {repliesPending ? <Skeleton className="h-16 w-full" /> : null}
                {replies && replies.length === 0 && !repliesPending ? (
                  <p className="text-sm text-muted-foreground">No replies sent yet.</p>
                ) : null}
                {replies?.map((reply) => (
                  <div key={reply.id} className="flex min-w-0 gap-2.5">
                    <Avatar className="mt-0.5 shrink-0">
                      <AvatarFallback>{initials(reply.authorName ?? session?.user.name ?? '?')}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {reply.authorName ?? session?.user.name ?? 'A staff member'}
                        </span>
                        <span>{new Date(reply.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs break-words text-muted-foreground">
                        To {reply.to} · {reply.subject}
                      </p>
                      <div className="ProseMirror text-sm break-words" dangerouslySetInnerHTML={{ __html: reply.bodyHtml }} />
                      {reply.attachments?.length ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {reply.attachments.map((a, i) => (
                            <li key={i} className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-0.5 text-xs">
                              <Paperclip className="size-3" />
                              {a.filename}
                              <span className="text-muted-foreground">({formatBytes(a.size)})</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Reply</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {sender?.email ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Recipient</Label>
                      <p className="truncate rounded-md border bg-muted/30 px-3 py-2 text-sm">{sender.email}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reply-subject" className="text-xs text-muted-foreground">
                        Subject
                      </Label>
                      <Input id="reply-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reply-reply-to" className="text-xs text-muted-foreground">
                        Reply-To (optional)
                      </Label>
                      <Input
                        id="reply-reply-to"
                        type="email"
                        value={replyTo}
                        placeholder={defaultReplyTo}
                        onChange={(event) => setReplyTo(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Leave blank to use {defaultReplyTo} (your Email sender address).</p>
                    </div>
                    <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder={`Write a reply to ${sender.email}…`} />
                    <EmailAttachments value={attachments} onChange={setAttachments} />
                    <Button
                      type="button"
                      disabled={bodyIsEmpty || !subject.trim() || sendReply.isPending}
                      onClick={() => void handleSend()}
                    >
                      <Send />
                      {sendReply.isPending ? 'Sending…' : 'Send reply'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No sender email was detected on this submission, so a reply can&apos;t be sent from here.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes this submission. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
