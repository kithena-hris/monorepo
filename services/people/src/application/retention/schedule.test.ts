import { describe, expect, it } from 'vitest';
import type { FieldPolicy } from '@kithena/contracts';

import { addMonths, dueForAnonymisation } from './schedule.js';

const kept = (retention: FieldPolicy['retention']): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
  retention,
});

describe('the retention schedule', () => {
  it('lets a statutory floor beat a shorter tenant policy', () => {
    // The tenant chose 12 months; Spanish labour law says four years.
    const attributes = [{ key: 'payslips', policy: kept({ monthsAfterTermination: 12, statutoryFloor: 'es-labour' }) }];

    // Two years after leaving: the tenant's 12 months are long gone, the floor is not.
    expect(dueForAnonymisation(attributes, '2024-03-31', '2026-03-31')).toEqual([]);

    // Four years after leaving, the floor has passed, and it is what decided.
    expect(dueForAnonymisation(attributes, '2024-03-31', '2028-03-31')).toEqual([
      { key: 'payslips', classification: 'confidential', dueOn: '2028-03-31', under: 'statutory_floor', floor: 'es-labour' },
    ]);
  });

  it('uses the tenant policy when it is the longer of the two', () => {
    const attributes = [{ key: 'payslips', policy: kept({ monthsAfterTermination: 120, statutoryFloor: 'es-labour' }) }];
    expect(dueForAnonymisation(attributes, '2020-01-15', '2030-01-15')).toEqual([
      { key: 'payslips', classification: 'confidential', dueOn: '2030-01-15', under: 'tenant_policy', floor: 'es-labour' },
    ]);
  });

  it('is not due the day before, and never for a field with no retention policy', () => {
    const attributes = [
      { key: 'phone', policy: kept({ monthsAfterTermination: 6 }) },
      { key: 'hire_date', policy: kept(undefined) },
    ];
    expect(dueForAnonymisation(attributes, '2026-01-10', '2026-07-09')).toEqual([]);
    expect(dueForAnonymisation(attributes, '2026-01-10', '2026-07-10').map((d) => d.key)).toEqual(['phone']);
  });
});

describe('adding months to a calendar date', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-11-30', 3)).toBe('2025-02-28');
    expect(addMonths('2024-03-15', 0)).toBe('2024-03-15');
  });
});
