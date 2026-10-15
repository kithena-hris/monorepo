/**
 * The evidence matrix (PRD §14.3): a model reads one application against
 * each of the job's criteria and quotes the passages behind its verdict; the
 * domain does the rest. A quote not found in the text is dropped, and a
 * verdict left with no quote becomes `not_evidenced`. The score and the band
 * are computed here and never asked of the model. A band is a label, never a
 * stage: nothing rejects on it (§14.4).
 */

export type Verdict = 'met' | 'partly_met' | 'not_met' | 'not_evidenced';
export type Band = 'strong' | 'good' | 'weak';

export interface MatrixCriterion {
  readonly id: string;
  readonly text: string;
  readonly must: boolean;
  readonly weight: number;
}

export interface Finding {
  readonly criterionId: string;
  readonly verdict: Verdict;
  readonly passages: readonly string[];
  /** One sentence, the model's; shown beside the quotes, never used in the score. */
  readonly why: string;
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/gu, ' ').trim();

/** One finding per criterion, in the job's order, each backed by quotes that are in the text. */
export function verifyFindings(
  findings: readonly Finding[],
  criteria: readonly MatrixCriterion[],
  text: string,
): Finding[] {
  const haystack = flat(text);
  return criteria.map((c) => {
    const given = findings.find((f) => f.criterionId === c.id);
    if (given === undefined)
      return { criterionId: c.id, verdict: 'not_evidenced', passages: [], why: '' };
    const passages = given.passages.filter((p) => p.trim() !== '' && haystack.includes(flat(p)));
    const claims = given.verdict === 'met' || given.verdict === 'partly_met';
    return {
      criterionId: c.id,
      verdict: claims && passages.length === 0 ? 'not_evidenced' : given.verdict,
      passages,
      why: given.why.slice(0, 400),
    };
  });
}

// Fixed thresholds, in basis points of the weighted maximum.
const STRONG = 7_500;
const GOOD = 5_000;

export function matchScore(
  criteria: readonly MatrixCriterion[],
  findings: readonly Finding[],
): { readonly scoreBp: number; readonly band: Band } {
  // Halves as whole numbers: met 2, partly 1, so the sum stays an integer.
  const total = criteria.reduce((n, c) => n + 2 * c.weight, 0);
  if (total === 0) return { scoreBp: 0, band: 'weak' };
  const verdictOf = (id: string) => findings.find((f) => f.criterionId === id)?.verdict;
  const earned = criteria.reduce((n, c) => {
    const v = verdictOf(c.id);
    return n + (v === 'met' ? 2 : v === 'partly_met' ? 1 : 0) * c.weight;
  }, 0);
  const scoreBp = Math.floor((earned * 10_000) / total);
  const mustsMet = criteria.every((c) => !c.must || verdictOf(c.id) === 'met');
  return {
    scoreBp,
    band: scoreBp >= STRONG && mustsMet ? 'strong' : scoreBp >= GOOD ? 'good' : 'weak',
  };
}
