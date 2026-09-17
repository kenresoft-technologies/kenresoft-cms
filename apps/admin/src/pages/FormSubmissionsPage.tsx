import { useMemo, useState } from 'react';
import { Archive, ExternalLink, Inbox, MailOpen, MoreHorizontal, Paperclip, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { buildReplyLink, opensInNewTab } from '@/lib/mail-compose-links';
import { useForm } from '@/lib/queries/forms';
import {
  useDeleteFormSubmission,
  useFormSubmissions,
  useUpdateFormSubmissionStatus,
} from '@/lib/queries/form-submissions';
import { getSubmissionAttachments } from '@/lib/submission-attachments';
import { getSubmissionSender } from '@/lib/submission-sender';
import type { FormSubmission, FormSubmissionStatus } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { TableSkeleton } from '@/components/table-skeleton';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

type StatusFilter = 'all' | FormSubmissionStatus;

function SubmissionActions({
  formId,
  submission,
  onRequestDelete,
}: {
  formId: string;
  submission: FormSubmission;
  onRequestDelete: (submission: FormSubmission) => void;
}) {
  const { data: session } = authClient.useSession();
  const updateStatus = useUpdateFormSubmissionStatus(formId);
  const { name: senderName, email: senderEmail } = getSubmissionSender(submission.data);

  function setStatus(status: FormSubmissionStatus) {
    updateStatus.mutate(
      { id: submission.id, status },
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update submission') },
    );
  }

  const preferredMailClient = session?.user.preferredMailClient ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Submission actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {senderEmail ? (
          <>
            <DropdownMenuItem asChild>
              <a
                href={buildReplyLink(preferredMailClient, {
                  to: senderEmail,
                  subject: `Re: submission from ${senderName ?? senderEmail}`,
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
        <DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(submission)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FormSubmissionsPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const { data: form } = useForm(formId ?? '');
  const { data: submissions, isPending, error, refetch } = useFormSubmissions(formId ?? '');
  const deleteSubmission = useDeleteFormSubmission(formId ?? '');
  const [pendingDelete, setPendingDelete] = useState<FormSubmission | FormSubmission[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [hideTest, setHideTest] = useState(false);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const targets = Array.isArray(pendingDelete) ? pendingDelete : [pendingDelete];

    const results = await Promise.allSettled(targets.map((submission) => deleteSubmission.mutateAsync(submission.id)));
    const failed = results.filter((result) => result.status === 'rejected').length;

    if (failed === 0) {
      toast.success(targets.length === 1 ? 'Submission deleted' : `${targets.length} submissions deleted`);
    } else {
      toast.error(`${failed} of ${targets.length} submissions failed to delete`);
    }
    setPendingDelete(null);
  }

  const filteredSubmissions = useMemo(
    () =>
      (submissions ?? []).filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (hideTest && s.isTest) return false;
        return true;
      }),
    [submissions, statusFilter, hideTest],
  );

  const columns = useMemo<ColumnDef<FormSubmission>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Submitted',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
        cell: ({ row }) => (
          <span className="font-medium">{new Date(row.original.createdAt).toLocaleString()}</span>
        ),
      },
      {
        id: 'sender',
        header: 'Submitted by',
        cell: ({ row }) => {
          const { name, email } = getSubmissionSender(row.original.data);
          if (!name && !email) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-col">
              {name ? <span className="text-sm">{name}</span> : null}
              {email ? <span className="text-xs text-muted-foreground">{email}</span> : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={row.original.status} />
            {row.original.isTest ? <TestSubmissionBadge /> : null}
          </div>
        ),
      },
      {
        id: 'attachments',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const attachments = getSubmissionAttachments(row.original.data);
          if (attachments.length === 0) return null;
          return (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={attachments.map((a) => a.filename).join(', ')}
            >
              <Paperclip className="size-3.5" />
              {attachments.length}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          formId ? (
            <SubmissionActions formId={formId} submission={row.original} onRequestDelete={setPendingDelete} />
          ) : null,
      },
    ],
    [formId],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Forms', to: '/forms' },
          { label: form?.name ?? '…', to: `/forms/${formId}` },
          { label: 'Submissions' },
        ]}
      />

      <PageHeader
        title="Submissions"
        description={form ? `Visitor submissions for ${form.name}.` : 'Visitor submissions.'}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {submissions && submissions.length === 0 ? (
        <EmptyState icon={Inbox} title="No submissions yet" description="Submissions appear here once visitors submit this form." />
      ) : null}

      {submissions && submissions.length > 0 ? (
        <DataTable
          columns={columns}
          data={filteredSubmissions}
          searchPlaceholder="Search submissions…"
          onRefresh={() => void refetch()}
          onRowClick={(row) => navigate(`/forms/${formId}/submissions/${row.id}`)}
          enableRowSelection
          toolbar={
            <>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={hideTest ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHideTest((v) => !v)}
              >
                Hide test
              </Button>
            </>
          }
          bulkActions={(selected, clearSelection) => (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setPendingDelete(selected);
                clearSelection();
              }}
            >
              <Trash2 />
              Delete
            </Button>
          )}
        />
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {Array.isArray(pendingDelete) ? `Delete ${pendingDelete.length} submissions?` : 'Delete this submission?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {Array.isArray(pendingDelete) ? 'these submissions' : 'this submission'}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
