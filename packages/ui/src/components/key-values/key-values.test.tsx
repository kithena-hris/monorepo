import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KeyValues } from './key-values';

describe('KeyValues', () => {
  it('pairs each label with its value in a description list', () => {
    render(
      <KeyValues
        aria-label="Organisation"
        items={[
          { label: 'Default time zone', value: 'Europe/Madrid' },
          { label: 'Cohort minimum', value: '10 people' },
        ]}
      />,
    );
    const list = screen.getByLabelText('Organisation');
    expect(list.tagName).toBe('DL');
    const terms = within(list).getAllByRole('term');
    expect(terms.map((t) => t.textContent)).toEqual(['Default time zone', 'Cohort minimum']);
    expect(
      within(list)
        .getAllByRole('definition')
        .map((d) => d.textContent),
    ).toEqual(['Europe/Madrid', '10 people']);
  });
});
