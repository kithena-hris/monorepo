import { Decimal } from 'decimal.js';
import type {
  CompanyScale,
  FormActivity,
  FormAnswer,
  FormAnswers,
  FormDefinition,
  FormQuestion,
  FormSection,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The forms kit (Performance PRD §11.1, PRF-008): pure logic over the forms
 * contract, so every module that stores forms reads, checks and scores them
 * the same way. No I/O, no clock, no framework.
 */

const MAX_SECTIONS = 30;
const MAX_QUESTIONS = 100;

const questionsOf = (def: FormDefinition): FormQuestion[] =>
  def.sections.flatMap((s) => s.questions);

/** §11.2–§11.5, as a refusal naming the first thing wrong. */
export function validateDefinition(
  def: FormDefinition,
  options: { readonly purpose?: 'review' | 'feedback' | 'quiz' } = {},
): Result<FormDefinition> {
  if (def.sections.length > MAX_SECTIONS)
    return err(failure('TOO_MANY_SECTIONS', `At most ${String(MAX_SECTIONS)} sections`));
  const all = questionsOf(def);
  if (all.length > MAX_QUESTIONS)
    return err(failure('TOO_MANY_QUESTIONS', `At most ${String(MAX_QUESTIONS)} questions`));
  const sections = new Set<string>();
  for (const s of def.sections) {
    if (sections.has(s.id))
      return err(failure('DUPLICATE_SECTION', `Two sections are called ${s.id}`, [s.id]));
    sections.add(s.id);
  }
  const ids = new Set<string>();
  for (const q of all) {
    if (ids.has(q.id))
      return err(failure('DUPLICATE_QUESTION', `Two questions share the id ${q.id}`, [q.id]));
    ids.add(q.id);
    if (q.type === 'scale' && !rising(q.options.map((o) => o.value)))
      return err(
        failure('SCALE_ORDER', `“${q.prompt}”: values must rise from low to high`, [q.id]),
      );
    if (q.type === 'choice') {
      const opts = new Set(q.options.map((o) => o.id));
      if (opts.size !== q.options.length)
        return err(failure('DUPLICATE_OPTION', `“${q.prompt}” lists an option twice`, [q.id]));
      if (q.min !== null && q.max !== null && q.min > q.max)
        return err(
          failure('CHOICE_RANGE', `“${q.prompt}”: the minimum is above the maximum`, [q.id]),
        );
      if (q.correct?.some((c) => !opts.has(c)) === true)
        return err(
          failure('BAD_CORRECT', `“${q.prompt}”: a right answer is not an option`, [q.id]),
        );
    }
  }
  const scores = all.filter((q) => q.type === 'performance_score');
  if (scores.length > 1)
    return err(failure('TWO_SCORES', 'A form has at most one performance score'));
  if (scores.length === 1) {
    if (options.purpose === 'feedback')
      return err(failure('SCORE_ON_FEEDBACK', 'Feedback never carries a performance score'));
    const last = def.sections.at(-1);
    if (
      last === undefined ||
      last.questions.length !== 1 ||
      last.questions[0]?.type !== 'performance_score'
    )
      return err(failure('SCORE_NOT_LAST', 'The performance score sits alone in the last section'));
  }
  return ok(def);
}

const rising = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v > (values[i - 1] ?? Number.NEGATIVE_INFINITY));

/** Empty sections removed (§11.2), with their titles for the toast. */
export function normalise(def: FormDefinition): {
  readonly definition: FormDefinition;
  readonly removed: readonly string[];
} {
  return {
    definition: { ...def, sections: def.sections.filter((s) => s.questions.length > 0) },
    removed: def.sections.filter((s) => s.questions.length === 0).map((s) => s.title),
  };
}

/** The form as one activity asks it: questions limited to others left out, then empty sections. */
export function questionsFor(def: FormDefinition, activity: FormActivity): FormDefinition {
  return normalise({
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.filter(
        (q) => q.activities === undefined || q.activities.includes(activity),
      ),
    })),
  }).definition;
}

/**
 * What the review's subject may read (§11.4): private questions and their
 * answers are absent, not hidden, and a section left empty goes too, so
 * nothing counts or numbers what was removed.
 */
export function subjectView(
  def: FormDefinition,
  answers: FormAnswers,
): { readonly definition: FormDefinition; readonly answers: FormAnswers } {
  const definition = normalise({
    ...def,
    sections: def.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => !q.private) })),
  }).definition;
  const kept = new Set(questionsOf(definition).map((q) => q.id));
  return {
    definition,
    answers: Object.fromEntries(Object.entries(answers).filter(([id]) => kept.has(id))),
  };
}

