import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import TiptapImage from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  FileCode,
  Columns3,
  Eye,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Image as ImageIcon,
  Info,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minus,
  Minimize2,
  Pencil,
  Quote,
  Redo,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Undo,
} from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { htmlToMarkdown, markdownToHtml } from '@/lib/rich-text-markdown';
import { mediaFileUrl } from '@/lib/queries/media';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MediaPickerDialog } from '@/components/media-picker-dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const lowlight = createLowlight(common);

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

type Editor = NonNullable<ReturnType<typeof useEditor>>;
type Mode = 'write' | 'preview' | 'markdown' | 'html';

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

function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

function LinkButton({ editor }: { editor: Editor }) {
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

// Inserting a rich-text image is choosing among files already in the Media Library — the same
// roomy picker every other media reference in the CMS uses.
function ImageButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  return (
    <MediaPickerDialog
      open={open}
      onOpenChange={setOpen}
      title="Insert image"
      onSelect={(mediaId, item) => {
        editor
          .chain()
          .focus()
          .setImage({ src: mediaFileUrl(mediaId), alt: item.altText ?? item.filename })
          .run();
      }}
      trigger={
        <ToolbarButton label="Image" onClick={() => setOpen(true)}>
          <ImageIcon />
        </ToolbarButton>
      }
    />
  );
}

