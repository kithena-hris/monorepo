/**
 * A summary a person can check (PRD §22.4): every sentence names the
 * scorecards it came from. A sentence citing nothing, or a scorecard that
 * does not exist, is dropped — an uncited verdict ("Overall, hire") is the
 * model deciding, and deciding is the hiring manager's.
 */
export interface Cited {
  readonly text: string;
  readonly cites: readonly string[];
}

export function keepCited(sentences: readonly Cited[], sources: ReadonlySet<string>): Cited[] {
  return sentences.filter((s) => s.cites.length > 0 && s.cites.every((c) => sources.has(c)));
}
