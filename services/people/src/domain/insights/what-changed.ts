import * as z from 'zod';

import { Decimal } from '../pay/pay.js';

/**
 * "What changed", the few sentences at the top of each Insights tab.
 *
 * **The numbers come from the data, never from a model.** Each tab's figures
 * become a list of facts, one sentence each, in which every figure and every
 * group's name is a placeholder — `{n1}`, `{g1}` — and `fill` says what each
 * stands for. Filled in, those sentences are the summary People writes on its
 * own (`filled`). A model, where there is one, is shown the sentences with
 * the placeholders still in them and nothing else: no figure, no name, no
 * record. It may regroup and rephrase them; its answer is refused whole if it
 * writes a number of its own, in digits or in words, or invents or drops a
 * placeholder (`phrasedFrom`), and then People's own sentences stand.
 *
 * **A group is named only when it holds at least the cohort minimum** (§11),
 * as a breakdown would be: "most joiners are in Engineering" about three
 * people is a statement about those three.
 *
 * Pure: the tab's figures, already authorized and already suppressed where
 * they were counted, in; sentences out.
 *
 * ponytail: the check is on numbers and placeholders, not on meaning — a model
 * that wrote "down" for "up" would pass. Temperature 0 and sentences that
 * already say the direction make that unlikely; compare direction words per
 * placeholder if it is ever seen.
 */

export type Tab = 'headcount' | 'turnover' | 'data-quality' | 'pay';

interface Point {
  readonly label: string;
  readonly value: number;
}

/** What the tabs are drawn from: the analytics view, as much of it as a summary reads. */
export interface Figures {
  readonly asOf: string;
  /** The cohort minimum in force. */
  readonly minimum: number;
  readonly headcount: { readonly value: number; readonly change: number | null };
  readonly startingSoon: number | null;
  readonly movement: {
    readonly joiners: number;
    readonly moves: number;
    readonly leavers: number;
  } | null;
  readonly joiners: {
    readonly cells: readonly {
      readonly row: string;
      readonly column: string;
      readonly value: number;
    }[];
  } | null;
  readonly attrition: {
    readonly percent: number;
    readonly leavers: number;
    readonly trend: readonly Point[];
  } | null;
  readonly tenure: readonly { readonly label: string; readonly leavers: number }[] | null;
  readonly complete: {
    readonly percent: number;
    readonly incomplete: number;
    readonly change: number | null;
  } | null;
  readonly completenessBySection: readonly Point[] | null;
  readonly expiries: {
    readonly today: string;
    readonly items: readonly { readonly kind: string; readonly day: string }[];
  } | null;
  readonly pay: {
    readonly grade: readonly {
      readonly status: string;
      readonly median: string | null;
      readonly band: { readonly minimumMinor: string; readonly maximumMinor: string } | null;
    }[];
  } | null;
}

export interface Facts {
  /** One sentence per fact; every figure and group is a placeholder. */
  readonly sentences: readonly string[];
  /** What each placeholder stands for. Shown to the viewer, never sent. */
  readonly fill: Readonly<Record<string, string>>;
}

const PLACEHOLDER = /\{[ng]\d{1,2}\}/gu;

/** One decimal at most: 4.3, 87, 1.2. */
const tidy = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const whole = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A tab's facts as they are written: figures and names go into `fill`, placeholders into the text. */
function writer() {
  const fill: Record<string, string> = {};
  const sentences: string[] = [];
  let n = 0;
  let g = 0;
  return {
    n(value: string): string {
      n += 1;
      fill[`{n${String(n)}}`] = value;
      return `{n${String(n)}}`;
    },
    g(name: string): string {
      g += 1;
      fill[`{g${String(g)}}`] = name;
      return `{g${String(g)}}`;
    },
    say(sentence: string): void {
      sentences.push(sentence);
    },
    done: (): Facts => ({ sentences, fill }),
  };
}

type Writer = ReturnType<typeof writer>;

const list = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;

/** The biggest group, when it is most of the total and big enough to name. */
function most(
  groups: readonly { readonly label: string; readonly value: number }[],
  minimum: number | null,
): string | null {
  const total = groups.reduce((sum, x) => sum + x.value, 0);
  const top = groups.toSorted((a, b) => b.value - a.value)[0];
  if (top === undefined || top.value * 2 <= total) return null;
  if (minimum !== null && top.value < minimum) return null;
  return top.label;
}