function TableButtons({ editor }: { editor: Editor }) {
  const inTable = editor.isActive('table');

  return (
    <>
      <ToolbarButton
        label="Insert table"
        disabled={inTable}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 />
      </ToolbarButton>
      {inTable ? (
        <>
          <ToolbarButton label="Add row" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows3 />
          </ToolbarButton>
          <ToolbarButton label="Add column" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns3 />
          </ToolbarButton>
          <ToolbarButton label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 />
          </ToolbarButton>
        </>
      ) : null}
    </>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-input p-1">
      <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
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
        label="Highlight"
        active={editor.isActive('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter />
      </ToolbarButton>

      <ToolbarSeparator />

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
        label="Heading 4"
        active={editor.isActive('heading', { level: 4 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Align left"
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft />
      </ToolbarButton>
      <ToolbarButton
        label="Align center"
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter />
      </ToolbarButton>
      <ToolbarButton
        label="Align right"
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight />
      </ToolbarButton>

      <ToolbarSeparator />

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
        label="Task list"
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code />
      </ToolbarButton>

      <ToolbarSeparator />

      <LinkButton editor={editor} />
      <ImageButton editor={editor} />
      <TableButtons editor={editor} />

      <ToolbarSeparator />

      <ToolbarButton label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus />
      </ToolbarButton>
      <ToolbarButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo />
      </ToolbarButton>
    </div>
  );
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

// The rich_text field's editor (docs/ARCHITECTURE.md §25's "Tiptap" stack decision). Content is
// still stored and returned as an HTML string — the Markdown mode below is a view/edit
// convenience layered on top via standalone converters (lib/rich-text-markdown.ts), not a
// change to that storage format, so every existing consumer (examples/astro-site's set:html,
// this same field's Preview-tab rendering) keeps working unmodified. ProseMirror's schema
// (StarterKit's node/mark set plus the extensions below) makes the generated HTML inherently
// safe from arbitrary script injection — there's no way to produce a <script> tag or an
// event-handler attribute through normal editing, paste, or this component's own toolbar.
//
// Markdown typing shortcuts (`# `, `**bold**`, `- `, `1. `, `> `, `` ``` ``, `---`, ...) need no
// extra code here — they're StarterKit's own built-in input rules, already active.
export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const [mode, setMode] = useState<Mode>('write');
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [htmlDraft, setHtmlDraft] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  // Tracks the HTML this editor itself last emitted, so the sync effect below only resets the
  // document when `value` changed for a reason other than this editor's own typing (switching
  // entries, restoring a revision) — resetting on every keystroke would fight the user's cursor.
  const lastEmitted = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        // Replaced by CodeBlockLowlight below for syntax highlighting — StarterKit's own
        // codeBlock would otherwise register the same node twice.
        codeBlock: false,
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        protocols: ['http', 'https', 'mailto'],
      }),
      TiptapImage,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      CodeBlockLowlight.configure({ lowlight }),
      CharacterCount,
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
        class: cn('px-2.5 py-2 text-base outline-none md:text-sm', !fullscreen && 'min-h-32'),
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

  function switchMode(next: Mode) {
    if (!editor) return;
    if (mode === 'markdown' && next !== 'markdown') {
      // Applying the edited Markdown back into the real ProseMirror doc — emitUpdate (the
      // default) fires onUpdate above, so `onChange` sees this exactly like any other edit.
      editor.commands.setContent(markdownToHtml(markdownDraft));
    } else if (next === 'markdown') {
      setMarkdownDraft(htmlToMarkdown(editor.getHTML()));
    }
    // Same apply-on-leave contract as Markdown: pasted/edited HTML goes through the editor's own
    // schema, so only supported markup survives (no scripts, event handlers, or unknown tags).
    if (mode === 'html' && next !== 'html') {
      editor.commands.setContent(htmlDraft);
    } else if (next === 'html') {
      setHtmlDraft(editor.getHTML());
    }
    setMode(next);
  }

  const characters = editor.storage.characterCount.characters();
  const words = editor.storage.characterCount.words();

  return (
    <div
      data-testid="rich-text-editor"
      className={cn(
        'flex flex-col rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        // Only when not fullscreen — dark:bg-input/30 (a translucent tint meant for the normal
        // bordered-input look) was previously applied unconditionally, competing with
        // fullscreen's own bg-popover on the same element. Invisible in light mode (--input and
        // --popover are both near-white there) but a real, visible clash in dark mode.
        !fullscreen && 'dark:bg-input/30',
        // z-40, not z-50 — Radix dialogs/popovers (the Image button, Link popover) use z-50, so
        // they need to stack above this even while it's fullscreen, not tie with it.
        fullscreen && 'fixed inset-4 z-40 bg-popover shadow-xl',
      )}
    >
      {/* flex-wrap: the mode-tab group + word count + fullscreen button never fit on one line
          in a narrow column (e.g. SubmissionDetailPage's ~40%-width Reply card on mobile) —
          without this, the row simply forces its own intrinsic width past the container,
          dragging the whole page wider than the viewport instead of wrapping to a second line. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-input p-1">
        {/* A dropdown rather than a tab per mode: four modes no longer fit the header row on narrow
            screens, and a single control scales to more modes later. */}
        <Select value={mode} onValueChange={(next) => switchMode(next as Mode)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Editor mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="write">
              <Pencil className="size-3.5" /> Write
            </SelectItem>
            <SelectItem value="preview">
              <Eye className="size-3.5" /> Preview
            </SelectItem>
            <SelectItem value="markdown">
              <Code className="size-3.5" /> Markdown
            </SelectItem>
            <SelectItem value="html">
              <FileCode className="size-3.5" /> HTML
            </SelectItem>
          </SelectContent>
        </Select>
        {/* min-w-0 + truncate on the count: a flex child's default min-width:auto otherwise
            keeps it at its full text width even when the row has genuinely run out of room,
            which is exactly what pushed this row (and the whole page) wider than the viewport
            on a narrow phone — this way it shrinks and ellipsizes instead. */}
        <div className="flex min-w-0 items-center gap-2 pr-1">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {words} word{words === 1 ? '' : 's'} · {characters} character{characters === 1 ? '' : 's'}
          </span>
          <div className="shrink-0">
            <ToolbarButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setFullscreen((prev) => !prev)}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </ToolbarButton>
          </div>
        </div>
      </div>

      {mode === 'write' ? (
        <Toolbar editor={editor} />
      ) : (
        // Write mode's toolbar row has real height — without an equivalent here, switching to
        // Preview/Markdown visibly shrinks the whole panel, then grows it back on switching
        // away, which reads as broken rather than intentional.
        <div className="flex items-center gap-1.5 border-b border-input p-1 px-2.5 py-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {mode === 'preview'
            ? 'Rendered preview of the saved content — switch to Write to edit.'
            : mode === 'html'
              ? 'Paste or edit HTML — applied when you switch to Write or Preview. Unsupported tags, scripts and styles are dropped.'
              : 'Editing as Markdown — applied back to the document when you switch away.'}
        </div>
      )}

      {/* min-h-0 overrides flexbox's default min-height:auto, which otherwise lets this grow
          to fit its content instead of respecting flex-1's height and actually scrolling —
          the classic flex-child-with-overflow gotcha, invisible until fullscreen made this
          container's height fixed instead of intrinsic. */}
      <div className={cn('flex flex-1 flex-col', fullscreen ? 'min-h-0 overflow-y-auto' : 'h-80 max-h-[80vh] min-h-40 resize-y overflow-y-auto')}>
        {mode === 'write' ? (
          <EditorContent
            editor={editor}
            className={cn('flex-1 cursor-text', fullscreen && 'min-h-0 overflow-y-auto')}
            onClick={(event) => {
              // Clicking the empty area below the text should still put the cursor in the editor.
              if (event.target === event.currentTarget) editor.commands.focus('end');
            }}
          />
        ) : null}
        {mode === 'preview' ? (
          <div
            className={cn(
              'ProseMirror px-2.5 py-2 text-base md:text-sm',
              'min-h-32 flex-1',
            )}
            dangerouslySetInnerHTML={{ __html: editor.getHTML() }}
          />
        ) : null}
        {mode === 'html' ? (
          <textarea
            aria-label="HTML source"
            value={htmlDraft}
            onChange={(event) => setHtmlDraft(event.target.value)}
            spellCheck={false}
            placeholder="<h2>Paste HTML here</h2>"
            className={cn(
              'resize-none bg-transparent px-2.5 py-2 font-mono text-sm outline-none',
              'min-h-32 flex-1',
            )}
          />
        ) : null}
        {mode === 'markdown' ? (
          <textarea
            value={markdownDraft}
            onChange={(event) => setMarkdownDraft(event.target.value)}
            spellCheck={false}
            className={cn(
              'resize-none bg-transparent px-2.5 py-2 font-mono text-sm outline-none',
              'min-h-32 flex-1',
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
