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
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
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
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

const STATUS_VARIANT: Record<FormSubmissionStatus, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  read: 'secondary',
  archived: 'outline',
};

function ViewSubmissionDialog({
  submission,
  fieldLabels,
  onOpenChange,
}: {
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
                <p className="text-sm break-words">{String(value)}</p>
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Submission actions"
          className="opacity-0 group-hover:opacity-100"
        >
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
  const { data: submissions, isPending, error } = useFormSubmissions(formId ?? '');
  const [viewing, setViewing] = useState<FormSubmission | null>(null);

  const fieldLabels = useMemo(() => new Map((fields ?? []).map((field) => [field.name, field.label])), [fields]);

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
        cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
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

      <div>
        <h1 className="text-2xl font-semibold">Submissions</h1>
        <p className="text-muted-foreground">{form ? `Visitor submissions for ${form.name}.` : 'Visitor submissions.'}</p>
      </div>

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
        <DataTable columns={columns} data={submissions} searchPlaceholder="Search submissions…" />
      ) : null}

      <ViewSubmissionDialog
        submission={viewing}
        fieldLabels={fieldLabels}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
    </div>
  );
}
