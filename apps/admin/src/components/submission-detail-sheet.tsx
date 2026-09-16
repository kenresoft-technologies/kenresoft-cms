import { getSubmissionSender } from '@/lib/submission-sender';
import type { FormSubmission, FormSubmissionWithForm } from '@/lib/types';
import { SubmissionReplyPanel } from '@/components/submission-reply-panel';
import { SubmissionValue } from '@/components/submission-value';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// Replaces the old small centered Dialog both submissions pages used — a real user report that
// a textarea field's paragraphs displayed as a single flattened line (fixed separately in
// submission-value.tsx) prompted a closer look, and the popup itself was cramped: little room
// for a form with several fields, no room at all for the new reply thread/compose box below. A
// wide slide-over reads far better for what's really a small document (a submission plus
// however many replies it's had), not a quick confirmation.
export function SubmissionDetailSheet<T extends FormSubmission | FormSubmissionWithForm>({
  formId,
  formName,
  submission,
  fieldLabels,
  onOpenChange,
  actions,
}: {
  formId: string;
  formName: string;
  submission: T | null;
  fieldLabels: Map<string, string>;
  onOpenChange: (open: boolean) => void;
  actions?: (submission: T) => React.ReactNode;
}) {
  const sender = submission ? getSubmissionSender(submission.data) : null;

  return (
    <Sheet open={submission !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        {submission ? (
          <>
            <SheetHeader className="flex-row items-start justify-between gap-4 space-y-0 pr-10">
              <div className="flex flex-col gap-1">
                <SheetTitle>{formName} submission</SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{new Date(submission.createdAt).toLocaleString()}</span>
                    <StatusBadge status={submission.status} />
                  </div>
                </SheetDescription>
              </div>
              {actions ? <div className="shrink-0">{actions(submission)}</div> : null}
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
              {sender && (sender.name || sender.email) ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
                  {sender.name ? <span className="text-sm font-medium">{sender.name}</span> : null}
                  {sender.email ? (
                    <Badge variant="outline" className="font-normal">
                      {sender.email}
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-4">
                {Object.entries(submission.data).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{fieldLabels.get(key) ?? key}</span>
                    <SubmissionValue formId={formId} submissionId={submission.id} fieldName={key} value={value} />
                  </div>
                ))}
              </div>

              {sender?.email ? (
                <SubmissionReplyPanel formId={formId} submissionId={submission.id} formName={formName} to={sender.email} />
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
