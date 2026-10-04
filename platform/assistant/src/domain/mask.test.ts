import { describe, expect, it } from 'vitest';
import { CatalogueLeaveType } from '@kithena/contracts';

import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from './fixtures.js';
import { mask, maskOffer, REF_LABEL, refused, unmask } from './mask.js';
import { offer, readPlan } from './plan.js';

/**
 * A private leave type never reaches the model (assistant PRD §12.2): its
 * name, its key and the everyday words for its category become `L1`, `L2`…
 * before a prompt is built, and what masking leaves of special-category
 * data, judgement or prediction is refused before the model sees anything.
 */

const TYPES = TIMEOFF_CATALOGUE.leaveTypes;

describe('masking a private leave type', () => {
  it('turns "sick leave" into a reference the model cannot read', () => {
    const masked = mask('Who are the managers of people on sick leave today?', TYPES);
    expect(masked.question).toBe('Who are the managers of people on L1 today?');
    expect(masked.refs).toEqual([{ ref: 'L1', keys: ['sick'] }]);
  });

  it('masks the company’s own name for the type, its key, and its category’s words', () => {
    for (const question of [
      'Who is on Baja médica this week?',
      'who is BAJA MÉDICA this week?',
      'Who is off sick this week?',
      'Who is ill this week?',
      'Who has sick this week?',
    ]) {
      const masked = mask(question, TYPES);
      expect(masked.question).toMatch(/\bL1 this week\?$/u);
      expect(masked.question).not.toMatch(/sick|ill\b|baja/iu);
    }
  });

  it('gives each type its own reference, and one word the same reference each time', () => {
    const masked = mask('Who is on maternity or sick leave, and who else is off sick?', TYPES);
    expect(masked.question).toBe('Who is on L1 or L2, and who else is L2?');
    expect(masked.refs).toEqual([
      { ref: 'L1', keys: ['parental'] },
      { ref: 'L2', keys: ['sick'] },
    ]);
  });

  it('lets one everyday word stand for every private type of its category', () => {
    const types = CatalogueLeaveType.array().parse([
      { key: 'sick', name: 'Sick', private: true, category: 'sick_leave' },
      { key: 'sick_child', name: 'Child sick day', private: true, category: 'sick_leave' },
    ]);
    expect(mask('Who is ill today?', types).refs).toEqual([
      { ref: 'L1', keys: ['sick', 'sick_child'] },
    ]);
    expect(mask('Who is on sick child today?', types).refs).toEqual([
      { ref: 'L1', keys: ['sick_child'] },
    ]);
  });

  it('leaves a type that is not private by its name, and words inside other words alone', () => {
    const masked = mask('Who is on vacation? Will Billy be in?', TYPES);
    expect(masked).toEqual({ question: 'Who is on vacation? Will Billy be in?', refs: [] });
  });

  it('masks a private type without a category by its name and key alone', () => {
    const types = CatalogueLeaveType.array().parse([
      { key: 'medical', name: 'Medical appointment', private: true },
    ]);
    expect(mask('Who has a medical appointment or is off sick?', types).question).toBe(
      'Who has a L1 or is off sick?',
    );
  });

  it('never leaves a private word in the prompt it feeds', () => {
    // The references stay with the assistant; only the question goes into a prompt.
    const { question } = mask(
      'How many people are on sick leave or off sick or Baja médica today?',
      TYPES,
    );
    expect(question).toBe('How many people are on L1 or L1 or L1 today?');
  });
});

describe('the catalogue the model is shown', () => {
  it('offers the references, labelled, in place of the private types', () => {
    const masked = mask('Who is on sick leave today?', TYPES);
    const offered = maskOffer(offer([PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE]), TYPES, masked.refs);
    expect(offered.get('timeoff.away')?.fields).toEqual([
      {
        key: 'leave_type',
        label: 'Leave type',
        kind: 'select',
        options: [
          { value: 'vacation', label: 'Vacation' },
          { value: 'personal', label: 'Personal' },
          { value: 'comp', label: 'Comp' },
          { value: 'L1', label: REF_LABEL },
        ],
      },
    ]);
    expect(JSON.stringify([...offered.values()].map((o) => o.fields))).not.toMatch(
      /sick|baja|parental/iu,
    );
  });
});

describe('unmasking the plan', () => {
  it('turns each reference back into its types before anything runs', () => {
    const masked = mask('Who is ill or on maternity today?', TYPES);
    const offered = maskOffer(offer([TIMEOFF_CATALOGUE]), TYPES, masked.refs);
    const read = readPlan(
      JSON.stringify({
        kind: 'plan',
        steps: [
          {
            id: 's1',
            capability: 'timeoff.away',
            input: {
              on: 'today',
              filters: [
                { key: 'leave_type', op: 'in', values: ['L1', 'L2', 'vacation'] },
                { key: 'team', op: 'in', values: ['engineering'] },
              ],
            },
          },
        ],
        answer: { kind: 'list', step: 's1' },
      }),
      offered,
    );
    if (!read.ok) throw new Error(read.error.code);
    const plan = unmask(read.value, masked.refs);
    expect(plan.kind === 'plan' && plan.steps[0]?.input.filters).toEqual([
      { key: 'leave_type', op: 'in', values: ['sick', 'parental', 'vacation'] },
      { key: 'team', op: 'in', values: ['engineering'] },
    ]);
  });
});

describe('refused before the model', () => {
  it('refuses sick leave where no module offers it as a leave type', () => {
    const masked = mask('Who are the managers of people on sick leave today?', []);
    expect(refused(masked.question)).toEqual({
      kind: 'special',
      text: 'Kithena never searches by health or other special-category data.',
    });
  });

  it('lets the masked question through', () => {
    expect(refused(mask('Who is on sick leave today?', TYPES).question)).toBeNull();
  });

  it('refuses pregnancy, whatever Time Off offers', () => {
    expect(refused(mask('Who is pregnant?', TYPES).question)?.kind).toBe('special');
    expect(refused(mask('Who is pregnant?', []).question)?.kind).toBe('special');
  });

  it('refuses judgements and predictions, with People’s sentences', () => {
    expect(refused('Who is likely to quit?')).toEqual({
      kind: 'prediction',
      text: 'Kithena doesn’t guess what people will do.',
    });
    expect(refused('Who are our top performers in sales?')).toEqual({
      kind: 'performance',
      text: 'Kithena doesn’t judge how well people work.',
    });
  });

  it('lets an ordinary question through', () => {
    expect(refused('Who in Engineering is off next week?')).toBeNull();
    expect(refused('Who reports to Michael?')).toBeNull();
  });
});
