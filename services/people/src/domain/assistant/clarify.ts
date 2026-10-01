import type { IntentCondition } from './intent.js';
import { directoryByRules, shiftDays, type PlannedField } from './selection.js';

/**
 * Smart search's two refusals to guess (docs/ai-settings.md, "Smart search").
 *
 * **It asks.** A few phrases mean more than one thing a directory can run:
 * "leaving soon" is somebody who has given notice, or a contract that ends
 * soon, or either. Rather than pick one, the screen asks, offering each
 * reading it can run over this company's fields with how many people each
 * finds. A reading chosen before is taken again (`remembered`), and one
 * reading alone is no question.
 *
 * **It refuses.** A judgement of a person — how good they are at something,
 * how well they work, what they will do — and anything about health or other
 * special-category data is not a field, so it is never searched for, by the
 * rules or by a model: the part is taken out of the sentence before either
 * reads it, and said plainly. Where a field records something close (a
 * Skills field for "good at Go"), it is offered instead, never applied.
 *
 * Pure: the readings are conditions; counting them is the application's.
 */

export interface Reading {
  readonly label: string;
  readonly conditions: readonly IntentCondition[];
  readonly match: 'all' | 'any';
}

export type Topic = 'leaving' | 'new' | 'starting';

export interface Clarification {
  /** What the choice is remembered under, whatever words asked it. */
  readonly topic: Topic;
  /** As typed: "leaving soon". */
  readonly phrase: string;
  readonly readings: readonly Reading[];
}

export type RefusalKind = 'skills' | 'performance' | 'prediction' | 'special';

export interface Refused {
  /** As typed: "who are good at Go". */
  readonly text: string;
  readonly kind: RefusalKind;
  readonly why: string;
  /** A field that records something close, offered and never applied. */
  readonly instead: {
    readonly key: string;
    readonly label: string;
    readonly subject: string;
    readonly condition: IntentCondition;
  } | null;
}

export interface Sifted {
  /** The sentence without what was refused or asked about: what the rules and a model read. */
  readonly rest: string;
  readonly refused: readonly Refused[];
  readonly clarify: Clarification | null;
  /** The reading used without asking: the only one, or the one chosen before. */
  readonly reading: Reading | null;
  readonly remembered: { readonly topic: Topic; readonly phrase: string; readonly label: string } | null;
}

/* ------------------------------------------------------------ refusing -- */

const WHY: Readonly<Record<RefusalKind, string>> = {
  skills: 'Kithena doesn’t rate people’s skills.',
  performance: 'Kithena doesn’t judge how well people work.',
  prediction: 'Kithena doesn’t guess what people will do.',
  special: 'Kithena never searches by health or other special-category data.',
};

const LEAD = String.raw`(?:(?:who|that)\s+(?:are|is|'re|’re)\s+)?(?:really\s+|very\s+)?`;
const END = String.raw`(?=\s*(?:[,;.?!]|\s(?:and|who|in|from|with|at|on)\s|$))`;