function headcount(f: Figures, w: Writer): void {
  const { value, change } = f.headcount;
  if (change === null) w.say(`Headcount is ${w.n(whole(value))}.`);
  else if (change === 0) w.say(`Headcount unchanged since last month, at ${w.n(whole(value))}.`);
  else {
    const by = w.n(whole(Math.abs(change)));
    w.say(
      `Headcount ${change > 0 ? 'up' : 'down'} ${by} since last month, to ${w.n(whole(value))}.`,
    );
  }
  const m = f.movement;
  if (m !== null) {
    const parts = [
      ...(m.joiners > 0 ? [`${w.n(whole(m.joiners))} joined`] : []),
      ...(m.leavers > 0 ? [`${w.n(whole(m.leavers))} left`] : []),
      ...(m.moves > 0 ? [`${w.n(whole(m.moves))} moved within the company`] : []),
    ];
    if (parts.length > 0) w.say(`${list(parts)} in the last month.`);
  }
  const cells = f.joiners?.cells ?? [];
  const latest = cells
    .map((c) => c.column)
    .toSorted()
    .at(-1);
  const where = most(
    cells.filter((c) => c.column === latest).map((c) => ({ label: c.row, value: c.value })),
    f.minimum,
  );
  if (where !== null) w.say(`Most joiners this month are in ${w.g(where)}.`);
  if (f.startingSoon !== null && f.startingSoon > 0) {
    const n = f.startingSoon;
    w.say(`${w.n(whole(n))} ${plural(n, 'person is', 'people are')} starting soon.`);
  }
}

function turnover(f: Figures, w: Writer): void {
  const a = f.attrition;
  if (a === null) return;
  const [before, now] = a.trend.slice(-2);
  if (before === undefined || now === undefined) {
    w.say(`Attrition ${w.n(`${tidy(a.percent)}%`)} over the last year.`);
  } else {
    const delta = now.value - before.value;
    if (Math.abs(delta) < 0.5)
      w.say(`Attrition flat at ${w.n(`${tidy(a.percent)}%`)} over the last year.`);
    else {
      const by = w.n(tidy(Math.abs(delta)));
      w.say(
        `Attrition ${delta > 0 ? 'up' : 'down'} ${by} points to ${w.n(`${tidy(a.percent)}%`)} over the last year.`,
      );
    }
  }
  w.say(`${w.n(whole(a.leavers))} ${plural(a.leavers, 'person', 'people')} left in the last year.`);
  const band = most(
    (f.tenure ?? []).map((t) => ({ label: t.label, value: t.leavers })),
    f.minimum,
  );
  if (band !== null) {
    w.say(`Most leavers had been here ${w.g(band.charAt(0).toLowerCase() + band.slice(1))}.`);
  }
}

const LAPSES: Readonly<Record<string, readonly [string, string]>> = {
  work_permit: ['work permit expires', 'work permits expire'],
  fixed_term: ['contract ends', 'contracts end'],
  probation: ['probation ends', 'probations end'],
  certification: ['certification expires', 'certifications expire'],
};

const monthName = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

function nextMonth(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return m === 12 ? `${String(y + 1)}-01` : `${String(y)}-${String(m + 1).padStart(2, '0')}`;
}

function dataQuality(f: Figures, w: Writer): void {
  const c = f.complete;
  if (c !== null) {
    const complete = w.n(`${tidy(c.percent)}%`);
    const since =
      c.change === null
        ? ''
        : c.change === 0
          ? ', unchanged since last month'
          : `, ${c.change > 0 ? 'up' : 'down'} ${w.n(tidy(Math.abs(c.change)))} points since last month`;
    w.say(`Records ${complete} complete${since}; ${w.n(whole(c.incomplete))} incomplete.`);
  }
  const section = most(f.completenessBySection ?? [], null);
  if (section !== null) w.say(`Most missing details are in ${w.g(section)}.`);
  const e = f.expiries;
  if (e === null) return;
  const month = e.today.slice(0, 7);
  for (const [when, words] of [
    [month, 'this month'],
    [nextMonth(month), `in ${monthName(nextMonth(month))}`],
  ] as const) {
    for (const [kind, [one, many]] of Object.entries(LAPSES)) {
      const n = e.items.filter(
        (i) => i.kind === kind && i.day.startsWith(when) && i.day >= e.today,
      ).length;
      if (n > 0) w.say(`${w.n(whole(n))} ${plural(n, one, many)} ${words}.`);
    }
  }
}

