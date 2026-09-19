import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, uploadMock } = vi.hoisted(() => ({ getMock: vi.fn(), uploadMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: getMock, upload: uploadMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { role: 'admin', email: 'me@example.test' } } }) },
}));
vi.mock('@/components/rich-text-editor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (v: string) => void }) => (
    <textarea aria-label="Body" onChange={(e) => onChange(`<p>${e.target.value}</p>`)} />
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmailPage } from '@/pages/EmailPage';

describe('EmailPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    uploadMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.endsWith('/email/limits')) return Promise.resolve({ configured: true, maxTotalBytes: 15728640, maxFiles: 10 });
      if (path.endsWith('/settings')) {
        return Promise.resolve({ emailSenderName: 'Acme', emailSenderEmail: 'hello@acme.test' });
      }
      return Promise.resolve([]);
    });
    uploadMock.mockResolvedValue({ from: 'Acme <hello@acme.test>' });
  });

  it('shows the configured sender and sends the composed email as multipart', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EmailPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Acme <hello@acme.test>')).toBeInTheDocument();
    await user.type(screen.getByLabelText('To'), 'someone@example.test');
    await user.type(screen.getByLabelText('Subject'), 'Hello');
    await user.type(screen.getByLabelText('Body'), 'Hi there');
    await user.click(screen.getByRole('button', { name: /send email/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const [path, form] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/api/v1/admin/email/send');
    expect(form.get('to')).toBe('someone@example.test');
    expect(form.get('subject')).toBe('Hello');
    expect(form.get('bodyHtml')).toContain('Hi there');
  });
});
