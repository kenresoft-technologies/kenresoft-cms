import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { RichTextEditor } from '@/components/rich-text-editor';

const SAMPLE = `<h2>Heading two</h2><h3>Heading three</h3><h4>Heading four</h4>
<p>Plain <strong>bold</strong> <em>italic</em> <s>strike</s> <u>under</u> <mark>highlight</mark> <code>inline</code> <a href="https://x.com">link</a></p>
<p style="text-align: center">Centered para</p>
<p>Line one<br>line two</p>
<blockquote><p>Quote</p></blockquote>
<ul><li><p>bullet</p><ul><li><p>nested</p></li></ul></li></ul>
<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>
<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>done task</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>open task</p><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>sub task</p></div></li></ul></div></li></ul>
<pre><code class="language-ts">const a = 1;</code></pre>
<hr>
<img src="https://x.com/a.png" alt="alt text" title="t">
<table><tbody><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>
<p>Special chars: 5 * 3 _under_ [brackets] &lt;tag&gt; #hash</p>`.replace(/\n/g, '');

function Harness() {
  const [value, setValue] = useState(SAMPLE);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RichTextEditor value={value} onChange={setValue} />
    </QueryClientProvider>
  );
}

async function switchTo(user: ReturnType<typeof userEvent.setup>, mode: string) {
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }));
  await user.click(await screen.findByRole('option', { name: mode }));
}

// Switching Write -> Markdown -> Write with no edits must not change the document: every format
// the toolbar can produce, including ones Markdown has no syntax for (underline, highlight,
// alignment), must survive, along with literal angle-bracket text.
it('round-trips every editor format through Markdown mode unchanged', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole('combobox', { name: 'Editor mode' });
  await switchTo(user, 'HTML');
  const before = (screen.getByLabelText('HTML source') as HTMLTextAreaElement).value;
  await switchTo(user, 'Markdown');
  const md = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
  await switchTo(user, 'HTML');
  const after = (screen.getByLabelText('HTML source') as HTMLTextAreaElement).value;
  expect(md).toContain('<u>under</u> <mark>highlight</mark>');
  expect(md).toContain('&lt;tag>');
  expect(md).toContain('*   [x] done task');
  expect(after).toBe(before);
}, 30000);
