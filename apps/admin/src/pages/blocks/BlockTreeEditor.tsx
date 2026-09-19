import { useId, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, GripVertical, ImageOff, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';

import { useRawHtmlAccess } from '@/lib/raw-html-access';
import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import { useReusableBlocks } from '@/lib/queries/reusable-blocks';
import type { BlockInstance, BlockType, ChildBlockInstance } from '@/lib/types';
import { MediaPickerDialog } from '@/components/media-picker-dialog';
import { RawHtmlField } from '@/components/raw-html-field';
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

function cloneChildWithNewId(child: ChildBlockInstance): ChildBlockInstance {
  return { ...child, id: newBlockId() };
}

// A block's own children never move to another block (§14 decision #3's two-tier cap has no
// cross-container concept to move between) — cloning a container block only needs fresh ids for
// itself and each of its own children, never a deeper walk.
function cloneBlockWithNewId(block: BlockInstance): BlockInstance {
  return {
    ...block,
    id: newBlockId(),
    children: block.children?.map(cloneChildWithNewId),
  };
}

// Phase 8 of the schema-driven frontend work (docs/SITE_BUILDER.md §14 decision #3): replaces
// Phase 3's button-based add/remove/reorder editing UI with drag-and-drop reordering (dnd-kit,
// the same pattern ContentTypeDetailPage.tsx's field list already established — pointer sensor
// only, no keyboard sensor, matching that precedent exactly), duplicate, and undo/redo — the
// underlying `(blocks, onChange)` controlled-component contract and the Page/Block data model
// itself are completely unchanged, exactly as §14 required when this phase was deferred.
//
// One `DndContext` wraps the whole tree rather than one per nesting level: top-level blocks and
// a container block's own children are two independent `SortableContext`s sharing it, and
// `handleDragEnd` below resolves which list a dragged id belongs to before reordering — blocks
// never move between the two lists (there's no cross-container concept to support, per the
// two-tier nesting cap), so this stays a plain lookup rather than full multi-container dnd-kit
// machinery.
export function BlockTreeEditor({ blocks, onChange }: BlockTreeEditorProps) {
  const [history, setHistory] = useState<BlockInstance[][]>([]);
  const [future, setFuture] = useState<BlockInstance[][]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Every mutation funnels through this instead of calling onChange directly, so undo/redo can
  // reconstruct history without changing what the parent (PageEditorPage) ever sees — it still
  // just gets a new `blocks` array. History resets on remount (PageEditorPage keys its form by
  // page id), which is the right scope: undo/redo is an editing-session convenience, not
  // something that needs to survive navigating away and back.
  function emitChange(next: BlockInstance[]) {
    setHistory((h) => [...h, blocks]);
    setFuture([]);
    onChange(next);
  }

  function undo() {
    const previous = history.at(-1);
    if (previous === undefined) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [blocks, ...f]);
    onChange(previous);
  }

  function redo() {
    const next = future.at(0);
    if (next === undefined) return;
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, blocks]);
    onChange(next);
  }

  function addBlock(type: BlockType) {
    emitChange([...blocks, { id: newBlockId(), type, config: {} }]);
  }

  function removeBlock(index: number) {
    emitChange(blocks.filter((_, i) => i !== index));
  }

  function duplicateBlock(index: number) {
    const copy = cloneBlockWithNewId(blocks[index]!);
    emitChange([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
  }

  function updateBlock(index: number, patch: Partial<BlockInstance>) {
    emitChange(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const topIndex = blocks.findIndex((block) => block.id === active.id);
    if (topIndex !== -1) {
      const overIndex = blocks.findIndex((block) => block.id === over.id);
      if (overIndex === -1) return;
      emitChange(arrayMove(blocks, topIndex, overIndex));
      return;
    }

    for (let i = 0; i < blocks.length; i++) {
      const children = blocks[i]!.children ?? [];
      const childIndex = children.findIndex((child) => child.id === active.id);
      if (childIndex === -1) continue;
      const overChildIndex = children.findIndex((child) => child.id === over.id);
      if (overChildIndex === -1) return;
      const reordered = arrayMove(children, childIndex, overChildIndex);
      emitChange(blocks.map((block, idx) => (idx === i ? { ...block, children: reordered } : block)));
      return;
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 self-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={history.length === 0}
            onClick={undo}
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={future.length === 0}
            onClick={redo}
          >
            <Redo2 />
          </Button>
        </div>

        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, index) => (
            <BlockCard
              key={block.id}
              block={block}
              onConfigChange={(config) => updateBlock(index, { config })}
              onChildrenChange={(children) => updateBlock(index, { children })}
              onRemove={() => removeBlock(index)}
              onDuplicate={() => duplicateBlock(index)}
              onEmitChildren={(children) => emitChange(blocks.map((b, i) => (i === index ? { ...b, children } : b)))}
            />
          ))}
        </SortableContext>
        <AddBlockControl onAdd={addBlock} />
      </div>
    </DndContext>
  );
}

