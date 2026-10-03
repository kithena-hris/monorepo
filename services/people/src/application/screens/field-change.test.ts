import { describe, expect, it } from 'vitest';
import type { AttributeDefinitionInput } from '@kithena/contracts';

import { SchemaDraft } from '../../domain/schema/draft.js';
import { define } from '../person/in-memory.js';
import { reviewValues, textOf } from './field-change.js';
import { fieldChange, type FieldInput } from './schema.js';

/**
 * Each value a field holds, read again as the field's new type, with nothing
 * written: the import's own coercion (`coerceCell`), so a value the import
 * would refuse is refused here, and a value it would take converts the same.
 */

const TODAY = '2026-10-03';
const text = define({ key: 'start_day' });
const as = (over: Partial<AttributeDefinitionInput>) => define({ key: 'start_day', ...over });
const rows = (...values: unknown[]) =>
  values.map((value, i) => ({ personId: `p${String(i + 1)}`, name: `Person ${String(i + 1)}`, value }));

describe('text to date', () => {
  const date = as({ dataType: 'date', typeConfig: { kind: 'date' } });

  it('reads day/month/year when a day gives it away, and shows each as a date', () => {
    const review = reviewValues(rows('12/03/2024', '25.12.2023', '2024-01-05'), text, date, TODAY);
    expect(review.dateOrder).toBe('dmy');
    expect(review.converted.map((c) => [c.value, c.after])).toEqual([
      ['2024-03-12', '12 Mar 2024'],
      ['2023-12-25', '25 Dec 2023'],
    ]);
    // Already a date as written: nothing to write.
    expect(review.unchanged).toBe(1);
    expect(review.unfit).toEqual([]);
  });

  it('reads month/day/year when that is what the column says', () => {
    const review = reviewValues(rows('03/25/2024', '12/31/2023'), text, date, TODAY);
    expect(review.dateOrder).toBe('mdy');
    expect(review.converted.map((c) => c.value)).toEqual(['2024-03-25', '2023-12-31']);
  });

  it('lists what is not a date, with the person and why', () => {
    const review = reviewValues(rows('12/03/2024', 'next Monday', '31/02/2024'), text, date, TODAY);
    expect(review.unfit).toEqual([
      expect.objectContaining({ personId: 'p2', name: 'Person 2', before: 'next Monday' }),
      expect.objectContaining({ personId: 'p3', before: '31/02/2024' }),
    ]);
    expect(review.unfit[0]?.reason).toMatch(/not a date/i);
  });
});

describe('text to a number', () => {
  it('a whole number, and a decimal kept as written', () => {
    const number = as({ dataType: 'number', typeConfig: { kind: 'number' } });
    expect(reviewValues(rows('42', '4.5', 'lots'), text, number, TODAY)).toMatchObject({
      converted: [{ value: 42 }],
      unfit: [{ personId: 'p2' }, { personId: 'p3' }],
    });
    const decimal = as({ dataType: 'decimal', typeConfig: { kind: 'decimal', decimals: 2 } });
    expect(reviewValues(rows('0.5', '1.25', '1.255'), text, decimal, TODAY)).toMatchObject({
      unchanged: 2,
      unfit: [{ personId: 'p3', reason: 'At most 2 decimals' }],
    });
  });
});

describe('text to a choice', () => {
  const choice = as({
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'full_time', label: { default: 'Full time' } },
        { value: 'part_time', label: { default: 'Part time' } },
      ],
    },
  });

  it('matches an option by its label, whatever the case', () => {
    const review = reviewValues(rows('full time', 'Part time', 'Casual'), text, choice, TODAY);
    expect(review.converted.map((c) => [c.value, c.after])).toEqual([
      ['full_time', 'Full time'],
      ['part_time', 'Part time'],
    ]);
    expect(review.unfit).toEqual([
      expect.objectContaining({ before: 'Casual', reason: '“Casual” isn’t one of the options' }),
    ]);
  });

  it('a retired option a record still holds needs a new answer', () => {
    const retired = as({
      dataType: 'select',
      typeConfig: {
        kind: 'select',
        options: [
          { value: 'full_time', label: { default: 'Full time' } },
          { value: 'part_time', label: { default: 'Part time' }, retiredAt: '2026-10-01T00:00:00Z' },
        ],
      },
    });
    const review = reviewValues(rows('full_time', 'part_time'), choice, retired, TODAY);
    expect(review.unchanged).toBe(1);
    expect(review.unfit).toEqual([
      expect.objectContaining({ before: 'Part time', reason: 'Part time is no longer an option' }),
    ]);
  });
});

