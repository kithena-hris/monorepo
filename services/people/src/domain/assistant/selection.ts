import * as z from 'zod';

import { firstObject, type CatalogueField, type IntentCondition, type IntentOp } from './intent.js';

/**
 * A sentence turned into a selection People already knows how to run: the
 * directory's conditions and order, or the export builder's fields,
 * audience, date and format (docs/ai-settings.md, "Search and export in
 * words").
 *
 * Two readers, one result. People's own rules read the sentence with no
 * model at all: an option's name, a field's name after "missing" or "with",
 * a date phrase after "hired" or "starting", an order word. The model's
 * answer, when there is one, is read strictly against what it was shown:
 * a field it was not shown, an operator the field does not take, a date
 * that is not a date, or any key this file does not expect refuses the whole
 * answer, and the rules stand. Either way the result is only a selection:
 * the directory and the export authorize and run it as the person asking.
 *
 * What the model is shown (`forModel`) is the sentence, today's date in
 * words, and the fields the person may filter by, with their options when
 * those are configuration (a department, a location). A field that is not
 * for the assistant is named with no options, for "is empty" or "is not"
 * only. Never a value from anybody's record.
 */

/** A field the person may filter by, and whether the assistant may use it. */
export interface PlannedField extends CatalogueField {
  readonly ai: boolean;
}

export interface DirectoryPlan {
  /** Words to search names with, when the sentence was (or held) a name. */
  readonly search: string | null;
  readonly conditions: readonly IntentCondition[];
  readonly match: 'all' | 'any';
  readonly sort: { readonly key: string; readonly direction: 'asc' | 'desc' } | null;
  /** Words neither reader made anything of, as typed: said, never guessed. */
  readonly unused: readonly string[];
  /** A phrase the model read more than one way, asked rather than guessed (`clarify.ts`). */
  readonly ask: {
    readonly phrase: string;
    readonly readings: readonly {
      readonly label: string;
      readonly conditions: readonly IntentCondition[];
      readonly match: 'all' | 'any';
    }[];
  } | null;
}

export type Audience =
  | { readonly kind: 'everyone' }
  | { readonly kind: 'segment'; readonly value: string }
  | {
      readonly kind: 'conditions';
      readonly conditions: readonly IntentCondition[];
      readonly match: 'all' | 'any';
    };

export interface ExportCatalogue {
  readonly today: string;
  /** What this person may export, in the builder's order. */
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly section: string;
  }[];
  /** The builder's audiences: everybody, and each saved view. */
  readonly audiences: readonly { readonly value: string; readonly label: string }[];
  /** What an audience may be narrowed by: the directory's own conditions. */
  readonly filters: readonly PlannedField[];
}

export interface ExportPlan {
  readonly fields: readonly string[];
  readonly audience: Audience;
  readonly asOf: string;
  readonly format: 'xlsx' | 'csv' | 'pdf';
  readonly photos: boolean;
  /** A reason to review; null when the model's could not be kept. */
  readonly reason: string | null;
  /** What was changed from what was asked, in words. */
  readonly notes: readonly string[];
}

/* -------------------------------------------------------------- words -- */

interface Token {
  /** As typed. */
  readonly raw: string;
  /** Lower case, without accents. */
  readonly word: string;
  /** Without a plural's ending, so "engineers" meets "Engineer". */
  readonly stem: string;
}

const TOKEN = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

const fold = (s: string): string =>
  s.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase().replaceAll('’', "'");

function stemOf(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) => {
    const word = fold(m[0]);
    return { raw: m[0], word, stem: stemOf(word) };
  });
}

const stems = (text: string): string[] => tokens(text).map((t) => t.stem);

/** Words that carry no meaning of their own here. */
const STOP = new Set(
  (
    'a an the and or of in at on to for from by with all any some every show me find list get give ' +
    'who whom whose that which are is was were be been being do does our my their them they his her ' +
    'people person persons employee employees staff everyone everybody anyone colleague colleagues ' +
    'work works working based currently now please member members whole entire still yet'
  ).split(' '),
);

const HIRE = new Set(
  'hired hire hires joined joining joiner joiners join joins started starting start starts'.split(
    ' ',
  ),
);
const BEFORE = new Set(['before', 'until', 'prior', 'earlier']);
const AFTER = new Set(['after', 'since', 'from']);
const EMPTY = new Set(['missing', 'without', 'lacking', 'no']);
const PRESENT = new Set(['with', 'have', 'has', 'having']);
/** "haven't added", "hasn't given": as "missing" when a verb of filling in follows. */
const NOT_YET = new Set(["haven't", "hasn't", 'havent', 'hasnt', 'not', 'never']);
const FILLED = new Set([
  'added',
  'provided',
  'given',
  'filled',
  'entered',
  'set',
  'shared',
  'uploaded',
  'got',
]);
const ARTICLES = new Set(['a', 'an', 'the', 'any', 'their', 'his', 'her', 'its', 'no']);

