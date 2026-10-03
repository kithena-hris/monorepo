import { describe, expect, it } from 'vitest';
import { LeaveTypeKey, LocationKey } from '@kithena/contracts';

import { live } from '../shared.js';
import {
  caller,
  d,
  hr,
  people,
  PLATFORM,
  sickType,
  TENANT,
  VACATION_POLICY,
  vacationPolicy,
  world,
} from '../testing/world.js';
import {
  assignHolidayCalendars,
  changeLeaveType,
  defineLeaveType,
  publishPolicy,
  revisePolicy,
  setNegativeBalanceRule,
  setTeamMinimum,
} from './admin.js';
import { holidaySettings, policyPreview } from '../screens/settings.js';

describe('settings (TOF-041)', () => {
  it('publishing a policy re-folds the balances it affects and emits policy.published', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const s = app.state(TENANT);
    const revised = await revisePolicy(app.deps)(
      hr,
      VACATION_POLICY,
      vacationPolicy({ allowance: [{ fromYears: 0, days: '27.000' }] }),
    );
    expect(revised).toEqual({ ok: true, value: 2 });

    const published = await publishPolicy(app.deps)(hr, VACATION_POLICY, d('2026-01-01'));
    expect(published).toEqual({ ok: true, value: { version: 2, refolded: 7 } });

    const adams = live(s.ledger.filter((e) => e.personId === people.adam));
    expect(adams.map((e) => [e.kind, e.amount, e.policyVersion])).toEqual([['grant', '27.000', 2]]);
    expect(s.events.map((e) => e.eventName)).toEqual(['timeoff.policy.published']);
    expect(s.events[0]?.payload).toMatchObject({ version: 2, effectiveFrom: '2026-01-01' });
  });

  it('is HR only', async () => {
    const app = world();
    const asMarco = caller(people.marco);
    expect(await publishPolicy(app.deps)(asMarco, VACATION_POLICY, d('2026-01-01'))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await setTeamMinimum(app.deps)(asMarco, PLATFORM, { atLeast: 3, unit: 'people' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('keeps a leave type\'s rules: one key, hidden rather than gone, sick always "Off"', async () => {
    const app = world();
    const key = LeaveTypeKey.parse('sick');
    expect(await defineLeaveType(app.deps)(hr, sickType())).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(
      await changeLeaveType(app.deps)(hr, key, { kind: 'update', changes: { visibility: 'type' } }),
    ).toMatchObject({ ok: false, error: { code: 'VISIBILITY_LOCKED' } });
    expect(await changeLeaveType(app.deps)(hr, key, { kind: 'hide' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(app.state(TENANT).leaveTypes.get(key)?.hidden).toBe(true);
  });

  it('drafts a negative balance rule as the next version, and checks calendars exist', async () => {
    const app = world();
    const drafted = await setNegativeBalanceRule(app.deps)(hr, VACATION_POLICY, null);
    expect(drafted).toEqual({ ok: true, value: 2 });
    expect(app.state(TENANT).policies.get(VACATION_POLICY)?.latest.status).toBe('draft');

    const assign = assignHolidayCalendars(app.deps);
    const barcelona = LocationKey.parse('barcelona');
    expect(await assign(hr, barcelona, ['es', 'nowhere'])).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await assign(hr, barcelona, ['es'])).toEqual({ ok: true, value: undefined });
  });
});

describe('the policy preview and the pack flag (TOF-079, TOF-083)', () => {
  it('folds the draft beside the version in effect for every member, and posts nothing', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const before = app.state(TENANT).ledger.length;
    await revisePolicy(app.deps)(
      hr,
      VACATION_POLICY,
      vacationPolicy({ allowance: [{ fromYears: 0, days: '27.000' }] }),
    );
    const preview = await policyPreview(app.deps)(hr, { policyId: VACATION_POLICY });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value).toMatchObject({
      draftVersion: 2,
      effectiveFrom: '2026-10-01',
      yearEnd: '2026-12-31',
    });
    expect(preview.value.members).toHaveLength(7);
    expect(preview.value.members.find((m) => m.personId === people.adam)).toMatchObject({
      allowance: { current: '25.000', draft: '27.000' },
    });
    expect(app.state(TENANT).ledger).toHaveLength(before);
    expect(
      await policyPreview(app.deps)(caller(people.marco), { policyId: VACATION_POLICY }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('has nobody to show without a draft', async () => {
    const app = world();
    expect(await policyPreview(app.deps)(hr, { policyId: VACATION_POLICY })).toMatchObject({
      ok: true,
      value: { draftVersion: null, members: [] },
    });
  });

  it('names the Spanish pack, not yet reviewed, where its holidays are in use', async () => {
    const app = world();
    const holidays = await holidaySettings(app.deps)(hr, { year: 2026 });
    expect(holidays.ok && holidays.value.packs).toEqual([
      { country: 'ES', version: 1, reviewed: false },
    ]);
  });
});
