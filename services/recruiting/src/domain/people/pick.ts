/**
 * People as a field that picks one by name offers them: a name, and for a
 * name two people share, the one thing that tells them apart. Their
 * department when no namesake is in it; otherwise their work email, which
 * nobody shares. Anyone whose name is theirs alone gets the name and nothing
 * else: a second line on every row is noise where there is nothing to confuse.
 */
export interface Pickable {
  readonly personId: string;
  readonly name: string;
  readonly hint?: string;
}

export function toPick(
  members: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly teamName: string | null;
    readonly workEmail: string | null;
  }[],
): Pickable[] {
  const sameName = new Map<string, number>();
  const sameTeam = new Map<string, number>();
  for (const m of members) {
    sameName.set(m.displayName, (sameName.get(m.displayName) ?? 0) + 1);
    const team = `${m.displayName}\u0000${m.teamName ?? ''}`;
    sameTeam.set(team, (sameTeam.get(team) ?? 0) + 1);
  }
  return members.map((m) => {
    const base = { personId: m.personId, name: m.displayName };
    if (sameName.get(m.displayName) === 1) return base;
    const alone = sameTeam.get(`${m.displayName}\u0000${m.teamName ?? ''}`) === 1;
    const hint = alone && m.teamName !== null ? m.teamName : m.workEmail;
    return hint === null ? base : { ...base, hint };
  });
}