function pay(f: Figures, w: Writer): void {
  if (f.pay === null) return;
  // Minor units as decimals, never floats: a median may sit between two cents.
  const banded = f.pay.grade.flatMap((g) =>
    g.status === 'ok' && g.median !== null && g.band !== null
      ? [{ median: new Decimal(g.median), band: g.band }]
      : [],
  );
  const above = banded.filter((g) => g.median.gt(g.band.maximumMinor)).length;
  const below = banded.filter((g) => g.median.lt(g.band.minimumMinor)).length;
  const hidden = f.pay.grade.filter((g) => g.status !== 'ok').length;
  if (above > 0) {
    w.say(
      `${w.n(whole(above))} ${plural(above, 'grade has a median above its band', 'grades have a median above their band')}.`,
    );
  }
  if (below > 0) {
    w.say(
      `${w.n(whole(below))} ${plural(below, 'grade has a median below its band', 'grades have a median below their band')}.`,
    );
  }
  if (hidden > 0) {
    w.say(`${w.n(whole(hidden))} ${plural(hidden, 'grade is', 'grades are')} too small to show.`);
  }
}

/** A tab's facts, from its figures. Empty when there is nothing to say. */
export function factsFor(f: Figures, tab: Tab): Facts {
  const w = writer();
  if (tab === 'headcount') headcount(f, w);
  if (tab === 'turnover') turnover(f, w);
  if (tab === 'data-quality') dataQuality(f, w);
  if (tab === 'pay') pay(f, w);
  return w.done();
}

const fillIn = (sentence: string, fill: Facts['fill']): string =>
  sentence.replace(PLACEHOLDER, (p) => fill[p] ?? p);

/** People's own summary: the facts, filled in. */
export const filled = (facts: Facts): string[] => facts.sentences.map((s) => fillIn(s, facts.fill));

/* -------------------------------------------------------- the model -- */

export const WHAT_CHANGED_INSTRUCTION = [
  'You write the short summary at the top of a workforce analytics page for an HR team.',
  'You are given facts, each a sentence in which every figure and every name is a placeholder in braces, such as {n1} or {g1}.',
  'Rewrite the facts as at most three short, plain sentences: group related facts, keep every placeholder exactly as written, and use every placeholder at least once.',
  'Never write a number, in digits or in words, and never add anything the facts do not say. Keep up, down, flat and unchanged as the facts say them.',
  'Answer with one JSON object and nothing else: {"sentences": ["..."]}.',
].join(' ');

/** What the model is shown: the tab, and the sentences with every figure and name held back. */
export const whatChangedContext = (
  tab: Tab,
  facts: Facts,
): { readonly tab: Tab; readonly facts: readonly string[] } => ({
  tab,
  facts: [...facts.sentences],
});

export const PhrasedAnswer = z.strictObject({
  sentences: z.array(z.string().min(1).max(400)).min(1).max(4),
});

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|half|double|twice|triple|quarter|third)\b/iu;

/**
 * A model's answer, filled in, or null when it cannot be trusted: not the
 * shape asked for, a number of its own anywhere, or a placeholder invented
 * or left out.
 */
export function phrasedFrom(facts: Facts, answer: unknown): string[] | null {
  const parsed = PhrasedAnswer.safeParse(answer);
  if (!parsed.success) return null;
  const known = new Set(Object.keys(facts.fill));
  const used = new Set<string>();
  for (const sentence of parsed.data.sentences) {
    for (const p of sentence.match(PLACEHOLDER) ?? []) {
      if (!known.has(p)) return null;
      used.add(p);
    }
    const words = sentence.replace(PLACEHOLDER, '');
    if (/[\d{}]/u.test(words) || NUMBER_WORDS.test(words)) return null;
  }
  if (used.size !== known.size) return null;
  return parsed.data.sentences.map((s) => fillIn(s, facts.fill));
}
