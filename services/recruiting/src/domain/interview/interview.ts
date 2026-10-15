import type { Rating, Recommendation } from '@kithena/contracts';
import { Decimal } from 'decimal.js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Interviews, scorecards and the debrief (Recruiting PRD §16, REC-022).
 *
 * Ratings are integers on 1–4 with no midpoint; every average is the
 * domain's. An interviewer sees the others' scorecards only after submitting
 * their own (§16.6); the hiring manager and recruiter see them as they come.
 */

export type InterviewState = 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';

export interface Interview {
  readonly id: string;
  readonly applicationId: string;
  readonly planKey: string;
  readonly startsAt: string;
  readonly minutes: number;
  readonly interviewerIds: readonly string[];
  readonly state: InterviewState;
}

const MOVES: Readonly<Record<InterviewState, readonly InterviewState[]>> = {
  scheduled: ['completed', 'no_show', 'cancelled', 'rescheduled'],
  rescheduled: [],
  completed: [],
  no_show: ['rescheduled'],
  cancelled: [],
};

export function moveInterview(interview: Interview, to: InterviewState): Result<Interview> {
  if (!MOVES[interview.state].includes(to))
    return err(failure('INTERVIEW_STATE', `A ${interview.state} interview cannot become ${to}`));
  return ok({ ...interview, state: to });
}

/** A completed interview owes a scorecard from each interviewer, due 24 hours later (§16.5). */
export function scorecardsOwed(
  interview: Interview,
  submittedBy: readonly string[],
  endedAt: string,
): { interviewerId: string; dueAt: string }[] {
  if (interview.state !== 'completed') return [];
  const due = new Date(Date.parse(endedAt) + 24 * 3_600_000).toISOString();
  return interview.interviewerIds
    .filter((id) => !submittedBy.includes(id))
    .map((interviewerId) => ({ interviewerId, dueAt: due }));
}

export interface Competency {
  readonly key: string;
  readonly name: string;
}

export interface Scorecard {
  readonly interviewId: string;
  readonly interviewerId: string;
  readonly ratings: Readonly<Record<string, Rating>>;
  readonly recommendation: Recommendation | null;
  readonly submittedAt: string | null;
}

/** A scorecard is submitted only complete: every competency the interview owns, and a recommendation. */
export function submitScorecard(
  card: Scorecard,
  owned: readonly Competency[],
  at: string,
): Result<Scorecard> {
  if (card.submittedAt !== null)
    return err(failure('ALREADY_SUBMITTED', 'This scorecard is already in'));
  const missing = owned.filter((c) => card.ratings[c.key] === undefined).map((c) => c.name);
  if (missing.length > 0)
    return err(failure('RATINGS_MISSING', `Rate ${missing.join(', ')} first`));
  if (card.recommendation === null)
    return err(failure('RECOMMENDATION_MISSING', 'Give an overall recommendation'));
  return ok({ ...card, submittedAt: at });
}

export type Viewer =
  { readonly kind: 'hiring_team' } | { readonly kind: 'interviewer'; readonly personId: string };

/** The scorecards a viewer may read (§16.6): an interviewer, only once theirs is in. */
export function visibleScorecards(cards: readonly Scorecard[], viewer: Viewer): Scorecard[] {
  const submitted = cards.filter((c) => c.submittedAt !== null);
  if (viewer.kind === 'hiring_team') return submitted;
  const mine = cards.find((c) => c.interviewerId === viewer.personId);
  if (mine?.submittedAt == null) return mine === undefined ? [] : [mine];
  return submitted;
}

export interface DebriefRow {
  readonly competency: string;
  /** Two places, as text: "3.25". Null when nobody rated it. */
  readonly average: string | null;
  readonly ratings: readonly { readonly interviewerId: string; readonly rating: Rating }[];
  /** Interviewers two or more points apart (§16.7). */
  readonly disagreement: boolean;
}

export interface Debrief {
  readonly rows: readonly DebriefRow[];
  readonly recommendations: Readonly<Record<Recommendation, number>>;
  readonly submitted: number;
  readonly expected: number;
}

export function debrief(
  competencies: readonly Competency[],
  cards: readonly Scorecard[],
  expected: number,
): Debrief {
  const submitted = cards.filter((c) => c.submittedAt !== null);
  const rows = competencies.map((competency) => {
    const ratings = submitted.flatMap((c) => {
      const rating = c.ratings[competency.key];
      return rating === undefined ? [] : [{ interviewerId: c.interviewerId, rating }];
    });
    const values = ratings.map((r) => r.rating);
    return {
      competency: competency.key,
      average:
        values.length === 0
          ? null
          : values
              .reduce((sum, v) => sum.plus(v), new Decimal(0))
              .div(values.length)
              .toFixed(2),
      ratings,
      disagreement: values.length > 1 && Math.max(...values) - Math.min(...values) >= 2,
    };
  });
  const recommendations: Record<Recommendation, number> = {
    strong_no: 0,
    no: 0,
    yes: 0,
    strong_yes: 0,
  };
  for (const card of submitted)
    if (card.recommendation !== null) recommendations[card.recommendation] += 1;
  return { rows, recommendations, submitted: submitted.length, expected };
}

export type DebriefDecision = 'advance' | 'reject' | 'offer';

/** The decision is the hiring manager's, with a reason (§16.7). */
export function decideDebrief(
  deciderId: string,
  hiringManagerId: string,
  decision: DebriefDecision,
  reason: string,
): Result<{ decision: DebriefDecision; reason: string }> {
  if (deciderId !== hiringManagerId)
    return err(failure('NOT_HIRING_MANAGER', 'The hiring manager decides'));
  if (reason.trim() === '') return err(failure('REASON_REQUIRED', 'Say why'));
  return ok({ decision, reason });
}
