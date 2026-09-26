import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// The Markdown view in rich-text-editor.tsx is a convenience alongside view/edit of the same
// content, not the field's storage format — that stays HTML, unchanged, so nothing downstream
// (examples/astro-site's set:html, the entry Preview tab) needs to know Markdown exists. Both
// conversions here are pure string transforms with no Tiptap/ProseMirror involvement, so the
// editor's own HTML-based content handling never has to change to support this.
const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndownService.use(gfm);

// Formatting the editor supports but Markdown has no syntax for — underline, highlight, and
// text alignment — would otherwise be silently stripped the moment someone opened Markdown mode
// and switched back. GFM allows raw inline/block HTML, so these are kept as HTML in the
// Markdown view instead; marked passes it through untouched on the way back and Tiptap's schema
// re-parses it (Underline/Highlight marks, TextAlign's `style="text-align: ..."`).
turndownService.keep(['u', 'mark']);
turndownService.addRule('alignedBlock', {
  filter: (node) =>
    /^(P|H[1-6])$/.test(node.nodeName) &&
    /text-align:\s*(center|right|justify)/.test(node.getAttribute('style') ?? ''),
  // One line, no blank lines inside: exactly what CommonMark needs to treat it as an HTML block.
  replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML.replace(/\n/g, ' ')}\n\n`,
});

// turndown escapes Markdown punctuation in text but not `<` or HTML entities, so literal text
// like "use the <div> tag" (stored as `&lt;div&gt;`) came out as a raw `<div>` in Markdown —
// which marked then parsed as a real tag and the editor's schema dropped, deleting the words
// outright. Backslash-escaping `<` and entity-shaped `&` keeps them literal text.
const baseEscape = turndownService.escape.bind(turndownService);
turndownService.escape = (text: string) =>
  baseEscape(text)
    .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/</g, '\\<');

// turndown-plugin-gfm's taskListItems rule only fires for a checkbox that's both a *direct*
// child of <li> and immediately followed by inline text (the flat shape a plain markdown
// parser produces) — Tiptap's TaskItem instead nests the checkbox inside a <label> and wraps
// the actual text in a sibling <div><p>...</p></div> block, so the rule silently never matches
// and a task list would otherwise turn into a plain bullet list, with the checked state lost
// entirely, the moment someone opens Markdown mode. This reshapes each task item into that
// flat form: drop the <label> (its real text lives in the sibling div, not itself), unwrap the
// div's first paragraph so its text sits directly under <li> right after the checkbox, and
// keep any further content (extra paragraphs, nested lists for sub-items) as later children.
function flattenTaskListHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  for (const item of container.querySelectorAll('li[data-type="taskItem"]')) {
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) continue;
    checkbox.closest('label')?.remove();
    checkbox.remove();

    const contentDiv = item.querySelector(':scope > div');
    if (contentDiv) {
      const firstParagraph = contentDiv.querySelector(':scope > p:first-child');
      if (firstParagraph) {
        while (firstParagraph.firstChild) contentDiv.insertBefore(firstParagraph.firstChild, firstParagraph);
        firstParagraph.remove();
      }
      while (contentDiv.firstChild) item.appendChild(contentDiv.firstChild);
      contentDiv.remove();
    }

    item.insertBefore(checkbox, item.firstChild);
  }

  return container.innerHTML;
}

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(flattenTaskListHtml(html || '<p></p>'));
}

// Tiptap's TaskItem only recognizes its own `data-type="taskItem"`/`data-checked` shape (see
// apps/admin/src/components/rich-text-editor.tsx's TaskItem config), not the plain
// `<li><input type="checkbox">` GFM shape marked (and most Markdown tools) produce — left as-is,
// Tiptap drops the checkbox and a `- [ ] todo` line silently downgrades to a plain bullet. This
// rewrites that shape into Tiptap's, covering every variant marked actually emits:
// - a tight list (`<li><input> text</li>`) and a *loose* one — a blank line between items makes
//   marked wrap each item's content, checkbox included, in a <p> (`<li><p><input> text</p>`);
// - an ordered list (`1. [ ] step`) — Tiptap's taskList is always a <ul>, so it becomes one;
// - a list mixing task and plain items — split into consecutive runs, since a taskList may
//   only hold taskItems and a plain item must not gain a checkbox it never had.
// Tiptap's own output (checkbox inside a <label>) is already recognized and left untouched.
function taskCheckbox(item: Element): HTMLInputElement | null {
  const direct = item.querySelector(':scope > input[type="checkbox"]');
  if (direct instanceof HTMLInputElement) return direct;
  const inParagraph = item.querySelector(':scope > p:first-child > input[type="checkbox"]:first-child');
  return inParagraph instanceof HTMLInputElement ? inParagraph : null;
}

function convertTaskItem(item: Element, checkbox: HTMLInputElement): void {
  item.setAttribute('data-type', 'taskItem');
  item.setAttribute('data-checked', String(checkbox.hasAttribute('checked') || checkbox.checked));
  const next = checkbox.nextSibling;
  if (next?.nodeType === Node.TEXT_NODE) next.textContent = (next.textContent ?? '').replace(/^\s+/, '');
  checkbox.remove();
}

function normalizeList(list: Element): void {
  if (list.getAttribute('data-type') === 'taskList') return;
  const items = [...list.children]
    .filter((child) => child.tagName === 'LI')
    .map((item) => ({ item, task: taskCheckbox(item) !== null }));
  if (!items.some(({ task }) => task)) return;

  const doc = list.ownerDocument;
  const runs: { task: boolean; items: Element[] }[] = [];
  for (const { item, task } of items) {
    const last = runs.at(-1);
    if (last && last.task === task) last.items.push(item);
    else runs.push({ task, items: [item] });
  }

  const ordered = list.tagName === 'OL';
  let position = Number(list.getAttribute('start') ?? '1') || 1;
  const replacements = runs.map((run) => {
    const next = doc.createElement(run.task || !ordered ? 'ul' : 'ol');
    if (run.task) next.setAttribute('data-type', 'taskList');
    else if (ordered && position !== 1) next.setAttribute('start', String(position));
    for (const item of run.items) {
      if (run.task) convertTaskItem(item, taskCheckbox(item)!);
      next.appendChild(item);
    }
    position += run.items.length;
    return next;
  });
  list.replaceWith(...replacements);
}

export function normalizeTaskListHtml(html: string): string {
  if (!html || !/type=["']?checkbox/i.test(html)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  // Innermost lists first, so replacing an outer list never detaches one still to be visited.
  for (const list of [...container.querySelectorAll('ul, ol')].reverse()) normalizeList(list);
  return container.innerHTML;
}

// Two more shape mismatches between marked's output and Tiptap's schema, each of which made a
// plain Write -> Markdown -> Write switch change the document even with no edits:
// - marked wraps a standalone image in <p>, but Tiptap's Image is a block node, so it split
//   that paragraph and left an empty <p> behind on every round trip;
// - marked ends every fenced code block's text with "\n", which Tiptap keeps as a trailing
//   blank line inside the block, growing by one line each round trip.
function fixUpBlockShapes(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  for (const paragraph of container.querySelectorAll('p')) {
    const images = paragraph.querySelectorAll(':scope > img');
    const onlyImages =
      images.length > 0 &&
      [...paragraph.childNodes].every(
        (node) => node instanceof HTMLImageElement || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
      );
    if (onlyImages) paragraph.replaceWith(...images);
  }

  for (const code of container.querySelectorAll('pre > code')) {
    const last = code.lastChild;
    if (last?.nodeType === Node.TEXT_NODE && last.textContent?.endsWith('\n')) {
      last.textContent = last.textContent.slice(0, -1);
    }
  }

  return container.innerHTML;
}

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return normalizeTaskListHtml(fixUpBlockShapes(html));
}
