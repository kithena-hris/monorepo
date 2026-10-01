import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * "What changed", the first tab of Insights (design AI5, MA4): a period's
 * changes as a handful of points, each with its figure and the records it
 * came from, a follow-up question, and the same points rewritten for
 * somebody else (AI6, MA5).
 *
 * **The numbers come from the data, never from a model.** Every figure and
 * every team's name in a point's sentence is a placeholder — `{n1}`, `{g1}` —
 * and `fill` says what each stands for. Filled in, the sentences are what
 * People says on its own. A model, where there is one, is shown the
 * sentences with the placeholders still in them, and the viewer's question,
 * and nothing else: no figure, no name, no record. Its answer is refused
 * whole if it writes a number of its own, in digits or in words, or invents
 * or drops a placeholder, and then People's own words stand.
 *
 * **A team is named only when it holds at least the cohort minimum** (§11),
 * counted at the end of the period, and only when it holds most of the
 * change: "9 of the 14 joiners are in Engineering" names Engineering's
 * fifty, never a team of three.
 *
 * **For somebody else** a summary is the one they would get themselves,
 * point by point: a point is kept only where theirs has the same numbers,
 * in their own words (without the team names they cannot see), and every
 * point left out says why.
 *
 * Pure: the figures, already authorized as the viewer and counted where they
 * were drawn, in; points out.
 *
 * ponytail: the model checks are on numbers and placeholders, not meaning —
 * a model that wrote "fell" for "grew" would pass. Temperature 0 and
 * sentences that already say the direction make that unlikely; compare
 * direction words per placeholder if it is ever seen.
 */

/* ----------------------------------------------------------- the period -- */

export const PERIOD_KINDS = ['week', 'month', 'quarter', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
  readonly kind: PeriodKind;
  /** The first and last day counted, both included. */
  readonly from: string;
  readonly to: string;
  /** What it is compared with: the unit before, or as many days before. */
  readonly before: { readonly from: string; readonly to: string };
  /** The week, month or quarter is not over yet. */
  readonly partial: boolean;
}

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const msOf = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => dayOf(msOf(day) + n * DAY_MS);
const daysFrom = (a: string, b: string): number => Math.round((msOf(b) - msOf(a)) / DAY_MS);
const pad = (n: number): string => String(n).padStart(2, '0');
const partsOf = (day: string): [number, number, number] =>
  day.split('-').map(Number) as [number, number, number];

function addMonths(day: string, n: number): string {
  const [y, m] = partsOf(day);
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12))}-${pad((index % 12) + 1)}-01`;
}

function unitStart(kind: Exclude<PeriodKind, 'custom'>, day: string): string {
  const [y, m] = partsOf(day);
  if (kind === 'week') return addDays(day, -((new Date(msOf(day)).getUTCDay() + 6) % 7));
  if (kind === 'month') return `${String(y)}-${pad(m)}-01`;
  return `${String(y)}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
}

function unitEnd(kind: Exclude<PeriodKind, 'custom'>, start: string): string {
  if (kind === 'week') return addDays(start, 6);
  return addDays(addMonths(start, kind === 'month' ? 1 : 3), -1);
}

const isDay = (day: string): boolean => DAY.test(day) && dayOf(msOf(day)) === day;

const Unfinished = failure(
  'BAD_PERIOD',
  'A period ends yesterday at the latest: today has no snapshot yet',
);

/**
 * The period asked for, from the tenant's today. Yesterday is the last day
 * with a nightly snapshot, so "this month" is the month holding yesterday:
 * on the 1st of October, September, whole. A custom range is two days, the
 * first not after the second, the second not after yesterday, at most a year.
 */
