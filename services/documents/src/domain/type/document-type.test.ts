import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '@kithena/contracts';

import { checkType, retentionEnds, retentionWords, SEEDED_TYPES } from './document-type.js';

const d = (s: string) => s as CalendarDate;

describe('the seeded types (S2)', () => {
  it('are fifteen, each valid, five required for new starters', () => {
    expect(SEEDED_TYPES).toHaveLength(15);
    for (const type of SEEDED_TYPES) expect(checkType(type).ok, type.key).toBe(true);
    expect(SEEDED_TYPES.filter((t) => t.requiredFor === 'new_starters')).toHaveLength(5);
  });
});

describe('a type keeps its parts together', () => {
  const contract = SEEDED_TYPES[0];
  it('medical is Confidential, HR only, and read for dates only', () => {
    expect(checkType({ ...contract, medical: true }).ok).toBe(false);
    expect(checkType({ ...contract, medical: true, audience: 'hr', aiReads: [] }).ok).toBe(true);
  });

  it('only a person’s type can be required, or signed by the person', () => {
    expect(checkType({ ...contract, filedTo: 'company' }).ok).toBe(false);
    expect(checkType({ ...contract, filedTo: 'company', requiredFor: null }).ok).toBe(false);
    expect(
      checkType({ ...contract, filedTo: 'company', requiredFor: null, signers: ['hr'] }).ok,
    ).toBe(true);
  });

  it('refuses a malformed key', () => {
    expect(checkType({ ...contract, key: 'Bad Key' })).toMatchObject({ ok: false });
  });
});

describe('retention (PRD §12.3)', () => {
  it('says each rule in words', () => {
    expect(retentionWords({ kind: 'after_leaving', years: 4 })).toBe('4 years after they leave');
    expect(retentionWords({ kind: 'until_leaving', plusYears: 1 })).toBe(
      'Until they leave, plus 1 year',
    );
    expect(retentionWords({ kind: 'forever' })).toBe('Every version, forever');
  });

  it('ends from filing, or from leaving, or never', () => {
    expect(retentionEnds({ kind: 'years', years: 5 }, d('2026-09-30'), null)).toBe('2031-09-30');
    expect(retentionEnds({ kind: 'days', days: 90 }, d('2026-10-12'), null)).toBe('2027-01-10');
    expect(retentionEnds({ kind: 'after_leaving', years: 4 }, d('2024-09-02'), null)).toBeNull();
    expect(
      retentionEnds({ kind: 'after_leaving', years: 4 }, d('2024-09-02'), d('2026-10-31')),
    ).toBe('2030-10-31');
    expect(retentionEnds({ kind: 'forever' }, d('2026-01-05'), d('2026-10-31'))).toBeNull();
  });
});
