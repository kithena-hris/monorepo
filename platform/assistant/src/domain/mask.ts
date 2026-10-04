import type { CatalogueLeaveType, LeaveCategory, LeaveTypeKey } from '@kithena/contracts';

import type { Offer, ValidPlan } from './plan.js';

/**
 * Special-category data, kept from the model (assistant PRD §7.6, §12.2).
 * Pure.
 *
 * Sick leave is health data. Before any prompt is built, every phrase naming
 * a private leave type — the company's own name for it ("Baja médica"), its
 * key, and the everyday words for its category ("off sick", "maternity") — is
 * replaced with an opaque reference, `L1`, `L2`…, and the catalogue offers
 * only those references, labelled `REF_LABEL`. The model can plan "people on
 * L1" and never learns what L1 is; the references are mapped back before the
 * plan runs.
 *
 * Whatever is still special-category after that — sick leave in a company
 * without Time Off, "who is pregnant" anywhere — and any judgement or
 * prediction about a person is refused before the model, with People's
 * sentences.
 */

/** An opaque reference and the private types it stands for. */
export interface LeaveRef {
  /** `L1`, `L2`…, in the order the question first names them. */
  readonly ref: string;
  readonly keys: readonly LeaveTypeKey[];
}

export interface Masked {
  readonly question: string;
  /** Earlier questions in the conversation, masked with the same references. */
  readonly earlier: readonly string[];
  readonly refs: readonly LeaveRef[];
}

/** How a reference is described to the model. */
export const REF_LABEL = 'a leave type named in the question';

/** The everyday words for a private category: they name every private type of it. */
const WORDS: Partial<Record<LeaveCategory, readonly string[]>> = {
  sick_leave: ['sick leave', 'off sick', 'sick', 'ill'],
  parental_leave: [
    'parental leave',
    'maternity leave',
    'paternity leave',
    'maternity',
    'paternity',
    'parental',
  ],
};

const escape = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const fold = (s: string): string => s.toLocaleLowerCase('en').replaceAll(/\s+/gu, ' ').trim();

/**
 * The question, and any earlier questions of a follow-up, masked together: a
 * type named in an earlier question is the same reference in this one, so
 * "and tomorrow?" after "who is off sick today?" can still plan by it.
 */
export function mask(
  question: string,
  leaveTypes: readonly CatalogueLeaveType[],
  earlier: readonly string[] = [],
): Masked {
  const named = new Map<string, LeaveTypeKey[]>();
  const add = (phrase: string, key: LeaveTypeKey) => {
    const p = fold(phrase);
    if (p === '') return;
    const keys = named.get(p) ?? [];
    if (!keys.includes(key)) keys.push(key);
    named.set(p, keys);
  };
  const hidden = leaveTypes.filter((t) => t.private);
  for (const t of hidden) {
    add(t.name, t.key);
    add(t.key, t.key);
    add(t.key.replaceAll('_', ' '), t.key);
    for (const word of t.category === undefined ? [] : (WORDS[t.category] ?? [])) add(word, t.key);
  }
  if (named.size === 0) return { question, earlier, refs: [] };

  // Longest first, so "sick leave" is one phrase rather than "sick" and a stray "leave".
  const phrases = [...named.keys()].toSorted((a, b) => b.length - a.length);
  const re = new RegExp(
    String.raw`(?<![\p{L}\p{N}_])(?:${phrases.map((p) => escape(p).replaceAll(' ', String.raw`\s+`)).join('|')})(?![\p{L}\p{N}_])`,
    'giu',
  );
  const refs: LeaveRef[] = [];
  const masked = (text: string) =>
    text.replace(re, (match) => {
      // Ordered as the catalogue lists them, so one set of types is one reference.
      const keys = hidden.map((t) => t.key).filter((k) => named.get(fold(match))?.includes(k));
      const same = refs.find((r) => r.keys.join() === keys.join());
      if (same !== undefined) return same.ref;
      const ref = { ref: `L${String(refs.length + 1)}`, keys };
      refs.push(ref);
      return ref.ref;
    });
  // The question first, so its references number as they did before follow-ups.
  return { question: masked(question), earlier: earlier.map(masked), refs };
}