export function periodOf(
  kind: string,
  today: string,
  custom?: { readonly from: string; readonly to: string },
): Result<Period> {
  const last = addDays(today, -1);
  if (kind === 'custom') {
    if (custom === undefined || !isDay(custom.from) || !isDay(custom.to)) {
      return err(failure('BAD_PERIOD', 'A custom period is two dates, from and to', ['from']));
    }
    const { from, to } = custom;
    if (from > to) return err(failure('BAD_PERIOD', 'A period starts before it ends', ['from']));
    if (to > last) return err(Unfinished);
    const length = daysFrom(from, to) + 1;
    if (length > 366) return err(failure('BAD_PERIOD', 'A period is a year at most', ['from']));
    return ok({
      kind,
      from,
      to,
      before: { from: addDays(from, -length), to: addDays(from, -1) },
      partial: false,
    });
  }
  if (kind !== 'week' && kind !== 'month' && kind !== 'quarter') {
    return err(failure('BAD_PERIOD', `period is one of ${PERIOD_KINDS.join(', ')}`, ['period']));
  }
  const from = unitStart(kind, last);
  const end = unitEnd(kind, from);
  const previous = unitStart(kind, addDays(from, -1));
  return ok({
    kind,
    from,
    to: last,
    before: { from: previous, to: addDays(from, -1) },
    partial: last < end,
  });
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "28 Sep". */
export function shortDay(day: string): string {
  const [, m, d] = partsOf(day);
  return `${String(d)} ${(MONTHS[m - 1] ?? '').slice(0, 3)}`;
}

/** "Sep", the month of a `YYYY-MM`. */
export const shortMonth = (month: string): string =>
  (MONTHS[Number(month.slice(5, 7)) - 1] ?? month).slice(0, 3);

export interface PeriodWords {
  /** "September", "The week of 28 Sep so far": a card's title starts with it. */
  readonly name: string;
  /** "September 2026". */
  readonly title: string;
  /** "in September": "What changed in September". */
  readonly inWords: string;
  /** "August": "September 2026 compared with August". */
  readonly against: string;
  /** "the month before". */
  readonly unit: 'week' | 'month' | 'quarter' | 'period';
}

export function wordsFor(p: Period): PeriodWords {
  const [y, m] = partsOf(p.from);
  const soFar = p.partial ? ' so far' : '';
  if (p.kind === 'month') {
    const month = MONTHS[m - 1] ?? '';
    return {
      name: `${month}${soFar}`,
      title: `${month} ${String(y)}`,
      inWords: `in ${month}`,
      against: MONTHS[partsOf(p.before.from)[1] - 1] ?? '',
      unit: 'month',
    };
  }
  if (p.kind === 'week') {
    const week = `the week of ${shortDay(p.from)}`;
    return {
      name: `The week of ${shortDay(p.from)}${soFar}`,
      title: `Week of ${shortDay(p.from)} ${String(y)}`,
      inWords: `in ${week}`,
      against: 'the week before',
      unit: 'week',
    };
  }
  if (p.kind === 'quarter') {
    const q = `Q${String(Math.floor((m - 1) / 3) + 1)}`;
    const before = `Q${String(Math.floor((partsOf(p.before.from)[1] - 1) / 3) + 1)}`;
    return {
      name: `${q}${soFar}`,
      title: `${q} ${String(y)}`,
      inWords: `in ${q}`,
      against: before,
      unit: 'quarter',
    };
  }
  const span = `${shortDay(p.from)} to ${shortDay(p.to)}`;
  return {
    name: span,
    title: `${span} ${String(partsOf(p.to)[0])}`,
    inWords: `from ${span}`,
    against: `the ${String(daysFrom(p.from, p.to) + 1)} days before`,
    unit: 'period',
  };
}

/* ----------------------------------------------------------- the points -- */

/** One team's share of a change, by its stored value and its label. */
export interface Group {
  readonly value: string | null;
  readonly label: string;
  readonly count: number;
}

/** What a period's summary is drawn from, every figure as the viewer may see it. */
export interface Figures {
  /** The cohort minimum in force. */
  readonly minimum: number;
  /** Headcount at the start and the end, and who joined and left in between. */
  readonly movement: {
    readonly opening: number;
    readonly closing: number;
    readonly joiners: number;
    readonly leavers: number;
  } | null;
  /** The period before's flows, to compare with. */
  readonly previous: { readonly joiners: number; readonly leavers: number } | null;
  readonly joinersBy: readonly Group[] | null;
  readonly leaversBy: readonly Group[] | null;
  /** The teams big enough to name: at least the cohort minimum at the period's end. */
  readonly named: readonly (string | null)[];
  /** Percent of records missing something, at the start and the end. */
  readonly complete: { readonly before: number; readonly after: number } | null;
  /** The section missing the most, at the end; HR's. */
  readonly gap: string | null;
  /** Managers with more than `limit` direct reports, at the end and the start. */
  readonly span: {
    readonly over: number;
    readonly before: number | null;
    readonly limit: number;
  } | null;
  /** Grades whose median sits outside their band; finance's. */
  readonly pay: { readonly above: number; readonly below: number } | null;
}

export type PointKey = 'headcount' | 'leavers' | 'completeness' | 'span' | 'pay';

/** More direct reports than this is a wide span (the design's "more than 8 reports"). */
export const SPAN_LIMIT = 8;

/** Where a point's records are. People names the place; the screen knows its address. */
export type Source =
  | {
      readonly kind: 'joiners';
      readonly label: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: 'group'; readonly label: string; readonly value: string }
  | { readonly kind: 'section'; readonly label: string }
  | {
      readonly kind: 'headcount' | 'turnover' | 'completeness' | 'org-chart' | 'span' | 'pay';
      readonly label: string;
    };

export interface Point {
  readonly key: PointKey;
  /** The number on the point's left: "+14", "−6 pts". */
  readonly figure: string;
  /** Every figure and name a placeholder. */
  readonly sentence: string;
  readonly sources: readonly Source[];
  /** Who else may read it, where that is narrower than Insights: "Finance only". */
  readonly audience: string | null;
  /** The numbers the point says, to compare one viewer's with another's. */
  readonly measure: readonly number[];
}

export interface Summary {
  readonly points: readonly Point[];
  /** What each placeholder stands for. Shown to the viewer, never sent. */
  readonly fill: Readonly<Record<string, string>>;
}

const PLACEHOLDER = /\{[ng]\d{1,2}\}/gu;

/** One decimal at most: 4.3, 87. */
const tidy = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const whole = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const signed = (n: number): string => (n > 0 ? `+${whole(n)}` : n < 0 ? `−${whole(-n)}` : '0');

function writer() {
  const fill: Record<string, string> = {};
  let n = 0;
  let g = 0;
  return {
    fill,
    n(value: number | string): string {
      n += 1;
      fill[`{n${String(n)}}`] = typeof value === 'number' ? whole(value) : value;
      return `{n${String(n)}}`;
    },
    g(name: string): string {
      g += 1;
      fill[`{g${String(g)}}`] = name;
      return `{g${String(g)}}`;
    },
  };
}

/** The team holding most of a change, when it is big enough to name. */
function most(
  groups: readonly Group[] | null,
  total: number,
  named: ReadonlySet<string>,
): (Group & { readonly value: string }) | null {
  const top = (groups ?? []).toSorted((a, b) => b.count - a.count)[0];
  if (top === undefined || top.value === null || !named.has(top.value)) return null;
  if (top.count * 2 <= total) return null;
  return { ...top, value: top.value };
}

export function summarise(f: Figures, period: Period): Summary {
  const w = writer();
  const { unit } = wordsFor(period);
  const named = new Set(f.named.filter((v): v is string => v !== null));
  const points: Point[] = [];
  const m = f.movement;

  if (m !== null) {
    const change = m.closing - m.opening;
    let sentence =
      change > 0
        ? `Headcount grew from ${w.n(m.opening)} to ${w.n(m.closing)}.`
        : change < 0
          ? `Headcount fell from ${w.n(m.opening)} to ${w.n(m.closing)}.`
          : `Headcount held at ${w.n(m.closing)}.`;
    const sources: Source[] = [];
    if (m.joiners > 0) {
      const where = most(f.joinersBy, m.joiners, named);
      if (where === null) {
        sentence += ` ${w.n(m.joiners)} ${plural(m.joiners, 'person', 'people')} joined.`;
      } else if (where.count === m.joiners) {
        sentence += ` ${m.joiners === 1 ? 'The' : 'All'} ${w.n(m.joiners)} ${plural(m.joiners, 'joiner is', 'joiners are')} in ${w.g(where.label)}.`;
      } else {
        sentence += ` ${w.n(where.count)} of the ${w.n(m.joiners)} joiners are in ${w.g(where.label)}.`;
      }
      sources.push({
        kind: 'joiners',
        label: `${whole(m.joiners)} ${plural(m.joiners, 'joiner', 'joiners')}`,
        from: period.from,
        to: period.to,
      });
      if (where !== null) sources.push({ kind: 'group', label: where.label, value: where.value });
    } else {
      sources.push({ kind: 'headcount', label: 'Headcount' });
    }
    points.push({
      key: 'headcount',
      figure: signed(change),
      sentence,
      sources,
      audience: null,
      measure: [m.opening, m.closing, m.joiners],
    });
  }

  const before = f.previous?.leavers ?? null;
  if (m !== null && (m.leavers > 0 || (before ?? 0) > 0)) {
    const sources: Source[] = [{ kind: 'turnover', label: 'Turnover' }];
    let sentence: string;
    if (m.leavers === 0) {
      sentence = `Nobody left, after ${w.n(before ?? 0)} the ${unit} before.`;
    } else {
      sentence = `${w.n(m.leavers)} ${plural(m.leavers, 'person', 'people')} left`;
      const where = most(f.leaversBy, m.leavers, named);
      if (where !== null) {
        sentence +=
          where.count === m.leavers
            ? `, ${m.leavers === 1 ? 'in' : 'all in'} ${w.g(where.label)}`
            : `, ${w.n(where.count)} of them in ${w.g(where.label)}`;
        sources.push({ kind: 'group', label: where.label, value: where.value });
      }
      if (before !== null) {
        sentence +=
          before === m.leavers
            ? `, as many as the ${unit} before`
            : `, ${m.leavers > before ? 'up' : 'down'} from ${w.n(before)} the ${unit} before`;
      }
      sentence += '.';
    }
    points.push({
      key: 'leavers',
      figure: whole(m.leavers),
      sentence,
      sources,
      audience: null,
      measure: [m.leavers, before ?? -1],
    });
  }

  if (f.complete !== null) {
    const { before: then, after: now } = f.complete;
    const d = now - then;
    const pct = (n: number) => `${tidy(n)}%`;
    let sentence =
      d < 0
        ? `Missing details fell from ${w.n(pct(then))} to ${w.n(pct(now))}.`
        : d > 0
          ? `Missing details rose from ${w.n(pct(then))} to ${w.n(pct(now))}.`
          : `Missing details held at ${w.n(pct(now))}.`;
    const sources: Source[] = [{ kind: 'completeness', label: 'Data health' }];
    if (f.gap !== null) {
      sentence += ` The biggest gap is ${w.g(f.gap)}.`;
      sources.push({ kind: 'section', label: f.gap });
    }
    points.push({
      key: 'completeness',
      figure: d === 0 ? '0 pts' : `${d > 0 ? '+' : '−'}${tidy(Math.abs(d))} pts`,
      sentence,
      sources,
      audience: null,
      measure: [then, now],
    });
  }

  const s = f.span;
  if (s !== null && (s.over > 0 || (s.before ?? 0) > 0)) {
    let sentence: string;
    if (s.over === 0) {
      sentence = `No manager has more than ${w.n(s.limit)} direct reports now, down from ${w.n(s.before ?? 0)}.`;
    } else {
      sentence = `${w.n(s.over)} ${plural(s.over, 'manager now has', 'managers now have')} more than ${w.n(s.limit)} direct reports`;
      if (s.before !== null && s.before !== s.over) {
        sentence += `, ${s.over > s.before ? 'up' : 'down'} from ${w.n(s.before)}`;
      }
      sentence += '.';
    }
    points.push({
      key: 'span',
      figure: whole(s.over),
      sentence,
      sources: [
        { kind: 'org-chart', label: 'Org chart' },
        { kind: 'span', label: 'Span of control' },
      ],
      audience: null,
      measure: [s.over, s.before ?? -1],
    });
  }

  const p = f.pay;
  if (p !== null && p.above + p.below > 0) {
    const said = [
      ...(p.above > 0
        ? [
            `${w.n(p.above)} ${plural(p.above, 'grade has a median above its band', 'grades have a median above their band')}`,
          ]
        : []),
      ...(p.below > 0
        ? [
            `${w.n(p.below)} ${plural(p.below, 'grade has a median below its band', 'grades have a median below their band')}`,
          ]
        : []),
    ];
    points.push({
      key: 'pay',
      figure: whole(p.above + p.below),
      sentence: `${said.join(', and ')}.`,
      sources: [{ kind: 'pay', label: 'Pay' }],
      audience: 'Finance only',
      measure: [p.above, p.below],
    });
  }

  return { points, fill: w.fill };
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'] as const;

/** "September in five points"; just the period when there is nothing to say. */
export function titleOf(summary: Summary, period: Period): string {
  const { name } = wordsFor(period);
  const n = summary.points.length;
  if (n === 0) return name;
  return `${name} in ${COUNT_WORDS[n] ?? String(n)} ${plural(n, 'point', 'points')}`;
}

/** A run of a sentence: People's words, or a figure or name it filled in. */
export interface Part {
  readonly text: string;
  readonly strong: boolean;
}

export interface FilledPoint extends Omit<Point, 'sentence' | 'measure'> {
  readonly text: string;
  readonly parts: readonly Part[];
}

function sentenceParts(sentence: string, fill: Summary['fill']): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const found of sentence.matchAll(PLACEHOLDER)) {
    const index = found.index;
    if (index > at) parts.push({ text: sentence.slice(at, index), strong: false });
    parts.push({ text: fill[found[0]] ?? found[0], strong: true });
    at = index + found[0].length;
  }
  if (at < sentence.length) parts.push({ text: sentence.slice(at), strong: false });
  return parts;
}

