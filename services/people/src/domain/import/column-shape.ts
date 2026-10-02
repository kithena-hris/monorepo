import type { AttributeDataType } from '@kithena/contracts';
import { isTimeZone } from '@kithena/domain-kit';

/**
 * An imported column that matches no field: what its values look like, and a
 * field to start from (docs/ai-settings.md, "From an import").
 *
 * The shape is what a model may be told: "dates, dd/mm/yyyy", "8 digits +
 * letter", "4 distinct short values" — never a value. A short list's choices
 * are kept beside it for the review screen, where the administrator sees
 * them, and are not part of the shape. Pure, and decided here rather than by
 * a model, so an import works the same with no model configured.
 */

export interface ColumnShape {
  /** In words, with no value in them. */
  readonly shape: string;
  readonly dataType: AttributeDataType;
  /** A short list's distinct values, first seen first: for the review, never a model. */
  readonly options: readonly string[];
  /** An IBAN's country, when every one agrees. */
  readonly country: string | null;
  /** The most decimal places a number in it has: how many a decimal keeps. */
  readonly decimals?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const IBAN = /^([A-Z]{2})\d{2}[A-Z0-9]{10,30}$/u;
const DMY = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/u;
const YMD = /^\d{4}-\d{2}-\d{2}$/u;
const PHONE = /^\+?[\d\s().-]+$/u;
const YES_NO = new Set(['yes', 'no', 'true', 'false', 'y', 'n', 'sí', 'si']);
/** Few enough to be a list, and short enough to be choices rather than text. */
const LIST_AT_MOST = 12;
const CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'));
const SHORT = 30;

/** "12345678Z" is "8 digits + letter": each run of a kind, counted. */
function patternOf(value: string): string {
  const runs: [string, number][] = [];
  for (const ch of value) {
    const kind = /\d/u.test(ch) ? 'digit' : /\p{L}/u.test(ch) ? 'letter' : 'other';
    const last = runs.at(-1);
    if (last?.[0] === kind) last[1] += 1;
    else runs.push([kind, 1]);
  }
  return runs.map(([kind, n]) => (n === 1 ? kind : `${String(n)} ${kind}s`)).join(' + ');
}

export function shapeOf(raw: readonly string[]): ColumnShape {
  const values = raw.map((v) => v.trim()).filter((v) => v !== '');
  const shape = (
    s: string,
    dataType: AttributeDataType,
    extra: Partial<ColumnShape> = {},
  ): ColumnShape => ({
    shape: s,
    dataType,
    options: [],
    country: null,
    ...extra,
  });
  if (values.length === 0) return shape('empty', 'text');
  const all = (re: RegExp) => values.every((v) => re.test(v));
  if (all(EMAIL)) return shape('email-like', 'email');
  const compact = values.map((v) => v.replaceAll(/\s/gu, '').toUpperCase());
  if (compact.every((v) => IBAN.test(v))) {
    const countries = new Set(compact.map((v) => v.slice(0, 2)));
    const [country] = countries;
    return countries.size === 1 && country !== undefined
      ? shape(`IBAN-like, country ${country}`, 'bank_account', { country })
      : shape('IBAN-like, several countries', 'bank_account');
  }
  if (all(YMD)) return shape('dates, yyyy-mm-dd', 'date');
  if (all(DMY)) return shape('dates, dd/mm/yyyy', 'date');
  if (values.every((v) => YES_NO.has(v.toLowerCase()))) return shape('yes or no', 'boolean');
  // A leading zero is a code (a zip, an account), never a count.
  const zeroLed = values.some((v) => /^-?0\d/u.test(v));
  if (all(/^-?\d+$/u) && !zeroLed && values.every((v) => v.replace('-', '').length <= 6)) {
    return shape('whole numbers', 'number');
  }
  // "2", "2.5" and "2.25" in one column are numbers with two decimals.
  if (all(/^-?\d+([.,]\d+)?$/u) && !zeroLed && values.some((v) => /[.,]/u.test(v))) {
    const decimals = Math.max(...values.map((v) => v.split(/[.,]/u)[1]?.length ?? 0));
    return shape(`numbers with ${String(decimals)} decimals`, 'decimal', { decimals });
  }
  // A phone is written with a "+" or spaces, brackets or dashes: a bare run
  // of digits is an account or a code.
  if (
    all(PHONE) &&
    values.every((v) => (v.match(/\d/gu)?.length ?? 0) >= 7 && /[+\s().-]/u.test(v))
  ) {
    return shape('phone-like', 'phone');
  }
  if (values.every((v) => CURRENCIES.has(v.toUpperCase()))) return shape('currency codes', 'currency');
  if (values.every((v) => v.includes('/') && isTimeZone(v))) return shape('time zones', 'time_zone');
  const distinct = [...new Set(values)];
  // A list is mostly repeats: a quarter of the values, at least, are ones seen
  // before. Children's or partners' names repeat now and then, never that much.
  // ponytail: a ratio, so three rows naming two people can still read as a list.
  const repeats = distinct.length * 4 <= values.length * 3;
  const patterns = new Set(values.map(patternOf));
  const [pattern] = patterns;
  // One pattern that never repeats is an identifier; one that repeats is a list of codes.
  if (patterns.size === 1 && pattern !== undefined && /digit/u.test(pattern) && !repeats)
    return shape(pattern, 'text');
  // A list repeats itself: names that mostly never repeat are text, not choices.
  if (
    distinct.length <= LIST_AT_MOST &&
    repeats &&
    distinct.every((v) => v.length <= SHORT)
  ) {
    return shape(
      distinct.length === 1
        ? 'one short value, the same in every row'
        : `${String(distinct.length)} distinct short values`,
      'select',
      { options: distinct },
    );
  }
  const longest = Math.max(...values.map((v) => v.length));
  return longest > 200
    ? shape(`free text, up to ${String(longest)} characters`, 'long_text')
    : shape(`free text, up to ${String(longest)} characters`, 'text');
}

/** What kind of data a column holds, read from its header and shape: it decides the defaults. */
export type Kind =
  | 'financial'
  | 'identifier'
  | 'pay'
  | 'special'
  | 'contact'
  | 'birth'
  | 'business'
  | 'plain';

/** First match wins: "Tax ID" names a person before "tax" says pay. */
const KINDS: readonly [RegExp, Kind][] = [
  [
    /\bnif\b|\bnie\b|\bdni\b|ssn|social security|\bnino\b|national insurance|passport|\bpan\b|\btin\b|\bsin\b|tax id|steuer|national id|driv\w* licen[cs]e|work permit|work authori[sz]ation|right to work|\bvisa\b|immigration/u,
    'identifier',
  ],
  [/iban|bank|account number|sort code|routing|ifsc|swift|\bbic\b/u, 'financial'],
  [
    /salary|wage|\bpay\b|bonus|commission|equity|stock|\braise\b|hourly rate|compensation|tax|irpf|pension|retirement|flsa/u,
    'pay',
  ],
  [
    /health|medical|allerg|disab|religio|faith|diet|ethnic|\brace\b|union|sexual|pregnan|diagnos|blood|veteran/u,
    'special',
  ],
  [/birth|\bdob\b/u, 'birth'],
  // Before contact: a work location's address is the company's, not the person's.
  [
    /cost cent|department|division|team|grade|level|job|position|contract|office|site|project|budget|work location/u,
    'business',
  ],
  [/emergency|next of kin|\bkin\b|phone|mobile|e-?mail|address|\bhome\b/u, 'contact'],
];

export function kindOf(header: string, shape: ColumnShape): Kind {
  const words = header.toLowerCase();
  if (shape.dataType === 'bank_account') return 'financial';
  return KINDS.find(([re]) => re.test(words))?.[1] ?? 'plain';
}

/**
 * The type a header and its values agree on. The values decide first; the
 * header corrects what values alone cannot tell: "Bonus target %" is a
 * percentage, a postal code keeps its digits as text, a salary is an amount
 * (money when the file gives each row's currency, else a decimal), notes are
 * long text.
 */
export function typeFor(
  header: string,
  shape: ColumnShape,
  file: { readonly hasCurrency: boolean } = { hasCurrency: false },
): ColumnShape {
  const words = header.toLowerCase();
  const numeric =
    shape.dataType === 'number' || shape.dataType === 'decimal' || shape.shape === 'empty';
  const as = (dataType: AttributeDataType, extra: Partial<ColumnShape> = {}): ColumnShape => ({
    ...shape,
    dataType,
    options: dataType === 'select' ? shape.options : [],
    ...extra,
  });
  if (/%|percent/u.test(words) && numeric) return as('percentage', { decimals: shape.decimals ?? 2 });
  if (/salary|wage|hourly rate|\bamount\b|compensation/u.test(words) && numeric) {
    return file.hasCurrency ? as('money') : as('decimal', { decimals: 2 });
  }
  if (
    /postal|\bzip\b|post ?code|\bcode\b|serial|badge|account|routing|number$|\bno\.?$|\bid$/u.test(
      words,
    ) &&
    (shape.dataType === 'number' || shape.dataType === 'decimal' || shape.dataType === 'phone')
  ) {
    return as('text');
  }
  if (/notes?$|comments?$|remarks?$|description$/u.test(words)) return as('long_text');
  if (/address/u.test(words) && shape.dataType === 'select') return as('text');
  return shape;
}
