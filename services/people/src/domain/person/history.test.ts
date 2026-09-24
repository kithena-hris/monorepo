import { describe, expect, it } from 'vitest';

import {
  arrived,
  correct,
  record,
  scheduled,
  timelineOf,
  valueAsOf,
  type HistoryEntry,
} from './history.js';

/**
 * A change is a new dated fact. A correction replaces one and never overwrites.
 *
 * The test that matters is the last one in this file, and it is the sentence
 * the ticket is written around: **a salary typo corrected three months later
 * must not read as a pay cut followed by a raise.** Payroll computes
 * retroactive deltas off this timeline, and an UPDATE would turn a typo into a
 * back-pay run.
 */

const actor = { kind: 'system', process: 'test' } as const;

const entry = (over: Partial<HistoryEntry> & { id: string }): HistoryEntry => ({
  attributeKey: 'base_salary',
  value: 50_000_00,
  effectiveFrom: '2026-01-01',
  recordedAt: '2026-01-01T09:00:00.000Z',
  actor,
  supersedes: null,
  eventId: null,
  ...over,
});

describe('reading a value as of a date', () => {
  const history = [
    entry({ id: 'h1', value: 50_000_00, effectiveFrom: '2026-01-01' }),
    entry({ id: 'h2', value: 55_000_00, effectiveFrom: '2026-06-01' }),
  ];

  it('gives the fact in force on that date', () => {
    expect(valueAsOf(history, 'base_salary', '2026-03-15')?.value).toBe(50_000_00);
    expect(valueAsOf(history, 'base_salary', '2026-07-01')?.value).toBe(55_000_00);
  });

  it('gives the fact in force on the day it takes effect', () => {
    // Half-open from the effective date: a raise effective on the 1st is in
    // force on the 1st, not from the 2nd.
    expect(valueAsOf(history, 'base_salary', '2026-06-01')?.value).toBe(55_000_00);
  });

  it('gives nothing before the first fact', () => {
    expect(valueAsOf(history, 'base_salary', '2025-12-31')).toBeUndefined();
  });

  it('ignores another attribute entirely', () => {
    expect(valueAsOf(history, 'job_title', '2026-07-01')).toBeUndefined();
  });
});

describe('recording a change', () => {
  it('adds a dated fact rather than replacing one', () => {
    const history = [entry({ id: 'h1' })];
    const next = record(history, {
      id: 'h2',
      attributeKey: 'base_salary',
      value: 55_000_00,
      effectiveFrom: '2026-06-01',
      recordedAt: '2026-05-20T09:00:00.000Z',
      actor,
    });

    expect(next).toHaveLength(2);
    expect(history).toHaveLength(1);
  });

  it('keeps the two dates apart', () => {
    // `recordedAt` is when we were told; `effectiveFrom` is when it takes
    // effect. A promotion entered on the 15th and effective on the 1st needs
    // both, or payroll cannot compute the retroactive delta.
    const [written] = record([], {
      id: 'h1',
      attributeKey: 'job_title',
      value: 'Staff Engineer',
      effectiveFrom: '2026-05-01',
      recordedAt: '2026-05-15T09:00:00.000Z',
      actor,
    });

    expect(written).toMatchObject({
      effectiveFrom: '2026-05-01',
      recordedAt: '2026-05-15T09:00:00.000Z',
      supersedes: null,
    });
  });
});

describe('a correction', () => {
  const typo = entry({ id: 'h1', value: 5_000_00, effectiveFrom: '2026-01-01' });

  it('carries what it supersedes', () => {
    const corrected = correct([typo], {
      id: 'h2',
      supersedes: 'h1',
      value: 50_000_00,
      recordedAt: '2026-04-01T09:00:00.000Z',
      actor,
    });

    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.value[1]).toMatchObject({
      supersedes: 'h1',
      value: 50_000_00,
      // The correction takes effect when the fact it corrects did. This is the
      // whole mechanism.
      effectiveFrom: '2026-01-01',
    });
  });

  it('leaves the row it corrects in place', () => {
    // History is append-only. "What did we believe in February" has an answer,
    // and an auditor asking why March's payslip was wrong needs it.
    const corrected = correct([typo], {
      id: 'h2',
      supersedes: 'h1',
      value: 50_000_00,
      recordedAt: '2026-04-01T09:00:00.000Z',
      actor,
    });
    if (!corrected.ok) return;
    expect(corrected.value[0]).toBe(typo);
  });

  it('refuses to correct a row that does not exist', () => {
    const missing = correct([typo], {
      id: 'h2',
      supersedes: 'nope',
      value: 50_000_00,
      recordedAt: '2026-04-01T09:00:00.000Z',
      actor,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('SUPERSEDES_UNKNOWN');
  });

  it('refuses to correct the same row twice', () => {
    // Two live corrections of one fact is two answers to "what was the salary
    // in March". The second correction supersedes the first.
    const once = correct([typo], {
      id: 'h2',
      supersedes: 'h1',
      value: 50_000_00,
      recordedAt: '2026-04-01T09:00:00.000Z',
      actor,
    });
    if (!once.ok) return;

    const twice = correct(once.value, {
      id: 'h3',
      supersedes: 'h1',
      value: 51_000_00,
      recordedAt: '2026-04-02T09:00:00.000Z',
      actor,
    });
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error.code).toBe('ALREADY_CORRECTED');
  });
});

