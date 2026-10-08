/**
 * `formatToParts`, on an engine that may not have it.
 *
 * Hermes on iOS ships `Intl.NumberFormat` and `Intl.DateTimeFormat` without
 * `formatToParts` (Android's, on ICU, has both). Storybook runs in a browser,
 * which always has them, so a component that called them directly drew there
 * and threw "undefined is not a function" on an iPhone: every `Money` did.
 *
 * Where the method exists it is used as it is. Where it does not, the same
 * parts are read off the formatted string, which every engine produces: runs
 * of digits are the figures, what lies between two of them is a separator,
 * and what lies outside them is a sign, a symbol or a space.
 */
export type Part = { type: string; value: string };

/** A currency's symbol or code: neither a digit, a space, a sign nor a bracket. */
const SYMBOL = /[^\s\d()+\-−]+/g;

function outside(text: string, currency: boolean): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(SYMBOL)) {
    parts.push(...signsAndLiterals(text.slice(at, match.index)), {
      type: currency ? 'currency' : 'literal',
      value: match[0],
    });
    at = match.index + match[0].length;
  }
  parts.push(...signsAndLiterals(text.slice(at)));
  return parts;
}

function signsAndLiterals(text: string): Part[] {
  return [...text.matchAll(/[-−]|\+|[^-−+]+/g)].map((m) => ({
    type: m[0] === '-' || m[0] === '−' ? 'minusSign' : m[0] === '+' ? 'plusSign' : 'literal',
    value: m[0],
  }));
}

/** The parts of `text`, which `format` made from `value`. Exported for its test. */
export function numberPartsOf(text: string, value: number, format: Intl.NumberFormat): Part[] {
  const options = format.resolvedOptions();
  const fractional = !Number.isInteger(value) || (options.minimumFractionDigits ?? 0) > 0;
  const currency = options.style === 'currency';
  const runs = [...text.matchAll(/\d+/g)];
  const parts: Part[] = [];
  let at = 0;
  runs.forEach((run, i) => {
    const start = run.index;
    const last = i === runs.length - 1 && runs.length > 1 && fractional;
    if (i === 0) parts.push(...outside(text.slice(at, start), currency));
    else parts.push({ type: last ? 'decimal' : 'group', value: text.slice(at, start) });
    parts.push({ type: last ? 'fraction' : 'integer', value: run[0] });
    at = start + run[0].length;
  });
  parts.push(...outside(text.slice(at), currency));
  return parts;
}

/** `format.formatToParts(value)`, with or without the engine's help. */
export function numberParts(format: Intl.NumberFormat, value: number): Part[] {
  return typeof format.formatToParts === 'function'
    ? format.formatToParts(value)
    : numberPartsOf(format.format(value), value, format);
}

/**
 * The order a locale writes a date's day, month and year in: `['day',
 * 'month', 'year']` for en-GB. Read off a date whose three numbers differ.
 */
export function dateOrder(locale: string | undefined): ('day' | 'month' | 'year')[] {
  const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC' });
  const sample = new Date(Date.UTC(2026, 10, 22));
  if (typeof format.formatToParts === 'function') {
    return format
      .formatToParts(sample)
      .map((p) => p.type)
      .filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year');
  }
  const text = format.format(sample);
  const found = (
    [
      ['day', /22/],
      ['month', /11/],
      ['year', /2026|26/],
    ] as const
  ).map(([type, pattern]) => ({ type, at: text.search(pattern) }));
  return found
    .filter((f) => f.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((f) => f.type);
}
