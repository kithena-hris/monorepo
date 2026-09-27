import { describe, expect, it } from 'vitest';

import { changesIn } from './activity';

describe('changesIn', () => {
  it('reads a change log sentence as what changed, from and to', () => {
    expect(changesIn('Seen by: HR → HR and their manager. Required: No → Yes.')).toEqual([
      { what: 'Seen by', from: 'HR', to: 'HR and their manager' },
      { what: 'Required', from: 'No', to: 'Yes' },
    ]);
    expect(changesIn('Everyone signing up must fill it in.')).toBe(null);
  });
});
