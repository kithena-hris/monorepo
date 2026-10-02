/**
 * What an imported file may say about who somebody is, and what it may not.
 *
 * **Identifiers are Kithena's.** A person's id and their employee number are
 * created here: the id when the record is, the number from the legal entity's
 * scheme when they are hired (PEO-101). A file brings its own — another
 * Kithena's ids, another system's "Employee ID" — and none of them is ever
 * written, matched on, or allowed to block a row. Rows match people already
 * here by work email only.
 *
 * **References are resolved, never copied.** A manager, a legal entity or a
 * work location in a file is a pointer into the system it came from. Here it
 * is resolved to somebody or something in this company, or to another row of
 * the same file (whose old id is only a name for that row), or it is left
 * empty and named for HR. A raw id from elsewhere never reaches a record.
 *
 * Pure.
 */

/** The column an export writes first: the record's id, in the system that exported it (§15.3). */
export const PERSON_ID_COLUMN = '__person_id';

/** The keys Kithena creates: a column mapped to one is shown, and ignored. */
const CREATED_HERE: ReadonlySet<string> = new Set([PERSON_ID_COLUMN, 'employee_number']);

export const kithenaCreates = (key: string | null | undefined): boolean =>
  key !== null && key !== undefined && CREATED_HERE.has(key);

/** What the mapping says about such a column, in the words the screen shows. */
export const KITHENA_CREATES = 'Kithena creates this';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const looksLikeId = (cell: string): boolean => UUID.test(cell.trim());

/** "  Ada   LOVELACE " and "ada lovelace" are one name. */
export const normalName = (s: string): string =>
  s.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en');

/** One row of the file, as a reference to a person can name it. */
export interface FileRow {
  readonly row: number;
  /** Its id in the system that exported it; only a name for this row here. */
  readonly fileId: string | null;
  readonly email: string | null;
  /** "Given family", as the row writes it. */
  readonly name: string | null;
}

/** Somebody already in this company. */
export interface Known {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

export type PersonRef =
  | { readonly kind: 'person'; readonly id: string }
  /** The person another row of the file creates or updates: linked once every row is in. */
  | { readonly kind: 'row'; readonly row: number }
  | { readonly kind: 'none'; readonly reason: string };

/**
 * Whom a cell that points at a person means: another row of this file by the
 * id it had where it came from; somebody here by id; then, here or in the
 * file, by work email, then by full name when exactly one person has it.
 */
export function personRefOf(
  cell: string,
  ctx: { readonly rows: readonly FileRow[]; readonly people: readonly Known[]; readonly self: number },
): PersonRef {
  const wanted = cell.trim();
  const others = ctx.rows.filter((r) => r.row !== ctx.self);
  const byFileId = others.find((r) => r.fileId !== null && r.fileId === wanted);
  if (byFileId) return { kind: 'row', row: byFileId.row };
  const byId = ctx.people.find((p) => p.id === wanted);
  if (byId) return { kind: 'person', id: byId.id };
  if (looksLikeId(wanted)) {
    return { kind: 'none', reason: 'nobody in this company or this file has this id' };
  }

  const key = normalName(wanted);
  const one = <T>(xs: readonly T[], of: (x: T) => string | null): T[] =>
    xs.filter((x) => {
      const v = of(x);
      return v !== null && normalName(v) === key;
    });
  if (wanted.includes('@')) {
    const [here] = one(ctx.people, (p) => p.email);
    if (here) return { kind: 'person', id: here.id };
    const [row] = one(others, (r) => r.email);
    if (row) return { kind: 'row', row: row.row };
    return { kind: 'none', reason: 'nobody in this company or this file has this work email' };
  }
  const named = [...one(ctx.people, (p) => p.name), ...one(others, (r) => r.name)];
  const [only] = named;
  if (named.length > 1) return { kind: 'none', reason: `more than one person is called “${wanted}”` };
  if (only === undefined) {
    return { kind: 'none', reason: `nobody in this company or this file is called “${wanted}”` };
  }
  return 'id' in only ? { kind: 'person', id: only.id } : { kind: 'row', row: only.row };
}

export type PlaceRef =
  | { readonly kind: 'id'; readonly id: string }
  /** Nothing here has this name: the import's plan adds it, where it may. */
  | { readonly kind: 'new'; readonly name: string }
  | { readonly kind: 'none'; readonly reason: string };

/** Which legal entity or work location a cell means: here by id, then by name. */
export function placeOf(
  cell: string,
  places: readonly { readonly id: string; readonly name: string; readonly archived?: boolean }[],
): PlaceRef {
  const wanted = cell.trim();
  const byId = places.find((p) => p.id === wanted);
  if (byId) {
    return byId.archived === true
      ? { kind: 'none', reason: `“${byId.name}” is archived` }
      : { kind: 'id', id: byId.id };
  }
  if (looksLikeId(wanted)) {
    return { kind: 'none', reason: 'not in this company: an id from another system' };
  }
  const named = places.filter((p) => normalName(p.name) === normalName(wanted));
  const live = named.filter((p) => p.archived !== true);
  const [one] = live;
  if (live.length > 1) return { kind: 'none', reason: `more than one is called “${wanted}”` };
  if (one) return { kind: 'id', id: one.id };
  if (named.length > 0) return { kind: 'none', reason: `“${named[0]?.name ?? wanted}” is archived` };
  return { kind: 'new', name: wanted.replaceAll(/\s+/gu, ' ') };
}
