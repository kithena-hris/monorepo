import { describe, expect, it } from 'vitest';
import { fixedClock, unwrap } from '@kithena/domain-kit';
import { CalendarDate, DayAmount, PeriodClosed, PersonId, TeamKey } from '@kithena/contracts';

import {
  close,
  hours,
  monthSummary,
  post,
  totals,
  type MemberMonth,
  type PayPeriod,
  type TimeLine,
} from './pay-period.js';
import { nextId, personId as adam, tenantId } from './t20.fixture.js';

const d = (s: string) => CalendarDate.parse(s);
const omar = PersonId.parse('55555555-5555-7555-8555-555555555555');
const platform = TeamKey.parse('platform');
const support = TeamKey.parse('support');

const september: PayPeriod = {
  id: '0192f000-0000-7000-8000-00000000a009',
  from: d('2026-09-01'),
  to: d('2026-09-30'),
  closedAt: null,
};
const october: PayPeriod = {
  id: '0192f000-0000-7000-8000-00000000a010',
  from: d('2026-10-01'),
  to: d('2026-10-31'),
  closedAt: null,
};
const actor = { kind: 'user', userId: '33333333-3333-7333-8333-333333333333' } as const;
const correlationId = '44444444-4444-7444-8444-444444444444';

const line = (over: Partial<TimeLine>): Omit<TimeLine, 'periodId'> => ({
  id: nextId(),
  personId: adam,
  team: platform,
  date: d('2026-09-29'),
  workedMinutes: 545,
  compMinutes: 0,
  paidMinutes: 0,
  supersedes: null,
  ...over,
});

const closeSeptember = (periods: readonly PayPeriod[], lines: readonly TimeLine[]) =>
  close({
    periods,
    periodId: september.id,
    lines,
    balances: new Map(),
    eventId: nextId(),
    actor,
    correlationId,
    tenantId,
    clock: fixedClock('2026-10-05T10:00:00+02:00'),
  });

describe('totals', () => {
  it('sums each member and each team', () => {
    const periods = [september, october];
    const lines = [
      line({ workedMinutes: 478 }),
      line({ workedMinutes: 545, compMinutes: 65 }),
      line({ personId: omar, workedMinutes: 570, paidMinutes: 90 }),
      line({
        personId: PersonId.parse('66666666-6666-7666-8666-666666666666'),
        team: support,
        workedMinutes: 480,
      }),
    ].map((l) => unwrap(post(periods, [], l)));

    const t = totals(september, lines);
    expect(t.members).toContainEqual({
      personId: adam,
      team: platform,
      workedMinutes: 1023,
      compMinutes: 65,
      paidMinutes: 0,
    });
    expect(t.teams).toEqual([
      { team: platform, people: 2, workedMinutes: 1593, compMinutes: 65, paidMinutes: 90 },
      { team: support, people: 1, workedMinutes: 480, compMinutes: 0, paidMinutes: 0 },
    ]);
  });
});

describe('closing September', () => {
  it('locks it, and sends Payroll hours and never punch times', () => {
    const tuesday = unwrap(post([september, october], [], line({ compMinutes: 65 })));
    const { periods, event } = unwrap(closeSeptember([september, october], [tuesday]));

    expect(periods[0]?.closedAt).toBe('2026-10-05T08:00:00.000Z');
    expect(event).toMatchObject({
      eventName: PeriodClosed.name,
      effectiveFrom: '2026-09-01',
      payload: {
        periodId: september.id,
        from: '2026-09-01',
        to: '2026-09-30',
        members: [
          {
            personId: adam,
            workedHours: '9.083',
            overtimeHours: '0.000',
            compHours: '1.083',
            unpaidDays: '0.000',
            negativeBalanceDays: '0.000',
          },
        ],
      },
    });
    expect(PeriodClosed.payload.safeParse(event.payload).success).toBe(true);
  });

  it('refuses to close it twice, or before August', () => {
    const closed = unwrap(closeSeptember([september, october], [])).periods;
    expect(closeSeptember(closed, [])).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_CLOSED' },
    });
    const august: PayPeriod = {
      id: nextId(),
      from: d('2026-08-01'),
      to: d('2026-08-31'),
      closedAt: null,
    };
    expect(closeSeptember([august, september], [])).toMatchObject({
      ok: false,
      error: { code: 'EARLIER_PERIOD_OPEN' },
    });
  });

  it('refuses a correction dated September and posts it to October, superseding the line it corrects', () => {
    // Wednesday 30 September went to Payroll with no clock-out and no hours.
    const wednesday = unwrap(
      post([september, october], [], line({ date: d('2026-09-30'), workedMinutes: 0 })),
    );
    const periods = unwrap(closeSeptember([september, october], [wednesday])).periods;

    const fixed = unwrap(
      post(
        periods,
        [wednesday],
        line({ date: d('2026-09-30'), workedMinutes: 508, supersedes: wednesday.id }),
      ),
    );
    expect(fixed).toMatchObject({
      periodId: october.id,
      date: '2026-09-30',
      supersedes: wednesday.id,
    });

    const lines = [wednesday, fixed];
    // September stays exactly as it was sent; October carries the difference.
    expect(totals(september, lines).members[0]?.workedMinutes).toBe(0);
    expect(totals(october, lines).members[0]?.workedMinutes).toBe(508);
  });

  it('counts a correction made before the close in its own month, once', () => {
    const first = unwrap(post([september, october], [], line({ workedMinutes: 500 })));
    const fixed = unwrap(
      post([september, october], [first], line({ workedMinutes: 545, supersedes: first.id })),
    );
    expect(fixed.periodId).toBe(september.id);
    expect(totals(september, [first, fixed]).members[0]?.workedMinutes).toBe(545);
  });

  it('refuses a correction of a line that does not exist, or with nowhere open to go', () => {
    expect(post([september], [], line({ supersedes: nextId() }))).toMatchObject({
      ok: false,
      error: { code: 'SUPERSEDES_UNKNOWN' },
    });
    const closed = unwrap(closeSeptember([september], [])).periods;
    expect(post(closed, [], line({}))).toMatchObject({
      ok: false,
      error: { code: 'NO_OPEN_PERIOD' },
    });
  });

  it('carries unpaid and negative days from the ledger', () => {
    const tuesday = unwrap(post([september, october], [], line({})));
    const { event } = unwrap(
      close({
        periods: [september, october],
        periodId: september.id,
        lines: [tuesday],
        balances: new Map([
          [
            adam,
            { unpaidDays: DayAmount.parse('1.000'), negativeBalanceDays: DayAmount.parse('0.500') },
          ],
        ]),
        eventId: nextId(),
        actor,
        correlationId,
        tenantId,
        clock: fixedClock('2026-10-05T10:00:00+02:00'),
      }),
    );
    expect(event.payload).toMatchObject({
      members: [{ unpaidDays: '1.000', negativeBalanceDays: '0.500' }],
    });
  });
});

