import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, type PersonId } from '@kithena/contracts';

import type { LeaveRequestId } from '../../domain/request/leave-request.js';
import { sendRequest } from '../request/request.js';
import { requestDetail } from '../screens/employee.js';
import { caller, d, hr, people, TENANT, world } from '../testing/world.js';
import {
  answerCounter,
  approvalQueue,
  batchApprove,
  counterPropose,
  decideRequest,
} from './decide.js';
import { escalationTick, setDelegation } from './escalation.js';

const vacation = LeaveTypeKey.parse('vacation');

function setup(at = '2026-10-01T07:00:00.000Z') {
  const app = world(at, { withGrant: true });
  const s = app.state(TENANT);
  const ask = async (who: PersonId, from: string, to: string): Promise<LeaveRequestId> => {
    const sent = await sendRequest(app.deps)(caller(who), {
      leaveTypeKey: vacation,
      span: DateSpan.parse({ from, to }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  return { app, s, ask, decide: decideRequest(app.deps) };
}

describe('deciding (TOF-038)', () => {
  it('refuses a non-approver in the application layer, and lets the manager approve', async () => {
    const { app, s, ask, decide } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');

    for (const who of [caller(people.omar), caller(people.adam)]) {
      expect(await decide(who, { requestId: id, decision: 'approve' })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    expect(s.requests.get(id)?.request.status).toBe('pending');

    expect(
      await decide(caller(people.marco), { requestId: id, decision: 'approve' }),
    ).toMatchObject({
      ok: true,
      value: { status: 'approved', next: null },
    });
    expect(s.events.at(-1)?.eventName).toBe('timeoff.request.approved');
    expect(app.timers.closed).toEqual([id]);
  });

  it('walks a manager-then-HR chain one step at a time', async () => {
    const { s, ask, decide } = setup();
    s.rules = [
      { subject: 'request', leaveTypes: null, when: 'always', approvers: ['manager', 'hr'] },
    ];
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');

    expect(
      await decide(caller(people.marco), { requestId: id, decision: 'approve' }),
    ).toMatchObject({
      ok: true,
      value: { status: 'pending', next: 'hr' },
    });
    expect(
      await decide(caller(people.marco), { requestId: id, decision: 'approve' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await decide(hr, { requestId: id, decision: 'approve' })).toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });

  it('declines and gives the days back', async () => {
    const { s, ask, decide } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    await decide(caller(people.marco), {
      requestId: id,
      decision: 'decline',
      reason: 'Release week',
    });
    expect(s.requests.get(id)?.request.status).toBe('declined');
    const booked = s.ledger.filter((e) => e.requestId === id).map((e) => [e.kind, e.amount]);
    expect(booked).toEqual([
      ['booking', '-5.000'],
      ['release', '5.000'],
    ]);
  });

  it('lets a delegate decide while covering', async () => {
    const { app, s, ask, decide } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    const set = await setDelegation(app.deps)(caller(people.marco), {
      approverId: people.marco,
      delegateId: people.omar,
      range: { from: d('2026-09-28'), to: d('2026-10-02') },
      automatic: false,
      salaryRelated: false,
    });
    expect(set.ok).toBe(true);
    expect(await decide(caller(people.omar), { requestId: id, decision: 'approve' })).toMatchObject(
      {
        ok: true,
      },
    );
    expect(s.requests.get(id)?.request.status).toBe('approved');
  });
});

describe('the queue and batch approval (TOF-038)', () => {
  it('splits the queue, and batch approves only the clear ones', async () => {
    const { app, s, ask } = setup();
    await ask(people.omar, '2026-10-19', '2026-10-21');
    await ask(people.yuki, '2026-10-21', '2026-10-21');
    const adam = await ask(people.adam, '2026-10-19', '2026-10-23');
    const ravi = await ask(people.ravi, '2026-11-16', '2026-11-17');

    const queue = await approvalQueue(app.deps)(caller(people.marco));
    if (!queue.ok) throw new Error(queue.error.message);
    expect(queue.value.clear.map((i) => i.requestId)).toEqual([ravi]);
    expect(queue.value.lookCloser.find((l) => l.item.requestId === adam)?.reason).toEqual({
      rule: 'below_minimum',
      days: ['2026-10-21'],
    });

    const batch = await batchApprove(app.deps)(caller(people.marco), [adam, ravi]);
    expect(batch).toMatchObject({
      ok: true,
      value: {
        approved: [{ requestId: ravi, status: 'approved' }],
        refused: [{ requestId: adam, code: 'LOOK_CLOSER', reason: { rule: 'below_minimum' } }],
      },
    });
    expect(s.requests.get(adam)?.request.status).toBe('pending');
  });
});

describe('suggesting other dates (TOF-038)', () => {
  it('approves the moment the member accepts a suggestion', async () => {
    const { app, s, ask } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    const countered = await counterPropose(app.deps)(caller(people.marco), {
      requestId: id,
      proposals: [
        {
          spans: [
            { from: d('2026-10-19'), to: d('2026-10-20') },
            { from: d('2026-10-22'), to: d('2026-10-23') },
            { from: d('2026-10-26'), to: d('2026-10-26') },
          ],
        },
      ],
    });
    expect(countered).toMatchObject({ ok: true, value: { status: 'counter_proposed' } });
    expect(s.requests.get(id)?.request.proposals[0]?.workingDays).toBe('5.000');

    expect(
      await answerCounter(app.deps)(caller(people.marco), { requestId: id, accept: 0 }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await answerCounter(app.deps)(caller(people.adam), { requestId: id, accept: 0 }),
    ).toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
    expect(s.requests.get(id)?.request.spans).toHaveLength(3);
  });

  it('carries the manager’s message to the member and onto the event (TOF-099b)', async () => {
    const { app, s, ask } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    await counterPropose(app.deps)(caller(people.marco), {
      requestId: id,
      proposals: [{ spans: [{ from: d('2026-10-26'), to: d('2026-10-30') }] }],
      message: 'Could you take the week after? The release lands on the 21st.',
    });
    const detail = await requestDetail(app.deps)(caller(people.adam), { requestId: id });
    expect(detail.ok && detail.value.proposalMessage).toBe(
      'Could you take the week after? The release lands on the 21st.',
    );
    expect(
      s.events.find((e) => e.eventName === 'timeoff.request.counter_proposed')?.payload,
    ).toMatchObject({
      message: 'Could you take the week after? The release lands on the 21st.',
    });
    // Answered, the message has done its job.
    await answerCounter(app.deps)(caller(people.adam), { requestId: id, accept: 0 });
    const after = await requestDetail(app.deps)(caller(people.adam), { requestId: id });
    expect(after.ok && after.value.proposalMessage).toBeNull();
  });
});

describe('escalation (TOF-039)', () => {
  it("moves an undecided request to the approver's manager after three working days, and reminds daily", async () => {
    const { app, s, ask } = setup();
    // Marco reports to Nora, so his undecided requests go to her.
    const nora = '00000000-0000-7000-8000-000000000008' as PersonId;
    const marco = s.members.get(people.marco);
    if (marco === undefined) throw new Error('no Marco');
    s.members.set(people.marco, { ...marco, managerPersonId: nora });
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    const tick = escalationTick(app.deps);

    // Thursday 1st: sent today, nothing yet. Monday 5th: two working days. Tuesday 6th: three.
    expect(await tick(TENANT, id, '2026-10-01T08:00:00.000Z')).toMatchObject({
      ok: true,
      value: { open: true, escalated: false },
    });
    expect(await tick(TENANT, id, '2026-10-05T07:30:00.000Z')).toMatchObject({
      ok: true,
      value: { escalated: false },
    });
    expect(await tick(TENANT, id, '2026-10-06T07:00:00.000Z')).toMatchObject({
      ok: true,
      value: { escalated: true },
    });
    expect(s.requests.get(id)?.routing.escalatedTo).toBe(nora);
    expect(app.notices.map((n) => [n.to, n.notice.kind])).toEqual([
      [people.marco, 'approval_waiting'],
      [nora, 'approval_escalated'],
      [nora, 'approval_waiting'],
    ]);

    const decided = await decideRequest(app.deps)(caller(nora), {
      requestId: id,
      decision: 'approve',
    });
    expect(decided.ok).toBe(true);
    expect(await tick(TENANT, id, '2026-10-07T07:00:00.000Z')).toMatchObject({
      ok: true,
      value: { open: false },
    });
  });

  it('follows HR’s "If nobody decides": one working day, straight to HR (TOF-099a)', async () => {
    const { app, s, ask } = setup();
    s.settings.set('escalation', { afterWorkingDays: 1, to: 'hr', remindAt: 8 * 60 });
    const id = await ask(people.adam, '2026-10-19', '2026-10-23');
    const tick = escalationTick(app.deps);
    // Friday 2nd is one working day after Thursday 1st; 08:00 in Madrid is 06:00Z.
    expect(await tick(TENANT, id, '2026-10-02T06:00:00.000Z')).toMatchObject({
      ok: true,
      value: { escalated: true },
    });
    expect(s.requests.get(id)?.routing.escalatedTo).toBe('hr');
    expect(app.notices.map((n) => [n.to, n.notice.kind])).toEqual([
      ['hr', 'approval_escalated'],
      ['hr', 'approval_waiting'],
    ]);
  });
});