/** The points as a reader sees them: every placeholder filled in, and marked. */
export function filled(summary: Summary): FilledPoint[] {
  return summary.points.map(({ sentence, measure: _measure, ...point }) => {
    const parts = sentenceParts(sentence, summary.fill);
    return { ...point, parts, text: parts.map((p) => p.text).join('') };
  });
}

/** "Short" is the first three points; "Detailed" all of them. */
export function shortened(summary: Summary, tone: 'short' | 'detailed'): Summary {
  return tone === 'short' ? { ...summary, points: summary.points.slice(0, 3) } : summary;
}

/* -------------------------------------------------------- the model -- */

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|half|double|twice|triple|quarter|third)\b/giu;

/**
 * Whether a sentence the model wrote says no number of its own: no digit
 * outside a placeholder, no brace, and no number word that People's own
 * words did not already use ("the quarter before").
 */
function writesNoNumber(sentence: string, ours: readonly string[]): boolean {
  const words = sentence.replace(PLACEHOLDER, '');
  if (/[\d{}]/u.test(words)) return false;
  const said = ours.join(' ').toLowerCase();
  for (const found of words.matchAll(NUMBER_WORDS)) {
    if (!new RegExp(`\\b${found[0].toLowerCase()}\\b`, 'u').test(said)) return false;
  }
  return true;
}

