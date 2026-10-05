import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import {
  ALL_CHECKS,
  CHECKS,
  DEFAULT_CHECKS,
  evidenceOf,
  flaggedNow,
  isCheckCode,
  MANAGER_PAY,
  payReach,
  payReadable,
  rowSummary,
  unusual,
  type Around,
  type ChangeSeen,
  type CheckCode,
  type Mark,
} from './unusual.js';

const NORA = 'acct-nora';
const TOM = 'acct-tom';
// A Tuesday, 10:00 in Madrid.
const WORKDAY = '2026-09-22T08:00:00.000Z';

const eur = (amountMinor: string) => ({ amountMinor, currency: 'EUR' });
const pay = (before: string, after: string) => ({ before: eur(before), after: eur(after) });

function change(over: Partial<ChangeSeen> = {}): ChangeSeen {
  return {
    id: 'c1',
    dataType: 'money',
    requestedAt: WORKDAY,
    requestedBy: NORA,
    subjectAccountId: TOM,
    effectiveFrom: '2026-10-01',
    pay: null,
    ...over,
  };
}

function around(over: Partial<Around> = {}): Around {
  return {
    zone: 'Europe/Madrid',
    at: '2026-09-22T12:00:00.000Z',
    team: null,
    band: null,
    contact: [],
    colleagues: null,
    enabled: DEFAULT_CHECKS,
    marks: [],
    ...over,
  };
}

const codes = (c: ChangeSeen, a: Partial<Around> = {}): CheckCode[] =>
  unusual(c, around(a)).reasons.map((r) => r.code);

describe('the checks', () => {
  it('are the six the settings list, all on but the time of day', () => {
    expect(CHECKS.map((c) => [c.code, c.on])).toEqual([
      ['raise', true],
      ['band', true],
      ['bank_after_contact', true],
      ['close_colleagues', true],
      ['payroll_closing', true],
      ['unusual_time', false],
    ]);
    expect([...DEFAULT_CHECKS]).toEqual([
      'raise',
      'band',
      'bank_after_contact',
      'close_colleagues',
      'payroll_closing',
    ]);
  });

  it('flag nothing about an ordinary change', () => {
    expect(unusual(change(), around())).toEqual({ reasons: [], comparisons: [], note: null });
  });
});

describe('a raise much bigger than usual', () => {
  const team = { name: 'Sales', raises: ['2', '4', '4', '6', '12'] };

  it('says how big, against the team’s raises this year, with the bars to compare', () => {
    const found = unusual(change({ pay: pay('6100000', '8400000') }), around({ team }));
    expect(found.reasons).toEqual([
      {
        code: 'raise',
        title: 'A 38% raise',
        detail: 'Sales raises this year had a median of 4%, and the largest was 12%.',
        magnitude: '38',
      },
    ]);
    expect(found.comparisons).toEqual([
      { label: 'This change', percent: '38', highlight: true },
      { label: 'Median', percent: '4', highlight: false },
      { label: 'Largest', percent: '12', highlight: false },
    ]);
  });

  it('leaves a raise the team has already seen bigger alone', () => {
    expect(codes(change({ pay: pay('5000000', '6500000') }), { team: { name: 'Sales', raises: ['31'] } })).toEqual([]);
  });

  it('leaves an ordinary raise alone, whatever the team did', () => {
    expect(codes(change({ pay: pay('5000000', '6000000') }), { team })).toEqual([]);
  });

  it('says so plainly when there is nothing to compare with', () => {
    const lonely = unusual(
      change({ pay: pay('5000000', '6500000') }),
      around({ team: { name: 'Legal', raises: [] } }),
    );
    expect(lonely.reasons[0]?.detail).toBe(
      'Nobody else in Legal has had a raise this year, and most raises are under 20%.',
    );
    expect(lonely.comparisons).toEqual([]);
    expect(unusual(change({ pay: pay('5000000', '6500000') }), around()).reasons[0]?.detail).toBe(
      'Most raises are under 20%.',
    );
  });

  it('flags a large cut too', () => {
    const [cut] = unusual(change({ pay: pay('5000000', '3000000') }), around()).reasons;
    expect(cut?.title).toBe('A 40% pay cut');
  });

  it('compares nothing across currencies, or against no pay at all', () => {
    expect(
      codes(
        change({ pay: { before: eur('5000000'), after: { amountMinor: '9000000', currency: 'GBP' } } }),
      ),
    ).toEqual([]);
    expect(codes(change({ pay: pay('0', '9000000') }))).toEqual([]);
  });
});

