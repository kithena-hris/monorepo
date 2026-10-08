/** Somebody in the org chart: who they report to, by id. */
export interface OrgPerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly managerId: string | null;
  readonly avatarUrl?: string | null;
}

export interface OrgNode {
  readonly person: OrgPerson;
  readonly reports: readonly OrgNode[];
}

/**
 * Everybody under whoever they report to. Somebody whose manager this viewer
 * cannot list starts a tree of their own rather than vanishing, and a cycle
 * in somebody's data stops where it closes rather than drawing forever.
 */
export function orgTree(people: readonly OrgPerson[]): OrgNode[] {
  const known = new Set(people.map((p) => p.id));
  const under = new Map<string, OrgPerson[]>();
  for (const p of people) {
    const top = p.managerId === null || !known.has(p.managerId) ? '' : p.managerId;
    under.set(top, [...(under.get(top) ?? []), p]);
  }
  const node = (person: OrgPerson, seen: ReadonlySet<string>): OrgNode => {
    const next = new Set(seen).add(person.id);
    return {
      person,
      reports: (under.get(person.id) ?? [])
        .filter((r) => !next.has(r.id))
        .map((r) => node(r, next)),
    };
  };
  const roots = under.get('') ?? [];
  // A ring with nobody outside it has no root: start it from its first member.
  const placed = new Set<string>();
  const walk = (n: OrgNode): void => {
    placed.add(n.person.id);
    n.reports.forEach(walk);
  };
  const trees = roots.map((p) => node(p, new Set()));
  trees.forEach(walk);
  for (const p of people) {
    if (placed.has(p.id)) continue;
    const ring = node(p, new Set());
    walk(ring);
    trees.push(ring);
  }
  return trees;
}
