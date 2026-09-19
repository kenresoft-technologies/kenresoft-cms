import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, uploadMock, postMock, roleRef } = vi.hoisted(() => ({
  getMock: vi.fn(),
  uploadMock: vi.fn(),
  postMock: vi.fn(),
  roleRef: { current: 'admin' },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: getMock, upload: uploadMock, post: postMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: roleRef.current, email: 'me@example.test' } } }),
  },
}));
vi.mock('@/components/rich-text-editor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (v: string) => void }) => (
    <textarea aria-label="Body" onChange={(e) => onChange(`<p>${e.target.value}</p>`)} />
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MemoryRouter } from 'react-router';

import { EmailPage } from '@/pages/EmailPage';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EmailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    uploadMock.mockReset();
    postMock.mockReset();
    roleRef.current = 'admin';
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 15728640, maxFiles: 10 });
      if (path.endsWith('/settings')) {
        return Promise.resolve({ emailSenderName: 'Acme', emailSenderEmail: 'hello@acme.test' });
      }
      return Promise.resolve([]);
    });
    uploadMock.mockResolvedValue({ from: 'Acme <hello@acme.test>' });
    postMock.mockResolvedValue({ html: '<table><tr><td>safe</td></tr></table>' });
  });

  it('shows the configured sender and sends the composed email as multipart', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Acme <hello@acme.test>')).toBeInTheDocument();
    await user.type(screen.getByLabelText('To'), 'someone@example.test');
    await user.type(screen.getByLabelText('Subject'), 'Hello');
    await user.type(screen.getByLabelText('Reply-To'), 'me@zoho.test');
    await user.type(screen.getByLabelText('Body'), 'Hi there');
    await user.click(screen.getByRole('button', { name: /send email/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const [path, form] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/api/v1/admin/email/send');
    expect(form.get('to')).toBe('someone@example.test');
    expect(form.get('subject')).toBe('Hello');
    expect(form.get('replyTo')).toBe('me@zoho.test');
    expect(form.get('bodyHtml')).toContain('Hi there');
    expect(form.get('designHtml')).toBeNull();
  });

  it('lets an admin paste an HTML template, previews the sanitized result, and sends it as designHtml', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: 'Format' }));
    await user.click(await screen.findByRole('option', { name: /design html/i }));

    await user.type(screen.getByLabelText('To'), 'someone@example.test');
    await user.type(screen.getByLabelText('Subject'), 'Newsletter');
    fireEvent.change(screen.getByLabelText('HTML template'), {
      target: { value: '<table><tr><td onclick="x()">hi</td></tr></table>' },
    });

    // The preview frame is fully sandboxed and shows the server's output, not the pasted markup.
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email/sanitize-preview', {
        html: '<table><tr><td onclick="x()">hi</td></tr></table>',
      }),
    );
    const frame = screen.getByTitle('Sanitized HTML preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('<td>safe</td>'));
    expect(frame.getAttribute('srcdoc')).not.toContain('onclick');

    await user.click(screen.getByRole('button', { name: /send email/i }));
    // A designed email needs an explicit confirmation before it is sent.
    expect(uploadMock).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const [, form] = uploadMock.mock.calls[0] as [string, FormData];
    expect(form.get('designHtml')).toBe('true');
    expect(form.get('bodyHtml')).toContain('<table>');
  });

  it('does not offer Design HTML to non-admins', async () => {
    roleRef.current = 'editor';
    renderPage();
    await screen.findByLabelText('To');
    expect(screen.queryByRole('combobox', { name: 'Format' })).toBeNull();
    expect(screen.queryByLabelText('HTML template')).toBeNull();
  });
});
