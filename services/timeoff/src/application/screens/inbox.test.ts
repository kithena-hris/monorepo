import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, type PersonId } from '@kithena/contracts';

import { decideRequest } from '../approval/decide.js';
import { nudgeRequest, sendRequest } from '../request/request.js';
import { caller, people, world } from '../testing/world.js';
import { spanLabel, timeOffInbox } from './inbox.js';

const vacation = LeaveTypeKey.parse('vacation');

function setup(at = '2026-10-01T07:00:00.000Z') {
  const app = world(at, { withGrant: true });
  const ask = async (who: PersonId, from: string, to: string) => {
    const sent = await sendRequest(app.deps)(caller(who), {
      leaveTypeKey: vacation,
      span: DateSpan.parse({ from, to }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  const inbox = async (who: PersonId) => {
    const read = await timeOffInbox(app.deps)(caller(who));
    if (!read.ok) throw new Error(read.error.message);
    return read.value.items;
  };
  return { app, ask, inbox };
}

describe('Time Off in the Inbox', () => {
  it('is a task for the approver and a request for the person asking, then an update and receipts', async () => {
    const { app, ask, inbox } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-21');

    const marco = await inbox(people.marco);
    const task = marco.find((i) => i.id === `timeoff:approval:${id}`);
    expect(task).toMatchObject({
      lane: 'task',
      kind: 'timeoff.approval',
      title: 'Adam Novak · 19–21 Oct',
      summary: '3 working days · Vacation',
      dueVerb: 'decide',
      due: '2026-10-06',
      link: `/time-off/approvals/waiting/${id}`,
      detail: { personName: 'Adam Novak', teamName: 'Platform', balanceAfter: '22.000' },
    });

    const adam = await inbox(people.adam);
    expect(adam.find((i) => i.id === `timeoff:request:${id}`)).toMatchObject({
      lane: 'request',
      status: { label: 'With Marco', tone: 'warning' },
      detail: { holder: { name: 'Marco Ruiz' } },
    });

    const decided = await decideRequest(app.deps)(caller(people.marco), {
      requestId: id,
      decision: 'approve',
      reason: 'Enjoy the long weekend!',
    });
    expect(decided.ok).toBe(true);

    const after = await inbox(people.adam);
    expect(after.find((i) => i.id === `timeoff:decided:${id}`)).toMatchObject({
      lane: 'update',
      title: 'Marco approved your time off',
      message: 'Enjoy the long weekend!',
      detail: { approved: true, by: 'Marco Ruiz', note: 'Enjoy the long weekend!' },
    });
    expect(after.find((i) => i.id === `timeoff:request:${id}`)).toMatchObject({
      lane: 'done',
      outcome: { label: 'Approved', tone: 'success' },
      summary: 'Approved by Marco',
    });
    expect((await inbox(people.marco)).some((i) => i.id === `timeoff:approval:${id}`)).toBe(false);
    expect((await inbox(people.marco)).find((i) => i.kind === 'timeoff.approval')).toMatchObject({
      lane: 'done',
      summary: 'You approved it',
    });
  });

  it('tells the person asking why it was declined', async () => {
    const { app, ask, inbox } = setup();
    const id = await ask(people.adam, '2026-12-24', '2026-12-24');
    await decideRequest(app.deps)(caller(people.marco), {
      requestId: id,
      decision: 'decline',
      reason: 'Two people are already out that day.',
    });
    expect((await inbox(people.adam)).find((i) => i.id === `timeoff:decided:${id}`)).toMatchObject({
      title: 'Marco declined your time off on 24 Dec',
      summary: '“Two people are already out that day.”',
    });
  });

  it('says spans the way the design does', () => {
    expect(spanLabel('2026-12-28' as never, '2026-12-30' as never)).toBe('28–30 Dec');
    expect(spanLabel('2026-12-30' as never, '2027-01-02' as never)).toBe('30 Dec – 2 Jan');
    expect(spanLabel('2026-12-24' as never, '2026-12-24' as never)).toBe('24 Dec');
  });

  it('lets the person asking nudge once after 48 hours, and the approver sees it', async () => {
    const { app, ask, inbox } = setup();
    const id = await ask(people.adam, '2026-10-19', '2026-10-21');
    const nudge = nudgeRequest(app.deps);
    expect(await nudge(caller(people.adam), id)).toMatchObject({
      ok: false,
      error: { code: 'TOO_SOON' },
    });
    app.clock.set('2026-10-03T08:00:00.000Z');
    expect(await nudge(caller(people.omar), id)).toMatchObject({ ok: false });
    expect(await nudge(caller(people.adam), id)).toMatchObject({ ok: true });
    expect(await nudge(caller(people.adam), id)).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_NUDGED' },
    });
    expect((await inbox(people.adam)).find((i) => i.id === `timeoff:request:${id}`)).toMatchObject({
      detail: { nudge: { used: true } },
    });
    expect(
      (await inbox(people.marco)).find((i) => i.id === `timeoff:approval:${id}`),
    ).toMatchObject({
      status: { label: 'Adam nudged you', tone: 'warning' },
    });
  });
});
