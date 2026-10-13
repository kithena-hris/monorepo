import { describe, expect, it } from 'vitest';

import { describedField } from './describe';

describe('a field drafted from a sentence', () => {
  it('reads the name, a range of sizes, when it is asked and who sees it', () => {
    const d = describedField(
      'T-shirt size for the offsite, XS to XXL. People pick it during onboarding; only HR needs it.',
    );
    expect(d).toMatchObject({
      label: 'T-shirt size',
      key: 't_shirt_size',
      dataType: 'select',
      options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      collectAt: 'onboarding',
      ownership: ['employee', 'hr'],
      visibility: ['self', 'hr'],
      understood: true,
    });
  });

  it('says so when there is nothing to read', () => {
    expect(describedField('  ').understood).toBe(false);
  });
});
