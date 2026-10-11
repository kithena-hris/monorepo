import {
  AUDIENCES,
  COLLECT,
  keyFromLabel,
  type CollectAt,
  type Draft,
  type RegistryField,
  type ViewerScope,
  type WriterRole,
} from './fields-model';

/**
 * Settings read and written as sentences (design v3 S2, S4, S6). Pure, so
 * the words are tested without a phone.
 *
 * ponytail: a small reader of a few shapes ("let managers see salaries",
 * "make job title required", "T-shirt size, S to XXL, only HR"), not a
 * model; what it cannot read it says so, and the full editor is a tap away.
 */

const join = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

/** "The employee, their manager and HR": an audience list as a sentence part. */
export function seersOf(visibility: readonly ViewerScope[]): string {
  if (visibility.includes('directory')) return 'Everyone';
  // Lower-cased after the first, but a name like HR stays as it is.
  const named = AUDIENCES.filter((a) => visibility.includes(a.id)).map((a, i) =>
    i === 0 || a.label === a.label.toUpperCase() ? a.label : a.label.charAt(0).toLowerCase() + a.label.slice(1),
  );
  if (named.length === 0) return 'Nobody';
  return join(named);
}

const WRITER_WORD: Readonly<Record<WriterRole, string>> = {
  employee: 'The employee',
  manager: 'Their manager',
  hr: 'HR',
  finance: 'Finance',
  system: 'Kithena',
  external: 'An integration',
};

/** "HR", "The employee or HR": who fills it in. */
export function writersOf(ownership: readonly WriterRole[]): string {
  const words = ownership.map((w, i) =>
    i === 0 ? WRITER_WORD[w] : WRITER_WORD[w].replace(/^The |^Their /u, (m) => m.toLowerCase()),
  );
  if (words.length === 0) return 'Nobody';
  return words.length === 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`;
}

/** "sign-up or onboarding": when it is asked for, as the end of "asked for it at …". */
export function askedOf(collectAt: CollectAt): string {
  return COLLECT.find((c) => c.value === collectAt)?.label.toLowerCase() ?? collectAt;
}

/** One field read back as a sentence, its choices separate so each can be tapped. */
export function fieldSentence(draft: Pick<Draft, 'ownership' | 'visibility' | 'collectAt'>): {
  readonly who: string;
  readonly see: string;
  readonly asked: string;
} {
  return {
    who: writersOf(draft.ownership),
    see: seersOf(draft.visibility),
    asked: draft.collectAt === 'hr_only' ? 'nobody is asked for it' : askedOf(draft.collectAt),
  };
}

const SCOPE_WORDS: readonly [RegExp, ViewerScope][] = [
  [/\bmanagers? above\b|\bskip.?level\b/iu, 'manager_chain'],
  [/\b(their |the )?managers?\b/iu, 'manager'],
  [/\b(the )?employees?\b|\bthemselves\b|\bpeople\b/iu, 'self'],
  [/\bhr\b/iu, 'hr'],
  [/\bfinance\b|\bpayroll\b/iu, 'finance'],
  [/\beveryone\b|\bwhole company\b|\bdirectory\b/iu, 'directory'],
];

const scopesIn = (text: string): ViewerScope[] =>
  SCOPE_WORDS.filter(([re]) => re.test(text)).map(([, s]) => s).filter((s, i, all) => all.indexOf(s) === i);

/** The field a sentence names: its label's words, longest first, or a plural of it. */
export function fieldNamed(
  sentence: string,
  fields: readonly Pick<RegistryField, 'key' | 'label'>[],
): Pick<RegistryField, 'key' | 'label'> | null {
  const text = ` ${sentence.toLowerCase().replace(/[’']s\b/gu, '')} `;
  const hits = fields.filter((f) => {
    const label = f.label.toLowerCase();
    return text.includes(` ${label} `) || text.includes(` ${label}s `) || text.includes(` ${label}es `) || text.includes(` ${label.replace(/y$/u, 'ies')} `);
  });
  // "Let managers see salaries": a field named like an audience (Manager) loses to one that isn't.
  const plain = hits.filter((f) => !SCOPE_WORDS.some(([re]) => re.test(f.label)));
  return [...(plain.length > 0 ? plain : hits)].sort((a, b) => b.label.length - a.label.length)[0] ?? null;
}

/** A change to one field's settings, read from a sentence (S2). */
export type FieldChange =
  | { readonly kind: 'see'; readonly key: string; readonly add: readonly ViewerScope[]; readonly remove: readonly ViewerScope[] }
  | { readonly kind: 'required'; readonly key: string; readonly required: boolean };

export function changeFrom(
  sentence: string,
  fields: readonly Pick<RegistryField, 'key' | 'label'>[],
): FieldChange | null {
  const field = fieldNamed(sentence, fields);
  if (field === null) return null;
  const text = sentence.toLowerCase();
  if (/\b(optional|not required)\b/u.test(text))
    return { kind: 'required', key: field.key, required: false };
  if (/\brequired?\b|\bmandatory\b/u.test(text))
    return { kind: 'required', key: field.key, required: true };
  // The field's own words are not an audience: "manager" in "Manager" the field.
  const rest = text.replace(field.label.toLowerCase(), ' ');
  const scopes = scopesIn(rest);
  if (scopes.length === 0) return null;
  const hide = /\b(hide|stop|don[’']?t|do not|no longer|remove|only)\b/u.test(text);
  if (/\bonly\b/u.test(text)) {
    return {
      kind: 'see',
      key: field.key,
      add: scopes,
      remove: (['self', 'manager', 'manager_chain', 'hr', 'finance', 'directory'] as const).filter(
        (s) => !scopes.includes(s),
      ),
    };
  }
  return hide
    ? { kind: 'see', key: field.key, add: [], remove: scopes }
    : { kind: 'see', key: field.key, add: scopes, remove: [] };
}

/** What a described field becomes (S6): a draft to read back as one sentence. */
export interface Described {
  readonly label: string;
  readonly key: string;
  readonly dataType: string;
  readonly options: readonly string[];
  readonly collectAt: CollectAt;
  readonly ownership: readonly WriterRole[];
  readonly visibility: readonly ViewerScope[];
  readonly understood: boolean;
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

export function describedField(text: string): Described {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const name = (clean.split(/[,.;:\n]| for | - /u)[0] ?? '').trim();
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  // A range of sizes, or a list after "one of" or in brackets.
  const range = /\b(XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:to|-|–)\s*(XXS|XS|S|M|L|XL|XXL|XXXL)\b/u.exec(clean);
  const listed = /one of ([^.;]+)/iu.exec(clean) ?? /\(([^)]+)\)/u.exec(clean);
  let options: string[] = [];
  if (range !== null) {
    const from = SIZES.indexOf(range[1] ?? '');
    const to = SIZES.indexOf(range[2] ?? '');
    if (from !== -1 && to >= from) options = SIZES.slice(from, to + 1);
  } else if (listed !== null) {
    options = (listed[1] ?? '')
      .split(/,|\bor\b|\band\b/u)
      .map((o) => o.trim())
      .filter((o) => o !== '');
  }
  const dataType =
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
  const ownership: WriterRole[] = collectAt === 'hr_only' ? ['hr'] : people || collectAt !== 'anytime' ? ['employee', 'hr'] : ['hr'];
  const onlyHr = /\bonly hr\b/u.test(lower);
  const seen = onlyHr ? [] : scopesIn(lower.replace(/\bfill[^,.;]*/gu, ' '));
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
