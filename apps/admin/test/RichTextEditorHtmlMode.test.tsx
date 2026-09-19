import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RichTextEditor } from '@/components/rich-text-editor';

function Harness({ onValue }: { onValue: (html: string) => void }) {
  const [value, setValue] = useState('');
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

describe('RichTextEditor HTML mode', () => {
  it('applies pasted HTML through the editor schema, dropping scripts and handlers', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await user.click(await screen.findByRole('combobox', { name: 'Editor mode' }));
    await user.click(await screen.findByRole('option', { name: 'HTML' }));
    fireEvent.change(screen.getByLabelText('HTML source'), {
      target: {
        value: '<h2>Hello</h2><p onclick="alert(1)">Body <strong>bold</strong></p><script>alert(2)</script>',
      },
    });
    await user.click(screen.getByRole('combobox', { name: 'Editor mode' }));
    await user.click(await screen.findByRole('option', { name: 'Preview' }));

    await waitFor(() => expect(onValue).toHaveBeenCalled());
    const html = onValue.mock.calls.at(-1)![0] as string;
    expect(html).toContain('<h2>Hello</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(document.querySelector('script')).toBeNull();
  });
});