describe('outside the pay band', () => {
  const band = {
    grade: 'Account executive L3',
    currency: 'EUR',
    minimumMinor: '6200000',
    maximumMinor: '7800000',
  };

  it('says by how much, in the band’s own words', () => {
    const [reason] = unusual(change({ pay: pay('6100000', '8400000') }), around({ band, enabled: new Set(['band']) })).reasons;
    expect(reason).toEqual({
      code: 'band',
      title: 'Above the band',
      detail: '€84k is over the top of the Account executive L3 band (€62k–€78k).',
      magnitude: null,
    });
  });

  it('flags below the band, and nothing inside it or in another currency', () => {
    expect(
      unusual(change({ pay: pay('6100000', '5000000') }), around({ band, enabled: new Set(['band']) })).reasons[0]?.title,
    ).toBe('Below the band');
    expect(codes(change({ pay: pay('6100000', '7000000') }), { band })).toEqual([]);
    expect(codes(change({ pay: pay('6100000', '9000000') }), { band: { ...band, currency: 'GBP' }, enabled: new Set(['band']) })).toEqual([]);
  });

  it('never states a sealed amount, and the limits only to whoever may read the band', () => {
    const sealed = change({ pay: { ...pay('6100000', '8400000'), sealed: true } });
    const only = new Set<CheckCode>(['band']);
    expect(unusual(sealed, around({ band, enabled: only })).reasons[0]?.detail).toBe(
      'It is over the top of the Account executive L3 band (€62k–€78k).',
    );
    const hidden = { ...band, limitsShown: false };
    expect(unusual(sealed, around({ band: hidden, enabled: only })).reasons[0]?.detail).toBe(
      'It is over the top of the Account executive L3 band.',
    );
    expect(
      unusual(change({ pay: pay('6100000', '8400000') }), around({ band: hidden, enabled: only }))
        .reasons[0]?.detail,
    ).toBe('€84k is over the top of the Account executive L3 band.');
  });
});

describe('sealed pay', () => {
  it('flags a raise by its percentage alone, with no team comparison it cannot honestly make', () => {
    const found = unusual(
      change({ pay: { ...pay('6100000', '8400000'), sealed: true } }),
      around({ team: { name: 'Sales', raises: [] } }),
    );
    expect(found.reasons[0]).toMatchObject({ title: 'A 38% raise', detail: 'Most raises are under 20%.' });
    expect(found.comparisons).toEqual([]);
    expect(JSON.stringify(found)).not.toMatch(/84|61,|6100000|8400000/u);
  });
});

describe('a bank change right after an address or email change', () => {
  const bank = change({ dataType: 'bank_account', effectiveFrom: '2026-10-15' });

  it('names the change and how long before', () => {
    const [reason] = unusual(
      bank,
      around({ contact: [{ kind: 'address', at: '2026-09-20T09:00:00.000Z' }] }),
    ).reasons;
    expect(reason).toEqual({
      code: 'bank_after_contact',
      title: '2 days after a new address',
      detail:
        'The address changed 2 days before the bank details. Changing both together is a common pattern in payroll fraud.',
      magnitude: null,
    });
  });

  it('says the same day, and ignores a change long before or after', () => {
    expect(
      unusual(bank, around({ contact: [{ kind: 'email', at: '2026-09-22T07:00:00.000Z' }] })).reasons[0]
        ?.title,
    ).toBe('The same day as a new email');
    expect(codes(bank, { contact: [{ kind: 'address', at: '2026-08-01T09:00:00.000Z' }] })).toEqual([]);
    expect(codes(bank, { contact: [{ kind: 'address', at: '2026-09-23T09:00:00.000Z' }] })).toEqual([]);
  });

  it('is about bank details only', () => {
    expect(codes(change(), { contact: [{ kind: 'address', at: '2026-09-21T09:00:00.000Z' }] })).toEqual([]);
  });
});

