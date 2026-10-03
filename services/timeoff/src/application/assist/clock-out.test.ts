import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, PunchInput, type PunchKind } from '@kithena/contracts';

import { punch } from '../attendance/attendance.js';
import type { Deps } from '../ports.js';
import { sendRequest } from '../request/request.js';
import { timesheetScreen } from '../screens/manager.js';
import { recordingJudge, shown } from '../testing/assist.js';
import { caller, d, people, world } from '../testing/world.js';

/**
 * Adam on Monday 5 October 2026 in Madrid: in at 09:00, back from lunch at
 * 14:00, never clocked out. At 18:04 he sent a request from Kithena, and his
 * calendar says "Billing v2 sync" ended at 17:30.
 */
async function monday(options: { request?: boolean } = {}) {
  const app = world('2026-10-05T07:00:00.000Z', { withGrant: true });
  const adam = caller(people.adam);
  const at = async (iso: string, kind: PunchKind) => {
    app.clock.set(iso);
    const done = await punch(app.deps)(
      adam,
      PunchInput.parse({ kind, source: 'web', workModel: 'office' }),
    );
    if (!done.ok) throw new Error(done.error.message);
  };
  await at('2026-10-05T07:00:00.000Z', 'in');
  await at('2026-10-05T11:30:00.000Z', 'break_start');
  await at('2026-10-05T12:00:00.000Z', 'break_end');
  if (options.request !== false) {
    app.clock.set('2026-10-05T16:04:00.000Z');
    const sent = await sendRequest(app.deps)(adam, {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-11-16', to: '2026-11-16' }),
      note: null,
      sickNoteFileId: null,
    });
    if (!sent.ok) throw new Error(sent.error.message);
  }
  app.clock.set('2026-10-06T06:30:00.000Z');
  return app;
}

const calendar: Deps['calendar'] = {
  events: () =>
    Promise.resolve([
      { endsAt: '2026-10-05T15:30:00.000Z', title: 'Billing v2 sync', calendar: 'Google Calendar' },
    ]),
};

const read = (deps: Deps, who = people.adam) =>
  timesheetScreen(deps)(caller(who), {
    personId: people.adam,
    from: d('2026-10-05'),
    to: d('2026-10-05'),
  });

describe('a missed clock-out’s suggestion (TOF-089)', () => {
  it('is the latest evidence without a model, shown with the evidence', async () => {
    const app = await monday();
    const sheet = await read({ ...app.deps, calendar });
    if (!sheet.ok) throw new Error(sheet.error.message);
    expect(sheet.value.open[0]?.suggestion).toEqual({
      at: '2026-10-05T16:05:00.000Z',
      time: '18:05',
      ai: false,
      evidence: [
        {
          source: 'kithena',
          at: expect.any(String) as string,
          what: 'You sent a time-off request',
        },
        {
          source: 'calendar',
          at: '2026-10-05T15:30:00.000Z',
          what: 'Billing v2 sync, Google Calendar',
        },
      ],
    });
  });

  it('lets TypeSafe pick among the candidates from times and kinds alone', async () => {
    const app = await monday();
    const judge = recordingJudge(() => 't1');
    const sheet = await read({ ...app.deps, calendar, judge });
    if (!sheet.ok) throw new Error(sheet.error.message);
    expect(sheet.value.open[0]?.suggestion).toMatchObject({ time: '17:30', ai: true });
    const prompt = shown(judge.asks);
    for (const never of ['Billing', 'Google', 'Adam', people.adam, 'vacation']) {
      expect(prompt).not.toContain(never);
    }
  });

  it('offers nothing without evidence, and nothing to a manager reading the sheet', async () => {
    const quiet = await monday({ request: false });
    const none = await read(quiet.deps);
    expect(none.ok && none.value.open[0]?.suggestion).toBeNull();
    const app = await monday();
    const marco = await read({ ...app.deps, calendar }, people.marco);
    expect(marco.ok && marco.value.open[0]?.suggestion).toBeNull();
  });
});
