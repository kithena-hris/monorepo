import type { ForExisting } from './new-fields.js';

/**
 * Everything an import will do, in plain words, before anything happens
 * (design AI11, MA9): the fields it creates, the people it creates and
 * updates, who is asked for what, the work it leaves HR, and what it leaves
 * out. Written from HR's choices and the dry run's counts; HR approves it
 * once. The same words go to the activity log, never the file. Pure.
 */

export interface PlanField {
  readonly label: string;
  /** The section's name, existing or new. */
  readonly section: string;
  readonly newSection: boolean;
  readonly forExisting: ForExisting;
  /** People without a value once the file is in. */
  readonly missing: number;
}

export interface PlanInput {
  /**
   * A company with nothing published: setup comes in the same approval, with
   * its country's pack (null: no pack for that country, the core fields only).
   */
  readonly setup: { readonly countryName: string | null } | null;
  /** The version the fields publish as. */
  readonly version: number;
  readonly fields: readonly PlanField[];
  readonly rows: Readonly<
    Record<'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate', number>
  >;
  /** Columns of the file that are not imported, by header. */
  readonly leftOut: readonly string[];
  /**
   * The file holds a person id or employee number column, which is ignored:
   * Kithena creates both. `numbered`: new people are given a number.
   */
  readonly identifiers?: { readonly inFile: boolean; readonly numbered: boolean };
  /** Work locations the file names that are not here yet; `added` when this run adds them. */
  readonly newLocations?: { readonly names: readonly string[]; readonly added: boolean };
  /** References the rows leave empty for HR, and the fields they are in. */
  readonly leftEmpty?: { readonly count: number; readonly labels: readonly string[] };
}

export type PlanStepKind =
  | 'setup'
  | 'places'
  | 'fields'
  | 'people'
  | 'ids'
  | 'refs'
  | 'ask'
  | 'hr'
  | 'new'
  | 'default'
  | 'leave'
  | 'skip';

export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly title: string;
  readonly detail: string;
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** "Emergency contact" reads "emergency contact" mid-sentence; "IBAN" and "T-shirt size" stay. */
const lowerFirst = (s: string): string =>
  /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/** "A", "A and B", "A, B and C". */
const listed = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1) ?? ''}`;

/** "a, b, and c": a sentence's clauses. */
const clauses = (xs: readonly string[]): string =>
  xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1) ?? ''}`;

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function fieldsDetail(input: PlanInput): string {
  const bySection = new Map<string, { labels: string[]; isNew: boolean }>();
  for (const f of input.fields) {
    const entry = bySection.get(f.section) ?? { labels: [], isNew: f.newSection };
    entry.labels.push(f.label);
    bySection.set(f.section, entry);
  }
  const where = [...bySection].map(
    ([section, { labels, isNew }]) =>
      `${listed(labels)} in ${isNew ? `a new ${section} section` : section}`,
  );
  const published =
    input.setup === null
      ? `Published as version ${String(input.version)}.`
      : `Published with the pack as version ${String(input.version)}.`;
  return `${where.length <= 1 ? (where[0] ?? '') : `${where.slice(0, -1).join(', ')}, and ${where.at(-1) ?? ''}`}. ${published}`;
}

function peopleStep(rows: PlanInput['rows']): PlanStep {
  const title =
    rows.create > 0 && rows.update > 0
      ? `Create ${plural(rows.create, 'person', 'people')} and update ${String(rows.update)}`
      : rows.create > 0
        ? `Create ${plural(rows.create, 'person', 'people')}`
        : rows.update > 0
          ? `Update ${plural(rows.update, 'person', 'people')}`
          : 'Nobody is created or updated';
  // Nothing is blocked: a row is skipped only when it cannot be anybody, or
  // is somebody already in the file or here.
  const parts = [
    rows.unchanged > 0 ? `${plural(rows.unchanged, 'row is', 'rows are')} unchanged.` : null,
    rows.blocked > 0
      ? `${plural(rows.blocked, 'row has', 'rows have')} no name and no work email, so ${rows.blocked === 1 ? 'it’s' : 'they’re'} skipped: nobody to create.`
      : null,
    rows.duplicate > 0
      ? `${plural(rows.duplicate, 'row repeats', 'rows repeat')} somebody, so ${rows.duplicate === 1 ? 'it’s' : 'they’re'} skipped.`
      : null,
  ].filter((p) => p !== null);
  return {
    kind: 'people',
    title,
    detail: parts.length === 0 ? 'Every row of the file imports.' : parts.join(' '),
  };
}

