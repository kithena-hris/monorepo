import { ok, type Result } from '@kithena/domain-kit';

import { MemberFields, type Caller, type Deps } from '../ports.js';
import { forbidden, isHrAdmin, refuse, transact } from '../shared.js';
import { upsertIn } from './sync.js';

/**
 * Members from a file, for a tenant without People (PRD §5.2, TOF-036):
 * `POST /v1/timeoff/members:import`, CSV or JSON, the columns of §5.2 by
 * their field names. A dry run answers what would happen and writes nothing;
 * a real run writes every row in one transaction, or none when any row is
 * wrong, so a half-imported team never exists.
 */

export interface ImportRequest {
  readonly format: 'csv' | 'json';
  readonly content: string;
  readonly dryRun: boolean;
}

export interface ImportReport {
  readonly dryRun: boolean;
  readonly rows: number;
  readonly errors: readonly {
    readonly row: number;
    readonly field: string;
    readonly message: string;
  }[];
  readonly created: number;
  readonly updated: number;
}

/** RFC 4180: commas, quoted fields with doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** A CSV row as JSON would have said it: blanks are null, a work pattern is its digits. */
function fromCsv(header: readonly string[], cells: readonly string[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  header.forEach((key, i) => {
    const value = (cells[i] ?? '').trim();
    if (value === '') return;
    record[key] =
      key === 'workPattern'
        ? value
            .split(/[,\s]+/u)
            .filter(Boolean)
            .map(Number)
        : value;
  });
  return record;
}

function rowsOf(request: ImportRequest): Result<Record<string, unknown>[]> {
  if (request.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.content);
    } catch {
      return refuse('INVALID_FILE', 'The file is not JSON');
    }
    if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'object' && r !== null)) {
      return refuse('INVALID_FILE', 'A JSON import is an array of members');
    }
    return ok(parsed as Record<string, unknown>[]);
  }
  const [header, ...body] = parseCsv(request.content);
  if (header === undefined) return refuse('INVALID_FILE', 'The file is empty');
  const keys = header.map((h) => h.trim());
  return ok(body.map((cells) => fromCsv(keys, cells)));
}

export const importMembers =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  async (caller: Caller, request: ImportRequest): Promise<Result<ImportReport>> => {
    if (!(await isHrAdmin(deps, caller))) return forbidden();
    const rows = rowsOf(request);
    if (!rows.ok) return rows;

    const errors: { row: number; field: string; message: string }[] = [];
    const valid: MemberFields[] = [];
    const seen = new Set<string>();
    rows.value.forEach((raw, i) => {
      const parsed = MemberFields.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({ row: i + 1, field: issue.path.join('.'), message: issue.message });
        }
        return;
      }
      if (seen.has(parsed.data.personId)) {
        errors.push({ row: i + 1, field: 'personId', message: 'This person is in the file twice' });
        return;
      }
      seen.add(parsed.data.personId);
      valid.push(parsed.data);
    });

    return transact(deps, caller.tenantId, async (tx) => {
      let created = 0;
      let updated = 0;
      for (const fields of valid) {
        const existing = await tx.members.get(fields.personId);
        if (existing === null) created++;
        else updated++;
        if (request.dryRun || errors.length > 0) continue;
        const done = await upsertIn(tx, deps, fields, {
          eventId: null,
          effectiveFrom: null,
          correlationId: caller.correlationId,
        });
        if (!done.ok) return done;
      }
      const written = !request.dryRun && errors.length === 0;
      return ok({
        dryRun: request.dryRun,
        rows: rows.value.length,
        errors,
        created: written || request.dryRun ? created : 0,
        updated: written || request.dryRun ? updated : 0,
      });
    });
  };
