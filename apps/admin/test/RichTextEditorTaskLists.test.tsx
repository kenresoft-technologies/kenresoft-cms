import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RichTextEditor } from '@/components/rich-text-editor';
import { markdownToHtml, normalizeTaskListHtml } from '@/lib/rich-text-markdown';

function Harness({ initial = '', onValue }: { initial?: string; onValue: (html: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RichTextEditor
        value={value}
        onChange={(html) => {
          setValue(html);
          onValue(html);
        }}
      />
    </QueryClientProvider>
  );
}

function parse(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function taskItems(html: string) {
  return [...parse(html).querySelectorAll('li[data-type="taskItem"]')].map((item) => ({
    checked: item.getAttribute('data-checked'),
    text: item.textContent?.trim(),
  }));
}

describe('markdownToHtml task lists', () => {
  it('converts a tight task list', () => {
    const html = markdownToHtml('- [ ] todo\n- [x] done');
    expect(parse(html).querySelector('ul[data-type="taskList"]')).not.toBeNull();
    expect(taskItems(html)).toEqual([
      { checked: 'false', text: 'todo' },
      { checked: 'true', text: 'done' },
    ]);
    expect(html).not.toContain('<input');
  });

  // A blank line between items makes marked emit a "loose" list, wrapping each item's content
  // (checkbox included) in a <p> — the shape most blog posts written in a text editor produce.
  it('converts a loose task list whose checkboxes sit inside <p>', () => {
    const html = markdownToHtml('- [ ] first\n\n- [x] second');
    expect(taskItems(html)).toEqual([
      { checked: 'false', text: 'first' },
      { checked: 'true', text: 'second' },
    ]);
    expect(html).not.toContain('<input');
  });

  it('turns an ordered task list into a task list Tiptap can hold', () => {
    const html = markdownToHtml('1. [ ] one\n2. [x] two');
    const root = parse(html);
    expect(root.querySelector('ol')).toBeNull();
    expect(root.querySelector('ul[data-type="taskList"]')).not.toBeNull();
    expect(taskItems(html)).toHaveLength(2);
  });

  it('splits a list mixing task and plain items instead of mislabeling the plain ones', () => {
    const html = markdownToHtml('- plain\n- [x] task\n- another plain');
    const lists = [...parse(html).children].filter((el) => el.tagName === 'UL');
    expect(lists.map((list) => list.getAttribute('data-type'))).toEqual([null, 'taskList', null]);
    expect(taskItems(html)).toEqual([{ checked: 'true', text: 'task' }]);
  });

  it('handles task items nested under a plain bullet', () => {
    const html = markdownToHtml('- parent\n  - [ ] child');
    const root = parse(html);
    expect(root.querySelector(':scope > ul')?.getAttribute('data-type')).toBeNull();
    expect(root.querySelector('ul ul[data-type="taskList"]')).not.toBeNull();
    expect(taskItems(html)).toEqual([{ checked: 'false', text: 'child' }]);
  });

  it('leaves Tiptap-shaped task lists untouched', () => {
    const tiptap =
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>';
    expect(normalizeTaskListHtml(tiptap)).toBe(tiptap);
  });
});

describe('RichTextEditor task lists', () => {
  async function switchTo(user: ReturnType<typeof userEvent.setup>, mode: string) {
    await user.click(screen.getByRole('combobox', { name: 'Editor mode' }));
    await user.click(await screen.findByRole('option', { name: mode }));
  }

  it('keeps checkboxes from a loose Markdown task list after switching back to Write', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await screen.findByRole('combobox', { name: 'Editor mode' });
    await switchTo(user, 'Markdown');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '## Checklist\n\n- [ ] Book venue\n\n- [x] Send invites\n' },
    });
    await switchTo(user, 'Write');

    await waitFor(() => expect(onValue).toHaveBeenCalled());
    const html = onValue.mock.calls.at(-1)![0] as string;
    expect(taskItems(html)).toEqual([
      { checked: 'false', text: 'Book venue' },
      { checked: 'true', text: 'Send invites' },
    ]);
  });

  it('recognizes GFM checkbox HTML pasted into HTML mode', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await screen.findByRole('combobox', { name: 'Editor mode' });
    await switchTo(user, 'HTML');
    fireEvent.change(screen.getByLabelText('HTML source'), {
      target: { value: '<ul><li><input type="checkbox" checked disabled> shipped</li></ul>' },
    });
    await switchTo(user, 'Write');

    await waitFor(() => expect(onValue).toHaveBeenCalled());
    expect(taskItems(onValue.mock.calls.at(-1)![0] as string)).toEqual([{ checked: 'true', text: 'shipped' }]);
  });

  const EDITOR_CHECKLIST =
    '<ol start="3"><li><p>three</p></li></ol><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done task</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>open task</p><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>sub task</p></div></li></ul></div></li></ul>';

  // What a save stores: the flat one-line shape, then run through apps/api's sanitizer (which adds
  // the checkbox's inline style). And the <label>/<div> shape saved before the flat one existed.
  const STORED_CHECKLISTS = {
    flat: '<ol start="3"><li><p>three</p></li></ol><ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" disabled checked style="display: inline-block; width: auto; margin: 0 0.4em 0 0">done task</li><li data-checked="false" data-type="taskItem"><input type="checkbox" disabled style="display: inline-block; width: auto; margin: 0 0.4em 0 0">open task<ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" disabled checked style="display: inline-block; width: auto; margin: 0 0.4em 0 0">sub task</li></ul></li></ul>',
    label:
      '<ol start="3"><li><p>three</p></li></ol><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" disabled checked><span></span></label><div><p>done task</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox" disabled><span></span></label><div><p>open task</p><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" disabled checked><span></span></label><div><p>sub task</p></div></li></ul></div></li></ul>',
  };

  // Reopening a saved entry must give back the same checklist, nesting and checked states
  // included, not a plain bullet list.
  it.each(Object.entries(STORED_CHECKLISTS))('reopens a saved checklist (%s shape) unchanged', async (_shape, stored) => {
    const user = userEvent.setup();
    render(<Harness initial={stored} onValue={vi.fn()} />);

    await screen.findByRole('combobox', { name: 'Editor mode' });
    await switchTo(user, 'HTML');
    expect((screen.getByLabelText('HTML source') as HTMLTextAreaElement).value).toBe(EDITOR_CHECKLIST);
  });

  // The saved shape must render on one line with no site CSS: checkbox directly in the <li>,
  // followed by the text, bullets off. No <label>/<div>/<p> block inside the item.
  it('saves checklists in the flat shape that renders on one line without CSS', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await screen.findByRole('combobox', { name: 'Editor mode' });
    await switchTo(user, 'HTML');
    fireEvent.change(screen.getByLabelText('HTML source'), { target: { value: EDITOR_CHECKLIST } });
    await switchTo(user, 'Write');

    await waitFor(() => expect(onValue).toHaveBeenCalled());
    expect(onValue.mock.calls.at(-1)![0]).toBe(
      '<ol start="3"><li><p>three</p></li></ol><ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" checked="checked" disabled="">done task</li><li data-checked="false" data-type="taskItem"><input type="checkbox" disabled="">open task<ul data-type="taskList" style="list-style: none"><li data-checked="true" data-type="taskItem"><input type="checkbox" checked="checked" disabled="">sub task</li></ul></li></ul>' +
        // Tiptap's trailing node: a document ending in a list always gets an empty paragraph.
        '<p></p>',
    );
  });

  it('renders stored GFM checkbox HTML (e.g. from an API import) as a task list', async () => {
    const user = userEvent.setup();
    render(<Harness initial={'<ul><li><input type="checkbox" disabled> imported</li></ul>'} onValue={vi.fn()} />);

    await screen.findByRole('combobox', { name: 'Editor mode' });
    await switchTo(user, 'HTML');
    const source = (screen.getByLabelText('HTML source') as HTMLTextAreaElement).value;
    expect(source).toMatch(/<ul data-type="taskList"><li data-checked="false" data-type="taskItem">.*imported/);
  });
});
