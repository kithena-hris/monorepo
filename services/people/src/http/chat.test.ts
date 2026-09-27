import { describe, expect, it } from 'vitest';

import { changedOf, chatApprovals, chatForm, spoken } from './chat.js';

const field = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  missing: false,
  readOnly: false,
  ...over,
});

describe('chatForm', () => {
  it('offers what was asked for first, then what is missing, and nothing read-only', () => {
    const form = chatForm({
      sections: [
        {
          fields: [
            field('phone', { missing: true }),
            field('shirt', {}),
            field('pronouns', {}),
            field('salary', { missing: true, readOnly: true }),
            field('passport', { missing: true, dataType: 'document_ref', label: 'Passport' }),
          ],
        },
      ],
      values: { pronouns: 'they/them' },
      requests: [{ key: 'pronouns' }],
    });
    expect(form.fields.map((f) => f.key)).toEqual(['pronouns', 'phone']);
    expect(form.fields[0]?.value).toBe('they/them');
    expect(form.elsewhere).toEqual(['Passport']);
  });
});

describe('changedOf', () => {
  it('takes only the form’s own fields, typed as the save expects', () => {
    const form = chatForm({
      sections: [
        {
          fields: [
            field('remote', { missing: true, dataType: 'boolean' }),
            field('languages', { missing: true, dataType: 'multi_select' }),
            field('nick', { missing: true }),
          ],
        },
      ],
      values: {},
      requests: [],
    });
    expect(
      changedOf(form, { remote: 'false', languages: ['en'], nick: '', salary: '1' }),
    ).toEqual({ remote: false, languages: ['en'] });
  });
});

describe('spoken', () => {
  it('says money in major units without a float', () => {
    expect(spoken({ amountMinor: '5', currency: 'EUR' })).toBe('0.05 EUR');
    expect(spoken({ amountMinor: '-123456', currency: 'USD' })).toBe('-1234.56 USD');
    expect(spoken({ last4: '1234' })).toBe('ending 1234');
    expect(spoken(null)).toBe('nothing');
  });
});

describe('chatApprovals', () => {
  it('lists only what this person may decide now, and hides what they cannot read', () => {
    const base = {
      name: 'Pam',
      label: 'Salary',
      value: 'x',
      current: 'y',
      readable: false,
      requestedBy: 'Jim',
      reason: null,
      effectiveFrom: '2026-10-01',
      canDecide: true,
      awaitingReview: false,
    };
    const items = chatApprovals({
      items: [
        { ...base, id: 'a' },
        { ...base, id: 'b', canDecide: false },
        { ...base, id: 'c', awaitingReview: true },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(items[0]?.to).toBe('a value you cannot see');
  });
});
