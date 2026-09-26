import { describe, expect, it } from 'vitest';

import { candidates, mergeRefusal, pairKey, valuesTaken, type SignalRow } from './merge.js';
import type { PersonSnapshot } from './person.js';

/**
 * Duplicate detection and merge (PEO-074; PRD §12.4): code ranks, a human
 * decides, and a merge is additive — the absorbed record becomes a tombstone
 * pointing at the survivor.
 */

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000a3';

function snapshot(id: string, over: Partial<PersonSnapshot> = {}): PersonSnapshot {
  return {
    id,
    tenantId: '00000000-0000-4000-8000-000000000001',
    status: 'provisional',
    identityAccountId: null,
    hireDate: null,
    lastWorkingDay: null,
    ...over,
  };
}

describe('ranking the candidates', () => {
  const rows: SignalRow[] = [
    { a: B, b: A, signal: 'name_and_birth_date', attributeKey: null },
    { a: A, b: C, signal: 'work_email', attributeKey: null },
    { a: A, b: B, signal: 'work_email', attributeKey: null },
    { a: B, b: C, signal: 'unique_value', attributeKey: 'es_nif' },
  ];

  it('puts one pair together whichever way round a signal named it, strongest first', () => {
    expect(candidates(rows, new Set())).toEqual([
      {
        personIds: [A, B],
        signals: [
          { signal: 'work_email', attributeKey: null },
          { signal: 'name_and_birth_date', attributeKey: null },
        ],
      },
      { personIds: [B, C], signals: [{ signal: 'unique_value', attributeKey: 'es_nif' }] },
      { personIds: [A, C], signals: [{ signal: 'work_email', attributeKey: null }] },
    ]);
  });

  it('leaves out a pair somebody has already decided', () => {
    const left = candidates(rows, new Set([pairKey(B, A)]));
    expect(left.map((c) => c.personIds)).toEqual([
      [B, C],
      [A, C],
    ]);
  });

  it('names a pair the same whichever way round it is asked', () => {
    expect(pairKey(A, B)).toBe(pairKey(B, A));
  });

  it('never pairs a record with itself', () => {
    expect(candidates([{ a: A, b: A, signal: 'work_email', attributeKey: null }], new Set())).toEqual(
      [],
    );
  });
});

describe('who may absorb whom', () => {
  it('lets an employed record absorb one that was never hired', () => {
    const survivor = snapshot(A, { status: 'active', hireDate: '2026-01-05' });
    expect(mergeRefusal(survivor, snapshot(B))).toBeNull();
  });

  it('lets one provisional record absorb another', () => {
    expect(mergeRefusal(snapshot(A), snapshot(B))).toBeNull();
  });

  it('refuses a record absorbing itself', () => {
    expect(mergeRefusal(snapshot(A), snapshot(A))?.code).toBe('SAME_PERSON');
  });

  it('never absorbs a record that holds an employment: that is payroll history', () => {
    for (const status of ['pre_hire', 'active', 'on_leave', 'notice', 'terminated'] as const) {
      const absorbed = snapshot(B, { status, hireDate: '2026-01-05' });
      expect(mergeRefusal(snapshot(A), absorbed)?.code, status).toBe('MERGE_ABSORBS_EMPLOYMENT');
    }
  });

  it('refuses a tombstone on either side', () => {
    const merged = snapshot(B, { status: 'merged', mergedInto: C });
    expect(mergeRefusal(snapshot(A), merged)?.code).toBe('MERGE_TOMBSTONE');
    expect(mergeRefusal(merged, snapshot(A))?.code).toBe('MERGE_TOMBSTONE');
    expect(mergeRefusal(snapshot(A), snapshot(B, { status: 'discarded' }))?.code).toBe(
      'MERGE_TOMBSTONE',
    );
  });

  it('refuses two records that each sign in: which login survives is not ours to pick', () => {
    const survivor = snapshot(A, { identityAccountId: '00000000-0000-4000-8000-0000000000b1' });
    const absorbed = snapshot(B, { identityAccountId: '00000000-0000-4000-8000-0000000000b2' });
    expect(mergeRefusal(survivor, absorbed)?.code).toBe('MERGE_TWO_ACCOUNTS');
  });
});

describe('the values taken from the absorbed record', () => {
  const absorbed = { given_name: 'Ada', date_of_birth: '1990-04-03', pronouns: null };
  const takeable = new Set(['given_name', 'date_of_birth', 'pronouns']);

  it('are the absorbed record’s values for the keys chosen', () => {
    const taken = valuesTaken(['date_of_birth'], absorbed, takeable);
    expect(taken).toEqual({ ok: true, value: { date_of_birth: '1990-04-03' } });
  });

  it('refuse a key the reviewer may not choose, naming it', () => {
    const taken = valuesTaken(['base_salary'], absorbed, takeable);
    expect(taken.ok).toBe(false);
    if (taken.ok) return;
    expect(taken.error.code).toBe('FIELD_NOT_WRITABLE');
    expect(taken.error.path).toEqual(['base_salary']);
  });

  it('refuse a key the absorbed record holds nothing for, rather than clearing the survivor’s', () => {
    const taken = valuesTaken(['pronouns'], absorbed, takeable);
    expect(taken.ok).toBe(false);
    if (taken.ok) return;
    expect(taken.error.code).toBe('NOTHING_TO_TAKE');
  });
});