const placeholdersIn = (sentence: string): Set<string> =>
  new Set(sentence.match(PLACEHOLDER) ?? []);

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

export const PHRASE_INSTRUCTION = [
  'You word the summary at the top of a workforce analytics page for an HR team.',
  'You are given points, each a key and a sentence in which every figure and every name is a placeholder in braces, such as {n1} or {g1}.',
  'Rewrite each sentence to read plainly and naturally: keep every placeholder of that sentence exactly as written and use each one, and add no placeholder from another sentence.',
  'Never write a number, in digits or in words, never add anything the sentence does not say, and keep grew, fell, rose, up, down and held as the sentence says them.',
  'Answer with one JSON object and nothing else: {"points": [{"key": "...", "sentence": "..."}]}.',
].join(' ');

/** What the model is shown to word the points: the sentences, every figure and name held back. */
export const phraseContext = (
  summary: Summary,
  period: Period,
): {
  readonly unit: PeriodWords['unit'];
  readonly points: readonly { readonly key: PointKey; readonly sentence: string }[];
} => ({
  unit: wordsFor(period).unit,
  points: summary.points.map((p) => ({ key: p.key, sentence: p.sentence })),
});

export const PhrasedAnswer = z.strictObject({
  points: z
    .array(z.strictObject({ key: z.string().max(40), sentence: z.string().min(1).max(400) }))
    .max(10),
});