describe('asked and decided by close colleagues', () => {
  it('flags a decider who shares the requester’s manager, within the hour', () => {
    const [reason] = unusual(
      change(),
      around({ colleagues: { name: 'Nora Becker' }, at: '2026-09-22T08:40:00.000Z' }),
    ).reasons;
    expect(reason?.code).toBe('close_colleagues');
    expect(reason?.title).toBe('You and Nora Becker share a manager');
  });

  it('is quiet once the hour has passed', () => {
    expect(codes(change(), { colleagues: { name: 'Nora Becker' }, at: '2026-09-22T09:30:00.000Z' })).toEqual([]);
  });
});

describe('a payroll that is already closing', () => {
  // A Monday, two days before September's payroll closes.
  const late = (effectiveFrom: string, over: Partial<ChangeSeen> = {}) =>
    change({ requestedAt: '2026-09-28T08:00:00.000Z', effectiveFrom, ...over });

  it('flags pay landing in this month’s payroll with less than five days left', () => {
    const [reason] = unusual(late('2026-09-28'), around({ at: '2026-09-28T09:00:00.000Z' })).reasons;
    expect(reason).toEqual({
      code: 'payroll_closing',
      title: 'Back-dated payroll impact',
      detail: 'It starts in 0 days, so it lands in this month’s payroll without the usual 5-day notice.',
      magnitude: null,
    });
    expect(unusual(late('2026-09-29'), around()).reasons[0]?.title).toBe('Short notice for payroll');
  });

  it('flags a change reaching back into a payroll already paid', () => {
    expect(unusual(change({ effectiveFrom: '2026-08-15' }), around()).reasons[0]?.detail).toBe(
      'It took effect 38 days before it was asked for, so payroll corrects what it already paid.',
    );
  });

  it('leaves next month’s payroll, a payroll with time left, and fields payroll does not pay from alone', () => {
    expect(codes(late('2026-10-01'))).toEqual([]);
    expect(codes(change({ effectiveFrom: '2026-09-22' }))).toEqual([]);
    expect(codes(change({ effectiveFrom: '2026-09-01' }))).toEqual([]);
    expect(codes(late('2026-09-28', { dataType: 'text' }))).toEqual([]);
  });
});

describe('an unusual time', () => {
  const night = change({ requestedAt: '2026-09-22T21:40:00.000Z', effectiveFrom: '2026-12-01' });
  const on = new Set<CheckCode>(['unusual_time']);

  it('is off unless switched on', () => {
    expect(codes(night)).toEqual([]);
  });

  it('flags a request at night, or at a weekend, by someone other than the employee', () => {
    expect(unusual(night, around({ enabled: on })).reasons[0]).toEqual({
      code: 'unusual_time',
      title: 'Asked for at an unusual time',
      detail: 'At 23:40 on a Tuesday, Europe/Madrid time, outside the requester’s working hours.',
      magnitude: null,
    });
    expect(
      codes(change({ requestedAt: '2026-09-26T09:00:00.000Z', effectiveFrom: '2026-12-01' }), { enabled: on }),
    ).toEqual(['unusual_time']);
    expect(codes({ ...night, requestedBy: TOM }, { enabled: on })).toEqual([]);
  });
});