function AddBlockControl({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [selected, setSelected] = useState<BlockType>(BLOCK_TYPE_REGISTRY[0]!.type);
  // Raw HTML can only be added when the deployment has enabled it and the user is an admin (the
  // server enforces both; this just avoids offering an action that would be refused).
  const { enabled: rawHtmlEnabled, isAdmin } = useRawHtmlAccess();
  const available = BLOCK_TYPE_REGISTRY.filter((def) => def.type !== 'rawHtml' || (rawHtmlEnabled && isAdmin));

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
      <Select value={selected} onValueChange={(value) => setSelected(value as BlockType)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {available.map((def) => (
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
  onDuplicate: () => void;
  // Child add/remove/duplicate bypass the parent's own history-tracked updateBlock (which only
  // patches `config`/`children` as a plain field, not through emitChange) — they call this to
  // route through BlockTreeEditor's undo/redo stack the same way every other mutation does.
  onEmitChildren: (children: ChildBlockInstance[]) => void;
}

function BlockCard({ block, onConfigChange, onChildrenChange, onRemove, onDuplicate, onEmitChildren }: BlockCardProps) {
  const def = getBlockTypeDef(block.type);
  const children = block.children ?? [];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  function addChild(type: BlockType) {
    onEmitChildren([...children, { id: newBlockId(), type, config: {} }]);
  }

  function removeChild(index: number) {
    onEmitChildren(children.filter((_, i) => i !== index));
  }

  function duplicateChild(index: number) {
    const copy = cloneChildWithNewId(children[index]!);
    onEmitChildren([...children.slice(0, index + 1), copy, ...children.slice(index + 1)]);
  }

  function updateChildConfig(index: number, config: Record<string, unknown>) {
    onChildrenChange(children.map((child, i) => (i === index ? { ...child, config } : child)));
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border p-4 ${isDragging ? 'relative z-10 bg-muted' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder ${def?.label ?? block.type}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <p className="text-sm font-medium">{def?.label ?? block.type}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={`Duplicate ${def?.label ?? block.type}`} onClick={onDuplicate}>
            <Copy />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <BlockConfigForm fields={def?.fields ?? []} config={block.config} onChange={onConfigChange} />

      {isContainerBlockType(block.type) ? (
        <div className="mt-4 flex flex-col gap-3 border-l-2 pl-4">
          <SortableContext items={children.map((child) => child.id)} strategy={verticalListSortingStrategy}>
            {children.map((child, index) => (
              <ChildBlockCard
                key={child.id}
                child={child}
                onConfigChange={(config) => updateChildConfig(index, config)}
                onRemove={() => removeChild(index)}
                onDuplicate={() => duplicateChild(index)}
              />
            ))}
          </SortableContext>
          <AddBlockControl onAdd={addChild} />
        </div>
      ) : null}
    </div>
  );
}

function ChildBlockCard({
  child,
  onConfigChange,
  onRemove,
  onDuplicate,
}: {
  child: ChildBlockInstance;
  onConfigChange: (config: Record<string, unknown>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const childDef = getBlockTypeDef(child.type);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: child.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border p-3 ${isDragging ? 'relative z-10 bg-muted' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder ${childDef?.label ?? child.type}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <p className="text-xs font-medium text-muted-foreground">{childDef?.label ?? child.type}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Duplicate ${childDef?.label ?? child.type}`}
            onClick={onDuplicate}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <BlockConfigForm fields={childDef?.fields ?? []} config={child.config} onChange={onConfigChange} />
    </div>
  );
}

interface BlockConfigFormProps {
  fields: BlockFieldDef[];
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

// Exported so ReusableBlocksPage can reuse the same per-type config form for a reusable
// block's own {type, config} pair, rather than duplicating this dispatch a second time.
export function BlockConfigForm({ fields, config, onChange }: BlockConfigFormProps) {
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

  if (fieldDef.kind === 'reusableBlock') {
    return (
      <ReusableBlockConfigField
        label={fieldDef.label}
        value={typeof value === 'string' ? value : undefined}
        onChange={onChange}
      />
    );
  }

  if (fieldDef.kind === 'rawhtml') {
    return (
      <RawHtmlField label={fieldDef.label} value={typeof value === 'string' ? value : ''} onChange={(html) => onChange(html)} />
    );
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

function ReusableBlockConfigField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (reusableBlockId: string | undefined) => void;
}) {
  const { data: reusableBlocks } = useReusableBlocks();

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {reusableBlocks && reusableBlocks.length > 0 ? (
        <Select value={value ?? ''} onValueChange={(next) => onChange(next || undefined)}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a reusable block…" />
          </SelectTrigger>
          <SelectContent>
            {reusableBlocks.map((block) => (
              <SelectItem key={block.id} value={block.id}>
                {block.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">
          No reusable blocks yet — create one on the Reusable Blocks page first.
        </p>
      )}
    </div>
  );
}
