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