/**
 * The summary in the model's words, or null when its answer cannot be
 * trusted: not the shape asked for, a key it was not given, a number of its
 * own, or a placeholder invented, moved between points or left out.
 */
export function phrasedFrom(summary: Summary, answer: unknown): Summary | null {
  const parsed = PhrasedAnswer.safeParse(answer);
  if (!parsed.success) return null;
  const worded = new Map<string, string>();
  for (const { key, sentence } of parsed.data.points) {
    const point = summary.points.find((p) => p.key === key);
    if (point === undefined || worded.has(key)) return null;
    if (!sameSet(placeholdersIn(sentence), placeholdersIn(point.sentence))) return null;
    if (!writesNoNumber(sentence, [point.sentence])) return null;
    worded.set(key, sentence);
  }
  return {
    ...summary,
    points: summary.points.map((p) => ({ ...p, sentence: worded.get(p.key) ?? p.sentence })),
  };
}

/* ---------------------------------------------------- a follow-up -- */

export interface Answer {
  /** `refused`: a question Kithena will not answer; `unknown`: one the figures cannot. */
  readonly kind: 'answer' | 'refused' | 'unknown';
  readonly sentences: readonly (readonly Part[])[];
  /** The points it drew on, so the screen can point at them. */
  readonly keys: readonly PointKey[];
}