function forExistingStep(f: PlanField): PlanStep | null {
  const label = lowerFirst(f.label);
  const n = f.missing;
  if (n === 0) return null;
  switch (f.forExisting.kind) {
    case 'ask':
      return {
        kind: 'ask',
        title: `Ask ${plural(n, 'person', 'people')} for their ${label}`,
        detail:
          'It’s theirs to fill in. It shows on their profile as missing, and the weekly reminder asks for it.',
      };
    case 'hr':
      return {
        kind: 'hr',
        title: `Give HR ${String(n)} ${label} ${n === 1 ? 'value' : 'values'} to fill in`,
        detail: 'They’re in Data health, on HR’s list, until they’re filled in.',
      };
    case 'new':
      return {
        kind: 'new',
        title: `Ask people who join from now on for their ${label}`,
        detail: `The ${plural(n, 'person', 'people')} without one now ${n === 1 ? 'isn’t' : 'aren’t'} asked.`,
      };
    case 'default':
      return {
        kind: 'default',
        title: `Give ${plural(n, 'person', 'people')} “${f.forExisting.value}” as their ${label}`,
        detail: 'Every row of the file holds that value, so it likely holds for everybody.',
      };
    case 'leave':
      return {
        kind: 'leave',
        title: `Leave ${label} empty for ${plural(n, 'person', 'people')}`,
        detail: 'It’s optional, and nobody is asked.',
      };
  }
}

/** The plan's steps, and the same in one sentence. */
export function planOf(input: PlanInput): {
  readonly steps: readonly PlanStep[];
  readonly short: string;
} {
  const steps: PlanStep[] = [];
  const short: string[] = [];
  if (input.setup !== null) {
    const country = input.setup.countryName;
    steps.push({
      kind: 'setup',
      title:
        country === null
          ? 'Set up the employee record'
          : `Set up the employee record with the ${country} pack`,
      detail:
        country === null
          ? 'The fields every company has. Every section can be changed later in Settings.'
          : 'The fields every company has, and the ones the law there requires. Every section can be changed later in Settings.',
    });
    short.push(country === null ? 'set up the employee record' : `set up the ${country} pack`);
  }
  const places = input.newLocations;
  if (places !== undefined && places.names.length > 0) {
    const names = listed(places.names);
    steps.push(
      places.added
        ? {
            kind: 'places',
            title: `Add ${plural(places.names.length, 'work location', 'work locations')}: ${names}`,
            detail:
              'Nothing here has those names yet. Each joins the legal entity of the first row that names it, on that entity’s time zone; change either in Settings › Organisation.',
          }
        : {
            kind: 'places',
            title: `Leave work location empty where the file names ${names}`,
            detail:
              'Only an administrator adds work locations. Add them in Settings › Organisation and import the file again, or set them on each profile.',
          },
    );
    if (places.added) {
      short.push(`add ${plural(places.names.length, 'work location', 'work locations')}`);
    }
  }
  if (input.fields.length > 0) {
    const n = input.fields.length;
    steps.push({
      kind: 'fields',
      title: `Create ${plural(n, 'field', 'fields')} in Settings › Employee fields`,
      detail: fieldsDetail(input),
    });
    short.push(`create ${plural(n, 'field', 'fields')}`);
  }
  steps.push(peopleStep(input.rows));
  const importing = input.rows.create + input.rows.update;
  if (importing > 0) short.push(`import ${plural(importing, 'person', 'people')}`);
  if (input.identifiers?.inFile === true) {
    const matching =
      'Rows match people already here by work email; a row that matches nobody is a new person.';
    steps.push(
      input.identifiers.numbered
        ? {
            kind: 'ids',
            title: 'Employee IDs in the file are ignored; Kithena gives each new person one',
            detail: matching,
          }
        : {
            kind: 'ids',
            title: 'Employee IDs in the file are ignored',
            detail: `${matching} This company doesn’t number its people yet: an administrator turns numbering on in Settings › Organisation.`,
          },
    );
  }
  const empty = input.leftEmpty;
  if (empty !== undefined && empty.count > 0) {
    const one = empty.labels.length === 1;
    steps.push({
      kind: 'refs',
      title: `Leave ${plural(empty.count, 'value', 'values')} empty for HR`,
      detail: `${listed(empty.labels)} on those rows can’t be read, or ${one ? 'points' : 'point'} at nobody here. The rows import without ${one ? 'it' : 'them'}, and nothing is blocked; each is listed below.`,
    });
    short.push(`leave ${String(empty.count)} for HR`);
  }
  for (const f of input.fields) {
    const step = forExistingStep(f);
    if (step === null) continue;
    steps.push(step);
    const label = lowerFirst(f.label);
    if (step.kind === 'ask') short.push(`ask ${String(f.missing)} for their ${label}`);
    if (step.kind === 'hr')
      short.push(`give HR ${String(f.missing)} ${label} ${f.missing === 1 ? 'value' : 'values'}`);
  }
  if (input.leftOut.length > 0) {
    const one = input.leftOut.length === 1;
    steps.push({
      kind: 'skip',
      title: `Leave out ${listed(input.leftOut)}`,
      detail: one
        ? 'The column is skipped and isn’t stored anywhere. Its values aren’t kept.'
        : 'The columns are skipped and aren’t stored anywhere. Their values aren’t kept.',
    });
    short.push(`leave out ${listed(input.leftOut)}`);
  }
  return {
    steps,
    short: short.length === 0 ? 'Nothing to import.' : `${capital(clauses(short))}.`,
  };
}
