import { describe, expect, it } from 'vitest';

import { openApproval } from '../approval/approval.js';
import {
  aboutSheet,
  approversFor,
  decideShare,
  gapBetween,
  mayDecideShare,
  recipientIn,
  type Share,
} from './share.js';

const ADA = 'acct-ada';
const SOFIA = 'acct-sofia';
const SOFIE = 'acct-sofie';
const NORA = 'acct-nora';
const TOM = 'acct-tom';

const people = [
  { accountId: ADA, name: 'Ada Lovelace', roles: new Set(['people_admin']) },
  { accountId: SOFIA, name: 'Sofia Lindqvist', roles: new Set(['finance']) },
  { accountId: NORA, name: 'Nora Becker', roles: new Set(['people_admin']) },
  { accountId: TOM, name: 'Tom Fischer', roles: new Set<string>() },
];

describe('who the sentence says the file is for', () => {
  it('finds somebody named in full', () => {
    expect(recipientIn('salaries for Sofia Lindqvist as of 30 June', people, ADA)).toBe(SOFIA);
  });

  it('finds somebody by their first name after "for" or "to"', () => {
    expect(recipientIn('send the Madrid list to sofia', people, ADA)).toBe(SOFIA);
  });

  it('reads accents and a possessive the same as the name', () => {
    expect(recipientIn('pay for Sofía’s review', people, ADA)).toBe(SOFIA);
  });

  it('finds the one person in a role named after "for"', () => {
    expect(
      recipientIn(
        'salaries for everyone in Madrid engineering as of 30 June, for Finance’s 2027 budget',
        people,
        ADA,
      ),
    ).toBe(SOFIA);
  });

  it('counts a role as granted, not as an administrator’s rights', () => {
    // Ada and Nora hold finance's rights as administrators; only Sofia was granted it.
    expect(recipientIn('for finance', people, TOM)).toBe(SOFIA);
  });

  it('guesses nothing when two people fit', () => {
    const two = [...people, { accountId: SOFIE, name: 'Sofia Berg', roles: new Set<string>() }];
    expect(recipientIn('send it to Sofia', two, ADA)).toBeNull();
  });

  it('never names the person asking', () => {
    expect(recipientIn('a copy for Ada Lovelace', people, ADA)).toBeNull();
  });

  it('does not take a first name that is not after "for" or "to"', () => {
    expect(recipientIn('people Tom manages', people, ADA)).toBeNull();
  });

  it('is nobody when nobody is named', () => {
    expect(recipientIn('everyone in Madrid as of today', people, ADA)).toBeNull();
  });
});

describe('what the recipient could not see themselves', () => {
  const asker = new Map([
    ['p1', new Set(['name', 'salary', 'level'])],
    ['p2', new Set(['name', 'salary', 'level'])],
    ['p3', new Set(['name', 'salary'])],
  ]);

  it('is nothing when they could read all of it', () => {
    expect(gapBetween(asker, asker, ['name', 'salary', 'level'])).toBeNull();
  });

  it('names each field they could not read, and for how many people', () => {
    const recipient = new Map([
      ['p1', new Set(['name', 'level'])],
      ['p2', new Set(['name', 'salary', 'level'])],
      ['p3', new Set(['name'])],
    ]);
    expect(gapBetween(asker, recipient, ['name', 'salary', 'level'])).toEqual({
      fields: [{ key: 'salary', people: 2 }],
      unlisted: 0,
    });
  });

  it('counts people they could not list at all, and their fields', () => {
    const recipient = new Map([['p1', new Set(['name', 'salary', 'level'])]]);
    expect(gapBetween(asker, recipient, ['name', 'salary', 'level'])).toEqual({
      fields: [
        { key: 'name', people: 2 },
        { key: 'salary', people: 2 },
        { key: 'level', people: 1 },
      ],
      unlisted: 2,
    });
  });
});

describe('who approves', () => {
  const holdings = new Map(people.map((p) => [p.accountId, p.roles]));

  it('is every other People administrator', () => {
    expect(approversFor(holdings, ADA, SOFIA)).toEqual([NORA]);
  });

  it('is never the recipient', () => {
    expect(approversFor(holdings, TOM, NORA)).toEqual([ADA]);
  });
});