const said = (text: string): Part[] => [{ text, strong: false }];

const REFUSED =
  'Kithena doesn’t judge performance, and doesn’t use health, diversity or other special-category data, so it can’t answer that.';
const UNKNOWN =
  'Kithena can only answer from the figures in this summary, and none of them is about that.';
const WHY = 'Kithena has the figures, not the reasons. These are the ones that bear on it:';

/** What the rules never answer: a judgement of somebody, or special-category data. */
const NEVER =
  /\b(perform\w*|productiv\w*|lazy|talent\w*|good at|bad at|best|worst|health\w*|sick\w*|illness|pregnan\w*|disab\w*|religio\w*|ethnic\w*|race|racial|sexual\w*|unions?|politic\w*)\b/iu;

const TOPICS: Readonly<Record<PointKey, RegExp>> = {
  headcount: /\b(headcount|grow\w*|grew|growth|hir\w*|join\w*|start\w*|bigger|smaller)\b/iu,
  leavers:
    /\b(leav\w*|left|quit\w*|resign\w*|notice|turnover|attrition|losing|lose|lost|churn\w*)\b/iu,
  completeness: /\b(missing|complete\w*|incomplete|data|details?|gaps?|bank)\b/iu,
  span: /\b(managers?|reports?|span|org\w*)\b/iu,
  pay: /\b(pay|paid|salar\w*|bands?|grades?|compensation|payroll)\b/iu,
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The point's names, as the viewer reads them: "Support". */
const namesIn = (point: Point, fill: Summary['fill']): string[] =>
  (point.sentence.match(/\{g\d{1,2}\}/gu) ?? []).flatMap((p) => fill[p] ?? []);

/**
 * A follow-up answered by People's own rules: the points the question is
 * about, by topic or by a team it names, in People's words. A question
 * after a reason is told that the figures are all there is; one after a
 * judgement of somebody, or special-category data, is refused.
 */
export function answerByRules(summary: Summary, question: string): Answer {
  if (NEVER.test(question)) return { kind: 'refused', sentences: [said(REFUSED)], keys: [] };
  const about = summary.points.filter(
    (p) =>
      TOPICS[p.key].test(question) ||
      namesIn(p, summary.fill).some((name) =>
        new RegExp(`\\b${escapeRegExp(name)}\\b`, 'iu').test(question),
      ),
  );
  if (about.length === 0) return { kind: 'unknown', sentences: [said(UNKNOWN)], keys: [] };
  const points = filled({ ...summary, points: about });
  return {
    kind: 'answer',
    sentences: [...(/\bwhy\b/iu.test(question) ? [said(WHY)] : []), ...points.map((p) => p.parts)],
    keys: about.map((p) => p.key),
  };
}

export const ASK_INSTRUCTION = [
  'You answer a follow-up question about the summary at the top of a workforce analytics page, for an HR team.',
  'You are given the question and the summary’s points, each a key and a sentence in which every figure and every name is a placeholder in braces, such as {n1} or {g1}.',
  'Answer only from those points, in at most three short sentences, using their placeholders exactly as written wherever you mention a figure or a name.',
  'Never write a number, in digits or in words, and never say why people do things: say what the points show, and that the reasons are not in them.',
  'Never judge anybody’s performance, and never speak about health, ethnicity, religion, sexuality or any other special-category data.',
  'If the points cannot answer it, set answerable to false and give no sentences.',
  'Answer with one JSON object and nothing else: {"answerable": true, "sentences": ["..."], "keys": ["..."]}, where keys are the points you used.',
].join(' ');

/** What the model is shown for a follow-up: the question and the points, held back as above. */
export const askContext = (
  summary: Summary,
  question: string,
): {
  readonly question: string;
  readonly points: readonly { readonly key: PointKey; readonly sentence: string }[];
} => ({
  question,
  points: summary.points.map((p) => ({ key: p.key, sentence: p.sentence })),
});

export const AskAnswer = z.strictObject({
  answerable: z.boolean(),
  sentences: z.array(z.string().min(1).max(400)).max(3),
  keys: z.array(z.string().max(40)).max(5),
});

/**
 * The model's answer, filled in, or null when it cannot be trusted: not the
 * shape asked for, a point or a placeholder it was not given, a number of its
 * own, or "answerable" with nothing to say.
 */
export function answeredFrom(summary: Summary, question: string, answer: unknown): Answer | null {
  const parsed = AskAnswer.safeParse(answer);
  if (!parsed.success) return null;
  const { answerable, sentences, keys } = parsed.data;
  const known = new Set(summary.points.map((p) => p.key as string));
  if (!keys.every((k) => known.has(k))) return null;
  if (!answerable) return { kind: 'unknown', sentences: [said(UNKNOWN)], keys: [] };
  if (sentences.length === 0) return null;
  const ours = [...summary.points.map((p) => p.sentence), question];
  for (const sentence of sentences) {
    if (![...placeholdersIn(sentence)].every((p) => p in summary.fill)) return null;
    if (!writesNoNumber(sentence, ours)) return null;
  }
  return {
    kind: 'answer',
    sentences: sentences.map((s) => sentenceParts(s, summary.fill)),
    keys: keys as PointKey[],
  };
}

/* ------------------------------------------------ for somebody else -- */

const LEFT_OUT: Readonly<Record<PointKey, (name: string) => string>> = {
  headcount: (name) => `Headcount is left out, because ${name} can’t see these people.`,
  leavers: (name) => `Leavers are left out, because ${name} can’t see these people.`,
  completeness: (name) =>
    `Missing details are left out, because ${name} can’t see how complete records are.`,
  span: (name) => `Span of control is left out, because ${name} can’t see who manages whom.`,
  pay: (name) => `Pay is left out, because ${name} can’t see pay in aggregate.`,
};

const DIFFERENT: Readonly<Record<PointKey, string>> = {
  headcount: 'Headcount is',
  leavers: 'Leavers are',
  completeness: 'Missing details are',
  span: 'Span of control is',
  pay: 'Pay is',
};

const teams = (point: Point): number => point.sources.filter((s) => s.kind === 'group').length;

/**
 * The sender's summary as `recipient` may have it: each point kept only
 * where the recipient's own summary of the same period says the same
 * numbers, in the recipient's words, and every point left out said, with why.
 * The recipient's words never name a team or a section the sender could not
 * name, so the preview shows the sender nothing new either. `recipient` is
 * null when they see no Insights at all.
 */
export function forRecipient(
  senderFigures: Figures,
  recipientFigures: Figures | null,
  period: Period,
  name: string,
): { readonly summary: Summary; readonly notes: readonly string[] } {
  const sender = summarise(senderFigures, period);
  const recipient =
    recipientFigures === null
      ? null
      : summarise(
          {
            ...recipientFigures,
            named: recipientFigures.named.filter((v) => senderFigures.named.includes(v)),
            gap: recipientFigures.gap === senderFigures.gap ? recipientFigures.gap : null,
          },
          period,
        );
  if (recipient === null) {
    return {
      summary: { points: [], fill: {} },
      notes: [`${name} can’t see Insights, so there is nothing to send.`],
    };
  }
  const kept: Point[] = [];
  const notes: string[] = [];
  let fewerTeams = false;
  let sameTeams = false;
  for (const ours of sender.points) {
    const theirs = recipient.points.find((p) => p.key === ours.key);
    if (theirs === undefined) {
      notes.push(LEFT_OUT[ours.key](name));
    } else if (
      theirs.measure.length !== ours.measure.length ||
      theirs.measure.some((n, i) => n !== ours.measure[i])
    ) {
      notes.push(
        `${DIFFERENT[ours.key]} left out, because ${name} sees a different set of people.`,
      );
    } else {
      kept.push(theirs);
      if (teams(theirs) < teams(ours)) fewerTeams = true;
      else if (teams(ours) > 0) sameTeams = true;
    }
  }
  if (fewerTeams) notes.push(`Team names are left out, because ${name} can’t see them.`);
  else if (sameTeams) notes.push(`Team names are kept, because ${name} can see them.`);
  return { summary: { points: kept, fill: recipient.fill }, notes };
}

/* ------------------------------------------------------ the chart -- */

/**
 * Leavers by team and month, for the chart beside the points: the teams big
 * enough to name, biggest first, and everybody else as "Other teams". Null
 * when nobody left.
 */
export function leaversByTeam(
  cells: readonly (Group & { readonly month: string })[],
  named: readonly (string | null)[],
  months: readonly string[],
): {
  readonly categories: readonly string[];
  readonly series: readonly { readonly label: string; readonly values: readonly number[] }[];
} | null {
  const OTHER = 'Other teams';
  const big = new Set(named.filter((v): v is string => v !== null));
  const team = (c: Group): string => (c.value !== null && big.has(c.value) ? c.label : OTHER);
  const totals = new Map<string, number>();
  for (const c of cells) totals.set(team(c), (totals.get(team(c)) ?? 0) + c.count);
  if ([...totals.values()].every((n) => n === 0)) return null;
  const categories = [...totals]
    .filter(([, n]) => n > 0)
    .toSorted((a, b) => Number(a[0] === OTHER) - Number(b[0] === OTHER) || b[1] - a[1])
    .map(([label]) => label);
  return {
    categories,
    series: months.map((month) => ({
      label: shortMonth(month),
      values: categories.map((category) =>
        cells
          .filter((c) => c.month === month && team(c) === category)
          .reduce((n, c) => n + c.count, 0),
      ),
    })),
  };
}
