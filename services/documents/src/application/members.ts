import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { CalendarDate, PersonId } from '@kithena/contracts';

import { contextOf, hrOnly } from './context.js';
import type { Caller, Deps, Member } from './ports.js';

/**
 * Who works here, when People is absent (PRD §5.2): HR imports the members,
 * as Time Off's import does. With People present its events keep the same
 * rows (`infrastructure/consumers`).
 */

export const MemberRow = z.strictObject({
  personId: PersonId,
  accountId: z.string().check(z.uuid()).nullable().default(null),
  displayName: z.string().trim().min(1).max(200),
  workEmail: z.string().trim().max(320).nullable().default(null),
  managerPersonId: PersonId.nullable().default(null),
  teamKey: z.string().trim().max(60).nullable().default(null),
  teamName: z.string().trim().max(200).nullable().default(null),
  locationKey: z.string().trim().max(60).nullable().default(null),
  hireDate: CalendarDate.nullable().default(null),
  terminationDate: CalendarDate.nullable().default(null),
  status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
});

export function importMembers(
  deps: Deps,
  caller: Caller,
  rows: readonly z.output<typeof MemberRow>[],
): Promise<Result<{ imported: number }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    if (rows.length > 5000) return err(failure('TOO_MANY', 'Up to 5,000 people at once'));
    let imported = 0;
    for (const row of rows) {
      const member: Member = row;
      // An import mints its own event id, dated today, so People's later events still win.
      if (await tx.members.upsert(member, deps.newId(), ctx.today)) imported += 1;
    }
    return ok({ imported });
  });
}
