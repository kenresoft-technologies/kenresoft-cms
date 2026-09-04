import { useMemo, useState } from 'react';
import { Archive, Inbox, MailOpen, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useForms } from '@/lib/queries/forms';
import { useFormFields } from '@/lib/queries/form-fields';
import { useAllSubmissions, useUpdateSubmissionStatusGlobal } from '@/lib/queries/all-submissions';
import type { FormSubmissionStatus, FormSubmissionWithForm } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { FormBadge } from '@/components/form-badge';
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
  submission,
  onOpenChange,
}: {
  submission: FormSubmissionWithForm | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: fields } = useFormFields(submission?.formId ?? '');
  const fieldLabels = useMemo(() => new Map((fields ?? []).map((field) => [field.name, field.label])), [fields]);

  return (
    <Dialog open={submission !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submission</DialogTitle>
          <DialogDescription>
            {submission ? `${submission.formName} · ${new Date(submission.createdAt).toLocaleString()}` : null}
          </DialogDescription>
        </DialogHeader>
        {submission ? (
          <div className="flex flex-col gap-3">
            {Object.entries(submission.data).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">{fieldLabels.get(key) ?? key}</span>
                <SubmissionValue formId={submission.formId} submissionId={submission.id} fieldName={key} value={value} />
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionActions({ submission }: { submission: FormSubmissionWithForm }) {
  const updateStatus = useUpdateSubmissionStatusGlobal();

  function setStatus(status: FormSubmissionStatus) {
    updateStatus.mutate(
      { formId: submission.formId, id: submission.id, status },
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

export function AllSubmissionsPage() {
  const { data: submissions, isPending, error, refetch } = useAllSubmissions();
  const { data: forms } = useForms();
  const updateStatus = useUpdateSubmissionStatusGlobal();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [formFilter, setFormFilter] = useState('all');
  const [viewing, setViewing] = useState<FormSubmissionWithForm | null>(null);

  const filteredSubmissions = useMemo(() => {
    return (submissions ?? []).filter((submission) => {
      if (statusFilter !== 'all' && submission.status !== statusFilter) return false;
      if (formFilter !== 'all' && submission.formId !== formFilter) return false;
      return true;
    });
  }, [submissions, statusFilter, formFilter]);

  async function handleBulkStatus(
    rows: FormSubmissionWithForm[],
    status: FormSubmissionStatus,
    clearSelection: () => void,
  ) {
    const results = await Promise.allSettled(
      rows.map((submission) => updateStatus.mutateAsync({ formId: submission.formId, id: submission.id, status })),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;

    if (failed === 0) {
      toast.success(`${rows.length} submissions marked ${status}`);
    } else {
      toast.error(`${failed} of ${rows.length} submissions failed to update`);
    }
    clearSelection();
  }

  const columns = useMemo<ColumnDef<FormSubmissionWithForm>[]>(
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
        accessorKey: 'formName',
        header: 'Form',
        cell: ({ row }) => (
          <Link to={`/forms/${row.original.formId}/submissions`} className="w-fit">
            <FormBadge id={row.original.formId} name={row.original.formName} />
          </Link>
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
        cell: ({ row }) => <SubmissionActions submission={row.original} />,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Submissions' }]} />

      <PageHeader title="Submissions" description="Every visitor submission across every form." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {submissions && submissions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No submissions yet"
          description="Submissions appear here once visitors submit one of your forms."
        />
      ) : null}

      {submissions && submissions.length > 0 ? (
        <DataTable
          columns={columns}
          data={filteredSubmissions}
          searchPlaceholder="Search submissions…"
          onRefresh={() => void refetch()}
          enableRowSelection
          toolbar={
            <>
              <Select value={formFilter} onValueChange={setFormFilter}>
                <SelectTrigger size="sm" className="w-40" aria-label="Filter by form">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All forms</SelectItem>
                  {forms?.map((form) => (
                    <SelectItem key={form.id} value={form.id}>
                      {form.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            </>
          }
          bulkActions={(selected, clearSelection) => (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBulkStatus(selected, 'read', clearSelection)}
              >
                Mark read
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBulkStatus(selected, 'archived', clearSelection)}
              >
                Archive
              </Button>
            </>
          )}
        />
      ) : null}

      <ViewSubmissionDialog
        submission={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
    </div>
  );
}
