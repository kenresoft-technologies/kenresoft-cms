import { useMemo, useState } from 'react';
import { Archive, Inbox, MailOpen, MoreHorizontal, Trash2 } from 'lucide-react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useForm } from '@/lib/queries/forms';
import { useFormFields } from '@/lib/queries/form-fields';
import {
  useDeleteFormSubmission,
  useFormSubmissions,
  useUpdateFormSubmissionStatus,
} from '@/lib/queries/form-submissions';
import { getSubmissionSender } from '@/lib/submission-sender';
import type { FormSubmission, FormSubmissionStatus } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SubmissionValue } from '@/components/submission-value';
import { TableSkeleton } from '@/components/table-skeleton';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function ViewSubmissionDialog({
  formId,
  submission,
  fieldLabels,
  onOpenChange,
}: {
  formId: string;
  submission: FormSubmission | null;
  fieldLabels: Map<string, string>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={submission !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submission</DialogTitle>
          <DialogDescription>
            {submission ? new Date(submission.createdAt).toLocaleString() : null}
          </DialogDescription>
        </DialogHeader>
        {submission ? (
          <div className="flex flex-col gap-3">
            {Object.entries(submission.data).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">{fieldLabels.get(key) ?? key}</span>
                <SubmissionValue formId={formId} submissionId={submission.id} fieldName={key} value={value} />
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionActions({
  formId,
  submission,
  onRequestDelete,
}: {
  formId: string;
  submission: FormSubmission;
  onRequestDelete: (submission: FormSubmission) => void;
}) {
  const updateStatus = useUpdateFormSubmissionStatus(formId);

  function setStatus(status: FormSubmissionStatus) {
    updateStatus.mutate(
      { id: submission.id, status },
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update submission') },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Submission actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
  const { data: form } = useForm(formId ?? '');
  const { data: fields } = useFormFields(formId ?? '');
  const { data: submissions, isPending, error, refetch } = useFormSubmissions(formId ?? '');
  const deleteSubmission = useDeleteFormSubmission(formId ?? '');
  const [viewing, setViewing] = useState<FormSubmission | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormSubmission | FormSubmission[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fieldLabels = useMemo(() => new Map((fields ?? []).map((field) => [field.name, field.label])), [fields]);

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
      statusFilter === 'all' ? (submissions ?? []) : (submissions ?? []).filter((s) => s.status === statusFilter),
    [submissions, statusFilter],
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
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
          onRowClick={(row) => setViewing(row)}
          enableRowSelection
          toolbar={
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

      <ViewSubmissionDialog
        formId={formId ?? ''}
        submission={viewing}
        fieldLabels={fieldLabels}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />

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