const answered = (a: FormAnswer | undefined): boolean => {
  if (a === undefined) return false;
  const v = a.value;
  if (v === null) return false;
  if (typeof v === 'string') return v.replaceAll(/<[^>]*>/gu, '').trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

const computed = (q: FormQuestion): boolean => q.type === 'performance_score';

function checkOne(q: FormQuestion, a: FormAnswer): string | null {
  const v = a.value;
  if (v === null) return null;
  if (a.comment !== null && !q.allowComment) return 'takes no comment';
  switch (q.type) {
    case 'text':
      return typeof v === 'string' ? null : 'needs words';
    case 'scale':
      return typeof v === 'number' && q.options.some((o) => o.value === v)
        ? null
        : 'is not on the scale';
    case 'goals':
      return typeof v === 'number' ? null : 'needs a rating';
    case 'binary':
      return typeof v === 'boolean' ? null : 'needs yes or no';
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'needs a number';
      if (q.min !== null && v < q.min) return `is below ${String(q.min)}`;
      if (q.max !== null && v > q.max) return `is above ${String(q.max)}`;
      return null;
    case 'choice': {
      const picked = Array.isArray(v) ? v : typeof v === 'string' ? [v] : null;
      if (picked === null) return 'needs an option';
      if (!picked.every((p) => q.options.some((o) => o.id === p))) return 'is not an option';
      if (!q.multiple && picked.length > 1) return 'takes one option';
      if (q.multiple && q.max !== null && picked.length > q.max)
        return `takes at most ${String(q.max)}`;
      if (q.multiple && q.min !== null && picked.length > 0 && picked.length < q.min)
        return `takes at least ${String(q.min)}`;
      return null;
    }
    case 'performance_score':
      return 'is computed';
  }
}

/** Types and ranges always; required questions only on submit (§11.4). */
export function validateAnswers(
  def: FormDefinition,
  answers: FormAnswers,
  options: { readonly submitting: boolean; readonly activity?: FormActivity },
): Result<FormAnswers> {
  const asked = options.activity === undefined ? def : questionsFor(def, options.activity);
  const byId = new Map(questionsOf(def).map((q) => [q.id, q]));
  for (const [id, a] of Object.entries(answers)) {
    const q = byId.get(id);
    if (q === undefined) return err(failure('UNKNOWN_QUESTION', `No question ${id}`, [id]));
    if (computed(q) && a.value !== null)
      return err(failure('COMPUTED', 'The performance score is computed, never typed', [id]));
    const why = checkOne(q, a);
    if (why !== null) return err(failure('BAD_ANSWER', `“${q.prompt}” ${why}`, [id]));
  }
  if (options.submitting) {
    const missing = questionsOf(asked).filter(
      (q) => q.required && !computed(q) && !answered(answers[q.id]),
    );
    if (missing.length > 0)
      return err(
        failure(
          'REQUIRED',
          `${String(missing.length)} required ${missing.length === 1 ? 'question has' : 'questions have'} no answer`,
          missing.map((q) => q.id),
        ),
      );
  }
  return ok(answers);
}

/** The questions a submit still needs, for the form's own list (§10.3). */
export function missing(
  def: FormDefinition,
  answers: FormAnswers,
  activity?: FormActivity,
): string[] {
  const asked = activity === undefined ? def : questionsFor(def, activity);
  return questionsOf(asked)
    .filter((q) => q.required && !computed(q) && !answered(answers[q.id]))
    .map((q) => q.id);
}

/** Whether a question has an answer worth counting. */
export const isAnswered = answered;

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** A stable hash of a definition (FNV-1a, 64 bits as hex): equal forms, equal prints. */
export function fingerprint(def: FormDefinition): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of canonical(def)) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export interface FormChange {
  readonly kind: 'added' | 'removed' | 'changed' | 'moved';
  readonly questionId: string;
  readonly prompt: string;
  /** For a change: the old prompt when it was the prompt that changed. */
  readonly was: string | null;
}

