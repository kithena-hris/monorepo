import { describe, expect, it } from 'vitest';
import { DateSpan, LedgerEntry, LeaveTypeKey, type PersonId } from '@kithena/contracts';

import type { LeaveRequestId } from '../../domain/request/leave-request.js';
import { caller, d, people, TENANT, world } from '../testing/world.js';
import {
  cancelRequest,
  changeRequest,
  previewRequest,
  sendRequest,
  shortenRequest,
} from './request.js';

const vacation = LeaveTypeKey.parse('vacation');
const sick = LeaveTypeKey.parse('sick');
const span = (from: string, to: string) => DateSpan.parse({ from, to });

function setup() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const s = app.state(TENANT);
  const send = sendRequest(app.deps);
  const ask = (who: PersonId, from: string, to: string) =>
    send(caller(who), { leaveTypeKey: vacation, span: span(from, to) });
  /** Approve straight through the aggregate: deciding is TOF-038's, tested there. */
  const approve = (id: LeaveRequestId) => {
    const record = s.requests.get(id);
    if (record === undefined) throw new Error('no such request');
    const done = record.request.approve(
      { by: '0000000a-0000-7000-8000-000000000001', jurisdiction: 'ES' },
      {
        ...app.deps,
        actor: { kind: 'system', process: 'test' },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        causationId: null,
        timeZone: 'Europe/Madrid',
      },
    );
    if (!done.ok) throw new Error(done.error.message);
    record.request.drainEvents();
  };
  const left = (who: PersonId) =>
    s.ledger
      .filter((e) => e.personId === who && e.kind !== 'borrow')
      .reduce((n, e) => n + Number(e.amount), 0);
  return { app, s, ask, approve, left };
}

describe('the request preview (TOF-037)', () => {
  it('returns working days, days away, the balance after and who approves, saving nothing', async () => {
    const { app, s } = setup();
    const result = await previewRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: vacation,
      span: span('2026-10-19', '2026-10-23'),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        span: { workingDays: '5.000' },
        daysAway: { from: '2026-10-17', to: '2026-10-25', days: '9.000' },
        balance: { before: '25.000', after: '20.000' },
        negative: { verdict: { kind: 'fits' } },
        approvers: ['manager'],
        approver: people.marco,
        belowMinimum: [],
      },
    });
    expect(s.requests.size).toBe(0);
    expect(s.events).toHaveLength(0);
  });

  it('warns of the day the team would fall below its minimum', async () => {
    const { app, ask } = setup();
    await ask(people.omar, '2026-10-19', '2026-10-21');
    await ask(people.yuki, '2026-10-21', '2026-10-21');
    const result = await previewRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: vacation,
      span: span('2026-10-19', '2026-10-23'),
    });
    expect(result.ok && result.value.belowMinimum).toEqual([
      expect.objectContaining({ date: '2026-10-21', in: 4, of: 7, required: 5 }),
    ]);
  });

  it('offers borrowing within the limit, and refuses beyond it with the limit', async () => {
    const { app, s, ask } = setup();
    s.ledger.push(
      LedgerEntry.parse({
        entryId: '0189eeee-0000-7000-8000-000000000001',
        personId: people.adam,
        leaveTypeKey: 'vacation',
        kind: 'taken',
        amount: '-23.000',
        unit: 'day',
        effectiveOn: '2026-08-14',
        occurredAt: '2026-08-14T08:00:00.000Z',
        policyVersion: null,
        supersedes: null,
        requestId: null,
        reason: null,
      }),
    );
    const borrow = await previewRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: vacation,
      span: span('2026-10-19', '2026-10-23'),
    });
    expect(borrow.ok && borrow.value.negative.verdict).toMatchObject({
      kind: 'borrow',
      days: '3.000',
    });
    expect(borrow.ok && borrow.value.approvers).toEqual(['manager', 'hr']);

    const beyond = await ask(people.adam, '2026-10-19', '2026-10-26');
    expect(beyond).toMatchObject({ ok: false, error: { code: 'BEYOND_NEGATIVE_LIMIT' } });
  });
});

