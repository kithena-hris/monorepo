import { createHash } from 'node:crypto';
import type { CalendarDate, PersonId } from '@kithena/contracts';
import { ok, type Result } from '@kithena/domain-kit';

import { audit, hrOnly, type Ctx } from './context.js';

/**
 * The member import (PRD §5.2): a company without People sends who works
 * there and who manages whom, and Performance keeps its own projection.
 * Departments arrive by name and become org units here.
 */
export async function importMembers(
  ctx: Ctx,
  members: readonly {
    readonly personId: PersonId;
    readonly accountId: string | null;
    readonly displayName: string;
    readonly workEmail: string | null;
    readonly managerPersonId: PersonId | null;
    readonly status: 'active' | 'terminated';
    readonly title: string | null;
    readonly department: string | null;
    readonly hiredOn: CalendarDate | null;
    readonly leftOn?: CalendarDate | null | undefined;
  }[],
): Promise<Result<{ imported: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const units = new Map((await ctx.tx.orgUnits.find()).map((u) => [u.name.toLowerCase(), u.id]));
  let imported = 0;
  for (const m of members) {
    let unit: string | null = null;
    if (m.department !== null && m.department !== '') {
      unit = units.get(m.department.toLowerCase()) ?? null;
      if (unit === null) {
        unit = ctx.deps.newId();
        await ctx.tx.orgUnits.save({ id: unit, name: m.department, parentId: null });
        units.set(m.department.toLowerCase(), unit);
      }
    }
    const old = await ctx.tx.members.get(m.personId);
    // The import's own event id: the same row twice changes nothing.
    const eventId = createHash('sha256')
      .update(JSON.stringify(m))
      .digest('hex')
      .slice(0, 32)
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
    const changed = await ctx.tx.members.upsert(
      {
        personId: m.personId,
        accountId: m.accountId,
        displayName: m.displayName,
        workEmail: m.workEmail,
        managerPersonId: m.managerPersonId,
        status: m.status,
        title: m.title,
        orgUnitId: unit,
        locationId: old?.locationId ?? null,
        legalEntityId: old?.legalEntityId ?? null,
        hiredOn: m.hiredOn,
        probationEnd: old?.probationEnd ?? null,
        leftOn: m.leftOn ?? old?.leftOn ?? null,
      },
      eventId,
    );
    if (changed) imported += 1;
  }
  await audit(ctx, {
    action: 'Imported members',
    target: `${String(imported)} people`,
    fields: ['members'],
  });
  return ok({ imported });
}