/** What changed from one version to the next (§11.7), in the newer form's order. */
export function diff(a: FormDefinition, b: FormDefinition): FormChange[] {
  const where = (def: FormDefinition) =>
    new Map(
      def.sections.flatMap((s) =>
        s.questions.map((q, i) => [q.id, { q, section: s.id, at: i }] as const),
      ),
    );
  const before = where(a);
  const after = where(b);
  const changes: FormChange[] = [];
  for (const [id, was] of before)
    if (!after.has(id))
      changes.push({ kind: 'removed', questionId: id, prompt: was.q.prompt, was: null });
  for (const [id, now] of after) {
    const was = before.get(id);
    if (was === undefined) {
      changes.push({ kind: 'added', questionId: id, prompt: now.q.prompt, was: null });
      continue;
    }
    if (canonical(was.q) !== canonical(now.q))
      changes.push({
        kind: 'changed',
        questionId: id,
        prompt: now.q.prompt,
        was: was.q.prompt === now.q.prompt ? null : was.q.prompt,
      });
    else if (was.section !== now.section)
      changes.push({ kind: 'moved', questionId: id, prompt: now.q.prompt, was: null });
  }
  const order = (c: FormChange) => (c.kind === 'removed' ? 1 : c.kind === 'added' ? 2 : 0);
  return changes.toSorted((x, y) => order(x) - order(y));
}

const rated = (q: FormQuestion): q is Extract<FormQuestion, { type: 'scale' | 'goals' }> =>
  q.type === 'scale' || q.type === 'goals';

export interface Score {
  /** In hundredths on the company scale: 350 is 3.50. */
  readonly hundredths: number;
  /** One decimal, or two when the company asks. */
  readonly display: string;
  readonly label: string;
  /** How many rated answers it rests on. */
  readonly rated: number;
}

/**
 * The performance score (§11.5, design PF2b): each rated answer put on the
 * company scale, averaged per section, then the sections averaged, rounded
 * half up. Nobody types it, and a model never sets it.
 */
export function score(
  def: FormDefinition,
  answers: FormAnswers,
  scale: CompanyScale,
  options: { readonly decimals?: 1 | 2 } = {},
): Score | null {
  const lo = new Decimal(scale[0]?.value ?? 1);
  const hi = new Decimal(scale.at(-1)?.value ?? 5);
  const sectionMeans: Decimal[] = [];
  let count = 0;
  for (const s of def.sections) {
    const values: Decimal[] = [];
    for (const q of s.questions) {
      if (!rated(q)) continue;
      const v = answers[q.id]?.value;
      if (typeof v !== 'number') continue;
      const [qlo, qhi] =
        q.type === 'scale'
          ? [q.options[0]?.value ?? 1, q.options.at(-1)?.value ?? 5]
          : [lo.toNumber(), hi.toNumber()];
      if (qhi === qlo) continue;
      values.push(
        lo.plus(
          new Decimal(v)
            .minus(qlo)
            .times(hi.minus(lo))
            .dividedBy(qhi - qlo),
        ),
      );
    }
    if (values.length === 0) continue;
    count += values.length;
    sectionMeans.push(values.reduce((a, b) => a.plus(b), new Decimal(0)).dividedBy(values.length));
  }
  if (sectionMeans.length === 0) return null;
  const mean = sectionMeans
    .reduce((a, b) => a.plus(b), new Decimal(0))
    .dividedBy(sectionMeans.length)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    hundredths: mean.times(100).toNumber(),
    display: mean.toFixed(options.decimals ?? 1, Decimal.ROUND_HALF_UP),
    label: labelOf(scale, mean.toNumber()),
    rated: count,
  };
}

/** The scale's word for a score: the option nearest it, a tie going up. */
export function labelOf(scale: CompanyScale, value: number): string {
  let best = scale[0];
  for (const o of scale)
    if (best === undefined || Math.abs(o.value - value) <= Math.abs(best.value - value)) best = o;
  return best?.label ?? '';
}

/** A quiz's mark (§15.2): choice questions with right answers, all of them or none. */
export function grade(def: FormDefinition, answers: FormAnswers): { correct: number; of: number } {
  const marked = questionsOf(def).filter(
    (q): q is Extract<FormQuestion, { type: 'choice' }> =>
      q.type === 'choice' && q.correct !== undefined,
  );
  const correct = marked.filter((q) => {
    const v = answers[q.id]?.value;
    const picked = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    const want = q.correct ?? [];
    return picked.length === want.length && want.every((w) => picked.includes(w));
  }).length;
  return { correct, of: marked.length };
}

/** The plain words of a rich-text answer, for a PDF, a summary or a sentence count. */
export const plainText = (html: string): string =>
  html
    .replaceAll(/<\/(p|li|h[1-6])>/giu, '\n')
    .replaceAll(/<br\s*\/?>/giu, '\n')
    .replaceAll(/<[^>]*>/gu, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();

export type { FormSection };