describe('switches and feedback', () => {
  const big = change({ pay: pay('6100000', '8400000') });
  const mark = (over: Partial<Mark> = {}): Mark => ({
    code: 'raise',
    requestedBy: NORA,
    magnitude: '40',
    at: '2026-09-01T10:00:00.000Z',
    ...over,
  });

  it('runs only the checks switched on', () => {
    expect(codes(big, { enabled: new Set() })).toEqual([]);
  });

  it('quietens a change no bigger than one marked not unusual, from the same requester', () => {
    expect(codes(big, { marks: [mark()] })).toEqual([]);
    expect(codes(big, { marks: [mark({ magnitude: '30' })] })).toEqual(['raise']);
    expect(codes(big, { marks: [mark({ requestedBy: 'acct-other' })] })).toEqual(['raise']);
  });

  it('forgets a mark after 90 days', () => {
    expect(codes(big, { marks: [mark({ at: '2026-06-01T10:00:00.000Z' })] })).toEqual(['raise']);
  });

  it('quietens checks without a size by requester alone', () => {
    const bank = change({ dataType: 'bank_account', effectiveFrom: '2026-10-15' });
    const contact = [{ kind: 'address' as const, at: '2026-09-20T09:00:00.000Z' }];
    expect(
      codes(bank, { contact, marks: [mark({ code: 'bank_after_contact', magnitude: null })] }),
    ).toEqual([]);
  });
});

describe('the honest note', () => {
  it('says a promotion would explain the pay reasons, counting them', () => {
    const band = { grade: 'L3', currency: 'EUR', minimumMinor: '6200000', maximumMinor: '7800000' };
    const found = unusual(
      change({ pay: pay('6100000', '8400000'), effectiveFrom: '2026-08-01' }),
      around({ band, team: { name: 'Sales', raises: ['4'] } }),
    );
    expect(found.reasons.map((r) => r.code)).toEqual(['raise', 'band', 'payroll_closing']);
    expect(found.note).toBe(
      'This might be fine: a promotion would explain all three. Check the reason before you decide.',
    );
  });

  it('says it plainly otherwise', () => {
    const found = unusual(
      change({ dataType: 'bank_account', effectiveFrom: '2026-10-15' }),
      around({ contact: [{ kind: 'address', at: '2026-09-21T09:00:00.000Z' }] }),
    );
    expect(found.note).toBe(
      'This might be fine: people who move often change banks too. Check the reason before you decide.',
    );
  });
});

describe('the row’s summary', () => {
  it('joins the reasons in one line', () => {
    expect(
      rowSummary([
        { title: 'A 38% raise' },
        { title: 'Above the band' },
      ]),
    ).toBe('A 38% raise, above the band');
    expect(rowSummary([])).toBeNull();
  });
});

describe('what is kept of a change’s flags, and what it says to each decider', () => {
  const big = change({ pay: pay('6100000', '8400000') });
  const bank = change({ dataType: 'bank_account', effectiveFrom: '2026-10-15' });
  const contact = [{ kind: 'address' as const, at: '2026-09-20T09:00:00.000Z' }];
  // Kept from every check on, nobody's marks, pay read, no decider: what any decider starts from.
  const kept = (c: ChangeSeen, a: Partial<Around> = {}) =>
    evidenceOf(unusual(c, around({ enabled: ALL_CHECKS, ...a })));
  const now = (over: Partial<Parameters<typeof flaggedNow>[1]> = {}) => ({
    enabled: DEFAULT_CHECKS,
    marks: [],
    at: '2026-09-22T12:00:00.000Z',
    requestedBy: NORA,
    payReadable: true,
    ...over,
  });

  it('keeps each check’s code and its size, never a sentence or an amount', () => {
    expect(kept(big)).toEqual([{ code: 'raise', magnitude: '38' }]);
    expect(kept(bank, { contact })).toEqual([{ code: 'bank_after_contact', magnitude: null }]);
  });

  it('says the same as the checks would, under every switch, mark and reader', () => {
    const cases: [ChangeSeen, Partial<Around>][] = [
      [big, {}],
      [bank, { contact }],
      [change({ dataType: 'money', effectiveFrom: '2026-09-25' }), {}],
    ];
    const marks: Mark[] = [
      { code: 'raise', requestedBy: NORA, magnitude: '40', at: '2026-09-01T10:00:00.000Z' },
      { code: 'raise', requestedBy: NORA, magnitude: '30', at: '2026-09-01T10:00:00.000Z' },
      { code: 'raise', requestedBy: NORA, magnitude: '40', at: '2026-06-01T10:00:00.000Z' },
      {
        code: 'bank_after_contact',
        requestedBy: NORA,
        magnitude: null,
        at: '2026-09-01T10:00:00.000Z',
      },
    ];
    for (const [c, a] of cases) {
      const evidence = kept(c, a);
      for (const enabled of [DEFAULT_CHECKS, new Set<CheckCode>(), ALL_CHECKS]) {
        for (const mark of [[], ...marks.map((m) => [m])]) {
          for (const payReadable of [true, false]) {
            const live = codes(payReadable ? c : { ...c, pay: null }, {
              ...a,
              enabled,
              marks: mark,
            });
            expect(flaggedNow(evidence, now({ enabled, marks: mark, payReadable }))).toEqual(live);
          }
        }
      }
    }
  });

  it('leaves close colleagues to the decider looking now: it depends on who and when', () => {
    expect(kept(big, { colleagues: { name: 'Nora' }, at: WORKDAY })).toEqual([
      { code: 'raise', magnitude: '38' },
    ]);
  });
});

