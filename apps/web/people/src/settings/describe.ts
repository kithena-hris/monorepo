import type { CollectAt, DataType, ViewerScope, WriterRole } from './model';
import { keyFromLabel } from './words';

/**
 * A new field drafted from one sentence (design F9): "T-shirt size for the
 * offsite, XS to XXL. People pick it during onboarding; only HR needs it."
 *
 * ponytail: a Kithena rule over a few shapes, not a model, the same reader as
 * the phone's (`apps/tenant-mobile/…/sentences.ts`). What it cannot read it
 * leaves as the section's default, and every step stays the admin's to check.
 */
export interface Described {
  readonly label: string;
  readonly key: string;
  readonly dataType: DataType;
  readonly options: readonly string[];
  readonly collectAt: CollectAt;
  readonly ownership: readonly WriterRole[];
  readonly visibility: readonly ViewerScope[];
  readonly understood: boolean;
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const SCOPE_WORDS: readonly [RegExp, ViewerScope][] = [
  [/\bmanagers? above\b|\bskip.?level\b|\bline managers?\b/iu, 'manager_chain'],
  [/\b(their |the )?managers?\b/iu, 'manager'],
  [/\b(the )?employees?\b|\bthemselves\b|\bpeople\b/iu, 'self'],
  [/\bhr\b/iu, 'hr'],
  [/\bfinance\b|\bpayroll\b/iu, 'finance'],
  [/\beveryone\b|\bwhole company\b|\bdirectory\b/iu, 'directory'],
];

const scopesIn = (text: string): ViewerScope[] =>
  SCOPE_WORDS.filter(([re]) => re.test(text))
    .map(([, s]) => s)
    .filter((s, i, all) => all.indexOf(s) === i);

export function describedField(text: string): Described {
  // A sentence, not a document: a cap keeps every pattern below linear in practice.
  const clean = text.trim().slice(0, 500);
  const lower = clean.toLowerCase();
  const name = (clean.split(/[,.;:\n]| for | - /u)[0] ?? '').trim();
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  // A range of sizes, or a list after "one of" or in brackets.
  const range = /\b(XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:to|-|–)\s*(XXS|XS|S|M|L|XL|XXL|XXXL)\b/u.exec(
    clean,
  );
  const open = clean.indexOf('(');
  const shut = open === -1 ? -1 : clean.indexOf(')', open + 1);
  const listed =
    /one of ([^.;]+)/iu.exec(clean)?.[1] ??
    (open !== -1 && shut > open + 1 ? clean.slice(open + 1, shut) : null);
  let options: string[] = [];
  if (range !== null) {
    const from = SIZES.indexOf(range[1] ?? '');
    const to = SIZES.indexOf(range[2] ?? '');
    if (from !== -1 && to >= from) options = SIZES.slice(from, to + 1);
  } else if (listed !== null) {
    options = listed
      .split(/,|\bor\b|\band\b/u)
      .map((o) => o.trim())
      .filter((o) => o !== '');
  }
  const dataType: DataType =
    options.length > 0
      ? 'select'
      : /\b(date|birthday|when)\b/u.test(lower)
        ? 'date'
        : /\b(how many|number|count)\b/u.test(lower)
          ? 'number'
          : /\b(yes or no|whether|true or false)\b/u.test(lower)
            ? 'boolean'
            : /\b(phone|mobile)\b/u.test(lower)
              ? 'phone'
              : /\bemail\b/u.test(lower)
                ? 'email'
                : 'text';
  const collectAt: CollectAt = /\bonboarding|first day|start\b/u.test(lower)
    ? 'onboarding'
    : /\bsign.?up\b/u.test(lower)
      ? 'signup'
      : /\bonly hr fills|hr fills|hr enters|hr adds\b/u.test(lower)
        ? 'hr_only'
        : /\bany ?time|profile\b/u.test(lower)
          ? 'anytime'
          : 'onboarding';
  const people = collectAt !== 'hr_only' && /\b(people|they|employees?|everyone) fill/u.test(lower);
  const ownership: WriterRole[] =
    collectAt === 'hr_only'
      ? ['hr']
      : people || collectAt !== 'anytime'
        ? ['employee', 'hr']
        : ['hr'];
  const onlyHr = /\bonly hr\b/u.test(lower);
  const seen = onlyHr ? [] : scopesIn(lower.replace(/\b(fill|pick)[^,.;]*/gu, ' '));
  const visibility: ViewerScope[] = onlyHr
    ? ['self', 'hr']
    : seen.length === 0
      ? ['self', 'manager', 'hr']
      : [...new Set<ViewerScope>(['self', ...seen])];
  return {
    label,
    key: keyFromLabel(label),
    dataType,
    options,
    collectAt,
    ownership,
    visibility,
    understood: label !== '',
  };
}
