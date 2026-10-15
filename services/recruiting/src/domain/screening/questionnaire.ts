import type { LaunchCountry } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Questionnaires, scoring and knockouts (Recruiting PRD §15, REC-021).
 *
 * A knockout is a rule a person wrote. By default it flags the application
 * for review. A company may let a knockout reject automatically, per
 * question, only where the question is a legal requirement in a German or
 * Spanish job, and the rejection email then offers a human review
 * (GDPR art. 22(3)).
 */

export type QuestionKind =
  'short_text' | 'long_text' | 'single' | 'multiple' | 'number' | 'yes_no' | 'date' | 'file';

export interface Question {
  readonly id: string;
  readonly text: string;
  readonly kind: QuestionKind;
  readonly required: boolean;
  readonly options: readonly string[];
  /** Points per option (single, multiple, yes_no as "yes"/"no"). */
  readonly points: Readonly<Record<string, number>> | null;
  readonly knockout: Knockout | null;
}

export interface Knockout {
  /** The answers that knock out: options, or "yes"/"no". */
  readonly answers: readonly string[];
  /** For a number: below this knocks out. */
  readonly below?: number;
  readonly autoReject: boolean;
  /** The question asks a legal requirement for the job (a licence, the right to work). */
  readonly legalRequirement: boolean;
}

export interface Questionnaire {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly questions: readonly Question[];
  /** BetrVG § 94: a works council's consent, recorded against this version. */
  readonly worksCouncilConsentVersion: number | null;
}

export type Answer = string | readonly string[] | number | boolean | null;

const asChoices = (answer: Answer): string[] =>
  answer === null
    ? []
    : typeof answer === 'boolean'
      ? [answer ? 'yes' : 'no']
      : Array.isArray(answer)
        ? [...(answer as string[])]
        : [String(answer)];

export function validateQuestionnaire(
  q: Questionnaire,
  countries: readonly LaunchCountry[],
): Result<Questionnaire> {
  for (const question of q.questions) {
    if (question.knockout?.autoReject === true) {
      const strict = countries.some((c) => c === 'DE' || c === 'ES');
      if (strict && !question.knockout.legalRequirement) {
        return err(
          failure(
            'AUTO_REJECT_NOT_ALLOWED',
            'In a German or Spanish job a knockout may reject on its own only for a legal requirement',
            [question.id],
          ),
        );
      }
    }
    if (
      (question.kind === 'single' || question.kind === 'multiple') &&
      question.options.length < 2
    ) {
      return err(failure('OPTIONS', 'A choice needs at least two options', [question.id]));
    }
  }
  return ok(q);
}

/** A DE job may only use a version its works council consented to (BetrVG § 94). */
export const usableIn = (
  q: Questionnaire,
  country: LaunchCountry,
  hasWorksCouncil: boolean,
): boolean => country !== 'DE' || !hasWorksCouncil || q.worksCouncilConsentVersion === q.version;

export interface Scored {
  /** The sum of points; null when no question is scored. */
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly knockedOut: readonly string[];
  /** Rejection happens only when every knockout that fired may reject on its own. */
  readonly autoReject: boolean;
  readonly missing: readonly string[];
}

export function score(q: Questionnaire, answers: Readonly<Record<string, Answer>>): Scored {
  let total = 0;
  let max = 0;
  let scored = false;
  const knockedOut: string[] = [];
  const missing: string[] = [];
  let reject = true;
  for (const question of q.questions) {
    const answer = answers[question.id] ?? null;
    if (
      question.required &&
      (answer === null || answer === '' || (Array.isArray(answer) && answer.length === 0))
    )
      missing.push(question.id);
    if (question.points !== null) {
      scored = true;
      const values = Object.values(question.points);
      max +=
        question.kind === 'multiple'
          ? values.filter((v) => v > 0).reduce((a, b) => a + b, 0)
          : Math.max(0, ...values);
      for (const choice of asChoices(answer)) total += question.points[choice] ?? 0;
    }
    const knockout = question.knockout;
    if (knockout !== null) {
      const fired =
        (knockout.below !== undefined && typeof answer === 'number' && answer < knockout.below) ||
        asChoices(answer).some((choice) => knockout.answers.includes(choice));
      if (fired) {
        knockedOut.push(question.id);
        if (!knockout.autoReject) reject = false;
      }
    }
  }
  return {
    score: scored ? total : null,
    maxScore: scored ? max : null,
    knockedOut,
    autoReject: knockedOut.length > 0 && reject,
    missing,
  };
}

/** Questions that would ask for pay history (PRD §8.3): refused where it is banned. */
export const PAY_HISTORY_QUESTION =
  /current (?:salary|pay)|previous (?:salary|pay)|how much do you (?:earn|make)|aktuelles gehalt|salario actual/iu;
export const asksPayHistory = (q: Questionnaire): boolean =>
  q.questions.some((question) => PAY_HISTORY_QUESTION.test(question.text));
