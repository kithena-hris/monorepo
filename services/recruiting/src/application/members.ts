import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { PersonId } from '@kithena/contracts';

import { adminOnly, type Ctx } from './context.js';

/**
 * Members from a file, for a company without People (PRD §5.2, REC-044):
 * Time Off's import, copied. CSV or JSON, the member's fields by name. A dry
 * run answers what would happen and writes nothing; a real run writes every
 * row, or none when any row is wrong, so a half-imported team never exists.
 */

const MemberRow = z.object({
  personId: PersonId,
  accountId: z.string().check(z.uuid()).nullable().default(null),
  displayName: z.string().trim().min(1).max(200),
  workEmail: z.string().trim().max(320).check(z.email()).nullable().default(null),
  managerPersonId: PersonId.nullable().default(null),
  teamKey: z.string().trim().max(100).nullable().default(null),
  teamName: z.string().trim().max(200).nullable().default(null),
  locationKey: z.string().trim().max(100).nullable().default(null),
  legalEntityId: z.string().trim().max(100).nullable().default(null),
  status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
});

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

function rowsOf(request: ImportRequest): Result<Record<string, unknown>[]> {
  if (request.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.content);
    } catch {
      return err(failure('INVALID_FILE', 'The file is not JSON'));
    }
    if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'object' && r !== null))
      return err(failure('INVALID_FILE', 'A JSON import is an array of members'));
    return ok(parsed as Record<string, unknown>[]);
  }
  const [header, ...body] = parseCsv(request.content);
  if (header === undefined) return err(failure('INVALID_FILE', 'The file is empty'));
  const keys = header.map((h) => h.trim());
  // A blank cell is an absent field, as JSON would have said it.
  return ok(
    body.map((cells) =>
      Object.fromEntries(
        keys.flatMap((k, i) => {
          const v = (cells[i] ?? '').trim();
          return v === '' ? [] : [[k, v]];
        }),
      ),
    ),
  );
}

export async function importMembers(
  ctx: Ctx,
  request: ImportRequest,
): Promise<Result<ImportReport>> {
  const admin = adminOnly(ctx);
  if (!admin.ok) return admin;
  const rows = rowsOf(request);
  if (!rows.ok) return rows;
  const errors: { row: number; field: string; message: string }[] = [];
  const valid: z.infer<typeof MemberRow>[] = [];
  const seen = new Set<string>();
  rows.value.forEach((raw, i) => {
    const parsed = MemberRow.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ row: i + 1, field: issue.path.join('.'), message: issue.message });
      return;
    }
    if (seen.has(parsed.data.personId)) {
      errors.push({ row: i + 1, field: 'personId', message: 'This person is in the file twice' });
      return;
    }
    seen.add(parsed.data.personId);
    valid.push(parsed.data);
  });
  const write = !request.dryRun && errors.length === 0;
  let created = 0;
  let updated = 0;
  for (const member of valid) {
    if ((await ctx.tx.members.get(member.personId)) === null) created += 1;
    else updated += 1;
    if (write) await ctx.tx.members.upsert(member, ctx.deps.newId(), ctx.today);
  }
  const counted = write || request.dryRun;
  return ok({
    dryRun: request.dryRun,
    rows: rows.value.length,
    errors,
    created: counted ? created : 0,
    updated: counted ? updated : 0,
  });
}
