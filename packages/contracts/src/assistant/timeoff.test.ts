import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { policy } from '../classification.js';
import {
  CatalogueLeaveType,
  isPrivateLeaveType,
  timeoffCapabilities,
  TimeOffAway,
  TimeOffManagers,
} from './timeoff.js';

const ANA = '0190a0b0-0000-7000-8000-000000000001';
const MARCO = '0190a0b0-0000-7000-8000-000000000002';

const away = {
  kind: 'people',
  rows: [
    {
      personId: ANA,
      name: 'Ana Ruiz',
      detail: 'Mon 12 to Wed 14 · Vacation',
      groups: { team: 'Engineering' },
    },
  ],
  ids: [ANA],
  total: 1,
  scope: 'visible',
  described: 'away from Monday 12 to Sunday 18 October',
  notes: ['Monday 12 October is a public holiday in Madrid.'],
};

describe('Time Off’s capabilities (AST-003)', () => {
  it('are away and managers', () => {
    expect(timeoffCapabilities.map((c) => c.name)).toEqual(['timeoff.away', 'timeoff.managers']);
  });

  it('timeoff.away: a date it must have, leave type and team, within', () => {
    const { step, input, output } = TimeOffAway.schemas;
    expect(
      step.safeParse({
        on: 'today',
        filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }],
      }).success,
    ).toBe(true);
    expect(step.safeParse({ filters: [] }).success).toBe(false);
    expect(
      step.safeParse({ on: 'today', filters: [{ key: 'department', op: 'in', values: ['x'] }] })
        .success,
    ).toBe(false);
    expect(
      input.safeParse({ on: { from: '2026-10-12', to: '2026-10-18' }, limit: 25, personIds: [ANA] })
        .success,
    ).toBe(true);
    expect(output.safeParse(away).success).toBe(true);
    expect(TimeOffAway.groups).toEqual(['team', 'location']);
  });

  it('gives way to People for teams and managers', () => {
    expect(TimeOffAway.yields).toEqual({ team: 'people.find' });
    expect(TimeOffManagers.yields).toEqual({ 'timeoff.managers': 'people.managers' });
  });

  it('timeoff.managers: only ever within an earlier step', () => {
    expect(TimeOffManagers.schemas.input.safeParse({ limit: 25, personIds: [MARCO] }).success).toBe(
      true,
    );
    expect(TimeOffManagers.schemas.input.safeParse({ limit: 25 }).success).toBe(false);
    expect(TimeOffManagers.schemas.output.safeParse({ ...away, ids: undefined }).success).toBe(
      true,
    );
  });

  it('classifies a row’s detail as special-category health data', () => {
    const output = TimeOffAway.schemas.output;
    if (!(output instanceof z.ZodDiscriminatedUnion)) throw new Error('away takes a name');
    const people = output.options.find(
      (o): o is z.ZodObject => o instanceof z.ZodObject && o.shape['rows'] !== undefined,
    );
    const rows: unknown = people?.shape['rows'];
    if (!(rows instanceof z.ZodArray) || !(rows.element instanceof z.ZodObject)) {
      throw new Error('away answers with rows');
    }
    const detail = policy.get(rows.element.shape['detail']);
    expect(detail?.classification).toBe('special-category');
    expect(detail?.piiKind).toBe('health');
    expect(detail?.aiEligible).toBe(false);
  });

  it('marks sick, parental and Off-only types private', () => {
    expect(isPrivateLeaveType({ category: 'sick_leave', visibility: 'off_only' })).toBe(true);
    expect(isPrivateLeaveType({ category: 'parental_leave', visibility: 'type' })).toBe(true);
    expect(isPrivateLeaveType({ category: 'other', visibility: 'off_only' })).toBe(true);
    expect(isPrivateLeaveType({ category: 'annual_leave', visibility: 'type' })).toBe(false);
    expect(
      CatalogueLeaveType.safeParse({ key: 'sick', name: 'Baja médica', private: true }).success,
    ).toBe(true);
    expect(CatalogueLeaveType.safeParse({ key: 'sick', name: 'Baja médica' }).success).toBe(false);
  });

  it('carries a type’s category, so the assistant knows which words name it', () => {
    const sick = { key: 'sick', name: 'Baja médica', private: true, category: 'sick_leave' };
    expect(CatalogueLeaveType.safeParse(sick).success).toBe(true);
    expect(CatalogueLeaveType.safeParse({ ...sick, category: 'flu' }).success).toBe(false);
  });
});
