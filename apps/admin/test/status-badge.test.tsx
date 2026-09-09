import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('renders a known status with its display label', () => {
    render(<StatusBadge status="published" />);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it.each(['draft', 'new', 'read', 'archived'])('renders the %s status without crashing', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(new RegExp(status, 'i'))).toBeInTheDocument();
  });

  it('falls back to the raw value for an unknown status', () => {
    render(<StatusBadge status="pending-review" />);
    expect(screen.getByText('pending-review')).toBeInTheDocument();
  });
});
