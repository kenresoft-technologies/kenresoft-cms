import { useState } from 'react';
import { Check, ChevronsUpDown, ImageOff, X } from 'lucide-react';

import { useContentType } from '@/lib/queries/content-types';
import { useEntries } from '@/lib/queries/entries';
import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface FieldInputProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}

function optionsFromConfig(config: Record<string, unknown> | null): string[] {
  const options = config?.options;
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === 'string') : [];
}

function targetContentTypeIdFromConfig(config: Record<string, unknown> | null): string | undefined {
  const target = config?.targetContentTypeId;
  return typeof target === 'string' ? target : undefined;
}

function BooleanField({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} />
      <Label htmlFor={id}>{field.label}</Label>
    </div>
  );
}

function TextAreaField({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
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

function PlainInputField({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
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

function SelectField({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
  const options = optionsFromConfig(field.config);

  if (options.length === 0) {
    return <PlainInputField field={field} value={value} onChange={onChange} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{field.label}</Label>
      <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
        <SelectTrigger id={id}>
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
    </div>
  );
}

function MultiSelectField({ field, value, onChange }: FieldInputProps) {
  const options = optionsFromConfig(field.config);
  const selected = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

  if (options.length === 0) {
    return <PlainInputField field={field} value={value} onChange={onChange} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        {options.map((option) => {
          const optionId = `field-${field.name}-${option}`;
          return (
            <div key={option} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                checked={selected.includes(option)}
                onCheckedChange={(checked) =>
                  onChange(checked === true ? [...selected, option] : selected.filter((entry) => entry !== option))
                }
              />
              <Label htmlFor={optionId} className="font-normal">
                {option}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MediaField({ field, value, onChange }: FieldInputProps) {
  const [open, setOpen] = useState(false);
  const { data: mediaItems } = useMediaList();
  const selectedId = typeof value === 'string' ? value : undefined;
  const selected = mediaItems?.find((item) => item.id === selectedId);

  return (
    <div className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      <div className="flex items-center gap-3">
        {selected ? (
          selected.width && selected.height ? (
            <img src={mediaFileUrl(selected.id)} alt={selected.altText ?? selected.filename} className="size-16 rounded-md object-cover" />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-md bg-muted">
              <ImageOff className="size-5 text-muted-foreground" />
            </div>
          )
        ) : (
          <div className="flex size-16 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            None
          </div>
        )}
        <div className="flex flex-col gap-2">
          {selected ? <p className="text-sm text-muted-foreground">{selected.filename}</p> : null}
          <div className="flex gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {selected ? 'Change media' : 'Choose media'}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Choose media</DialogTitle>
                </DialogHeader>
                {mediaItems && mediaItems.length > 0 ? (
                  <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto">
                    {mediaItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onChange(item.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'aspect-square overflow-hidden rounded-md ring-2 ring-transparent hover:ring-primary',
                          item.id === selectedId && 'ring-primary',
                        )}
                      >
                        {item.width && item.height ? (
                          <img src={mediaFileUrl(item.id)} alt={item.altText ?? item.filename} className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center bg-muted">
                            <ImageOff className="size-5 text-muted-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No media uploaded yet.</p>
                )}
              </DialogContent>
            </Dialog>
            {selected ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <X />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferenceField({ field, value, onChange }: FieldInputProps) {
  const [open, setOpen] = useState(false);
  const targetContentTypeId = targetContentTypeIdFromConfig(field.config);
  const { data: targetContentType } = useContentType(targetContentTypeId ?? '');
  const { data: entries } = useEntries(targetContentTypeId ?? '');
  const selectedId = typeof value === 'string' ? value : undefined;
  const selected = entries?.find((entry) => entry.id === selectedId);

  if (!targetContentTypeId) {
    return (
      <div className="flex flex-col gap-2">
        <Label>{field.label}</Label>
        <p className="text-sm text-muted-foreground">
          This field has no target content type configured yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="justify-between font-normal">
            {selected ? selected.slug : `Select a ${targetContentType?.name ?? 'reference'}…`}
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <Command>
            <CommandInput placeholder="Search entries…" />
            <CommandList>
              <CommandEmpty>No entries found.</CommandEmpty>
              <CommandGroup>
                {entries?.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.slug}
                    onSelect={() => {
                      onChange(entry.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('size-4', entry.id === selectedId ? 'opacity-100' : 'opacity-0')} />
                    {entry.slug}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function FieldInput({ field, value, onChange }: FieldInputProps) {
  if (field.fieldType === 'boolean') {
    return <BooleanField field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'textarea' || field.fieldType === 'rich_text') {
    return <TextAreaField field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'select') {
    return <SelectField field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'multi_select') {
    return <MultiSelectField field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'media') {
    return <MediaField field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'reference') {
    return <ReferenceField field={field} value={value} onChange={onChange} />;
  }
  return <PlainInputField field={field} value={value} onChange={onChange} />;
}