describe('text to an email or a phone number', () => {
  it('keeps an email that is one, and lists one that is not', () => {
    const email = as({ dataType: 'email', typeConfig: { kind: 'email' } });
    const review = reviewValues(rows('ada@example.com', 'ada at example'), text, email, TODAY);
    // The same text, so nothing is written for it.
    expect(review.unchanged).toBe(1);
    expect(review.unfit).toEqual([expect.objectContaining({ reason: 'Not an email address' })]);
  });

  it('a phone number loses its spaces; one without its country code is listed', () => {
    const phone = as({ dataType: 'phone', typeConfig: { kind: 'phone' } });
    const review = reviewValues(rows('+44 20 7946 0958', '020 7946 0958'), text, phone, TODAY);
    expect(review.converted.map((c) => c.value)).toEqual(['+442079460958']);
    expect(review.unfit[0]?.reason).toMatch(/country code/);
  });
});

describe('anything to text', () => {
  it('writes what the value said', () => {
    const number = as({ dataType: 'number', typeConfig: { kind: 'number' } });
    expect(textOf(12, number)).toBe('12');
    expect(textOf(true, as({ dataType: 'boolean', typeConfig: { kind: 'boolean' } }))).toBe('Yes');
    expect(reviewValues(rows(12), number, text, TODAY).converted).toEqual([
      expect.objectContaining({ value: '12', after: '12' }),
    ]);
  });
});

describe('saving a changed field to the draft', () => {
  const section = {
    key: 'hr_information',
    label: { default: 'HR', translations: {} },
    order: 0,
    defaultVisibility: ['hr' as const],
    origin: 'core' as const,
    archivedAt: null,
  } as Parameters<typeof SchemaDraft.rehydrate>[0][number];
  const choice = as({
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'full_time', label: { default: 'Full time' } },
        { value: 'ft_legacy', label: { default: 'Part time' } },
      ],
    },
  });
  const input = (over: Partial<FieldInput>): FieldInput => ({
    key: 'start_day',
    sectionKey: 'hr_information',
    label: 'Start day',
    description: null,
    dataType: 'select',
    options: [],
    requiredness: 'never',
    requiredWhen: null,
    ownership: ['hr'],
    collectAt: 'hr_only',
    visibility: ['self', 'hr'],
    visibilityRules: [],
    classification: 'internal',
    piiKind: 'none',
    classificationSource: 'human',
    requiresApproval: null,
    ...over,
  });
  const NOW = '2026-10-03T09:00:00.000Z';

  it('retires an option taken off the list, keeps the value of one kept, and renames by label', () => {
    const draft = SchemaDraft.rehydrate([section], [choice]);
    const saved = fieldChange(
      draft,
      [choice],
      input({ options: ['Full time', 'Casual'] }),
      'start_day',
      NOW,
    );
    expect(saved.ok && saved.value.typeConfig).toMatchObject({
      options: [
        { value: 'full_time', retiredAt: null },
        { value: 'casual', retiredAt: null },
        { value: 'ft_legacy', label: { default: 'Part time' }, retiredAt: NOW },
      ],
    });
    // An option an import named keeps its own value when only its label is sent back.
    const kept = fieldChange(
      draft,
      [choice],
      input({ options: ['Full time', 'Part time'] }),
      'start_day',
      NOW,
    );
    expect(kept.ok && kept.value.typeConfig).toMatchObject({
      options: [{ value: 'full_time' }, { value: 'ft_legacy', retiredAt: null }],
    });
  });

  it('a built-in field keeps its type', () => {
    const core = { ...choice, origin: 'core' as const };
    const draft = SchemaDraft.rehydrate([section], [core]);
    expect(
      fieldChange(draft, [core], input({ dataType: 'text', options: [] }), 'start_day', NOW),
    ).toMatchObject({ ok: false, error: { code: 'TYPE_FIXED' } });
  });
});
