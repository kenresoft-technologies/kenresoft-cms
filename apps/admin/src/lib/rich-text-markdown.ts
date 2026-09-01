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

// Tiptap's TaskItem only recognizes its own `data-checked` attribute shape (see
// apps/admin/src/components/rich-text-editor.tsx's TaskItem config), not the plain
// `<li><input type="checkbox">` markdown-it/marked produce for GFM task lists — rewriting that
// shape here is what makes a `- [ ] todo` line typed in Markdown mode come back as a real,
// interactive task item instead of silently downgrading to a plain bullet the moment someone
// switches back to Write mode.
function fixUpTaskListHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  for (const item of container.querySelectorAll('li')) {
    const checkbox = item.querySelector(':scope > input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) continue;

    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', String(checkbox.checked));
    checkbox.remove();

    const parentList = item.parentElement;
    if (parentList && parentList.tagName === 'UL') {
      parentList.setAttribute('data-type', 'taskList');
    }
  }

  return container.innerHTML;
}

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return fixUpTaskListHtml(html);
}