describe('pay a decider reads only through a reporting line (MANAGER_PAY)', () => {
  const define = (
    key: string,
    visibility: AttributeDefinitionInput['visibility'],
    over: Partial<AttributeDefinitionInput> = {},
  ) =>
    AttributeDefinition.parse({
      key,
      sectionKey: 'pay',
      label: { default: key },
      dataType: 'money',
      typeConfig: { kind: 'money' },
      requiredness: { mode: 'never' },
      ownership: ['hr'],
      visibility,
      collectAt: 'hr_only',
      classification: {
        classification: 'confidential',
        piiKind: 'none',
        exportable: true,
        aiEligible: false,
      },
      classificationSource: 'human',
      origin: 'tenant',
      ...over,
    });
  const definitions = [
    define('hr_pay', ['self', 'hr']),
    define('chain_pay', ['self', 'manager', 'manager_chain']),
    define('direct_pay', ['self', 'manager']),
    define('finance_pay', ['self', 'finance']),
  ];
  // An HR decider, as their tenant roles make them to everybody.
  const hr = { isHr: true, isFinance: false, isAdmin: false };
  const stranger = { direct: false, chain: false };
  const manager = { direct: true, chain: true };
  const above = { direct: false, chain: true };

  it('is a company setting beside the checks, on unless switched off', () => {
    expect(MANAGER_PAY).toEqual({
      code: 'manager_pay',
      title: 'Pay that only a person’s manager can see',
      detail: 'Count it in Flagged for the managers who can',
      on: true,
    });
    expect(isCheckCode(MANAGER_PAY.code)).toBe(false);
  });

  it('counted, is read on exactly the people the line reaches', () => {
    const reach = payReach(definitions, hr, true);
    expect(reach).toEqual({ everyone: ['hr_pay'], chain: ['chain_pay'], direct: ['direct_pay'] });
    expect(payReadable(reach, 'hr_pay', stranger)).toBe(true);
    expect(payReadable(reach, 'chain_pay', manager)).toBe(true);
    expect(payReadable(reach, 'chain_pay', above)).toBe(true);
    expect(payReadable(reach, 'chain_pay', stranger)).toBe(false);
    expect(payReadable(reach, 'direct_pay', manager)).toBe(true);
    expect(payReadable(reach, 'direct_pay', above)).toBe(false);
    // Nobody reads it, whoever they are to the person.
    expect(payReadable(reach, 'finance_pay', manager)).toBe(false);
  });

  it('left out, is read only where the decider reads it on everybody', () => {
    const reach = payReach(definitions, hr, false);
    expect(reach).toEqual({ everyone: ['hr_pay'], chain: [], direct: [] });
    expect(payReadable(reach, 'chain_pay', manager)).toBe(false);
    expect(payReadable(reach, 'direct_pay', manager)).toBe(false);
    expect(payReadable(reach, 'hr_pay', stranger)).toBe(true);
  });

  it('never counts a custom rule: a count could not say whom it holds for', () => {
    const ruled = define('ruled_pay', ['self'], {
      visibilityRules: [
        {
          scopes: ['hr', 'manager'],
          when: { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] },
        },
      ],
    });
    expect(payReach([ruled], hr, true)).toEqual({ everyone: [], chain: [], direct: [] });
  });
});