/**
 * The offer the model is shown: on every `leave_type` field, the private
 * types give way to the references this question named.
 */
export function maskOffer(
  offered: Offer,
  leaveTypes: readonly CatalogueLeaveType[],
  refs: readonly LeaveRef[],
): Offer {
  const hidden = new Set<string>(leaveTypes.filter((t) => t.private).map((t) => t.key));
  return new Map(
    [...offered].map(([name, o]) => [
      name,
      {
        ...o,
        fields: o.fields.map((f) =>
          f.key === 'leave_type'
            ? {
                ...f,
                options: [
                  ...f.options.filter((option) => !hidden.has(option.value)),
                  ...refs.map((r) => ({ value: r.ref, label: REF_LABEL })),
                ],
              }
            : f,
        ),
      },
    ]),
  );
}

/** The plan with each reference turned back into the types it stands for. */
export function unmask(plan: ValidPlan, refs: readonly LeaveRef[]): ValidPlan {
  if (plan.kind !== 'plan' || refs.length === 0) return plan;
  const keysOf = (value: string): readonly string[] =>
    refs.find((r) => r.ref === value)?.keys ?? [value];
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.input.filters === undefined
        ? step
        : {
            ...step,
            input: {
              ...step.input,
              filters: step.input.filters.map((f) =>
                f.key === 'leave_type'
                  ? { ...f, values: [...new Set(f.values.flatMap(keysOf))] }
                  : f,
              ),
            },
          },
    ),
  };
}

/* ------------------------------------------------------------ refusing -- */

/*
 * A deliberate copy of People's refusals (`services/people/src/domain/assistant/clarify.ts`),
 * less its skills one, which only offers a field instead. A platform service
 * cannot import a module, and Time Off's caller rule is the precedent for a
 * copy that says where it came from. Change both together.
 */

export type RefusalKind = 'performance' | 'prediction' | 'special';

export interface Refusal {
  readonly kind: RefusalKind;
  /** People's sentence for it, said to the asker as it stands. */
  readonly text: string;
}

const WHY: Readonly<Record<RefusalKind, string>> = {
  performance: 'Kithena doesn’t judge how well people work.',
  prediction: 'Kithena doesn’t guess what people will do.',
  special: 'Kithena never searches by health or other special-category data.',
};

const LEAD = String.raw`(?:(?:who|that)\s+(?:are|is|'re|’re)\s+)?(?:really\s+|very\s+)?`;

const REFUSALS: readonly { readonly kind: RefusalKind; readonly re: RegExp }[] = [
  {
    kind: 'performance',
    re: new RegExp(
      String.raw`\b${LEAD}(?:(?:top|high|low|best|worst|poor|strong|weak|under|over)[\s-]?(?:performers?|performing|achievers?)|under-?perform\w*|perform(?:s|ing)?\s+(?:well|badly|poorly)|lazy|talented|high[\s-]potentials?|best\s+(?:employees|people|staff|workers))\b`,
      'iu',
    ),
  },
  {
    kind: 'prediction',
    re: new RegExp(
      String.raw`\b${LEAD}(?:(?:likely|going|planning)\s+to\s+(?:quit|resign|leave)|(?:might|could|may|will)\s+(?:quit|resign|leave)|flight\s+risks?|unhappy|disengaged)\b`,
      'iu',
    ),
  },
  {
    kind: 'special',
    re: new RegExp(
      String.raw`\b${LEAD}(?:sick(?:\s+leave)?|(?:poor|bad|ill)\s+health|ill|illness(?:es)?|(?:mental\s+)?health\s+(?:issues?|problems?|conditions?)|pregnan\w*|disab\w*|mentally\s+ill|depress\w*|burn(?:ed|t)?[\s-]?out|religio\w*|muslims?|christians?|jewish|jews|hindus?|buddhists?|ethnic\w*|race|gay|lesbian|lgbt\w*|sexual\w*|(?:trade\s+)?union\s+members?|political\w*)\b`,
      'iu',
    ),
  },
];

/** What People would refuse to search for, in what masking left of the question; null for none. */
export function refused(question: string): Refusal | null {
  const hit = REFUSALS.find(({ re }) => re.test(question));
  return hit === undefined ? null : { kind: hit.kind, text: WHY[hit.kind] };
}
