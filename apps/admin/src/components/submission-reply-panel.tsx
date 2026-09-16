import { useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useSendSubmissionReply, useSubmissionReplies } from '@/lib/queries/form-submission-replies';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name.slice(0, 2)]).join('').toUpperCase();
}

// The in-CMS half of replying to a submission — a visible thread of every reply already sent
// (so a shared inbox with multiple staff doesn't double-reply blind) plus a rich-text compose
// box that sends through this deployment's own configured email provider. The other half —
// opening an external mail app instead — lives in mail-compose-links.ts and the row action
// menu's own "Reply by email" item; this panel is the alternative for not leaving the CMS at
// all. Only rendered when a sender email was actually detected on the submission (the caller
// checks that), since there's nowhere to send to otherwise.
export function SubmissionReplyPanel({
  formId,
  submissionId,
  formName,
  to,
}: {
  formId: string;
  submissionId: string;
  formName: string;
  to: string;
}) {
  const { data: session } = authClient.useSession();
  const { data: replies, isPending } = useSubmissionReplies(formId, submissionId);
  const sendReply = useSendSubmissionReply(formId, submissionId);
  const [subject, setSubject] = useState(`Re: ${formName} submission`);
  const [bodyHtml, setBodyHtml] = useState('');

  const bodyIsEmpty = bodyHtml.replace(/<[^>]+>/g, '').trim().length === 0;

  async function handleSend() {
    try {
      await sendReply.mutateAsync({ to, subject, bodyHtml });
      toast.success(`Reply sent to ${to}`);
      setBodyHtml('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send reply');
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <p className="text-sm font-medium">Replies</p>

      {isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {replies && replies.length > 0 ? (
        <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
          {replies.map((reply) => (
            <div key={reply.id} className="flex gap-2">
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback>{initials(reply.authorName ?? session?.user.name ?? '?')}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{reply.authorName ?? session?.user.name ?? 'A staff member'}</span>
                  <span>{new Date(reply.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  To {reply.to} · {reply.subject}
                </p>
                <div
                  className="ProseMirror text-sm break-words"
                  dangerouslySetInnerHTML={{ __html: reply.bodyHtml }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {replies && replies.length === 0 && !isPending ? (
        <p className="text-sm text-muted-foreground">No replies sent yet.</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reply-subject" className="text-xs text-muted-foreground">
            Subject
          </Label>
          <Input id="reply-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </div>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder={`Write a reply to ${to}…`} />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={bodyIsEmpty || !subject.trim() || sendReply.isPending}
            onClick={() => void handleSend()}
          >
            <Send />
            {sendReply.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </div>
    </div>
  );
}
