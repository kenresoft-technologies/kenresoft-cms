import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, ImageOff, Plus, Trash2 } from 'lucide-react';

import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import type { BlockInstance, BlockType, ChildBlockInstance } from '@/lib/types';
import { MediaPickerDialog } from '@/components/media-picker-dialog';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { BLOCK_TYPE_REGISTRY, getBlockTypeDef, isContainerBlockType, newBlockId } from './block-registry';
import type { BlockFieldDef } from './block-registry';

interface BlockTreeEditorProps {
  blocks: BlockInstance[];
  onChange: (blocks: BlockInstance[]) => void;
}

// Phase 3's own scope (docs/SITE_BUILDER.md §14 decision #3): "basic add/remove/reorder UI
// (buttons, not drag-and-drop — matching Navigation's own precedent, §1.8)". A drag-and-drop
// canvas is Phase 8, deliberately not built here — this component's callback shape
// (`blocks: BlockInstance[]` in, out) is exactly what a future Phase 8 editor would also
// produce, so replacing this component later doesn't require touching the Page/Block data model
// or the rendering side at all (§14's own explicit requirement).
export function BlockTreeEditor({ blocks, onChange }: BlockTreeEditorProps) {
  function addBlock(type: BlockType) {
    onChange([...blocks, { id: newBlockId(), type, config: {} }]);
  }

  function removeBlock(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function updateBlock(index: number, patch: Partial<BlockInstance>) {
    onChange(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => (
        <BlockCard
          key={block.id}
          block={block}
          onConfigChange={(config) => updateBlock(index, { config })}
          onChildrenChange={(children) => updateBlock(index, { children })}
          onRemove={() => removeBlock(index)}
          onMoveUp={index > 0 ? () => moveBlock(index, -1) : undefined}
          onMoveDown={index < blocks.length - 1 ? () => moveBlock(index, 1) : undefined}
        />
      ))}
      <AddBlockControl onAdd={addBlock} />
    </div>
  );
}

function AddBlockControl({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [selected, setSelected] = useState<BlockType>(BLOCK_TYPE_REGISTRY[0]!.type);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
      <Select value={selected} onValueChange={(value) => setSelected(value as BlockType)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BLOCK_TYPE_REGISTRY.map((def) => (
            <SelectItem key={def.type} value={def.type}>
              {def.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="sm" onClick={() => onAdd(selected)}>
        <Plus />
        Add block
      </Button>
    </div>
  );
}

interface BlockCardProps {
  block: BlockInstance;
  onConfigChange: (config: Record<string, unknown>) => void;
  onChildrenChange: (children: ChildBlockInstance[]) => void;
  onRemove: () => void;
  onMoveUp: (() => void) | undefined;
  onMoveDown: (() => void) | undefined;
}

function BlockCard({ block, onConfigChange, onChildrenChange, onRemove, onMoveUp, onMoveDown }: BlockCardProps) {
  const def = getBlockTypeDef(block.type);
  const children = block.children ?? [];

  function addChild(type: BlockType) {
    onChildrenChange([...children, { id: newBlockId(), type, config: {} }]);
  }

  function removeChild(index: number) {
    onChildrenChange(children.filter((_, i) => i !== index));
  }

  function moveChild(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= children.length) return;
    const next = [...children];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChildrenChange(next);
  }

  function updateChildConfig(index: number, config: Record<string, unknown>) {
    onChildrenChange(children.map((child, i) => (i === index ? { ...child, config } : child)));
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{def?.label ?? block.type}</p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" disabled={!onMoveUp} onClick={onMoveUp}>
            <ChevronUp />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={!onMoveDown} onClick={onMoveDown}>
            <ChevronDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <BlockConfigForm fields={def?.fields ?? []} config={block.config} onChange={onConfigChange} />

      {isContainerBlockType(block.type) ? (
        <div className="mt-4 flex flex-col gap-3 border-l-2 pl-4">
          {children.map((child, index) => {
            const childDef = getBlockTypeDef(child.type);
            return (
              <div key={child.id} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{childDef?.label ?? child.type}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveChild(index, -1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === children.length - 1}
                      onClick={() => moveChild(index, 1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeChild(index)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <BlockConfigForm
                  fields={childDef?.fields ?? []}
                  config={child.config}
                  onChange={(config) => updateChildConfig(index, config)}
                />
              </div>
            );
          })}
          <AddBlockControl onAdd={addChild} />
        </div>
      ) : null}
    </div>
  );
}

interface BlockConfigFormProps {
  fields: BlockFieldDef[];
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

function BlockConfigForm({ fields, config, onChange }: BlockConfigFormProps) {
  function setField(key: string, value: unknown) {
    const next = { ...config };
    if (value === '' || value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  if (fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {fields.map((fieldDef) => (
        <BlockConfigFieldInput
          key={fieldDef.key}
          fieldDef={fieldDef}
          value={config[fieldDef.key]}
          onChange={(value) => setField(fieldDef.key, value)}
        />
      ))}
    </div>
  );
}

function BlockConfigFieldInput({
  fieldDef,
  value,
  onChange,
}: {
  fieldDef: BlockFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = useId();

  if (fieldDef.kind === 'media') {
    return <MediaConfigField label={fieldDef.label} value={typeof value === 'string' ? value : undefined} onChange={onChange} />;
  }

  if (fieldDef.kind === 'richtext') {
    return (
      <div className="flex flex-col gap-2">
        <Label>{fieldDef.label}</Label>
        <RichTextEditor value={typeof value === 'string' ? value : ''} onChange={(html) => onChange(html)} />
      </div>
    );
  }

  if (fieldDef.kind === 'textarea') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{fieldDef.label}</Label>
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={fieldDef.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  if (fieldDef.kind === 'number') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{fieldDef.label}</Label>
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          placeholder={fieldDef.placeholder}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{fieldDef.label}</Label>
      <Input
        id={id}
        type={fieldDef.kind === 'url' ? 'url' : 'text'}
        value={typeof value === 'string' ? value : ''}
        placeholder={fieldDef.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function MediaConfigField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (mediaId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: mediaItems } = useMediaList();
  const selected = mediaItems?.find((item) => item.id === value);

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {selected && selected.width && selected.height ? (
          <img src={mediaFileUrl(selected.id)} alt={selected.altText ?? selected.filename} className="size-14 rounded-md object-cover" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-md border border-dashed text-muted-foreground">
            <ImageOff className="size-4" />
          </div>
        )}
        <div className="flex gap-2">
          <MediaPickerDialog
            open={open}
            onOpenChange={setOpen}
            selectedId={value}
            onSelect={onChange}
            trigger={
              <Button type="button" variant="outline" size="sm">
                {selected ? 'Change' : 'Choose'}
              </Button>
            }
          />
          {selected ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