/* -------------------------------------------------------------- dates -- */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const monthOf = (word: string): number | null => {
  if (word.length < 3) return null;
  const at = MONTHS.findIndex(
    (m) => m === word || (word.length >= 3 && m.startsWith(word) && word.length <= 4),
  );
  return at < 0 ? null : at + 1;
};

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string => `${String(y)}-${pad(m)}-${pad(d)}`;
const leap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number =>
  [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;

function valid(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

/** The day before or after a calendar date. */
function nextDay(date: string, step: 1 | -1): string {
  let [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  d += step;
  if (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d = daysIn(y, m);
  } else if (d > daysIn(y, m)) {
    d = 1;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return iso(y, m, d);
}

/** A calendar date so many days later, or earlier for a negative count. */
export function shiftDays(date: string, days: number): string {
  let at = date;
  for (let k = 0; k < Math.abs(days); k += 1) at = nextDay(at, days < 0 ? -1 : 1);
  return at;
}

/** "1 October 2026": a calendar date as people say it. */
export function spokenDate(date: string): string {
  const [y = '', m = '1', d = '1'] = date.split('-');
  const month = MONTHS[Number(m) - 1] ?? '';
  return `${String(Number(d))} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`;
}

interface Span {
  readonly from: string;
  readonly to: string;
  /** The first token after it. */
  readonly end: number;
}

const YEAR = /^(19|20)\d{2}$/;

/** A date or a period starting at token `i`, or null. A month with no year is this year's. */
function dateAt(ts: readonly Token[], i: number, today: string): Span | null {
  const t = ts[i];
  if (t === undefined) return null;
  const [ty = 2000, tm = 1] = today.split('-').map(Number);
  const w = t.word;
  const next = ts[i + 1]?.word;

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (m !== null) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? { from: w, to: w, end: i + 1 } : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(w);
  if (m !== null) {
    // Day first: the way the companies People serves write a date.
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? { from: iso(y, mo, d), to: iso(y, mo, d), end: i + 1 } : null;
  }
  if ((w === 'next' || w === 'this' || w === 'last') && (next === 'month' || next === 'year')) {
    const step = w === 'next' ? 1 : w === 'last' ? -1 : 0;
    if (next === 'year') {
      const y = ty + step;
      return { from: iso(y, 1, 1), to: iso(y, 12, 31), end: i + 2 };
    }
    let y = ty;
    let mo = tm + step;
    if (mo > 12) {
      mo = 1;
      y += 1;
    } else if (mo < 1) {
      mo = 12;
      y -= 1;
    }
    return { from: iso(y, mo, 1), to: iso(y, mo, daysIn(y, mo)), end: i + 2 };
  }
  // "the next 30 days", "the last 2 weeks": from today, or up to it.
  const unit = ts[i + 2]?.word ?? '';
  if (
    ['next', 'last', 'past', 'coming'].includes(w) &&
    next !== undefined &&
    /^\d{1,3}$/.test(next) &&
    /^(days?|weeks?)$/.test(unit)
  ) {
    const days = Number(next) * (unit.startsWith('week') ? 7 : 1);
    return w === 'next' || w === 'coming'
      ? { from: today, to: shiftDays(today, days), end: i + 3 }
      : { from: shiftDays(today, -days), to: today, end: i + 3 };
  }
  if (w === 'today') return { from: today, to: today, end: i + 1 };
  if (YEAR.test(w)) {
    const y = Number(w);
    return { from: iso(y, 1, 1), to: iso(y, 12, 31), end: i + 1 };
  }
  // "1 October [2026]"
  if (/^\d{1,2}$/.test(w) && next !== undefined) {
    const mo = monthOf(next);
    if (mo !== null) {
      const yw = ts[i + 2]?.word ?? '';
      const y = YEAR.test(yw) ? Number(yw) : ty;
      const d = Number(w);
      if (!valid(y, mo, d)) return null;
      return { from: iso(y, mo, d), to: iso(y, mo, d), end: YEAR.test(yw) ? i + 3 : i + 2 };
    }
  }
  const mo = monthOf(w);
  if (mo !== null) {
    // "October 1[, 2026]" or "October [2026]"
    if (next !== undefined && /^\d{1,2}$/.test(next)) {
      const yw = ts[i + 2]?.word ?? '';
      const y = YEAR.test(yw) ? Number(yw) : ty;
      const d = Number(next);
      if (valid(y, mo, d)) {
        return { from: iso(y, mo, d), to: iso(y, mo, d), end: YEAR.test(yw) ? i + 3 : i + 2 };
      }
    }
    // "may" is a word too: a month only beside a year or after "in".
    if (w === 'may' && !(next !== undefined && YEAR.test(next)) && ts[i - 1]?.word !== 'in') {
      return null;
    }
    const y = next !== undefined && YEAR.test(next) ? Number(next) : ty;
    return {
      from: iso(y, mo, 1),
      to: iso(y, mo, daysIn(y, mo)),
      end: next !== undefined && YEAR.test(next) ? i + 2 : i + 1,
    };
  }
  return null;
}

/* ------------------------------------------------------------ matching -- */

/** Where `phrase` occurs as consecutive stems among tokens not yet used. */
function find(ts: readonly Token[], used: ReadonlySet<number>, phrase: readonly string[]): number {
  if (phrase.length === 0) return -1;
  for (let i = 0; i + phrase.length <= ts.length; i += 1) {
    if (phrase.every((p, k) => !used.has(i + k) && ts[i + k]?.stem === p)) return i;
  }
  return -1;
}

const take = (used: Set<number>, from: number, count: number): void => {
  for (let k = 0; k < count; k += 1) used.add(from + k);
};

/** Words in a company's name that say nothing about which one it is. */
const GENERIC = new Set(
  'sl slu sa sas ltd limited inc llc plc gmbh ag bv nv srl spa co company group office branch team the and of'.split(
    ' ',
  ),
);

/** The field whose name starts at token `j`: most of its words, then the shortest name. */
function fieldAt<F extends CatalogueField>(
  ts: readonly Token[],
  used: ReadonlySet<number>,
  j: number,
  fields: readonly F[],
): { field: F; length: number } | null {
  let best: { field: F; length: number; ratio: number } | null = null;
  for (const field of fields) {
    const label = new Set(stems(field.label));
    let k = 0;
    while (j + k < ts.length && !used.has(j + k) && label.has(ts[j + k]?.stem ?? '')) k += 1;
    if (k === 0 || (k < label.size && k < 2)) continue;
    const ratio = k / label.size;
    if (best === null || k > best.length || (k === best.length && ratio > best.ratio)) {
      best = { field, length: k, ratio };
    }
  }
  return best === null ? null : { field: best.field, length: best.length };
}

/** The date field a sentence means: the start date after "hired", else one it names. */
function dateField(
  ts: readonly Token[],
  at: number,
  fields: readonly CatalogueField[],
): { field: CatalogueField; cue: number | null } | null {
  const dates = fields.filter((f) => f.kind === 'date');
  for (let k = at - 1; k >= Math.max(0, at - 4); k -= 1) {
    if (HIRE.has(ts[k]?.word ?? '')) {
      const hire =
        dates.find((f) => f.key === 'hire_date') ??
        dates.find((f) => /start|hire|join/u.test(fold(f.label)));
      if (hire !== undefined) return { field: hire, cue: k };
    }
  }
  const named = dates.find((f) =>
    stems(f.label)
      .filter((s) => s !== 'date')
      .some((s) => ts.some((t) => t.stem === s)),
  );
  return named === undefined ? null : { field: named, cue: null };
}

/**
 * Conditions from what People recognises, marking the tokens it used. The
 * order is the order a person reads the chips in: options first, then the
 * rest as they appear.
 */
function conditionsFrom(
  ts: readonly Token[],
  used: Set<number>,
  fields: readonly CatalogueField[],
  today: string,
): IntentCondition[] {
  const found: { at: number; condition: IntentCondition }[] = [];

  // "missing an emergency contact", "with no manager", "with a work phone"
  for (let i = 0; i < ts.length; i += 1) {
    const w = ts[i]?.word ?? '';
    const notYet = NOT_YET.has(w) && FILLED.has(ts[i + 1]?.word ?? '');
    if (used.has(i) || (!EMPTY.has(w) && !PRESENT.has(w) && !notYet)) continue;
    let j = notYet ? i + (ts[i + 2]?.word === 'in' ? 3 : 2) : i + 1;
    let empty = EMPTY.has(w) || notYet;
    while (j < ts.length && ARTICLES.has(ts[j]?.word ?? '')) {
      if (ts[j]?.word === 'no') empty = true;
      j += 1;
    }
    const hit = fieldAt(ts, used, j, fields);
    if (hit === null) continue;
    take(used, i, j + hit.length - i);
    found.push({
      at: i,
      condition: { key: hit.field.key, op: empty ? 'empty' : 'not_empty', values: [] },
    });
  }

  // Dates: "hired before 2024", "starting next month", "between X and Y".
  for (let i = 0; i < ts.length; i += 1) {
    if (used.has(i)) continue;
    const span = dateAt(ts, i, today);
    if (span === null) continue;
    const previous = ts[i - 1]?.word ?? '';
    const relation = BEFORE.has(previous)
      ? 'before'
      : AFTER.has(previous)
        ? previous === 'after'
          ? 'after'
          : 'since'
        : previous === 'between'
          ? 'between'
          : 'in';
    const start = relation === 'in' ? (previous === 'in' || previous === 'on' ? i - 1 : i) : i - 1;
    const target = dateField(ts, start, fields);
    if (target === null) continue;
    let end = span.end;
    let values: string[];
    let op: IntentOp;
    if (relation === 'between') {
      const second = ts[end]?.word === 'and' ? dateAt(ts, end + 1, today) : null;
      if (second === null) continue;
      op = 'between';
      values = [span.from, second.to];
      end = second.end;
    } else if (relation === 'before') {
      op = 'before';
      values = [nextDay(span.from, -1)];
    } else if (relation === 'after') {
      op = 'after';
      values = [nextDay(span.to, 1)];
    } else if (relation === 'since') {
      op = 'after';
      values = [span.from];
    } else {
      op = 'between';
      values = [span.from, span.to];
    }
    take(used, start, end - start);
    if (target.cue !== null) used.add(target.cue);
    found.push({ at: start, condition: { key: target.field.key, op, values } });
    i = end - 1;
  }

  // Options: "Barcelona", "Sales or Engineering", "the Madrid entity".
  const picked: { at: number; length: number; field: CatalogueField; value: string }[] = [];
  for (const field of fields) {
    if (field.options.length === 0) continue;
    const fieldWords = new Set(stems(field.label));
    for (const option of field.options) {
      const phrase = stems(option.label);
      // An option that is an everyday word ("People", a department) is that
      // option only as a name is written, mid-sentence, or beside its field.
      const everyday = phrase.length === 1 && STOP.has(phrase[0] ?? '');
      const at = everyday
        ? ts.findIndex(
            (t, i) =>
              !used.has(i) &&
              t.stem === phrase[0] &&
              ((i > 0 && /^\p{Lu}/u.test(t.raw)) ||
                fieldWords.has(ts[i - 1]?.stem ?? '') ||
                fieldWords.has(ts[i + 1]?.stem ?? '')),
          )
        : find(ts, used, phrase);
      if (at >= 0) {
        picked.push({ at, length: phrase.length, field, value: option.value });
        continue;
      }
      // One telling word of a long name, only beside the field's own name.
      if (phrase.length < 2) continue;
      for (const s of phrase.filter((p) => p.length >= 4 && !GENERIC.has(p))) {
        const i = find(ts, used, [s]);
        if (i < 0) continue;
        const beside = [i - 2, i - 1, i + 1, i + 2].some((k) => fieldWords.has(ts[k]?.stem ?? ''));
        if (beside) picked.push({ at: i, length: 1, field, value: option.value });
      }
    }
  }
  picked.sort((a, b) => b.length - a.length || a.at - b.at);
  const values = new Map<string, { at: number; values: string[] }>();
  for (const p of picked) {
    if ([...Array(p.length).keys()].some((k) => used.has(p.at + k))) continue;
    take(used, p.at, p.length);
    // The field's own name beside its option ("Sales department") is part of it.
    const fieldWords = new Set(stems(p.field.label));
    for (const k of [p.at - 1, p.at + p.length]) {
      if (fieldWords.has(ts[k]?.stem ?? '')) used.add(k);
    }
    const entry = values.get(p.field.key) ?? { at: p.at, values: [] };
    if (!entry.values.includes(p.value)) entry.values.push(p.value);
    entry.at = Math.min(entry.at, p.at);
    values.set(p.field.key, entry);
  }
  const options = [...values.entries()]
    .toSorted((a, b) => a[1].at - b[1].at)
    .map(([key, v]) => ({ key, op: 'in' as const, values: v.values }));

  // A role in the plural ("engineers", "managers", "analysts"): the job title
  // mentions it. Only a role's ending, because a name ("James", "Lewis") ends
  // in s as often as not.
  const title = fields.find((f) => f.key === 'job_title' && f.kind === 'text');
  if (title !== undefined) {
    const at = ts.findIndex(
      (t, i) =>
        !used.has(i) &&
        !STOP.has(t.word) &&
        !CUES.has(t.word) &&
        /^\p{L}{3,}(er|or|ist|yst|ant|ent|ian|eer|ect|ern|ner|ead)s$/u.test(t.word),
    );
    const role = ts[at];
    if (role !== undefined) {
      used.add(at);
      found.push({ at, condition: { key: title.key, op: 'contains', values: [role.stem] } });
    }
  }

  return [...options, ...found.toSorted((a, b) => a.at - b.at).map((f) => f.condition)];
}

/** "newest", "longest serving", "alphabetical": an order, marking what it used. */
function sortFrom(
  ts: readonly Token[],
  used: Set<number>,
  fields: readonly CatalogueField[],
): DirectoryPlan['sort'] {
  const hire = fields.some((f) => f.key === 'hire_date');
  for (let i = 0; i < ts.length; i += 1) {
    if (used.has(i)) continue;
    const w = ts[i]?.word ?? '';
    const plus = ['first', 'hire', 'hires', 'joiner', 'joiners', 'serving'].includes(
      ts[i + 1]?.word ?? '',
    )
      ? 2
      : 1;
    if (hire && ['newest', 'latest', 'recent', 'newer'].includes(w)) {
      if (ts[i - 1]?.word === 'most') used.add(i - 1);
      take(used, i, plus);
      return { key: 'hire_date', direction: 'desc' };
    }
    if (hire && ['earliest', 'longest', 'oldest'].includes(w)) {
      take(used, i, plus);
      return { key: 'hire_date', direction: 'asc' };
    }
    if (['alphabetical', 'alphabetically'].includes(w)) {
      used.add(i);
      return { key: 'name', direction: 'asc' };
    }
    if (w === 'by' && ts[i + 1]?.word === 'name') {
      take(used, i, 2);
      return { key: 'name', direction: 'asc' };
    }
  }
  return null;
}

const unusedOf = (ts: readonly Token[], used: ReadonlySet<number>): string[] =>
  ts.filter((t, i) => !used.has(i) && !STOP.has(t.word)).map((t) => t.raw);

/* ----------------------------------------------------------- directory -- */

/** The directory from a sentence, by People's own rules. */
export function directoryByRules(
  sentence: string,
  fields: readonly CatalogueField[],
  today: string,
): DirectoryPlan {
  const ts = tokens(sentence);
  const used = new Set<number>();
  const sort = sortFrom(ts, used, fields);
  const conditions = conditionsFrom(ts, used, fields, today);
  return { search: null, conditions, match: 'all', sort, unused: unusedOf(ts, used), ask: null };
}

const CUES = new Set([
  ...STOP,
  ...HIRE,
  ...BEFORE,
  ...AFTER,
  ...EMPTY,
  ...PRESENT,
  ...MONTHS,
  'next',
  'last',
  'this',
  'month',
  'year',
  'week',
  'today',
  'newest',
  'latest',
  'earliest',
  'between',
]);

/** One email address, which goes straight to whoever has it. */
export const isEmail = (sentence: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(sentence.trim());

/**
 * A query that is only a name: a few words, no number, none of the words a
 * description is made of, and nothing People's rules recognise. Searched as
 * names, with no model.
 */
export function isPlainSearch(sentence: string, fields: readonly CatalogueField[]): boolean {
  const ts = tokens(sentence);
  if (ts.length === 0 || ts.length > 4) return false;
  if (ts.some((t) => /\d/u.test(t.word) || CUES.has(t.word))) return false;
  const plan = directoryByRules(sentence, fields, '2000-01-01');
  return plan.conditions.length === 0 && plan.sort === null;
}

/** What the model may be told of each field. */
export function forModel(fields: readonly PlannedField[]): CatalogueField[] {
  return fields.map((f) =>
    f.ai
      ? { key: f.key, label: f.label, kind: f.kind, options: f.options }
      : { key: f.key, label: f.label, kind: 'presence', options: [] },
  );
}

/** Which operators each kind of field takes: the directory's own (`OPERATORS` on screen). */
const FITS: Readonly<Record<string, readonly IntentOp[]>> = {
  text: ['contains', 'is', 'empty', 'not_empty'],
  select: ['in', 'empty', 'not_empty'],
  status: ['in'],
  date: ['between', 'before', 'after', 'empty', 'not_empty'],
  number: ['is', 'before', 'after', 'empty', 'not_empty'],
  person: ['empty', 'not_empty'],
  presence: ['empty', 'not_empty'],
};

const OPS = ['is', 'in', 'contains', 'before', 'after', 'between', 'empty', 'not_empty'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const ConditionAnswer = z.strictObject({
  key: z.string().max(64),
  op: z.enum(OPS),
  values: z
    .array(z.union([z.string().max(200), z.number()]).transform(String))
    .max(50)
    .default([]),
});

/** A condition the field takes, with an option read by its label; null for anything else. */
function checkedCondition(
  c: z.infer<typeof ConditionAnswer>,
  fields: ReadonlyMap<string, CatalogueField>,
): IntentCondition | null {
  const field = fields.get(c.key);
  if (field === undefined) return null;
  // A choice is asked as "any of", whichever the model wrote.
  const op: IntentOp = field.options.length > 0 && c.op === 'is' ? 'in' : c.op;
  if (!(FITS[field.kind] ?? FITS['text'] ?? []).includes(op)) return null;
  const values = op === 'empty' || op === 'not_empty' ? [] : c.values.map((v) => v.trim());
  const arity =
    op === 'between' ? 2 : op === 'in' ? -1 : op === 'empty' || op === 'not_empty' ? 0 : 1;
  if (arity >= 0 && values.length !== arity) return null;
  if (arity < 0 && values.length === 0) return null;
  if (field.kind === 'date' && values.length > 0) {
    if (
      !values.every(
        (v) =>
          v === '' ||
          (ISO.test(v) && valid(...(v.split('-').map(Number) as [number, number, number]))),
      )
    ) {
      return null;
    }
    if (values.every((v) => v === '')) return null;
  }
  if (field.kind === 'number' && !values.every((v) => /^-?\d+(\.\d+)?$/u.test(v))) return null;
  if (field.options.length > 0 && values.length > 0) {
    const mapped = values.map(
      (v) => field.options.find((o) => o.value === v || fold(o.label) === fold(v))?.value,
    );
    if (mapped.some((v) => v === undefined)) return null;
    return { key: c.key, op, values: [...new Set(mapped as string[])] };
  }
  return { key: c.key, op, values };
}

const conditionsChecked = (
  raw: readonly z.infer<typeof ConditionAnswer>[],
  shown: readonly CatalogueField[],
): IntentCondition[] | null => {
  const byKey = new Map(shown.map((f) => [f.key, f]));
  const checked = raw.map((c) => checkedCondition(c, byKey));
  return checked.some((c) => c === null) ? null : (checked as IntentCondition[]);
};

const AskAnswer = z.strictObject({
  phrase: z.string().trim().min(1).max(60),
  options: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(60),
        conditions: z.array(ConditionAnswer).min(1).max(10),
        match: z.enum(['all', 'any']).default('all'),
      }),
    )
    .min(2)
    .max(4),
});

const DirectoryAnswer = z.strictObject({
  conditions: z.array(ConditionAnswer).max(20).default([]),
  ask: AskAnswer.nullable().default(null),
  match: z.enum(['all', 'any']).default('all'),
  sort: z
    .strictObject({ key: z.string().max(64), direction: z.enum(['asc', 'desc']) })
    .nullable()
    .default(null),
  search: z.string().trim().max(120).nullable().default(null),
});

const NAME = /^[\p{L}][\p{L}'’. -]*$/u;

/**
 * The model's answer for the directory, read against the fields it was
 * shown (`forModel`). Null when any of it is not what People runs, or when
 * it understood nothing: the rules then stand.
 */
export function readDirectoryAnswer(
  text: string,
  shown: readonly CatalogueField[],
): DirectoryPlan | null {
  const parsed = DirectoryAnswer.safeParse(firstObject(text));
  if (!parsed.success) return null;
  const a = parsed.data;
  const conditions = conditionsChecked(a.conditions, shown);
  if (conditions === null) return null;
  let sort: DirectoryPlan['sort'] = null;
  if (a.sort !== null) {
    const field = shown.find((f) => f.key === a.sort?.key);
    if (a.sort.key !== 'name' && (field === undefined || field.kind === 'presence')) return null;
    sort = a.sort;
  }
  const search = a.search !== null && a.search !== '' && NAME.test(a.search) ? a.search : null;
  let ask: DirectoryPlan['ask'] = null;
  if (a.ask !== null) {
    // Words the screen shows as they are: plain, and nothing shaped like somebody's value.
    if (plainReason(a.ask.phrase) === null && a.ask.phrase.length >= 3) return null;
    const readings = a.ask.options.map((o) => ({
      label: plainReason(o.label),
      conditions: conditionsChecked(o.conditions, shown),
      match: o.match,
    }));
    if (readings.some((r) => r.label === null || r.conditions === null)) return null;
    ask = {
      phrase: a.ask.phrase,
      readings: readings.map((r) => ({
        label: r.label ?? '',
        conditions: r.conditions ?? [],
        match: r.match,
      })),
    };
  }
  if (conditions.length === 0 && sort === null && search === null && ask === null) return null;
  return { search, conditions, match: a.match, sort, unused: [], ask };
}

export const DIRECTORY_INSTRUCTION = `You turn what somebody typed into the search box of a company's employee directory into the directory's own filters. Answer with ONE JSON object and nothing else, in exactly this shape:
{"conditions":[{"key":"<field key>","op":"<op>","values":["..."]}],"match":"all","sort":{"key":"<field key or name>","direction":"asc"}|null,"search":"<a person's name>"|null}

You are given what was typed ("sentence"), today's date, and the fields this person may filter by, each with its key, label, kind and, for a choice, its options.
- Ops by kind. text: contains, is, empty, not_empty. select: in, empty, not_empty (values are option values). status: in. date: between (two dates), before, after (one date, bounds included), empty, not_empty. number: is, before (less than), after (more than), empty, not_empty. person: empty, not_empty. presence: empty, not_empty only.
- Dates are YYYY-MM-DD. "starting next month" is the start date between the first and the last day of next month; "hired before 2024" is before the last day of 2023.
- A job, a role or a title ("engineers", "managers") is a text field such as the job title, with contains and the word in its singular form.
- "missing X" or "without X" is X empty; "with X" is X not_empty.
- "search" is only for a person's name that was typed; otherwise null.
- When a part could mean two or more different things the fields can express, do not pick one: leave it out of "conditions" and add "ask":{"phrase":"<those words as typed>","options":[{"label":"<a few plain words>","conditions":[...],"match":"all"}]} with 2 to 4 options. Otherwise omit "ask".
- Never judge people: how good they are at something, how well they work, what they might do, their health, beliefs or other sensitive traits are not fields. Leave such words out.
- sort only when an order was asked for ("newest" is the start date, desc).
- Use only the keys given. Never invent a field, an option or a value. When you cannot tell, leave it out.`;

export function directoryContext(
  sentence: string,
  shown: readonly CatalogueField[],
  today: string,
): Record<string, unknown> {
  return { sentence, today: spokenDate(today), fields: shown };
}

/* -------------------------------------------------------------- export -- */

/** The words that make a field payroll's (payroll needs these, and not a T-shirt size). */
const PAYROLL = new Set(
  stems(
    'name employee number start hire entity salary pay bank account iban tax national identifier address contract cost centre center ' +
      // The tax and social-security identifiers, as countries name them.
      'nif nie naf nss ssn nino tin bsn social security',
  ),
);

const FORMATS: readonly [RegExp, ExportPlan['format']][] = [
  [/^csv$/u, 'csv'],
  [/^(excel|xlsx|spreadsheet|workbook)$/u, 'xlsx'],
  [/^(pdf|roster|print|printable)$/u, 'pdf'],
];

function audienceLabel(audience: Audience, cat: ExportCatalogue): string {
  switch (audience.kind) {
    case 'everyone':
      return 'everybody';
    case 'segment':
      return cat.audiences.find((a) => a.value === audience.value)?.label ?? 'a saved view';
    case 'conditions': {
      const named = audience.conditions.flatMap((c) => {
        const f = cat.filters.find((x) => x.key === c.key);
        return c.values.flatMap((v) => f?.options.find((o) => o.value === v)?.label ?? []);
      });
      return named.length === 0 ? 'the people described' : named.join(' and ');
    }
  }
}

/** A drafted reason, from what was understood: the person edits it. */
export function draftedReason(plan: ExportPlan, cat: ExportCatalogue, payroll: boolean): string {
  return `${payroll ? 'Payroll' : 'People data'} for ${audienceLabel(plan.audience, cat)}, as of ${spokenDate(plan.asOf)}`;
}

/** An as-of date no later than today, and a note when it had to be. */
function notAfterToday(date: string, today: string): { asOf: string; notes: string[] } {
  return date > today
    ? {
        asOf: today,
        notes: [`${spokenDate(date)} is still to come, so the export is as of today.`],
      }
    : { asOf: date, notes: [] };
}

/** An export from a sentence, by People's own rules. */
export function exportByRules(sentence: string, cat: ExportCatalogue): ExportPlan {
  const ts = tokens(sentence);
  const used = new Set<number>();

  // "as of 1 October", "as at the end of September": the file's date.
  let asOf = cat.today;
  let notes: string[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const w = ts[i]?.word;
    const lead =
      w === 'as' && ['of', 'at', 'on'].includes(ts[i + 1]?.word ?? '') ? 2 : w === 'on' ? 1 : 0;
    if (lead === 0) continue;
    const span = dateAt(ts, i + lead, cat.today);
    if (span === null) continue;
    take(used, i, span.end - i);
    ({ asOf, notes } = notAfterToday(span.to, cat.today));
    break;
  }

  let format: ExportPlan['format'] = 'xlsx';
  let photos = false;
  ts.forEach((t, i) => {
    const f = FORMATS.find(([re]) => re.test(t.word));
    if (f !== undefined) {
      format = f[1];
      used.add(i);
    }
    if (/^(photo|picture|headshot)s?$/u.test(t.word)) {
      photos = true;
      used.add(i);
    }
  });

  // A saved view by its name.
  let audience: Audience = { kind: 'everyone' };
  for (const a of cat.audiences) {
    if (a.value === 'everyone') continue;
    const phrase = stems(a.label);
    const at = find(ts, used, phrase);
    if (at >= 0) {
      take(used, at, phrase.length);
      audience = { kind: 'segment', value: a.value };
      break;
    }
  }

  // Which fields: payroll's, the sections and fields named, or everything.
  const payroll = ts.some((t) => t.word === 'payroll');
  let fields: string[];
  if (payroll) {
    ts.forEach((t, i) => {
      if (t.word === 'payroll') used.add(i);
    });
    fields = cat.fields.filter((f) => stems(f.label).some((s) => PAYROLL.has(s))).map((f) => f.key);
  } else {
    const named = new Set<string>();
    const sections = [...new Set(cat.fields.map((f) => f.section))];
    for (const f of cat.fields) {
      const phrase = stems(f.label);
      const at = find(ts, used, phrase);
      if (at >= 0) {
        take(used, at, phrase.length);
        named.add(f.key);
      }
    }
    for (const section of sections) {
      const phrase = stems(section);
      const at = find(ts, used, phrase);
      if (at >= 0) {
        take(used, at, phrase.length);
        for (const f of cat.fields) if (f.section === section) named.add(f.key);
      }
    }
    fields =
      named.size === 0
        ? cat.fields.map((f) => f.key)
        : cat.fields.filter((f) => named.has(f.key)).map((f) => f.key);
  }

  if (audience.kind === 'everyone') {
    const conditions = conditionsFrom(ts, used, cat.filters, cat.today);
    if (conditions.length > 0) audience = { kind: 'conditions', conditions, match: 'all' };
  }

  const plan: ExportPlan = { fields, audience, asOf, format, photos, reason: null, notes };
  return { ...plan, reason: draftedReason(plan, cat, payroll) };
}

const AudienceAnswer = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('everyone') }),
  z.strictObject({ kind: z.literal('segment'), value: z.string().max(80) }),
  z.strictObject({
    kind: z.literal('conditions'),
    conditions: z.array(ConditionAnswer).min(1).max(20),
    match: z.enum(['all', 'any']).default('all'),
  }),
]);

