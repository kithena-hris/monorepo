import type { AttributeDataType } from '@kithena/contracts';

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
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const IBAN = /^([A-Z]{2})\d{2}[A-Z0-9]{10,30}$/u;
const DMY = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/u;
const YMD = /^\d{4}-\d{2}-\d{2}$/u;
const PHONE = /^\+?[\d\s().-]+$/u;
const YES_NO = new Set(['yes', 'no', 'true', 'false', 'y', 'n', 'sí', 'si']);
/** Few enough to be a list, and short enough to be choices rather than text. */
const LIST_AT_MOST = 12;
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
  if (all(/^-?\d+$/u) && values.every((v) => v.replace('-', '').length <= 6)) {
    return shape('whole numbers', 'number');
  }
  if (all(/^-?\d+[.,]\d+$/u)) {
    const decimals = Math.max(...values.map((v) => v.split(/[.,]/u)[1]?.length ?? 0));
    return shape(`numbers with ${String(decimals)} decimals`, 'decimal');
  }
  if (all(PHONE) && values.every((v) => (v.match(/\d/gu)?.length ?? 0) >= 7)) {
    return shape('phone-like', 'phone');
  }
  const patterns = new Set(values.map(patternOf));
  const [pattern] = patterns;
  if (patterns.size === 1 && pattern !== undefined && /digit/u.test(pattern))
    return shape(pattern, 'text');
  const distinct = [...new Set(values)];
  // A list repeats itself: two names that never repeat are text, not choices.
  if (
    distinct.length <= LIST_AT_MOST &&
    distinct.length < values.length &&
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
  'financial' | 'identifier' | 'special' | 'contact' | 'birth' | 'business' | 'plain';

const KINDS: readonly [RegExp, Kind][] = [
  [
    /iban|bank|account number|sort code|swift|bic|salary|wage|pay\b|bonus|tax|irpf|pension/u,
    'financial',
  ],
  [
    /\bnif\b|\bnie\b|\bdni\b|ssn|social security|\bnino\b|national insurance|passport|\bpan\b|\btin\b|tax id|national id/u,
    'identifier',
  ],
  [/health|medical|allerg|disab|religio|ethnic|union|sexual|pregnan|diagnos|blood/u, 'special'],
  [/emergency|next of kin|\bkin\b|phone|mobile|e-?mail|address/u, 'contact'],
  [/birth|\bdob\b/u, 'birth'],
  [
    /cost cent|department|division|team|grade|level|job|position|contract|office|site|project|budget/u,
    'business',
  ],
];

export function kindOf(header: string, shape: ColumnShape): Kind {
  const words = header.toLowerCase();
  if (shape.dataType === 'bank_account') return 'financial';
  return KINDS.find(([re]) => re.test(words))?.[1] ?? 'plain';
}
