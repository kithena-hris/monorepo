import { describe, expect, it } from 'vitest';
import { LeaveTypeKey } from '@kithena/contracts';

import { recordingJudge, recordingWriter, shown } from '../testing/assist.js';
import { caller, d, people, world } from '../testing/world.js';
import { describeRequest, readByRules } from './describe.js';

const SENTENCE = 'a week off in October, ideally next to a holiday, but not when the team is short';
const vacation = LeaveTypeKey.parse('vacation');
const types = [{ key: vacation, name: 'Vacation', category: 'annual_leave' }];

describe('reading the sentence by rule', () => {
  it('finds the type, the length, the month, the holiday and the team', () => {
    expect(readByRules(SENTENCE, types, d('2026-10-01'))).toEqual({
      leaveTypeKey: vacation,
      days: 5,
      month: '2026-10',
      nextToHoliday: true,
      avoidShort: true,
    });
  });

  it('reads two weeks, a month already past as next year’s, and nothing it does not know', () => {
    expect(readByRules('two weeks in March', types, d('2026-10-01'))).toMatchObject({
      days: 10,
      month: '2027-03',
      nextToHoliday: false,
      avoidShort: false,
    });
    expect(readByRules('some time', types, d('2026-10-01'))).toMatchObject({
      days: 5,
      month: null,
    });
  });
});

/** Adam on 1 October 2026; Madrid's Monday 12 October is Fiesta Nacional. */
describe('describe it (TOF-090)', () => {
  it('turns the sentence into editable choices and the domain’s best dates, templated without a model', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const read = await describeRequest(app.deps)(caller(people.adam), { sentence: SENTENCE });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.understood).toEqual({
      leaveTypeKey: vacation,
      leaveTypeName: 'Vacation',
      days: 5,
      month: '2026-10',
      nextToHoliday: true,
      avoidShort: true,
      ai: false,
    });
    expect(read.value.options[0]).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-16',
      used: 4,
      away: { from: '2026-10-10', to: '2026-10-18', days: 9 },
      holidays: [{ date: '2026-10-12', name: 'Fiesta Nacional' }],
      fits: true,
      line: { text: '4 days for 9 days away, with Fiesta Nacional.', ai: false },
    });
    // Nothing was asked for.
    expect(app.state(caller(people.adam).tenantId).events).toHaveLength(0);
  });

  it('lets what the person changed win over what was read', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const read = await describeRequest(app.deps)(caller(people.adam), {
      sentence: SENTENCE,
      days: 10,
      month: '2026-11',
      nextToHoliday: false,
    });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.understood).toMatchObject({
      days: 10,
      month: '2026-11',
      nextToHoliday: false,
    });
    expect(read.value.options.every((o) => o.from >= '2026-11-01')).toBe(true);
  });

  it('lets TypeSafe read the sentence and a model write the lines, from the sentence and dates alone', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const judge = recordingJudge(
      (id) =>
        ({ type: 'vacation', length: '5', month: '2026-10', holiday: 'yes', team: 'yes' })[id] ??
        null,
    );
    const writer = recordingWriter(() => 'Four days buy you Sat 10 Oct to Sun 18 Oct.');
    const read = await describeRequest({ ...app.deps, judge, writer })(caller(people.adam), {
      sentence: SENTENCE,
    });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.understood.ai).toBe(true);
    expect(read.value.options[0]?.line).toEqual({
      text: 'Four days buy you Sat 10 Oct to Sun 18 Oct.',
      ai: true,
    });
    const prompt = shown([...judge.asks, ...writer.asks]);
    for (const never of ['Adam', 'Novak', 'Omar', 'Yuki', people.adam, 'sick']) {
      expect(prompt).not.toContain(never);
    }
  });

  it('never shows a model a sentence about health', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const judge = recordingJudge(() => null);
    const read = await describeRequest({ ...app.deps, judge })(caller(people.adam), {
      sentence: 'three days in November after my surgery',
    });
    expect(read.ok && read.value.understood).toMatchObject({
      days: 3,
      month: '2026-11',
      ai: false,
    });
    expect(judge.asks).toHaveLength(0);
  });
});