const ExportAnswer = z.strictObject({
  fields: z.union([z.literal('all'), z.array(z.string().max(64)).min(1).max(500)]),
  audience: AudienceAnswer.default({ kind: 'everyone' }),
  asOf: z.string().regex(ISO).nullable().default(null),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
  photos: z.boolean().default(false),
  reason: z.string().max(300).nullable().default(null),
});

/** A reason worth showing: plain words, no markup, nothing shaped like somebody's value. */
function plainReason(raw: string | null): string | null {
  const reason = raw?.replaceAll(/\s+/gu, ' ').trim() ?? '';
  if (reason.length < 3 || reason.length > 200) return null;
  if (/[<>{}[\]\\|`*_#@]/u.test(reason)) return null;
  if (/\p{Nd}(?:[\s./-]?\p{Nd}){5,}/u.test(reason)) return null;
  return reason;
}

/**
 * The model's answer for an export, read against what it was shown: fields
 * offered, an audience offered, conditions the directory takes. Null when
 * any of it is not; a reason that cannot be kept is null on its own, and a
 * date still to come is today, with a note.
 */
export function readExportAnswer(text: string, cat: ExportCatalogue): ExportPlan | null {
  const parsed = ExportAnswer.safeParse(firstObject(text));
  if (!parsed.success) return null;
  const a = parsed.data;
  const offered = new Set(cat.fields.map((f) => f.key));
  if (a.fields !== 'all' && a.fields.some((k) => !offered.has(k))) return null;
  const fields =
    a.fields === 'all'
      ? cat.fields.map((f) => f.key)
      : cat.fields.filter((f) => (a.fields as string[]).includes(f.key)).map((f) => f.key);
  let audience: Audience;
  if (a.audience.kind === 'segment') {
    const value = a.audience.value;
    if (value === 'everyone' || !cat.audiences.some((x) => x.value === value)) return null;
    audience = { kind: 'segment', value };
  } else if (a.audience.kind === 'conditions') {
    const conditions = conditionsChecked(a.audience.conditions, forModel(cat.filters));
    if (conditions === null) return null;
    audience = { kind: 'conditions', conditions, match: a.audience.match };
  } else {
    audience = { kind: 'everyone' };
  }
  if (a.asOf !== null && !valid(...(a.asOf.split('-').map(Number) as [number, number, number]))) {
    return null;
  }
  const { asOf, notes } = notAfterToday(a.asOf ?? cat.today, cat.today);
  return {
    fields,
    audience,
    asOf,
    format: a.format,
    photos: a.photos && a.format !== 'pdf',
    reason: plainReason(a.reason),
    notes,
  };
}

export const EXPORT_INSTRUCTION = `You turn a description of a spreadsheet of employees into the export builder's own choices. Answer with ONE JSON object and nothing else, in exactly this shape:
{"fields":["<field key>"]|"all","audience":{"kind":"everyone"}|{"kind":"segment","value":"<audience value>"}|{"kind":"conditions","conditions":[{"key":"<filter key>","op":"<op>","values":["..."]}],"match":"all"},"asOf":"YYYY-MM-DD"|null,"format":"xlsx"|"csv"|"pdf","photos":false,"reason":"<one short sentence>"}

You are given the description ("sentence"), today's date, the fields this person may export (key, label, section), the audiences they may choose (everybody, and saved views), and the filters an audience may be narrowed by (key, label, kind and, for a choice, its options).
- fields: the keys that fit the purpose. Payroll needs names, the employee number, start date, legal entity, pay, bank and tax details and address; a phone list needs names and contact details. "all" only when everything was asked for.
- audience: a saved view when one is named; otherwise conditions when a group is described ("the Madrid entity" is the legal entity whose option is in Madrid); otherwise everyone. Ops by kind as for filters: select in; date between, before, after; text contains; presence empty or not_empty.
- asOf: the date the values should be as of, YYYY-MM-DD, never after today; null for today.
- format: csv for another system, xlsx for a person, pdf for a printed roster.
- reason: why this export is being made, in a few plain words, for the audit log ("Monthly payroll for the Madrid entity"). No names of people, no numbers but a date.
- Use only the keys and values given. Never invent a field, an option or a value.`;

export function exportContext(sentence: string, cat: ExportCatalogue): Record<string, unknown> {
  return {
    sentence,
    today: spokenDate(cat.today),
    fields: cat.fields,
    audiences: cat.audiences,
    filters: forModel(cat.filters),
  };
}

/** Whether a sentence mentions payroll, for the drafted reason. */
export const aboutPayroll = (sentence: string): boolean =>
  tokens(sentence).some((t) => t.word === 'payroll');
