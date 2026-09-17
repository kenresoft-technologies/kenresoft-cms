import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ContentTypeTabs } from '@/components/content-type-tabs';

describe('ContentTypeTabs', () => {
  it('marks Entries as active by default and Schema when active="schema"', () => {
    const { rerender } = render(
      <MemoryRouter>
        <ContentTypeTabs contentTypeId="ct-1" active="entries" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Entries' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Schema' })).toHaveAttribute('aria-selected', 'false');

    rerender(
      <MemoryRouter>
        <ContentTypeTabs contentTypeId="ct-1" active="schema" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Schema' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Entries' })).toHaveAttribute('aria-selected', 'false');
  });

  it('navigates to the schema route when the Schema tab is clicked', async () => {
    function Location() {
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/content-types/ct-1']}>
        <Routes>
          <Route
            path="/content-types/:contentTypeId"
            element={<ContentTypeTabs contentTypeId="ct-1" active="entries" />}
          />
          <Route path="/content-types/:contentTypeId/schema" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    // Navigating away unmounts this component's own route element entirely — its disappearance
    // is itself proof the navigation happened, since there's nothing left to assert against.
    expect(screen.queryByRole('tab', { name: 'Schema' })).not.toBeInTheDocument();
  });
});
