import { describe, expect, it } from 'vitest';
import { LeaveTypeDefinition } from '@kithena/contracts';

import { LeaveType } from './leave-type.js';

const vacation = LeaveTypeDefinition.parse({
  key: 'vacation',
  name: { default: 'Vacation' },
  category: 'annual_leave',
  colorToken: 'chart-1',
  icon: 'sun',
  tracked: true,
  paid: 'paid',
  visibility: 'type',
});

const { visibility: _ignored, ...sickWithoutVisibility } = LeaveTypeDefinition.parse({
  key: 'sick',
  name: { default: 'Sick' },
  category: 'sick_leave',
  colorToken: 'chart-3',
  icon: 'thermometer',
  tracked: false,
  paid: 'statutory',
  visibility: 'off_only',
  requiresNote: { afterDays: 3 },
  statutory: true,
});

const define = (input: Parameters<typeof LeaveType.define>[0]): LeaveType => {
  const result = LeaveType.define(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('LeaveType', () => {
  it('keeps the key it was defined with', () => {
    const type = define(vacation);
    const result = type.update({ key: 'holiday' as typeof vacation.key });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KEY_IMMUTABLE');
    expect(type.definition.key).toBe('vacation');
  });

  it('accepts an update that repeats the same key', () => {
    const type = define(vacation);
    expect(type.update({ key: vacation.key, colorToken: 'chart-2' }).ok).toBe(true);
    expect(type.definition.colorToken).toBe('chart-2');
  });

  it('can hide and show a statutory type but never delete it', () => {
    const sick = define(sickWithoutVisibility);
    sick.hide();
    expect(sick.hidden).toBe(true);
    sick.show();
    expect(sick.hidden).toBe(false);

    const result = sick.delete();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STATUTORY_NOT_DELETABLE');
    expect(sick.deleted).toBe(false);
  });

  it('deletes a type the tenant made itself', () => {
    const type = define(vacation);
    expect(type.delete().ok).toBe(true);
    expect(type.deleted).toBe(true);
  });

  it('shows teammates only "Off" for sick and parental unless told otherwise', () => {
    expect(define(sickWithoutVisibility).definition.visibility).toBe('off_only');
    expect(
      define({
        ...sickWithoutVisibility,
        key: 'parental' as typeof vacation.key,
        category: 'parental_leave',
      }).definition.visibility,
    ).toBe('off_only');
    const { visibility: _v, ...vacationWithoutVisibility } = vacation;
    expect(define(vacationWithoutVisibility).definition.visibility).toBe('type');
  });

  it('refuses to define sick or parental leave that shows its type to teammates', () => {
    const result = LeaveType.define({ ...sickWithoutVisibility, visibility: 'type' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VISIBILITY_LOCKED');
  });

  it('refuses to loosen sick leave to show its type', () => {
    const sick = define(sickWithoutVisibility);
    const result = sick.update({ visibility: 'type' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VISIBILITY_LOCKED');
    expect(sick.definition.visibility).toBe('off_only');
  });

  it('refuses to turn a visible type into parental leave without hiding it', () => {
    const type = define(vacation);
    const result = type.update({ category: 'parental_leave' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VISIBILITY_LOCKED');
    expect(type.definition.category).toBe('annual_leave');
  });

  it('refuses to change a deleted type', () => {
    const type = define(vacation);
    type.delete();
    const result = type.update({ colorToken: 'chart-2' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DELETED');
  });
});

describe('LeaveType.rehydrate', () => {
  it('comes back hidden or deleted as it was stored', () => {
    const type = LeaveType.rehydrate({ definition: vacation, hidden: true, deleted: true });
    expect(type.definition).toEqual(vacation);
    expect(type.hidden).toBe(true);
    expect(type.deleted).toBe(true);
  });

  it('still refuses a stored private type that shows its reason', () => {
    expect(() =>
      LeaveType.rehydrate({
        definition: { ...sickWithoutVisibility, visibility: 'type' },
        hidden: false,
        deleted: false,
      }),
    ).toThrow(/Off/u);
  });
});
