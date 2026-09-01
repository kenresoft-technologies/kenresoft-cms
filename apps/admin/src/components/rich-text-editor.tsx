import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Only http(s)/mailto — the Link mark's own `protocols` option (below) mainly gates autolink
// detection, not a programmatic setLink() call, so this is checked again by hand before ever
// applying a URL the user typed, closing off a `javascript:`-URI XSS vector through this field.
function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value, 'https://example.com');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn('text-muted-foreground', active && 'bg-muted text-foreground')}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function LinkButton({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUrl(editor.getAttributes('link').href ?? '');
      }}
    >
      <PopoverTrigger asChild>
        <span>
          <ToolbarButton label="Link" active={editor.isActive('link')} onClick={() => setOpen(true)}>
            <LinkIcon />
          </ToolbarButton>
        </span>
      </PopoverTrigger>
      <PopoverContent className="flex w-72 gap-2 p-2" align="start">
        <Input
          autoFocus
          placeholder="https://…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (url && isSafeUrl(url)) editor.chain().focus().setLink({ href: url }).run();
            setOpen(false);
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (url && isSafeUrl(url)) editor.chain().focus().setLink({ href: url }).run();
            setOpen(false);
          }}
        >
          Apply
        </Button>
        {editor.isActive('link') ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setOpen(false);
            }}
          >
            Remove
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// The rich_text field's editor (docs/ARCHITECTURE.md §25's "Tiptap" stack decision) — content
// is stored and returned as an HTML string, same as every other consumer of this field already
// assumes (examples/astro-site's blog page renders it via `set:html`). ProseMirror's schema
// (StarterKit's node/mark set, plus Link below) makes the generated HTML inherently safe from
// arbitrary script injection — there's no way to produce a <script> tag or an event-handler
// attribute through normal editing, paste, or this component's own toolbar.
export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  // Tracks the HTML this editor itself last emitted, so the sync effect below only resets the
  // document when `value` changed for a reason other than this editor's own typing (switching
  // entries, restoring a revision) — resetting on every keystroke would fight the user's cursor.
  const lastEmitted = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        protocols: ['http', 'https', 'mailto'],
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write something…' }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: 'min-h-32 px-2.5 py-2 text-base outline-none md:text-sm',
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input p-1">
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <LinkButton editor={editor} />
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo />
        </ToolbarButton>
        <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
