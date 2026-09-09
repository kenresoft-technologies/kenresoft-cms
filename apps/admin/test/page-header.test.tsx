import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/page-header';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Entries" />);
    expect(screen.getByRole('heading', { name: 'Entries' })).toBeInTheDocument();
  });

  it('renders an optional description', () => {
    render(<PageHeader title="Entries" description="Instances of Blog Post." />);
    expect(screen.getByText('Instances of Blog Post.')).toBeInTheDocument();
  });

  it('omits the description paragraph when none is given', () => {
    const { container } = render(<PageHeader title="Entries" />);
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('renders actions', () => {
    render(<PageHeader title="Entries" actions={<button>New entry</button>} />);
    expect(screen.getByRole('button', { name: 'New entry' })).toBeInTheDocument();
  });
});
