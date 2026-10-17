import type { Ctx } from './context.js';
import type { Member } from './ports.js';

/**
 * The people Performance knows (PRD §5.2, PRF-037), as screens and the
 * filter read them: each with their department's name and their manager.
 */

export interface Person {
  readonly personId: string;
  readonly name: string;
  readonly title: string | null;
  readonly department: string | null;
  readonly managerId: string | null;
  readonly status: string;
  readonly hiredOn: string | null;
  readonly legalEntityId: string | null;
  readonly probationEnd: string | null;
  readonly email: string | null;
}

export async function people(ctx: Ctx): Promise<Person[]> {
  const [members, units] = await Promise.all([ctx.members(), ctx.tx.orgUnits.find()]);
  const unit = new Map(units.map((u) => [u.id, u.name]));
  return members.map((m: Member) => ({
    personId: m.personId,
    name: m.displayName,
    title: m.title,
    department: m.orgUnitId === null ? null : (unit.get(m.orgUnitId) ?? null),
    managerId: m.managerPersonId,
    status: m.status,
    hiredOn: m.hiredOn,
    legalEntityId: m.legalEntityId,
    probationEnd: m.probationEnd,
    email: m.workEmail,
  }));
}

/** The member's line under their name: "Backend engineer · Engineering". */
export const subtitle = (p: Person | undefined): string =>
  [p?.title, p?.department].filter((x) => x !== null && x !== undefined && x !== '').join(' · ');

/** A person's team for "all peers" and the picker (§9.3): same manager, not them. */
export function team(all: readonly Person[], personId: string): Person[] {
  const me = all.find((p) => p.personId === personId);
  if (me?.managerId === null || me === undefined) return [];
  return all.filter(
    (p) => p.managerId === me.managerId && p.personId !== personId && p.status !== 'terminated',
  );
}

/** A search over everyone, by name, title or department. */
export function search(all: readonly Person[], q: string, limit = 20): Person[] {
  const needle = q.trim().toLowerCase();
  const live = all.filter((p) => p.status !== 'terminated');
  if (needle === '') return live.slice(0, limit);
  return live
    .filter((p) =>
      [p.name, p.title, p.department].some((x) => (x ?? '').toLowerCase().includes(needle)),
    )
    .slice(0, limit);
}
