import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, PunchInput, type PersonId } from '@kithena/contracts';

import { punch } from '../attendance/attendance.js';
import type { Deps } from '../ports.js';
import { sendRequest } from '../request/request.js';
import { rightNowScreen } from '../screens/manager.js';
import { recordingWriter, shown } from '../testing/assist.js';
import { caller, people, world } from '../testing/world.js';

/**
 * Platform at 12:33 on Thursday 1 October 2026, Madrid: everyone but Hana is
 * in, Ravi the last at 10:12; Hana is off sick, which is approved as it is
 * recorded.
 */
async function thursday() {
  const app = world('2026-10-01T06:00:00.000Z', { withGrant: true });
  const clockIn = async (who: PersonId, at: string) => {
    app.clock.set(at);
    const done = await punch(app.deps)(
      caller(who),
      PunchInput.parse({ kind: 'in', source: 'web', workModel: 'office' }),
    );
    if (!done.ok) throw new Error(done.error.message);
  };
  const sick = await sendRequest(app.deps)(caller(people.hana), {
    leaveTypeKey: LeaveTypeKey.parse('sick'),
    span: DateSpan.parse({ from: '2026-10-01', to: '2026-10-02' }),
    note: 'Migraine',
    sickNoteFileId: null,
  });
  if (!sick.ok) throw new Error(sick.error.message);
  await clockIn(people.adam, '2026-10-01T06:52:00.000Z');
  await clockIn(people.omar, '2026-10-01T06:31:00.000Z');
  await clockIn(people.yuki, '2026-10-01T06:15:00.000Z');
  await clockIn(people.leo, '2026-10-01T07:18:00.000Z');
  await clockIn(people.ravi, '2026-10-01T08:12:00.000Z');
  app.clock.set('2026-10-01T10:33:00.000Z');
  return app;
}

const board = (deps: Deps) => rightNowScreen(deps)(caller(people.marco));

describe('today in a sentence (TOF-091)', () => {
  it('says what is normal from the board, templated without a model', async () => {
    const app = await thursday();
    const read = await board(app.deps);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.sentence).toEqual({
      text: 'Everyone expected is in. Ravi started at 10:12, inside the team’s hours.',
      ai: false,
    });
  });

  it('lets a model write it with every person a placeholder and nothing about why anyone is away', async () => {
    const app = await thursday();
    const writer = recordingWriter(() => 'All in; {p0} started at 10:12, which is normal.');
    const read = await board({ ...app.deps, writer });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.sentence).toEqual({
      text: 'All in; Ravi started at 10:12, which is normal.',
      ai: true,
    });
    const prompt = shown(writer.asks);
    for (const never of ['Ravi', 'Hana', 'Adam', 'sick', 'Sick', 'Migraine', people.ravi]) {
      expect(prompt).not.toContain(never);
    }
  });
});
