import { describe, expect, it } from 'vitest';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import { define } from './in-memory.js';
import { refinable } from './person-access.js';

const none: ViewerRelations = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
};
const hr = { ...none, isHr: true };

const department = define({ key: 'department', visibility: ['directory', 'hr'] });
const salaryNote = define({ key: 'salary_note', visibility: ['hr'] });
const manager = define({ key: 'manager_id', visibility: ['directory', 'hr'] });
const definitions = [department, salaryNote, manager];

const code = (r: ReturnType<typeof refinable>) => (r.ok ? 'ok' : r.error.code);

describe('refinable', () => {
  it('lets anybody narrow and sort by what they read on everybody', () => {
    expect(
      code(
        refinable(
          definitions,
          {
            conditions: [{ key: 'department', op: 'in', values: ['sales', 'accounting'] }],
            sort: { key: 'department', direction: 'asc' },
          },
          none,
        ),
      ),
    ).toBe('ok');
  });

  it('refuses a field the viewer cannot read on everybody, as a condition and as an order', () => {
    expect(
      code(
        refinable(
          definitions,
          { conditions: [{ key: 'salary_note', op: 'not_empty', values: [] }] },
          none,
        ),
      ),
    ).toBe('FIELD_NOT_FILTERABLE');
    expect(
      code(refinable(definitions, { sort: { key: 'salary_note', direction: 'asc' } }, none)),
    ).toBe('FIELD_NOT_SORTABLE');
    expect(
      code(
        refinable(
          definitions,
          { conditions: [{ key: 'salary_note', op: 'not_empty', values: [] }] },
          hr,
        ),
      ),
    ).toBe('ok');
  });

  it('gives status to HR alone, and sorts anybody by name', () => {
    const byStatus = { conditions: [{ key: 'status', op: 'is' as const, values: ['active'] }] };
    expect(code(refinable(definitions, byStatus, none))).toBe('FIELD_NOT_FILTERABLE');
    expect(code(refinable(definitions, byStatus, hr))).toBe('ok');
    expect(code(refinable(definitions, { sort: { key: 'name', direction: 'desc' } }, none))).toBe(
      'ok',
    );
  });

  it('checks each operator takes the values it needs, and only walks the reporting line', () => {
    const one = (op: 'between' | 'empty' | 'under', key: string, values: string[]) =>
      code(refinable(definitions, { conditions: [{ key, op, values }] }, hr));
    expect(one('between', 'department', ['a'])).toBe('CONDITION_INVALID');
    expect(one('empty', 'department', ['x'])).toBe('CONDITION_INVALID');
    expect(one('under', 'department', ['x'])).toBe('CONDITION_INVALID');
    expect(one('under', 'manager_id', ['00000000-0000-4000-8000-000000000001'])).toBe('ok');
  });

  it('caps how many conditions one list may combine', () => {
    const many = Array.from({ length: 21 }, () => ({
      key: 'department',
      op: 'is' as const,
      values: ['x'],
    }));
    expect(code(refinable(definitions, { conditions: many }, hr))).toBe('TOO_MANY_CONDITIONS');
  });

  it('orders and narrows by a metric only as its fields allow: missing details are HR’s, reports the manager field’s', () => {
    const by = (key: string, who: ViewerRelations) =>
      code(refinable(definitions, { sort: { key, direction: 'desc' } }, who));
    expect(by('missing_count', none)).toBe('FIELD_NOT_SORTABLE');
    expect(by('missing_count', hr)).toBe('ok');
    expect(by('direct_reports', none)).toBe('ok');
    // No start date in this schema: tenure is nobody's to sort by.
    expect(by('tenure_days', hr)).toBe('FIELD_NOT_SORTABLE');
    const more = { conditions: [{ key: 'missing_count', op: 'after' as const, values: ['4'] }] };
    expect(code(refinable(definitions, more, none))).toBe('FIELD_NOT_FILTERABLE');
    expect(code(refinable(definitions, more, hr))).toBe('ok');
    // Completeness orders, and is no condition.
    const complete = { conditions: [{ key: 'completeness', op: 'after' as const, values: ['1'] }] };
    expect(code(refinable(definitions, complete, hr))).toBe('FIELD_NOT_FILTERABLE');
  });

  it('takes "none of" as it takes "any of"', () => {
    const not = { conditions: [{ key: 'department', op: 'not_in' as const, values: ['sales'] }] };
    expect(code(refinable(definitions, not, none))).toBe('ok');
    const empty = { conditions: [{ key: 'department', op: 'not_in' as const, values: [] }] };
    expect(code(refinable(definitions, empty, none))).toBe('CONDITION_INVALID');
  });
});
