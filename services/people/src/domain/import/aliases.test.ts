import { describe, expect, it } from 'vitest';

import { keyFrom } from '../schema/draft.js';
import { aliasOf, builtInChoices, CHOICE_KEYS, choiceOf } from './aliases.js';

/**
 * The names other systems' exports give the fields every company has. A file
 * from BambooHR says "First Name", not "Legal first name", and with no model
 * configured nothing else would place it.
 */
describe('the usual names for the core fields', () => {
  it.each([
    ['First Name', 'given_name'],
    ['first_name', 'given_name'],
    ['Forename', 'given_name'],
    ['Last Name', 'family_name'],
    ['Surname', 'family_name'],
    ['Email', 'work_email'],
    ['E-mail address', 'work_email'],
    ['Work Email', 'work_email'],
    ['Employee ID', 'employee_number'],
    ['Employee #', 'employee_number'],
    ['Hire Date', 'hire_date'],
    ['Start date', 'hire_date'],
    ['Date of birth', 'date_of_birth'],
    ['DOB', 'date_of_birth'],
    ['Preferred name', 'preferred_name'],
    ['Job title', 'job_title'],
    ['Manager email', 'manager_id'],
    ['Reports to', 'manager_id'],
    ['Location', 'location_id'],
    ['Legal entity', 'legal_entity_id'],
    ['Employment Status', 'employment_status'],
    ['Termination Date', 'last_working_day'],
    ['Last working day', 'last_working_day'],
    ['Termination Reason', 'leaving_reason'],
    ['Eligible for Rehire', 'eligible_for_rehire'],
  ])('%s is %s', (header, key) => {
    expect(aliasOf(header)).toBe(key);
  });

  it.each([
    'T-shirt size',
    'Cost centre',
    'Personal email',
    'Emergency contact email',
    'Name',
    // People keeps no leave record: these stay fields of their own.
    'Leave Type',
    'Leave Start Date',
    'Expected Return Date',
  ])(
    '%s is nobody’s alias',
    (header) => {
      expect(aliasOf(header)).toBeNull();
    },
  );
});

/**
 * A file's values for People's own choice fields. "Fixed-term" is People's
 * fixed term whatever the spelling; "Full-time" is not one of People's, so it
 * is the company's own, spelt one way however the file writes it.
 */
describe('the values of People’s own choice fields', () => {
  it.each([
    ['Employment Type', 'employment_type'],
    ['Contract type', 'employment_type'],
    ['Worker type', 'employment_type'],
    ['Work Arrangement', 'work_model'],
    ['Work model', 'work_model'],
  ])('%s is %s', (header, key) => {
    expect(aliasOf(header)).toBe(key);
  });

  it.each([
    ['Fixed-term', 'fixed_term', true],
    ['fixed term', 'fixed_term', true],
    ['Temporary', 'fixed_term', true],
    ['Contractor', 'contractor', true],
    ['Freelancer', 'contractor', true],
    ['INTERN', 'intern', true],
    ['Permanent', 'permanent', true],
    ['Full-time', 'full_time', false],
    ['full time', 'full_time', false],
    ['FT', 'full_time', false],
    ['Full Time', 'full_time', false],
    ['Part-time', 'part_time', false],
    ['PT', 'part_time', false],
    ['Zero hours', 'zero_hours', false],
  ])('employment type %s is %s', (cell, value, ours) => {
    const meant = choiceOf('employment_type', cell);
    expect(meant?.value).toBe(value);
    expect(builtInChoices('employment_type').some((c) => c.value === value)).toBe(ours);
  });

  it('spells a value People knows one way, and keeps the file’s spelling of one it does not', () => {
    expect(choiceOf('employment_type', 'FT')?.label).toBe('Full-time');
    expect(choiceOf('employment_type', 'fixed-term')?.label).toBe('Fixed term');
    expect(choiceOf('employment_type', ' Zero hours ')?.label).toBe('Zero hours');
  });

  it.each([
    ['Onsite', 'onsite'],
    ['On-site', 'onsite'],
    ['Office', 'onsite'],
    ['Hybrid', 'hybrid'],
    ['Remote', 'remote'],
    ['WFH', 'remote'],
  ])('work model %s is %s', (cell, value) => {
    expect(choiceOf('work_model', cell)?.value).toBe(value);
  });

  it('labels each of People’s values so the field editor keys it back to the same value', () => {
    for (const key of CHOICE_KEYS) {
      for (const c of builtInChoices(key)) expect(keyFrom(c.label)).toBe(c.value);
    }
  });

  it('reads nothing into an empty cell or another field', () => {
    expect(choiceOf('employment_type', '  ')).toBeNull();
    expect(choiceOf('job_title', 'Intern')).toBeNull();
  });
});
