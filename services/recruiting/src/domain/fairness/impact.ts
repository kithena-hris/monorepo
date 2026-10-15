/**
 * Fairness checks (PRD §22.6): for each stage, the share of each voluntary
 * self-ID group that reached it, and that share against the highest group's
 * — the adverse impact ratio, flagged under four-fifths. Only groups of at
 * least five people are shown (People's cohort minimum). Pure: the caller
 * decides who is counted (all, or only AI-assisted decisions).
 */

export const COHORT_MINIMUM = 5;
const FOUR_FIFTHS_BP = 8_000;

export interface Person {
  readonly group: string;
  /** How far the application got, as a stage's position in the pipeline. */
  readonly reachedRank: number;
  readonly ai: boolean;
}

export interface ImpactRow {
  readonly stage: string;
  readonly group: string;
  readonly n: number;
  readonly rateBp: number;
  readonly ratioBp: number;
  readonly flagged: boolean;
}

export function adverseImpact(
  people: readonly Person[],
  stages: readonly { readonly rank: number; readonly name: string }[],
  counted: (p: Person) => boolean = () => true,
): ImpactRow[] {
  const groups = new Map<string, Person[]>();
  for (const p of people.filter(counted)) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const shown = [...groups.entries()].filter(([, members]) => members.length >= COHORT_MINIMUM);
  return stages.flatMap((stage) => {
    const rates = shown.map(([group, members]) => ({
      group,
      n: members.length,
      rateBp: Math.floor(
        (members.filter((m) => m.reachedRank >= stage.rank).length * 10_000) / members.length,
      ),
    }));
    const best = Math.max(0, ...rates.map((r) => r.rateBp));
    return rates.map((r) => {
      const ratioBp = best === 0 ? 0 : Math.floor((r.rateBp * 10_000) / best);
      return { stage: stage.name, ...r, ratioBp, flagged: best > 0 && ratioBp < FOUR_FIFTHS_BP };
    });
  });
}