describe('sending, changing and cancelling (TOF-037)', () => {
  it('sends: the request waits, the days are booked, the event is out, the timer runs', async () => {
    const { app, s, ask, left } = setup();
    const sent = await ask(people.adam, '2026-10-19', '2026-10-23');
    expect(sent).toMatchObject({ ok: true, value: { status: 'pending' } });
    const id = sent.ok ? sent.value.requestId : ('' as LeaveRequestId);
    expect(left(people.adam)).toBe(20);
    expect(s.events.map((e) => e.eventName)).toEqual(['timeoff.request.requested']);
    expect(app.timers.started).toEqual([id]);

    const again = await ask(people.adam, '2026-10-22', '2026-10-27');
    expect(again).toMatchObject({ ok: false, error: { code: 'OVERLAP' } });
  });

  it('changes: the old dates stay booked until the new ones are approved', async () => {
    const { app, s, ask, approve, left } = setup();
    const sent = await ask(people.adam, '2026-10-19', '2026-10-23');
    if (!sent.ok) throw new Error(sent.error.message);
    approve(sent.value.requestId);

    const changed = await changeRequest(app.deps)(caller(people.adam), {
      requestId: sent.value.requestId,
      span: span('2026-10-26', '2026-10-29'),
    });
    expect(changed).toMatchObject({ ok: true, value: { status: 'change_pending' } });
    expect(left(people.adam)).toBe(20);
    expect(s.requests.get(sent.value.requestId)?.request.span.from).toBe('2026-10-19');

    const someoneElse = await changeRequest(app.deps)(caller(people.omar), {
      requestId: sent.value.requestId,
      span: span('2026-10-26', '2026-10-29'),
    });
    expect(someoneElse).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('shortens at once, giving the tail back', async () => {
    const { app, ask, approve, left, s } = setup();
    const sent = await ask(people.adam, '2026-10-19', '2026-10-23');
    if (!sent.ok) throw new Error(sent.error.message);
    approve(sent.value.requestId);
    const shortened = await shortenRequest(app.deps)(caller(people.adam), {
      requestId: sent.value.requestId,
      to: d('2026-10-21'),
      endsHalfDay: false,
    });
    expect(shortened).toMatchObject({ ok: true, value: { releasedDays: '2.000' } });
    expect(left(people.adam)).toBe(22);
    expect(s.events.at(-1)?.eventName).toBe('timeoff.request.cancelled');
  });

  it('cancels an approved request and withdraws a waiting one, the days back at once', async () => {
    const { app, ask, approve, left } = setup();
    const cancel = cancelRequest(app.deps);
    const first = await ask(people.adam, '2026-10-19', '2026-10-23');
    const second = await ask(people.adam, '2026-11-16', '2026-11-17');
    if (!first.ok || !second.ok) throw new Error('not sent');
    approve(first.value.requestId);
    expect(left(people.adam)).toBe(18);

    expect(await cancel(caller(people.adam), first.value.requestId)).toMatchObject({
      ok: true,
      value: { status: 'cancelled' },
    });
    expect(await cancel(caller(people.adam), second.value.requestId)).toMatchObject({
      ok: true,
      value: { status: 'withdrawn' },
    });
    expect(left(people.adam)).toBe(25);
    expect(app.timers.closed).toEqual([second.value.requestId]);
  });

  it('records sick leave under the threshold as approved, without booking anything', async () => {
    const { app, s } = setup();
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: sick,
      span: span('2026-10-01', '2026-10-02'),
    });
    expect(sent).toMatchObject({ ok: true, value: { status: 'approved', noteRequired: false } });
    expect(s.ledger.filter((e) => e.requestId !== null)).toHaveLength(0);
    expect(app.timers.started).toEqual([]);
  });
});
