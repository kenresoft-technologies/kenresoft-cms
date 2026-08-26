import type { FieldDefinition } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface FieldInputProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}

// text, slug, select, multi_select, media, reference render as plain text for now — option
// lists (select/multi_select), a media picker, and reference lookups are future work once the
// field builder can configure them (§6.1, §14, FieldDefinition.config).
export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;

  if (field.fieldType === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <Label htmlFor={id}>{field.label}</Label>
      </div>
    );
  }

  if (field.fieldType === 'textarea' || field.fieldType === 'rich_text') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        <Textarea
          id={id}
          required={field.required}
          rows={field.fieldType === 'rich_text' ? 8 : 4}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  const inputType =
    field.fieldType === 'number'
      ? 'number'
      : field.fieldType === 'date'
        ? 'date'
        : field.fieldType === 'datetime'
          ? 'datetime-local'
          : field.fieldType === 'email'
            ? 'email'
            : field.fieldType === 'url'
              ? 'url'
              : 'text';

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        type={inputType}
        required={field.required}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) =>
          onChange(inputType === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)
        }
      />
    </div>
  );
}
