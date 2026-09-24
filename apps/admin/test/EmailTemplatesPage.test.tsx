import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, patchMock, postMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock, post: postMock, put: putMock } };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmailTemplatesPage } from '@/pages/EmailTemplatesPage';

const templates = [
  {
    id: 't-1',
    key: 'email_verification',
    name: 'Email Verification',
    description: 'Sent when someone needs to verify their email address.',
    subject: 'Verify your email address',
    mode: 'standard',
    content: {
      heading: 'Verify your email address',
      bodyText: "You're almost there. Verify your email address to finish setting up your account.",
      ctaLabel: 'Verify email',
      fineprint: 'This link expires in {{expiresIn}}.',
    },
    bodyHtml: '<p>Verify {{verificationUrl}}</p>',
    plainText: null,
    enabled: true,
    isCustomized: false,
    availableVariables: ['user.name', 'verificationUrl', 'design.brandColor'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't-2',
    key: 'password_reset',
    name: 'Password Reset',
    description: 'Sent when someone requests a password reset.',
    subject: 'Reset your password',
    mode: 'developer',
    content: {
      heading: 'Reset your password',
      bodyText: 'Someone requested a password reset for your account.',
      ctaLabel: 'Reset password',
      fineprint: 'This link expires in {{expiresIn}}.',
    },
    bodyHtml: '<p>Reset {{resetUrl}}</p>',
    plainText: null,
    enabled: false,
    isCustomized: true,
    availableVariables: ['user.name', 'resetUrl'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const designs = [
  { id: 'modern-minimal', name: 'Modern Minimal', description: 'A clean, spacious layout.' },
  { id: 'cloudflare-inspired', name: 'Dark Technical', description: 'A dark, high-contrast layout.' },
  { id: 'corporate', name: 'Corporate', description: 'A traditional layout.' },
  { id: 'elegant', name: 'Elegant', description: 'Refined and airy.' },
  { id: 'simple', name: 'Simple', description: 'Very lightweight.' },
];

function mockGet(developerModeEnabled = false, brandingOverrides: Record<string, unknown> = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/email-templates') return Promise.resolve(templates);
    if (path === '/api/v1/admin/email-templates/designs') return Promise.resolve(designs);
    if (path === '/api/v1/admin/structured-settings/emailBranding') {
      return Promise.resolve({
        id: 'b-1',
        module: 'emailBranding',
        data: {
          designId: 'modern-minimal',
          developerModeEnabled,
          logoMediaId: null,
          footerText: null,
          brandColor: null,
          ...brandingOverrides,
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    if (path === '/api/v1/admin/structured-settings/general') {
      return Promise.resolve({
        id: 'g-1',
        module: 'general',
        data: { siteName: 'Acme', tagline: null, logoMediaId: 'media-logo-1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EmailTemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmailTemplatesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    postMock.mockResolvedValue({ subject: 'x', html: '<p>x</p>', text: 'x' });
    mockGet();
  });

  it('renders the management page: the current global design, the fixed transactional email list, and branding', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('System Email Design')).toBeInTheDocument());
    // Current global design shown as a single compact card — not a gallery.
    expect(screen.getByText('Modern Minimal')).toBeInTheDocument();
    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thumbnail/ })).not.toBeInTheDocument();

    expect(screen.getByText('Transactional Emails')).toBeInTheDocument();
    expect(screen.getByText('Email Verification')).toBeInTheDocument();
    expect(screen.getByText('Password Reset')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    expect(screen.getByText('Email Branding')).toBeInTheDocument();
  });

  it('opening "Change design" shows all five designs; selecting one and confirming updates the global design', async () => {
    putMock.mockResolvedValue({
      id: 'b-1',
      module: 'emailBranding',
      data: { designId: 'corporate', developerModeEnabled: false },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('System Email Design')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Change design' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Choose email design')).toBeInTheDocument();
    for (const design of designs) {
      expect(within(dialog).getByText(design.name)).toBeInTheDocument();
    }

    await userEvent.click(within(dialog).getByText('Corporate'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use design' }));

    // Section 18's confirmation step, naming the design and its deployment-wide effect.
    expect(await screen.findByText('Use Corporate?')).toBeInTheDocument();
    expect(screen.getByText('This design will be used by all standard system emails.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Use Corporate' }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        '/api/v1/admin/structured-settings/emailBranding',
        expect.objectContaining({ designId: 'corporate' }),
      ),
    );
  });

  it('opens an individual email editor when clicking Edit, with no design gallery and exactly one live preview', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());

    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByLabelText('Heading')).toHaveValue('Verify your email address');
    expect(screen.getByLabelText('Message')).toHaveValue(templates[0]!.content.bodyText);
    expect(screen.getByLabelText('Button label')).toHaveValue('Verify email');
    expect(screen.queryByLabelText('Body HTML')).not.toBeInTheDocument();
    expect(screen.queryByText('{{verificationUrl}}')).not.toBeInTheDocument();

    // No design gallery inside the editor.
    expect(screen.queryByText('Choose email design')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use design' })).not.toBeInTheDocument();
    expect(screen.queryAllByText(/thumbnail/)).toHaveLength(0);

    // Exactly one preview, informational text naming the active global design.
    expect(screen.getByText(/Using the/)).toBeInTheDocument();
    expect(screen.getByText('Modern Minimal')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTitle('Email preview')).toHaveLength(1));
  });

  it('going back from the editor returns to the management page', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());

    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Email Templates/ }));

    await waitFor(() => expect(screen.getByText('System Email Design')).toBeInTheDocument());
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
  });

  it('a Developer-mode email shows its raw HTML with no design gallery or informational design line', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Password Reset')).toBeInTheDocument());

    const row = screen.getByText('Password Reset').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByLabelText('Body HTML')).toHaveValue('<p>Reset {{resetUrl}}</p>');
    expect(screen.getByText('{{resetUrl}}')).toBeInTheDocument();
    expect(screen.getByText("This email uses custom HTML, so it doesn't use the system design.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTitle('Email preview')).toHaveLength(1));
  });

  it('content changes update the single preview for the selected email, debounced (not one request per design)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
      const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
      await userEvent.setup({ delay: null }).click(within(row).getByRole('button', { name: /Edit/ }));
      await waitFor(() => expect(screen.getByLabelText('Subject')).toBeInTheDocument());

      postMock.mockClear();
      await userEvent.setup({ delay: null }).type(screen.getByLabelText('Heading'), 'x');

      await vi.advanceTimersByTimeAsync(600);

      // Exactly one preview request for the whole edit, not one per keystroke and not one per design.
      const previewCalls = postMock.mock.calls.filter(([path]) => String(path).endsWith('/preview'));
      expect(previewCalls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves structured content changes for a Standard-mode email', async () => {
    patchMock.mockResolvedValue({ ...templates[0], subject: 'New subject' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'New subject');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', {
        mode: 'standard',
        subject: 'New subject',
        content: templates[0]!.content,
        plainText: null,
      }),
    );
  });

  it('toggles an email enabled/disabled immediately, without a separate save step', async () => {
    patchMock.mockResolvedValue({ ...templates[0], enabled: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Enabled')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Enabled'));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', { enabled: false }),
    );
  });

  it('restores the default email after confirming, but Save is disabled once nothing is customized', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    let row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Email Templates/ }));
    await waitFor(() => expect(screen.getByText('Password Reset')).toBeInTheDocument());
    row = screen.getByText('Password Reset').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeEnabled();

    postMock.mockResolvedValue({ ...templates[1], subject: 'Reset your password', mode: 'standard', isCustomized: false });
    await userEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/password_reset/restore-default', {}),
    );
  });

  it('sends a test email to the given address for the selected email', async () => {
    postMock.mockResolvedValue({ sent: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.type(screen.getByLabelText('Send a test email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification/send-test', {
        to: 'me@example.test',
      }),
    );
  });

  it('offers "Enable developer mode" for a Standard-mode email until Developer options is on deployment-wide', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeInTheDocument());

    expect(screen.queryByText('Use custom HTML for this email instead of the fields below')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable developer mode' })).toBeInTheDocument();
  });

  it('a Standard-mode email gets the custom-HTML switch once Developer options is on', async () => {
    mockGet(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());
    const row = screen.getByText('Email Verification').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeInTheDocument());

    const toggle = screen.getByLabelText('Use custom HTML for this email instead of the fields below');
    expect(toggle).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByLabelText('Body HTML')).toBeInTheDocument();
    expect(screen.queryByLabelText('Heading')).not.toBeInTheDocument();
  });

  it("a Developer-mode email's own custom-HTML switch stays visible even when Developer options is off deployment-wide", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Password Reset')).toBeInTheDocument());
    const row = screen.getByText('Password Reset').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));

    expect(screen.getByLabelText('Use custom HTML for this email instead of the fields below')).toBeChecked();
  });

  it('shows branding inheritance, not a hardcoded fallback value, until a custom override is set', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Branding')).toBeInTheDocument());

    expect(screen.getByText('Using site logo')).toBeInTheDocument();
    expect(screen.getByText("Using the design's own colors")).toBeInTheDocument();
    expect(screen.queryByText(/#6366f1/)).not.toBeInTheDocument();
  });

  it('shows a custom branding override distinctly from inherited defaults', async () => {
    mockGet(false, { brandColor: '#ff0000', footerText: 'Custom footer', logoMediaId: 'custom-logo' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Email Branding')).toBeInTheDocument());

    expect(screen.getByText('Custom email logo')).toBeInTheDocument();
    expect(screen.getByText(/Custom color override/)).toBeInTheDocument();
    expect(screen.getByText('Custom footer text')).toBeInTheDocument();
  });

  it('switching the email tab changes what the one live preview renders', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Password Reset')).toBeInTheDocument());
    const row = screen.getByText('Password Reset').closest('.border-b') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/admin/email-templates/password_reset/preview',
        expect.objectContaining({ mode: 'developer', bodyHtml: '<p>Reset {{resetUrl}}</p>' }),
      ),
    );
  });
});
