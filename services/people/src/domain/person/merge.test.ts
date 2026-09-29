import { describe, expect, it } from 'vitest';

import type { HistoryEntry } from './history.js';
import {
  candidates,
  matchBand,
  mergeRefusal,
  pairKey,
  unmergePlan,
  unmergeRefusal,
  valuesTaken,
  type SignalRow,
} from './merge.js';
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

describe('how strong a match is', () => {
  const band = (...signals: SignalRow['signal'][]) =>
    matchBand(signals.map((signal) => ({ signal, attributeKey: null })));

  it('calls a shared unique value strong, on its own', () => {
    expect(band('unique_value')).toBe('strong');
  });

  it('calls a shared work email likely, and a name with a birth date possible', () => {
    expect(band('work_email')).toBe('likely');
    expect(band('scim_work_email')).toBe('likely');
    expect(band('name_and_birth_date')).toBe('possible');
  });

  it('adds up signals that agree: a work email with a name and birth date is strong', () => {
    expect(band('work_email', 'name_and_birth_date')).toBe('strong');
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

describe('undoing a merge', () => {
  const merged = snapshot(B, { status: 'merged', mergedInto: A });
  const survivor = snapshot(A, { status: 'active', hireDate: '2026-01-05' });

  it('is allowed for a tombstone whose survivor still stands', () => {
    expect(unmergeRefusal(merged, survivor, false)).toBeNull();
  });

  it('is refused for a record that was not merged, or merged somewhere else', () => {
    expect(unmergeRefusal(snapshot(B), survivor, false)?.code).toBe('UNMERGE_NOT_MERGED');
    expect(unmergeRefusal(snapshot(B, { status: 'merged', mergedInto: C }), survivor, false)?.code).toBe(
      'UNMERGE_NOT_MERGED',
    );
  });

  it('is refused once the tombstone was erased: there is nothing left to give back', () => {
    expect(unmergeRefusal(merged, survivor, true)?.code).toBe('UNMERGE_ERASED');
  });

  it('is refused while the survivor is itself a tombstone: that is undone first', () => {
    for (const status of ['merged', 'discarded'] as const) {
      const gone = snapshot(A, { status, ...(status === 'merged' ? { mergedInto: C } : {}) });
      expect(unmergeRefusal(merged, gone, false)?.code, status).toBe('UNMERGE_SURVIVOR_GONE');
    }
  });
});

describe('what an undo reverses on the survivor', () => {
  const row = (
    id: string,
    attributeKey: string,
    value: unknown,
    effectiveFrom: string,
    recordedAt: string,
    supersedes: string | null = null,
  ): HistoryEntry => ({
    id,
    attributeKey,
    value,
    effectiveFrom,
    recordedAt,
    supersedes,
    actor: { kind: 'system', process: 'test' },
    eventId: null,
  });
  const before = row('h1', 'given_name', 'Ada', '2026-01-05', '2026-01-05T09:00:00Z');
  const merge = row('h2', 'given_name', 'Augusta', '2026-09-26', '2026-09-26T09:00:00Z');
  const phone = row('h3', 'work_phone', '+34 600', '2026-09-26', '2026-09-26T09:00:00Z');

  it('corrects each value the merge wrote back to what stood before it, from the same day', () => {
    expect(unmergePlan({ given_name: 'h2' }, [before, merge], new Set())).toEqual({
      reverse: [{ key: 'given_name', supersedes: 'h2', value: 'Ada' }],
      kept: [],
    });
  });

  it('clears a value the survivor never had', () => {
    expect(unmergePlan({ work_phone: 'h3' }, [phone], new Set(['work_phone'])).reverse).toEqual([
      { key: 'work_phone', supersedes: 'h3', value: null },
    ]);
  });

  it('keeps a value the survivor held with no history row to say what: it cannot be guessed', () => {
    expect(unmergePlan({ work_phone: 'h3' }, [phone], new Set())).toEqual({
      reverse: [],
      kept: ['work_phone'],
    });
  });

  it('keeps a value changed since the merge, and says so, rather than clobbering it', () => {
    const edited = row('h4', 'given_name', 'Ada L.', '2026-09-27', '2026-09-27T09:00:00Z');
    const corrected = row('h5', 'work_phone', '+34 601', '2026-09-26', '2026-09-27T09:00:00Z', 'h3');
    expect(
      unmergePlan({ given_name: 'h2', work_phone: 'h3' }, [before, merge, phone, edited, corrected], new Set()),
    ).toEqual({
      reverse: [],
      kept: ['given_name', 'work_phone'],
    });
  });

  it('reads a backdated change recorded since as what stood before, not as a change to keep', () => {
    const backdated = row('h6', 'given_name', 'Ada K.', '2026-06-01', '2026-09-27T09:00:00Z');
    expect(unmergePlan({ given_name: 'h2' }, [before, merge, backdated], new Set()).reverse).toEqual([
      { key: 'given_name', supersedes: 'h2', value: 'Ada K.' },
    ]);
  });

  it('keeps a key whose row is gone, having nothing to supersede', () => {
    expect(unmergePlan({ given_name: 'missing' }, [before], new Set())).toEqual({
      reverse: [],
      kept: ['given_name'],
    });
  });
});
