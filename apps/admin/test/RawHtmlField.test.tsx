import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, accessMock } = vi.hoisted(() => ({ postMock: vi.fn(), accessMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { post: postMock } }));
vi.mock('@/lib/raw-html-access', () => ({ useRawHtmlAccess: accessMock }));

import { RawHtmlField } from '@/components/raw-html-field';

function Harness() {
  const [value, setValue] = useState('');
  return <RawHtmlField label="HTML" value={value} onChange={setValue} />;
}

describe('RawHtmlField', () => {
  beforeEach(() => {
    postMock.mockReset();
    accessMock.mockReset();
  });

  it('previews the server-sanitized result in a fully sandboxed frame, never the pasted markup', async () => {
    accessMock.mockReturnValue({ enabled: true, isAdmin: true });
    postMock.mockResolvedValue({ html: '<p>safe</p>' });
    render(<Harness />);

    await userEvent.type(screen.getByLabelText('HTML'), 'x');
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/pages/sanitize-html', { html: 'x' }),
    );

    const frame = screen.getByTitle('Sanitized HTML preview');
    // sandbox="" = every restriction on: no scripts, no same-origin, no forms, no popups.
    expect(frame.getAttribute('sandbox')).toBe('');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('<p>safe</p>'));
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(frame.getAttribute('srcdoc')).not.toContain('>x<');
  });

  it('shows a notice instead of an editor when the feature is off', () => {
    accessMock.mockReturnValue({ enabled: false, isAdmin: true });
    render(<Harness />);
    expect(screen.getByText(/turned off for this deployment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('HTML')).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('is read-only for non-admins and never calls the sanitize endpoint', () => {
    accessMock.mockReturnValue({ enabled: true, isAdmin: false });
    render(<Harness />);
    expect(screen.getByText(/only an admin or owner can edit/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('HTML')).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });
});