const REFUSALS: readonly { readonly kind: RefusalKind; readonly re: RegExp }[] = [
  {
    kind: 'skills',
    re: new RegExp(
      String.raw`\b${LEAD}(?:good|great|best|strong|excellent|bad|weak|skilled|proficient|experts?)\s+(?:at|in|with)\s+(?<subject>[^,;.?!]+?)${END}`,
      'iu',
    ),
  },
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

/** A text field that records skills or something like them. */
const SKILLISH = /skill|expertise|competenc|language|certific|qualific/iu;

const tidy = (s: string): string => s.replaceAll(/\s+/gu, ' ').trim();

function refuse(sentence: string, fields: readonly PlannedField[]): { rest: string; refused: Refused[] } {
  let rest = sentence;
  const refused: Refused[] = [];
  for (const { kind, re } of REFUSALS) {
    for (let m = re.exec(rest); m !== null; m = re.exec(rest)) {
      const subject = m.groups?.['subject']?.trim() ?? '';
      const field =
        kind === 'skills' && subject !== ''
          ? fields.find((f) => f.kind === 'text' && SKILLISH.test(f.label))
          : undefined;
      refused.push({
        text: tidy(m[0]),
        kind,
        why: WHY[kind],
        instead:
          field === undefined
            ? null
            : {
                key: field.key,
                label: field.label,
                subject,
                condition: { key: field.key, op: 'contains', values: [subject] },
              },
      });
      rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    }
  }
  return { rest: tidy(rest), refused };
}

/* -------------------------------------------------------------- asking -- */

const TOPICS: readonly { readonly topic: Topic; readonly re: RegExp }[] = [
  {
    topic: 'leaving',
    re: /\b(?:leaving(?:\s+soon)?|leavers|about\s+to\s+leave|on\s+(?:their|the)\s+way\s+out)\b/iu,
  },
  {
    topic: 'new',
    re: /\b(?:new\s+(?:joiners|starters|hires|people|employees|staff|colleagues)|newcomers|recent\s+(?:joiners|starters|hires)|joined\s+recently|recently\s+joined)\b/iu,
  },
  { topic: 'starting', re: /\b(?:starting\s+soon|about\s+to\s+start|joining\s+soon)\b/iu },
];

const DAYS_AHEAD = 90;

const byKind = (fields: readonly PlannedField[], kind: string) => fields.filter((f) => f.kind === kind);

/** The start date: by its key, else by its name. */
const hireField = (fields: readonly PlannedField[]) =>
  byKind(fields, 'date').find((f) => f.key === 'hire_date') ??
  byKind(fields, 'date').find((f) => /start|hire|join/iu.test(f.label));

const statusIs = (fields: readonly PlannedField[], value: string): IntentCondition | null =>
  fields.some((f) => f.kind === 'status' && f.options.some((o) => o.value === value))
    ? { key: 'status', op: 'in', values: [value] }
    : null;

/** Each reading this company's fields can run, in the order they are offered. */
function readingsOf(topic: Topic, fields: readonly PlannedField[], today: string): Reading[] {
  const one = (label: string, c: IntentCondition | null): Reading[] =>
    c === null ? [] : [{ label, conditions: [c], match: 'all' }];
  const hire = hireField(fields);
  switch (topic) {
    case 'leaving': {
      const end = byKind(fields, 'date').find(
        (f) => f !== hire && /\bend|termination|leav|last\s+day|exit/iu.test(f.label),
      );
      return [
        ...one('Have given notice', statusIs(fields, 'notice')),
        ...one(
          `${end?.label ?? ''} in the next ${String(DAYS_AHEAD)} days`,
          end === undefined
            ? null
            : { key: end.key, op: 'between', values: [today, shiftDays(today, DAYS_AHEAD)] },
        ),
      ];
    }
    case 'starting':
      return [
        ...one('Haven’t started yet', statusIs(fields, 'pre_hire')),
        ...one(
          'Start in the next 30 days',
          hire === undefined
            ? null
            : { key: hire.key, op: 'between', values: [today, shiftDays(today, 30)] },
        ),
      ];
    case 'new':
      if (hire === undefined) return [];
      return [
        ['Joined in the last 30 days', shiftDays(today, -30)],
        ['Joined in the last 90 days', shiftDays(today, -90)],
        ['Joined this year', `${today.slice(0, 4)}-01-01`],
      ].map(([label = '', from = '']) => ({
        label,
        conditions: [{ key: hire.key, op: 'between', values: [from, today] }],
        match: 'all' as const,
      }));
  }
}

/**
 * What a sentence asks that People will not guess or will not search: the
 * judgements taken out, and a phrase with several readings either asked
 * about, answered from `remembered` (topic → the label chosen before), or
 * read the one way it can be.
 */
export function sift(
  sentence: string,
  fields: readonly PlannedField[],
  today: string,
  remembered: Readonly<Record<string, string>>,
): Sifted {
  const refusal = refuse(sentence, fields);
  let rest = refusal.rest;
  for (const { topic, re } of TOPICS) {
    const m = re.exec(rest);
    if (m === null) continue;
    const phrase = tidy(m[0]);
    const without = tidy(`${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`);
    const own = readingsOf(topic, fields, today);
    if (own.length === 0) break;
    rest = without;
    // Nothing else asked: "either" is one more reading. With more asked,
    // all of that and any of these is not one query, so it is not offered.
    const alone = directoryByRules(without, fields, today).conditions.length === 0;
    const readings =
      alone && own.length > 1 && topic !== 'new'
        ? [...own, { label: 'Both', conditions: own.flatMap((r) => r.conditions), match: 'any' as const }]
        : own;
    const chosen = readings.find((r) => r.label === remembered[topic]);
    if (chosen !== undefined) {
      return {
        rest,
        refused: refusal.refused,
        clarify: null,
        reading: chosen,
        remembered: { topic, phrase, label: chosen.label },
      };
    }
    return {
      rest,
      refused: refusal.refused,
      clarify: readings.length > 1 ? { topic, phrase, readings } : null,
      reading: readings.length === 1 ? (readings[0] ?? null) : null,
      remembered: null,
    };
  }
  return { rest, refused: refusal.refused, clarify: null, reading: null, remembered: null };
}

/* --------------------------------------------------------- suggestions -- */

const article = (word: string): string => (/^[aeiou]/iu.test(word) ? 'an' : 'a');

/**
 * "Try asking": up to four questions built from this company's own fields
 * and options, each one People's rules read in full, so a suggestion never
 * meets "not understood". Options only of fields the assistant may use.
 */
export function suggestions(fields: readonly PlannedField[], today: string): string[] {
  const hire = hireField(fields);
  const choices = fields.filter((f) => f.kind === 'select' && f.ai && f.options.length > 0);
  const place = choices.find((f) => f.key === 'location_id' || /location|office|city/iu.test(f.label));
  const contract = choices.find((f) => /contract/iu.test(f.label));
  const group = choices.find(
    (f) => f !== place && f !== contract && f.key !== 'legal_entity_id' && !/entity/iu.test(f.label),
  );
  const gap =
    fields.find((f) => f.kind === 'text' && /emergency|bank|phone|address/iu.test(f.label)) ??
    fields.find((f) => f.kind === 'text');
  const first = (f: PlannedField | undefined) => f?.options[0]?.label;

  const candidates = [
    hire === undefined ? null : 'Who joins in the next 30 days?',
    place === undefined
      ? null
      : contract === undefined
        ? `People in ${first(place) ?? ''}`
        : `People in ${first(place) ?? ''} on ${article(first(contract) ?? '')} ${(first(contract) ?? '').toLowerCase()} contract`,
    group === undefined
      ? null
      : `Everyone in ${first(group) ?? ''}${hire === undefined ? '' : ' who joined this year'}`,
    gap === undefined
      ? null
      : `Everyone missing ${article(gap.label)} ${gap.label.toLowerCase()}`,
  ];
  return candidates
    .filter((s): s is string => s !== null)
    .filter((s) => {
      const plan = directoryByRules(s, fields, today);
      return (plan.conditions.length > 0 || plan.sort !== null) && plan.unused.length === 0;
    })
    .slice(0, 4);
}
