import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import { actionsFor, dateOrderOf, decide, defaultAction, needsReview } from './retype.js';

/**
 * Changing a field that already holds values (a text becoming a date, an
 * option retired): which changes need every value looked at, how the dates
 * a company typed are read, and what happens to each value that does not fit.
 */

const field = (over: Partial<AttributeDefinitionInput> = {}) =>
  AttributeDefinition.parse({
    key: 'start_day',
    sectionKey: 'employment',
    label: { default: 'Start day' },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['self', 'hr'],
    collectAt: 'hr_only',
    classification: { classification: 'internal', piiKind: 'none', exportable: true, aiEligible: true },
    classificationSource: 'human',
    origin: 'tenant',
    ...over,
  });

const choice = (options: { value: string; retiredAt?: string }[]) =>
  field({
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: options.map((o) => ({
        value: o.value,
        label: { default: o.value },
        retiredAt: o.retiredAt ?? null,
      })),
    },
  });

describe('which changes need the values reviewed', () => {
  it('a new field, or a new label, does not', () => {
    expect(needsReview(undefined, field())).toBe(false);
    expect(needsReview(field(), field({ label: { default: 'First day' } }))).toBe(false);
  });

  it('a new type does', () => {
    expect(needsReview(field(), field({ dataType: 'date', typeConfig: { kind: 'date' } }))).toBe(
      true,
    );
  });

  it('a format setting does: fewer decimals, another currency', () => {
    const decimal = (decimals: number) =>
      field({ dataType: 'decimal', typeConfig: { kind: 'decimal', decimals } });
    expect(needsReview(decimal(2), decimal(0))).toBe(true);
    expect(needsReview(decimal(2), decimal(2))).toBe(false);
  });

  it('adding an option does not; retiring or removing one does', () => {
    const was = choice([{ value: 'a' }, { value: 'b' }]);
    expect(needsReview(was, choice([{ value: 'a' }, { value: 'b' }, { value: 'c' }]))).toBe(false);
    expect(
      needsReview(was, choice([{ value: 'a' }, { value: 'b', retiredAt: '2026-10-01T00:00:00Z' }])),
    ).toBe(true);
    expect(needsReview(was, choice([{ value: 'a' }]))).toBe(true);
  });
});

describe('how typed dates are read', () => {
  it('a day above 12 first means day/month/year', () => {
    expect(dateOrderOf(['12/03/2024', '25/12/2023'])).toBe('dmy');
  });

  it('a day above 12 second means month/day/year', () => {
    expect(dateOrderOf(['03/12/2024', '12/25/2023'])).toBe('mdy');
  });

  it('nothing to tell them apart reads day/month/year, as the import does', () => {
    expect(dateOrderOf(['01/02/2024', '3.4.2024'])).toBe('dmy');
  });

  it('the larger side wins a mixed file; ISO alone stays ISO', () => {
    expect(dateOrderOf(['13/01/2024', '14/01/2024', '01/13/2024'])).toBe('dmy');
    expect(dateOrderOf(['2024-03-12', 'soon'])).toBe('iso');
  });
});

describe('what happens to a value that does not fit', () => {
  const problems = [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }];

  it('the employee is asked for their own details; HR fills in the rest', () => {
    expect(defaultAction(field({ ownership: ['employee', 'hr'] }))).toBe('request');
    expect(defaultAction(field({ ownership: ['hr'] }))).toBe('hr');
    expect(actionsFor(field({ ownership: ['hr'] }))).toEqual(['edit', 'clear', 'hr', 'leave']);
    expect(actionsFor(field({ ownership: ['employee'] }))).toEqual([
      'edit',
      'clear',
      'request',
      'leave',
    ]);
  });

  it('takes each decision, and the default for a value nobody decided', () => {
    const decided = decide(field({ ownership: ['employee', 'hr'] }), problems, [
      { personId: 'p1', action: 'edit', value: '2024-03-12' },
      { personId: 'p2', action: 'clear' },
      // Somebody not on the list is ignored, not an error: their value fits now.
      { personId: 'p9', action: 'clear' },
    ]);
    expect(decided).toEqual({
      ok: true,
      value: [
        { personId: 'p1', action: 'edit', value: '2024-03-12' },
        { personId: 'p2', action: 'clear', value: null },
        { personId: 'p3', action: 'request', value: null },
      ],
    });
  });

  it('refuses asking the employee for a field only HR fills in, and an edit with no value', () => {
    const hrOnly = field({ ownership: ['hr'] });
    expect(decide(hrOnly, problems, [{ personId: 'p1', action: 'request' }])).toMatchObject({
      ok: false,
      error: { code: 'ACTION_NOT_ALLOWED' },
    });
    expect(decide(hrOnly, problems, [{ personId: 'p1', action: 'edit' }])).toMatchObject({
      ok: false,
      error: { code: 'VALUE_INVALID' },
    });
  });
});
