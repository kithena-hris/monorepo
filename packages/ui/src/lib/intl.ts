/**
 * Numbers, dates and lists in the reader's language.
 *
 * The app says which language the page is in (`setLocale`), as it says where
 * the words come from; every screen formats through these, never through a
 * locale written in the code, so a German page reads "24. Okt." and "Ana und
 * Ben" where an American one reads "Oct 24" and "Ana and Ben".
 *
 * The formatters are lazy: `dateFormat({ month: 'short' })` at the top of a
 * module asks for the language each time it formats, so a server rendering
 * two people's pages at once formats each in its own.
 */

let current: () => string = () => 'en-US';

/** The page's language, as the app answers it; `null` goes back to US English. */
export function setLocale(next: (() => string) | null): void {
  current = next ?? (() => 'en-US');
}

/** The language the page is formatted in: a BCP 47 tag (`de`, `en-GB`). */
export function locale(): string {
  return current();
}

const held = new Map<string, unknown>();

function cached<F>(kind: string, options: object | undefined, make: (tag: string) => F): F {
  const tag = locale();
  const id = `${kind}|${tag}|${options === undefined ? '' : JSON.stringify(options)}`;
  let f = held.get(id) as F | undefined;
  if (f === undefined) {
    f = make(tag);
    held.set(id, f);
  }
  return f;
}

/** `Intl.DateTimeFormat` in the page's language, asked for each time it formats. */
export function dateFormat(options?: Intl.DateTimeFormatOptions): {
  format(date?: Date | number): string;
  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[];
  formatRange(start: Date | number, end: Date | number): string;
  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions;
} {
  const f = () => cached('date', options, (tag) => new Intl.DateTimeFormat(tag, options));
  return {
    format: (date) => f().format(date),
    formatToParts: (date) => f().formatToParts(date),
    formatRange: (start, end) => f().formatRange(start, end),
    resolvedOptions: () => f().resolvedOptions(),
  };
}

/** `Intl.NumberFormat` in the page's language, asked for each time it formats. */
export function numberFormat(options?: Intl.NumberFormatOptions): {
  format(value: number | bigint): string;
  formatToParts(value: number | bigint): Intl.NumberFormatPart[];
  resolvedOptions(): Intl.ResolvedNumberFormatOptions;
} {
  const f = () => cached('number', options, (tag) => new Intl.NumberFormat(tag, options));
  return {
    format: (value) => f().format(value),
    formatToParts: (value) => f().formatToParts(value),
    resolvedOptions: () => f().resolvedOptions(),
  };
}

/** A number as the page's language writes it: 1,234 · 1.234 · 1 234. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(options).format(value);
}

/**
 * Items joined as the page's language joins them: "Ana, Ben and Cleo",
 * "Ana, Ben und Cleo"; `or` for a choice ("Ana or Ben").
 */
export function formatList(
  items: readonly string[],
  type: 'and' | 'or' | 'unit' = 'and',
  style: Intl.ListFormatStyle = 'long',
): string {
  const kind: Intl.ListFormatType =
    type === 'and' ? 'conjunction' : type === 'or' ? 'disjunction' : 'unit';
  return cached(
    'list',
    { kind, style },
    (tag) => new Intl.ListFormat(tag, { type: kind, style }),
  ).format(items);
}

/** "in 3 days", "vor 2 Tagen": a distance in time, in the page's language. */
export function formatRelative(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  return cached('relative', options, (tag) => new Intl.RelativeTimeFormat(tag, options)).format(
    value,
    unit,
  );
}

/** A country's name in the page's language, from its ISO code: `DE` → "Allemagne". */
export function regionName(code: string): string {
  return (
    cached('region', undefined, (tag) => new Intl.DisplayNames(tag, { type: 'region' })).of(code) ??
    code
  );
}

/** A language's name in the page's language, from its tag: `pl` → "Polnisch". */
export function languageName(tag: string): string {
  return (
    cached('language', undefined, (l) => new Intl.DisplayNames(l, { type: 'language' })).of(tag) ??
    tag
  );
}

/**
 * A label as it reads inside a sentence: "your address change" in English,
 * "Ihre Adresse-Änderung" in German, whose nouns keep their capital.
 */
export function inSentence(label: string): string {
  return /^de\b/u.test(locale()) ? label : label.toLocaleLowerCase(locale());
}