describe('deciding a request to send', () => {
  const opened = openApproval({
    id: 'share-1',
    requestedBy: ADA,
    reason: 'Budget planning for 2027',
    at: '2026-10-01T12:00:00.000Z',
    expiresAt: '2026-10-08T12:00:00.000Z',
  });
  if (!opened.ok) throw new Error('approval did not open');
  const share: Share = {
    approval: opened.value,
    recipient: SOFIA,
  };
  const at = '2026-10-01T14:31:00.000Z';

  it('is a People administrator’s', () => {
    const decided = decideShare(share, { accountId: TOM, roles: new Set(['hr']) }, true, at);
    expect(decided.ok ? null : decided.error.code).toBe('FORBIDDEN');
  });

  it('is never the requester’s', () => {
    const decided = decideShare(
      share,
      { accountId: ADA, roles: new Set(['people_admin']) },
      true,
      at,
    );
    expect(decided.ok ? null : decided.error.code).toBe('FORBIDDEN');
  });

  it('is never the recipient’s', () => {
    const asRecipient = { ...share, recipient: NORA };
    const decided = decideShare(
      asRecipient,
      { accountId: NORA, roles: new Set(['people_admin']) },
      true,
      at,
    );
    expect(decided.ok ? null : decided.error.code).toBe('FORBIDDEN');
  });

  it('is offered only to whoever could make it, while it waits', () => {
    const nora = { accountId: NORA, roles: new Set(['people_admin']) };
    expect(mayDecideShare(share, nora, at)).toBe(true);
    expect(mayDecideShare(share, { accountId: ADA, roles: new Set(['people_admin']) }, at)).toBe(
      false,
    );
    expect(mayDecideShare({ ...share, recipient: NORA }, nora, at)).toBe(false);
    expect(mayDecideShare(share, { accountId: TOM, roles: new Set(['hr']) }, at)).toBe(false);
    // Lapsed after its week, even before anything recorded that.
    expect(mayDecideShare(share, nora, '2026-10-08T12:00:00.000Z')).toBe(false);
  });

  it('is recorded with who and when', () => {
    const decided = decideShare(
      share,
      { accountId: NORA, roles: new Set(['people_admin']) },
      true,
      at,
    );
    expect(decided.ok && decided.value.approval).toMatchObject({
      state: 'approved',
      decidedBy: NORA,
      decidedAt: at,
    });
  });
});

describe('the About sheet', () => {
  const base = {
    audience: 'Everybody whose department is Engineering and location is Madrid',
    count: 148,
    fields: [
      { label: 'Name', money: false, masked: false },
      { label: 'Job title', money: false, masked: false },
      { label: 'Base salary', money: true, masked: false },
      { label: 'FTE', money: false, masked: false },
    ],
    asOf: '2026-06-30',
    madeBy: 'Ada Lovelace',
    madeOn: '2026-10-01',
    reason: 'Budget planning for 2027',
    recipient: 'Sofia Lindqvist',
    expiresOn: '2026-10-08',
    exportId: '0199a3f0-7c1e-7d2a-9b1e-4f6a8c2d1e00',
  };

  it('says what it holds, as of when, for whom and why', () => {
    const about = aboutSheet(base);
    expect(about.title).toBe(
      'Everybody whose department is Engineering and location is Madrid, 30 June 2026',
    );
    expect(about.paragraphs[0]).toBe(
      '148 people, with their name, job title, base salary and FTE as they were at the end of 30 June 2026.',
    );
    expect(about.paragraphs[1]).toBe(
      'Made by Ada Lovelace on 1 October 2026 for Sofia Lindqvist. Why: Budget planning for 2027.',
    );
    expect(about.paragraphs).toContain(
      'Amounts are as recorded for each person, in their own currency, and are not converted.',
    );
    expect(about.footnote).toBe(
      'Confidential · link expires 8 October 2026 · export ID EXP-0199A3F0',
    );
  });

  it('says one person, no recipient, no reason and no expiry plainly', () => {
    const about = aboutSheet({
      ...base,
      count: 1,
      fields: [{ label: 'Name', money: false, masked: false }],
      recipient: null,
      reason: null,
      expiresOn: null,
      madeBy: null,
    });
    expect(about.paragraphs).toEqual([
      '1 person, with their name as it was at the end of 30 June 2026.',
      'Made on 1 October 2026.',
    ]);
    expect(about.footnote).toBe('Confidential · export ID EXP-0199A3F0');
  });

  it('names whose view “you” was, for whoever reads the file later', () => {
    expect(aboutSheet({ ...base, audience: 'Everyone you can see' }).title).toBe(
      'Everyone Ada Lovelace can see, 30 June 2026',
    );
  });

  it('says plainly when nobody, or no field, is in it', () => {
    expect(aboutSheet({ ...base, count: 0, fields: [] }).paragraphs[0]).toBe(
      'Nobody, as of the end of 30 June 2026: nobody matched who it is for.',
    );
    expect(aboutSheet({ ...base, fields: [] }).paragraphs[0]).toBe(
      '148 people, with no field that could be read on them, as of the end of 30 June 2026.',
    );
  });

  it('says a masked value shows its last characters only', () => {
    const about = aboutSheet({
      ...base,
      fields: [{ label: 'Bank account', money: false, masked: true }],
    });
    expect(about.paragraphs).toContain(
      'Bank account shows only its last four characters, as it does in People.',
    );
  });
});