describe('the timeline a correction produces', () => {
  /*
   * The sentence this file exists for.
   *
   * January: salary recorded as 5,000 — a typo, a zero short.
   * June:    a genuine raise to 55,000.
   * April:   somebody notices January was wrong and corrects it to 50,000.
   *
   * Read naively, that is a pay cut in January and two raises afterwards.
   * Read correctly, it is one salary of 50,000 from January and one raise in
   * June, which is what payroll has to see.
   */
  const january = entry({ id: 'h1', value: 5_000_00, effectiveFrom: '2026-01-01' });
  const june = entry({
    id: 'h2',
    value: 55_000_00,
    effectiveFrom: '2026-06-01',
    recordedAt: '2026-05-20T09:00:00.000Z',
  });

  const corrected = correct([january, june], {
    id: 'h3',
    supersedes: 'h1',
    value: 50_000_00,
    recordedAt: '2026-04-01T09:00:00.000Z',
    actor,
  });

  it('does not read as a pay cut followed by a raise', () => {
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;

    const timeline = timelineOf(corrected.value, 'base_salary');
    expect(timeline.map((e) => [e.effectiveFrom, e.value])).toEqual([
      ['2026-01-01', 50_000_00],
      ['2026-06-01', 55_000_00],
    ]);
  });

  it('answers March with the corrected figure, not the typo', () => {
    if (!corrected.ok) return;
    expect(valueAsOf(corrected.value, 'base_salary', '2026-03-15')?.value).toBe(50_000_00);
  });

  it('still holds the superseded row for anyone who asks', () => {
    if (!corrected.ok) return;
    expect(corrected.value.map((e: HistoryEntry) => e.id)).toEqual(['h1', 'h2', 'h3']);
  });
});

describe('a value dated in the future, when its day comes (PEO-124)', () => {
  const manager = (over: Partial<HistoryEntry> & { id: string }) =>
    entry({ attributeKey: 'manager_id', ...over });
  const standing = manager({
    id: 'm1',
    value: 'ada',
    effectiveFrom: '2026-01-01',
    recordedAt: '2026-01-01T13:00:00.000Z',
  });
  // Recorded on 24 September, in force from 1 October.
  const pending = manager({
    id: 'm2',
    value: 'grace',
    effectiveFrom: '2026-10-01',
    recordedAt: '2026-09-24T09:00:00.000Z',
  });
  const projection = { manager_id: 'ada' };

  it('is scheduled only when dated after the day it was recorded anywhere on Earth', () => {
    expect(scheduled(pending)).toBe(true);
    expect(scheduled(standing)).toBe(false);
    // 23:00 UTC on the 30th is already the 1st in Auckland and still the
    // 30th at UTC−12: a row dated the 1st may have been future for somebody.
    const edge = manager({ id: 'x', effectiveFrom: '2026-10-01', recordedAt: '2026-09-30T23:00:00.000Z' });
    expect(scheduled(edge)).toBe(true);
    const late = manager({ id: 'y', effectiveFrom: '2026-09-30', recordedAt: '2026-10-01T13:00:00.000Z' });
    expect(scheduled(late)).toBe(false);
  });

  it('has not arrived before its day, and has on it', () => {
    const history = [standing, pending];
    expect(arrived(history, ['manager_id'], '2026-09-30', projection)).toEqual([]);
    expect(arrived(history, ['manager_id'], '2026-10-01', projection).map((e) => e.id)).toEqual([
      'm2',
    ]);
  });

  it('is nothing to do once the projection holds it, so a rerun is a no-op', () => {
    expect(arrived([standing, pending], ['manager_id'], '2026-10-05', { manager_id: 'grace' })).toEqual(
      [],
    );
  });

  it('brings in the latest in force when several arrived, not each in turn', () => {
    const later = manager({
      id: 'm3',
      value: 'hedy',
      effectiveFrom: '2026-10-03',
      recordedAt: '2026-09-25T09:00:00.000Z',
    });
    const due = arrived([standing, pending, later], ['manager_id'], '2026-10-05', projection);
    expect(due.map((e) => e.id)).toEqual(['m3']);
  });

  it('brings in the correction of a pending value, not the value it corrected', () => {
    const corrected = correct([standing, pending], {
      id: 'm2c',
      supersedes: 'm2',
      value: 'hedy',
      recordedAt: '2026-09-26T09:00:00.000Z',
      actor,
    });
    if (!corrected.ok) throw new Error('refused');
    const due = arrived(corrected.value, ['manager_id'], '2026-10-01', projection);
    expect(due.map((e) => [e.id, e.value])).toEqual([['m2c', 'hedy']]);
  });

  it('orders the arrivals by the day each took effect', () => {
    const office = entry({
      id: 'o1',
      attributeKey: 'location_id',
      value: 'akl',
      effectiveFrom: '2026-09-28',
      recordedAt: '2026-09-20T09:00:00.000Z',
    });
    const due = arrived(
      [standing, pending, office],
      ['manager_id', 'location_id'],
      '2026-10-02',
      projection,
    );
    expect(due.map((e) => e.id)).toEqual(['o1', 'm2']);
  });

  it('leaves alone a key it was not asked about, and a value nothing scheduled', () => {
    expect(arrived([standing, pending], ['cost_centre'], '2026-10-02', projection)).toEqual([]);
    // In force and written that way: the write projected it already, whatever
    // the projection says since (a retention job may have cleared it).
    expect(arrived([standing], ['manager_id'], '2026-10-02', {})).toEqual([]);
  });

  it('reads an object value as the same whatever order its keys are in', () => {
    const address = entry({
      id: 'a1',
      attributeKey: 'home_address',
      value: { city: 'Madrid', country: 'ES' },
      effectiveFrom: '2026-10-01',
      recordedAt: '2026-09-24T09:00:00.000Z',
    });
    const held = { home_address: { country: 'ES', city: 'Madrid' } };
    expect(arrived([address], ['home_address'], '2026-10-01', held)).toEqual([]);
  });
});
