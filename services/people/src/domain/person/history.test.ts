import { describe, expect, it } from 'vitest';

import { correct, record, timelineOf, valueAsOf, type HistoryEntry } from './history.js';

/**
 * A change is a new dated fact. A correction replaces one and never overwrites.
 *
 * The test that matters is the last one in this file, and it is the sentence
 * the ticket is written around: **a salary typo corrected three months later
 * must not read as a pay cut followed by a raise.** Payroll computes
 * retroactive deltas off this timeline, and an UPDATE would turn a typo into a
 * back-pay run.
 */

const entry = (over: Partial<HistoryEntry> & { id: string }): HistoryEntry => ({
  attributeKey: 'base_salary',
  value: 50_000_00,
  effectiveFrom: '2026-01-01',
  recordedAt: '2026-01-01T09:00:00.000Z',
  supersedes: null,
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
    });
    if (!once.ok) return;

    const twice = correct(once.value, {
      id: 'h3',
      supersedes: 'h1',
      value: 51_000_00,
      recordedAt: '2026-04-02T09:00:00.000Z',
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
    expect(corrected.value.map((e) => e.id)).toEqual(['h1', 'h2', 'h3']);
  });
});
