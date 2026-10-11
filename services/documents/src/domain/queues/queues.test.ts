import { describe, expect, it } from 'vitest';
import type { CalendarDate, DocumentTypeKey, Instant, PersonId } from '@kithena/contracts';

import { SEEDED_TYPES } from '../type/document-type.js';
import { dueForDeletion, expiring, trashOver, type QueueDocument } from './queues.js';

const today = '2026-10-12' as CalendarDate;
const doc = (over: Partial<QueueDocument>): QueueDocument => ({
  id: 'd',
  typeKey: null,
  subjectPersonId: null,
  expiresOn: null,
  createdAt: '2020-01-01T00:00:00.000Z' as Instant,
  deletedAt: null,
  held: false,
  ...over,
});
const types = new Map(SEEDED_TYPES.map((t) => [t.key as string, t]));

describe('Expiring (H1)', () => {
  it('within 60 days or past, soonest first, never a deleted one', () => {
    const list = expiring(
      [
        doc({ id: 'permit', expiresOn: '2026-12-02' as CalendarDate }),
        doc({ id: 'aid', expiresOn: '2026-10-01' as CalendarDate }),
        doc({ id: 'far', expiresOn: '2027-06-01' as CalendarDate }),
        doc({
          id: 'gone',
          expiresOn: '2026-10-20' as CalendarDate,
          deletedAt: '2026-10-01T00:00:00.000Z' as Instant,
        }),
      ],
      today,
    );
    expect(list.map((d) => d.id)).toEqual(['aid', 'permit']);
  });
});

describe('To delete (H3)', () => {
  const left = (p: PersonId) => (p === 'p-nora' ? ('2021-06-30' as CalendarDate) : null);
  it('payslips after 5 years; a contract 4 years after its person left; never under a hold', () => {
    const list = dueForDeletion(
      [
        doc({
          id: 'slip',
          typeKey: 'payslip' as DocumentTypeKey,
          subjectPersonId: 'p-adam' as PersonId,
        }),
        doc({
          id: 'ctr',
          typeKey: 'employment_contract' as DocumentTypeKey,
          subjectPersonId: 'p-nora' as PersonId,
        }),
        doc({ id: 'held', typeKey: 'payslip' as DocumentTypeKey, held: true }),
        doc({
          id: 'stay',
          typeKey: 'employment_contract' as DocumentTypeKey,
          subjectPersonId: 'p-adam' as PersonId,
        }),
        doc({ id: 'mine' }),
      ],
      types,
      left,
      today,
    );
    expect(list.map((d) => [d.id, d.retentionEnded])).toEqual([
      ['slip', '2025-01-01'],
      ['ctr', '2025-06-30'],
    ]);
  });
});

describe('the trash', () => {
  it('ends 30 days after deleting, unless held', () => {
    const list = trashOver(
      [
        doc({ id: 'old', deletedAt: '2026-09-01T10:00:00.000Z' as Instant }),
        doc({ id: 'new', deletedAt: '2026-10-01T10:00:00.000Z' as Instant }),
        doc({ id: 'held', deletedAt: '2026-09-01T10:00:00.000Z' as Instant, held: true }),
      ],
      today,
    );
    expect(list.map((d) => d.id)).toEqual(['old']);
  });
});
