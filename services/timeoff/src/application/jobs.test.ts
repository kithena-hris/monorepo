import { describe, expect, it } from 'vitest';
import { DateSpan, LedgerEntry, LeaveTypeKey, PunchInput, type PersonId } from '@kithena/contracts';

import { decideRequest } from './approval/decide.js';
import { punch } from './attendance/attendance.js';
import {
  balanceWarnings,
  clockOutReminder,
  markTakenDue,
  missedPunchCheck,
  yearEnd,
} from './jobs.js';
import { sendRequest } from './request/request.js';
import { live } from './shared.js';
import { caller, people, TENANT, world } from './testing/world.js';

let n = 0;
const taken = (personId: PersonId, amount: string) => {
  n += 1;
  return LedgerEntry.parse({
    entryId: `0189eeee-0000-7000-8000-${String(n).padStart(12, '0')}`,
    personId,
    leaveTypeKey: 'vacation',
    kind: 'taken',
    amount,
    unit: 'day',
    effectiveOn: '2026-08-14',
    occurredAt: '2026-08-14T08:00:00.000Z',
    policyVersion: null,
    supersedes: null,
    requestId: null,
    reason: null,
  });
};

describe('the year turning over (TOF-043)', () => {
  it('carries in up to the cap, takes a negative from the new year, and expires unused carry-over', async () => {
    const app = world('2027-01-01T01:00:00.000Z', { withGrant: true });
    const s = app.state(TENANT);
    s.ledger.push(taken(people.adam, '-20.000'), taken(people.omar, '-27.000'));
    const run = yearEnd(app.deps);

    await run(TENANT);
    await run(TENANT);
    const year = (who: PersonId) =>
      live(s.ledger.filter((e) => e.personId === who && e.effectiveOn >= '2027-01-01')).map((e) => [
        e.kind,
        e.amount,
        e.effectiveOn,
      ]);
    expect(year(people.adam)).toEqual([
      ['carry_over', '5.000', '2027-01-01'],
      ['grant', '25.000', '2027-01-01'],
    ]);
    expect(year(people.leo)).toEqual([
      ['carry_over', '5.000', '2027-01-01'],
      ['grant', '25.000', '2027-01-01'],
    ]);
    expect(year(people.omar)).toEqual([
      ['grant', '25.000', '2027-01-01'],
      ['adjustment', '-2.000', '2027-01-01'],
    ]);

    app.clock.set('2027-04-01T01:00:00.000Z');
    await run(TENANT);
    await run(TENANT);
    expect(year(people.adam)).toContainEqual(['expiry', '-5.000', '2027-03-31']);
    expect(year(people.adam).filter(([kind]) => kind === 'expiry')).toHaveLength(1);
    expect(s.events.filter((e) => e.eventName === 'timeoff.balance.adjusted').length).toBe(
      6 + 1 + 6, // six carried in, Omar's negative, six expired
    );
  });
});

describe('the warnings, the settling and the clock checks (TOF-043)', () => {
  it('warns on 1 October of days that will not carry over, once', async () => {
    const app = world('2026-10-01T06:00:00.000Z', { withGrant: true });
    await balanceWarnings(app.deps)(TENANT);
    await balanceWarnings(app.deps)(TENANT);
    expect(app.notices).toHaveLength(7);
    expect(app.notices[0]?.notice).toEqual({
      kind: 'use_it_or_lose_it',
      leaveTypeKey: 'vacation',
      left: '25.000',
      carries: '5.000',
    });
    app.clock.set('2026-10-02T06:00:00.000Z');
    await balanceWarnings(app.deps)(TENANT);
    expect(app.notices).toHaveLength(7);
  });

  it('settles an approved request into taken once its last day has passed', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-10-05', to: '2026-10-06' }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    await decideRequest(app.deps)(caller(people.marco), {
      requestId: sent.value.requestId,
      decision: 'approve',
    });

    app.clock.set('2026-10-06T20:00:00.000Z');
    expect(await markTakenDue(app.deps)(TENANT)).toEqual({ ok: true, value: 0 });
    app.clock.set('2026-10-07T06:00:00.000Z');
    expect(await markTakenDue(app.deps)(TENANT)).toEqual({ ok: true, value: 1 });
    expect(await markTakenDue(app.deps)(TENANT)).toEqual({ ok: true, value: 0 });
    const s = app.state(TENANT);
    expect(s.requests.get(sent.value.requestId)?.request.status).toBe('taken');
    expect(
      s.ledger.filter((e) => e.requestId === sent.value.requestId).map((e) => [e.kind, e.amount]),
    ).toEqual([
      ['booking', '-2.000'],
      ['release', '2.000'],
      ['taken', '-2.000'],
    ]);
  });

  it('asks about a missed clock-out the next morning, and reminds at 20:00, each once', async () => {
    const app = world('2026-10-05T07:00:00.000Z');
    await punch(app.deps)(
      caller(people.adam),
      PunchInput.parse({ kind: 'in', source: 'web', workModel: 'office' }),
    );

    app.clock.set('2026-10-05T17:00:00.000Z');
    await clockOutReminder(app.deps)(TENANT);
    expect(app.notices).toHaveLength(0);
    app.clock.set('2026-10-05T18:05:00.000Z');
    await clockOutReminder(app.deps)(TENANT);
    await clockOutReminder(app.deps)(TENANT);
    expect(app.notices.map((x) => [x.to, x.notice.kind])).toEqual([
      [people.adam, 'still_clocked_in'],
    ]);

    app.clock.set('2026-10-06T05:00:00.000Z');
    await missedPunchCheck(app.deps)(TENANT);
    await missedPunchCheck(app.deps)(TENANT);
    expect(app.notices.at(-1)?.notice).toEqual({ kind: 'missed_clock_out', date: '2026-10-05' });
    expect(app.notices).toHaveLength(2);
  });
});
