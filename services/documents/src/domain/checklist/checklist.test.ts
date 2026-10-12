import { describe, expect, it } from 'vitest';
import type { CalendarDate, DocumentTypeKey, PersonId } from '@kithena/contracts';

import { SEEDED_TYPES } from '../type/document-type.js';
import { checklist, isNewStarter, progress } from './checklist.js';

const today = '2026-10-12' as CalendarDate;
const k = (s: string) => s as DocumentTypeKey;
const mei = {
  personId: 'p-mei' as PersonId,
  hireDate: '2026-11-01' as CalendarDate,
  terminationDate: null,
  status: 'active',
};

describe('a new starter’s file (B3, Mei)', () => {
  const rows = checklist(
    mei,
    SEEDED_TYPES,
    [
      { id: 'd-ctr', typeKey: k('employment_contract'), expiresOn: null },
      { id: 'd-pass', typeKey: k('id_document'), expiresOn: '2031-03-14' as CalendarDate },
      { id: 'd-nda', typeKey: k('nda'), expiresOn: null },
    ],
    [
      {
        id: 'r-bank',
        typeKey: k('bank_details'),
        dueOn: null,
        askedOn: '2026-10-07' as CalendarDate,
      },
    ],
    today,
  );

  it('lists the five required, 3 of 5 in', () => {
    expect(rows.map((r) => r.typeKey)).toEqual([
      'employment_contract',
      'id_document',
      'nda',
      'bank_details',
      'tax_form',
    ]);
    expect(progress(rows)).toEqual({ have: 3, of: 5 });
  });

  it('gives each row its one action, due before day one', () => {
    expect(rows.map((r) => r.action)).toEqual(['view', 'view', 'view', 'remind', 'ask']);
    expect(rows[4]?.dueOn).toBe('2026-11-01');
  });
});

describe('who is a new starter', () => {
  it('started within 90 days, or not yet', () => {
    expect(isNewStarter(mei, today)).toBe(true);
    expect(isNewStarter({ ...mei, hireDate: '2024-09-02' as CalendarDate }, today)).toBe(false);
    expect(isNewStarter({ ...mei, hireDate: null }, today)).toBe(false);
  });

  it('somebody who is not owes nothing for new starters', () => {
    expect(
      checklist({ ...mei, hireDate: '2024-09-02' as CalendarDate }, SEEDED_TYPES, [], [], today),
    ).toEqual([]);
  });
});

describe('an expired document does not count', () => {
  it('is expired, and to ask for again', () => {
    const [, id] = checklist(
      mei,
      SEEDED_TYPES,
      [{ id: 'd-old', typeKey: k('id_document'), expiresOn: '2026-10-01' as CalendarDate }],
      [],
      today,
    );
    expect(id).toMatchObject({ state: 'expired', action: 'ask', documentId: 'd-old' });
  });
});
