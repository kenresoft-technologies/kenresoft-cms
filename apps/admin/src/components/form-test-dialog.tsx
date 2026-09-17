import { useState } from 'react';
import { CheckCircle2, FlaskConical } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useTestFormSubmission } from '@/lib/queries/form-submissions';
import type { FormField } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

// Renders the form from its real field definitions — the same source of truth the public
// submission page would use, not a separate hand-maintained preview template — and submits
// through the real validate/upload/notify pipeline (server-side: submitForm(), shared with the
// public route) rather than a client-only dry run. That's the point: it proves the whole thing
// actually works, not just that the fields look right. The resulting submission is real, just
// flagged isTest so it's excluded from any future count/export by default and badged in the
// inbox instead of hidden.
function TestFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `form-test-${field.name}`;

  switch (field.fieldType) {
    case 'textarea':
      return (
        <Textarea
          id={id}
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'select': {
      const options = (field.config?.['options'] as string[] | undefined) ?? [];
      return (
        <Select value={(value as string) ?? ''} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label htmlFor={id} className="font-normal text-muted-foreground">
            {field.required ? 'Required' : 'Optional'}
          </Label>
        </div>
      );
    case 'file':
      return (
        <Input
          id={id}
          type="file"
          required={field.required}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'email':
      return (
        <Input
          id={id}
          type="email"
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'url':
      return (
        <Input
          id={id}
          type="url"
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'text':
    default:
      return (
        <Input
          id={id}
          type="text"
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function FormTestForm({ formId, fields, onDone }: { formId: string; fields: FormField[]; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const testSubmission = useTestFormSubmission(formId);

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData();
    for (const field of fields) {
      const value = values[field.name];
      if (field.fieldType === 'file') {
        if (value instanceof File) formData.set(field.name, value);
      } else if (field.fieldType === 'checkbox') {
        // An unchecked checkbox sends no key at all, matching a real browser form's own
        // behavior — schemaForField's server-side validation treats a missing key as
        // "unchecked", not "false".
        if (value === true) formData.set(field.name, 'true');
      } else if (value !== undefined && value !== null && value !== '') {
        formData.set(field.name, String(value));
      }
    }

    try {
      await testSubmission.mutateAsync(formData);
      setSucceeded(true);
      toast.success('Test submission sent');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Test submission failed';
      setError(message);
      toast.error(message);
    }
  }

  if (succeeded) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-10 text-success" />
        <p className="font-medium">Test submission created</p>
        <p className="text-sm text-muted-foreground">
          It ran through the real validation, file-upload, and notification pipeline, and appears
          in Submissions flagged as a test.
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" onClick={() => setSucceeded(false)}>
            Test again
          </Button>
          <Button asChild>
            <Link to={`/forms/${formId}/submissions`} onClick={onDone}>
              View submissions
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      {fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-2">
          <Label htmlFor={`form-test-${field.name}`}>
            {field.label}
            {field.required ? <span className="text-destructive"> *</span> : null}
          </Label>
          <TestFieldInput field={field} value={values[field.name]} onChange={(value) => setValue(field.name, value)} />
        </div>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={testSubmission.isPending}>
          <FlaskConical />
          {testSubmission.isPending ? 'Submitting…' : 'Submit test'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function FormTestDialog({ formId, fields }: { formId: string; fields: FormField[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FlaskConical />
          Preview & Test
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Preview & Test</DialogTitle>
          <DialogDescription>
            Rendered from this form's real fields. Submitting runs the same validation, file
            upload, and email notification a real visitor submission would — the result is
            flagged as a test.
          </DialogDescription>
        </DialogHeader>
        {open ? <FormTestForm key={formId} formId={formId} fields={fields} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
