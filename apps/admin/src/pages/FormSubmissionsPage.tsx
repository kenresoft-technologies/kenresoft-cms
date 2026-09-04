import { useMemo, useState } from 'react';
import { Archive, Inbox, MailOpen, MoreHorizontal } from 'lucide-react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useForm } from '@/lib/queries/forms';
import { useFormFields } from '@/lib/queries/form-fields';
import { useFormSubmissions, useUpdateFormSubmissionStatus } from '@/lib/queries/form-submissions';
import type { FormSubmission, FormSubmissionStatus } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SubmissionValue } from '@/components/submission-value';
import { TableSkeleton } from '@/components/table-skeleton';
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

function SubmissionActions({ formId, submission }: { formId: string; submission: FormSubmission }) {
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FormSubmissionsPage() {
  const { formId } = useParams<{ formId: string }>();
  const { data: form } = useForm(formId ?? '');
  const { data: fields } = useFormFields(formId ?? '');
  const { data: submissions, isPending, error, refetch } = useFormSubmissions(formId ?? '');
  const [viewing, setViewing] = useState<FormSubmission | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fieldLabels = useMemo(() => new Map((fields ?? []).map((field) => [field.name, field.label])), [fields]);

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
          <button type="button" className="font-medium hover:underline" onClick={() => setViewing(row.original)}>
            {new Date(row.original.createdAt).toLocaleString()}
          </button>
        ),
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
        cell: ({ row }) => (formId ? <SubmissionActions formId={formId} submission={row.original} /> : null),
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
    </div>
  );
}
