/**
 * What other systems call the fields every company has.
 *
 * An export from BambooHR, HiBob or a payroll spreadsheet says "First Name",
 * "Email" and "Employee ID", while the record says "Legal first name", "Work
 * email" and "Employee number". With no model configured nothing else places
 * those columns, every row is then blocked for want of a name, and the file's
 * name columns are proposed as new fields beside the real ones. So the usual
 * names are known here, by rule: a column is mapped by its key, then its
 * label, then one of these, and only then asked of a model.
 *
 * Only unambiguous names: "Name" could be either half, and "Personal email"
 * is not the work email. Pure.
 */

import { keyFrom } from '../schema/draft.js';

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  given_name: ['first name', 'firstname', 'forename', 'given name', 'legal first name'],
  family_name: ['last name', 'lastname', 'surname', 'family name', 'legal last name'],
  preferred_name: ['preferred name', 'preferred first name', 'known as', 'nickname'],
  work_email: [
    'email',
    'e mail',
    'email address',
    'e mail address',
    'work email',
    'work email address',
    'business email',
    'company email',
  ],
  employee_number: [
    'employee id',
    'employee no',
    'employee number',
    'emp id',
    'staff id',
    'staff number',
    'personnel number',
  ],
  hire_date: ['hire date', 'date hired', 'date of hire', 'start date', 'employment start date'],
  date_of_birth: ['date of birth', 'dob', 'birth date', 'birthdate', 'birthday'],
  job_title: ['job title', 'title', 'position', 'job'],
  manager_id: ['manager', 'manager email', 'reports to', 'line manager', 'supervisor'],
  location_id: ['location', 'work location', 'office location'],
  legal_entity_id: ['legal entity', 'employer', 'employing entity'],
  employment_type: [
    'employment type',
    'employee type',
    'worker type',
    'contract type',
    'type of employment',
    'employment category',
  ],
  work_model: ['work model', 'work arrangement', 'work mode', 'workplace type', 'remote status'],
};

/** "E-mail address" and "e_mail address" are one header; "Employee #" is "employee number". */
const normal = (header: string): string =>
  header
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('#', ' number ')
    .replaceAll('.', ' ')
    .replaceAll(/[\s_-]+/gu, ' ')
    .trim();

const BY_NAME = new Map(
  Object.entries(ALIASES).flatMap(([key, names]) => names.map((n) => [n, key] as const)),
);

/** The core field a header usually means, or null. */
export function aliasOf(header: string): string | null {
  return BY_NAME.get(normal(header)) ?? null;
}

/* ------------------------------------------- People's own choice fields -- */

export interface Choice {
  readonly value: string;
  readonly label: string;
}

interface Named extends Choice {
  /** What other systems call it, spelt as `normal` spells a header. */
  readonly names: readonly string[];
}

/**
 * The choice fields People keeps in columns of its own (`core.ts`): its own
 * values, and what other systems' exports call each. `known` are values a
 * company commonly has and People does not, spelt one way, so "FT" and
 * "Full Time" in one file are one Full-time and not two.
 *
 * Each label keys back to its value (`keyFrom`), because the field editor
 * re-keys options from their labels.
 */
const CHOICES: Readonly<Record<string, { ours: readonly Named[]; known: readonly Named[] }>> = {
  employment_type: {
    ours: [
      { value: 'permanent', label: 'Permanent', names: ['regular', 'indefinite', 'open ended'] },
      { value: 'fixed_term', label: 'Fixed term', names: ['temporary', 'temp', 'limited term'] },
      {
        value: 'contractor',
        label: 'Contractor',
        names: [
          'contract worker',
          'independent contractor',
          'freelance',
          'freelancer',
          'consultant',
        ],
      },
      { value: 'intern', label: 'Intern', names: ['internship', 'trainee', 'working student'] },
      { value: 'apprentice', label: 'Apprentice', names: ['apprenticeship'] },
      { value: 'seasonal', label: 'Seasonal', names: ['seasonal worker'] },
    ],
    known: [
      { value: 'full_time', label: 'Full-time', names: ['fulltime', 'ft'] },
      { value: 'part_time', label: 'Part-time', names: ['parttime', 'pt'] },
    ],
  },
  work_model: {
    ours: [
      {
        value: 'onsite',
        label: 'Onsite',
        names: ['on site', 'office', 'in office', 'office based', 'in person', 'on premises'],
      },
      { value: 'hybrid', label: 'Hybrid', names: [] },
      {
        value: 'remote',
        label: 'Remote',
        names: ['fully remote', 'home based', 'work from home', 'wfh'],
      },
    ],
    known: [],
  },
};

export const CHOICE_KEYS: readonly string[] = Object.keys(CHOICES);

/** People's own values for one of its choice fields; none for any other field. */
export const builtInChoices = (key: string): readonly Choice[] =>
  (CHOICES[key]?.ours ?? []).map(({ value, label }) => ({ value, label }));

/**
 * What a file's cell means in one of People's own choice fields: one of
 * People's values under any spelling, a value companies commonly add, or the
 * file's own word as a value of the company's. Null for an empty cell or
 * another field.
 */
export function choiceOf(key: string, cell: string): Choice | null {
  const choices = CHOICES[key];
  const wanted = normal(cell);
  if (choices === undefined || wanted === '') return null;
  const value = keyFrom(cell);
  const found = [...choices.ours, ...choices.known].find(
    (c) => c.value === value || normal(c.label) === wanted || c.names.includes(wanted),
  );
  return found ? { value: found.value, label: found.label } : { value, label: cell.trim() };
}
