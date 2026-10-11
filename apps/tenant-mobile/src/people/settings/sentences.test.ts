import { describe, expect, it } from 'vitest';

import { changeFrom, describedField, fieldSentence, seersOf } from './sentences';

const fields = [
  { key: 'salary', label: 'Salary' },
  { key: 'job_title', label: 'Job title' },
  { key: 'manager_id', label: 'Manager' },
];

describe('settings as sentences', () => {
  it('reads a field back as who fills it in, who sees it and when it is asked', () => {
    expect(
      fieldSentence({
        ownership: ['hr'],
        visibility: ['self', 'manager', 'hr'],
        collectAt: 'hr_only',
      }),
    ).toEqual({
      who: 'HR',
      see: 'The employee, their manager and HR',
      asked: 'nobody is asked for it',
    });
    expect(seersOf(['self', 'directory'])).toBe('Everyone');
  });

  it('reads a change to who sees a field, and to whether it is required', () => {
    expect(changeFrom('let managers see their team’s salaries', fields)).toEqual({
      kind: 'see',
      key: 'salary',
      add: ['manager'],
      remove: [],
    });
    expect(changeFrom('make job title required', fields)).toEqual({
      kind: 'required',
      key: 'job_title',
      required: true,
    });
    expect(changeFrom('hide salary from finance', fields)).toEqual({
      kind: 'see',
      key: 'salary',
      add: [],
      remove: ['finance'],
    });
    expect(changeFrom('something else entirely', fields)).toBeNull();
  });

  it('drafts a new field from a description', () => {
    const d = describedField(
      'T-shirt size for the offsite, S to XXL. People fill it in during onboarding; only HR needs it.',
    );
    expect(d.label).toBe('T-shirt size');
    expect(d.dataType).toBe('select');
    expect(d.options).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
    expect(d.collectAt).toBe('onboarding');
    expect(d.visibility).toEqual(['self', 'hr']);
  });
});