describe('overtime money (TOF-096)', () => {
  const omarsOvertime = () =>
    [line({ personId: omar, workedMinutes: 570, paidMinutes: 90 })].map((l) =>
      unwrap(post([september, october], [], l)),
    );
  const closed = (rates: ReadonlyMap<PersonId, { amountMinor: number; currency: string }>) =>
    unwrap(
      close({
        periods: [september, october],
        periodId: september.id,
        lines: omarsOvertime(),
        balances: new Map(),
        rates,
        multiplier: '1.25',
        eventId: nextId(),
        actor,
        correlationId,
        tenantId,
        clock: fixedClock('2026-10-05T10:00:00+02:00'),
      }),
    ).event.payload as { members: { overtimeAmount: unknown }[] };

  it('prices paid overtime at the multiplier when the hourly rate is known, in minor units', () => {
    // 1.5h × 1.25 × €20.00 = €37.50.
    const payload = closed(new Map([[omar, { amountMinor: 2000, currency: 'EUR' }]]));
    expect(payload.members[0]?.overtimeAmount).toEqual({ amountMinor: 3750, currency: 'EUR' });
    expect(PeriodClosed.payload.safeParse(payload).success).toBe(true);
  });

  it('sends hours alone when nobody told Time Off a rate', () => {
    expect(closed(new Map()).members[0]?.overtimeAmount).toBeNull();
  });
});

describe('monthSummary (T24)', () => {
  const member = (over: Partial<MemberMonth>): MemberMonth => ({
    personId: adam,
    team: platform,
    teamName: 'Platform',
    openDays: 0,
    overtimeWaitingMinutes: 0,
    paidMinutes: 0,
    compMinutes: 0,
    unpaidDays: DayAmount.parse('0.000'),
    negativeBalanceDays: DayAmount.parse('0.000'),
    ...over,
  });

  it('counts each team’s people, who is late, and how its overtime is paid', () => {
    const summary = monthSummary([
      member({ compMinutes: 65 }),
      member({ personId: omar, paidMinutes: 90, openDays: 1 }),
      member({
        personId: PersonId.parse('66666666-6666-7666-8666-666666666666'),
        team: support,
        teamName: 'Support',
        overtimeWaitingMinutes: 30,
        unpaidDays: DayAmount.parse('2.000'),
        negativeBalanceDays: DayAmount.parse('1.500'),
      }),
    ]);
    expect(summary.teams).toEqual([
      {
        team: platform,
        teamName: 'Platform',
        people: 2,
        waiting: 1,
        paidMinutes: 90,
        compMinutes: 65,
        paidAs: 'mixed',
      },
      {
        team: support,
        teamName: 'Support',
        people: 1,
        waiting: 1,
        paidMinutes: 0,
        compMinutes: 0,
        paidAs: null,
      },
    ]);
    expect(summary.totals).toEqual({
      paidMinutes: 90,
      compMinutes: 65,
      unpaidDays: '2.000',
      unpaidPeople: 1,
      negativePeople: 1,
      negativeBalanceDays: '1.500',
    });
  });
});

describe('hours', () => {
  it('rounds minutes to three places without a float', () => {
    expect([0, 1, 2, 20, 65, 545, -65].map(hours)).toEqual([
      '0.000',
      '0.017',
      '0.033',
      '0.333',
      '1.083',
      '9.083',
      '-1.083',
    ]);
  });
});
