import { describe, expect, it } from 'vitest';

import { homeDocuments, type LibraryAnswer } from './home-documents';

const row = (id: string, more: Partial<LibraryAnswer['rows'][number]> = {}) => ({
  id,
  title: `Document ${id}`,
  kind: 'Contract',
  typeName: null,
  who: { label: 'Only you' },
  subject: null,
  updatedAt: '2026-11-20T09:00:00Z',
  ...more,
});

describe('Documents on Home', () => {
  it('offers only the lists that have rows, what needs the reader first', () => {
    const home = homeDocuments({
      needsYou: [
        {
          id: 'e1',
          kind: 'sign',
          title: 'Sign the addendum',
          detail: 'From Ada',
          dueOn: '2026-12-03',
          documentId: 'd1',
        },
      ],
      tiles: [],
      rows: [row('d1')],
      total: 9,
    });
    expect(home.lists.map((l) => l.key)).toEqual(['needs', 'recent']);
    expect(home.lists[0]?.rows[0]).toMatchObject({
      href: '/documents/envelopes/e1',
      kind: 'To sign',
    });
    // The day is in the reader's own format.
    expect(home.lists[0]?.rows[0]?.detail).toMatch(/^From Ada · Due .*3/u);
    expect(home.lists[1]?.total).toBe(9);
  });

  it('says who a request waits on and how far it is, and whom a document is about', () => {
    const home = homeDocuments({
      needsYou: [],
      tiles: [],
      rows: [
        row('d2', {
          typeName: 'Employment contract',
          subject: { name: 'Omar Haddad' },
          signing: {
            envelopeId: 'e2',
            status: 'sent',
            signed: 1,
            of: 2,
            waitingOn: ['Omar Haddad'],
          },
        }),
      ],
      total: 1,
    });
    expect(home.lists[0]).toMatchObject({ key: 'signing', href: '/documents/envelopes' });
    expect(home.lists[0]?.rows[0]).toMatchObject({
      href: '/documents/envelopes/e2',
      detail: 'Waiting for Omar Haddad',
      kind: 'Employment contract',
      about: 'Omar Haddad',
      status: '1 of 2 signed',
    });
  });

  it('gives HR its follow-up as figures that lead to each list, and leaves out what is zero', () => {
    const home = homeDocuments({
      needsYou: [],
      tiles: [
        { key: 'to_sign', count: 4 },
        { key: 'missing', count: 12 },
        { key: 'expiring', count: 0 },
      ],
      rows: [],
      total: 0,
    });
    expect(home.figures).toEqual([
      { label: 'missing', value: 12, href: '/documents/compliance?queue=missing' },
    ]);
    expect(home.lists).toEqual([]);
  });
});
