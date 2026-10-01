import { describe, expect, it } from 'vitest';

import { aliasOf } from './aliases.js';

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
  ])('%s is %s', (header, key) => {
    expect(aliasOf(header)).toBe(key);
  });

  it.each(['T-shirt size', 'Cost centre', 'Personal email', 'Emergency contact email', 'Name'])(
    '%s is nobody’s alias',
    (header) => {
      expect(aliasOf(header)).toBeNull();
    },
  );
});
