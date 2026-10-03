import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, type PersonId } from '@kithena/contracts';

import { decideRequest } from '../approval/decide.js';
import type { Deps } from '../ports.js';
import { sendRequest } from '../request/request.js';
import { approvals, requestDecision } from '../screens/manager.js';
import { recordingWriter, shown } from '../testing/assist.js';
import { caller, people, world } from '../testing/world.js';

/**
 * TOF-086 to TOF-088 on the design's October: Omar and Yuki are off on Wed 21
 * Oct, so Adam's 19–23 Oct leaves 4 of Platform's 7 in against 5; Leo's
 * 26–30 Oct is clear; Hana is off sick for a week, past the three days a note
 * is needed for. Adam wrote a note to Marco.
 */
const NOTE = 'My sister is getting married in Lisbon';

async function october(writer?: Deps['writer']) {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const deps = writer === undefined ? app.deps : { ...app.deps, writer };
  const ask = async (who: PersonId, type: string, from: string, to: string, note?: string) => {
    const sent = await sendRequest(app.deps)(caller(who), {
      leaveTypeKey: LeaveTypeKey.parse(type),
      span: DateSpan.parse({ from, to }),
      note: note ?? null,
      sickNoteFileId: null,
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  const approve = async (id: string) => {
    const done = await decideRequest(app.deps)(caller(people.marco), {
      requestId: id as never,
      decision: 'approve',
    });
    if (!done.ok) throw new Error(done.error.message);
  };
  await approve(await ask(people.omar, 'vacation', '2026-10-19', '2026-10-21'));
  await approve(await ask(people.yuki, 'vacation', '2026-10-21', '2026-10-21'));
  const adam = await ask(people.adam, 'vacation', '2026-10-19', '2026-10-23', NOTE);
  const leo = await ask(people.leo, 'vacation', '2026-10-26', '2026-10-30');
  const hana = await ask(people.hana, 'sick', '2026-10-05', '2026-10-09');
  return { deps, adam, leo, hana };
}

const NAMES = ['Adam', 'Novak', 'Omar', 'Yuki', 'Leo', 'Hana', 'Marco', NOTE, people.adam];

describe('reasons in the approvals queue (TOF-086)', () => {
  it('writes each line from the rule and its numbers, templated without a model', async () => {
    const { deps, adam, leo, hana } = await october();
    const queue = await approvals(deps)(caller(people.marco), { tab: 'waiting' });
    if (!queue.ok) throw new Error(queue.error.message);
    const why = new Map(queue.value.why.map((w) => [w.requestId, w.text]));
    expect(why.get(adam)).toEqual({
      text: 'Wed 21 Oct: 4 of 7 in, below the 5 the team needs.',
      ai: false,
    });
    expect(why.get(leo)).toEqual({
      text: 'Team stays at 6 of 7. Leo has 20 days left after this.',
      ai: false,
    });
    expect(why.get(hana)).toEqual({ text: '5 days off sick, so a note is needed.', ai: false });
  });

  it('lets a model write them with names held back, and never shows it sick leave', async () => {
    const writer = recordingWriter((key) => `{${key}} is fine to approve.`);
    const { deps, leo, hana } = await october(writer);
    const queue = await approvals(deps)(caller(people.marco), { tab: 'waiting' });
    if (!queue.ok) throw new Error(queue.error.message);
    const why = new Map(queue.value.why.map((w) => [w.requestId, w.text]));
    expect(why.get(leo)).toEqual({ text: 'Leo is fine to approve.', ai: true });
    expect(why.get(hana)?.ai).toBe(false);
    const prompt = shown(writer.asks);
    for (const never of [...NAMES, 'sick', hana]) expect(prompt).not.toContain(never);
  });
});

describe('what to know, the clash and the message (TOF-087, TOF-088)', () => {
  it('templates the closing line, the clash and a message for each of Adam’s own options', async () => {
    const { deps, adam } = await october();
    const read = await requestDecision(deps)(caller(people.marco), { requestId: adam });
    if (!read.ok) throw new Error(read.error.message);
    const d = read.value;
    expect(d.whatToKnow).toEqual({
      text: 'This might be fine if 4 people can cover on Wed 21.',
      ai: false,
    });
    expect(d.clash?.text).toMatch(
      /^Adam’s request would leave 4 of 7 in\. Here are \d ways to keep 5/u,
    );
    const swap = d.alternatives.find((a) => a.kind === 'swap_days');
    expect(swap?.message?.text).toMatch(
      /^Hi Adam, could you swap Wed 21 for .+\? Omar and Yuki are out on the day you asked\./u,
    );
    expect(d.alternatives.find((a) => a.kind === 'approve_as_asked')?.message).toBeNull();
  });

  it('lets a model write them from the figures alone: no name, no note', async () => {
    const writer = recordingWriter((key) =>
      key === 'know' ? 'This might be fine if 4 can cover on Wed 21.' : null,
    );
    const { deps, adam } = await october(writer);
    const read = await requestDecision(deps)(caller(people.marco), { requestId: adam });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.whatToKnow).toEqual({
      text: 'This might be fine if 4 can cover on Wed 21.',
      ai: true,
    });
    expect(read.value.clash?.ai).toBe(false);
    const prompt = shown(writer.asks.filter((a) => 'know' in a.lines));
    for (const never of NAMES) expect(prompt).not.toContain(never);
  });
});
