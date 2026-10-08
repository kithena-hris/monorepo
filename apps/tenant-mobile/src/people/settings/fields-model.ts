/**
 * Employee fields as the web's settings screens hold them (`people/src/settings`:
 * `model.ts`, `words.ts`, `access.tsx`, `predicate-editor.tsx`, the field
 * editor's draft and its checks), for the phone. Pure: tested without React.
 */

export type WriterRole = 'employee' | 'manager' | 'hr' | 'finance' | 'system' | 'external';
export type ViewerScope =
  'self' | 'manager' | 'manager_chain' | 'hr' | 'finance' | 'admin' | 'directory';
export type CollectAt = 'signup' | 'enrolment' | 'onboarding' | 'hr_only' | 'anytime';
export type Classification = 'public' | 'internal' | 'confidential' | 'special-category';
export type RequirednessMode = 'never' | 'always' | 'conditional';
export type ListOperand = 'legalEntity' | 'country' | 'employmentType' | 'workModel' | 'status';

export type PredicateClause =
  | { readonly operand: ListOperand; readonly in: readonly string[] }
  | {
      readonly operand: 'attribute';
      readonly key: string;
      readonly is: 'set' | 'equals';
      readonly equals: string | null;
    };

export interface Predicate {
  readonly combine: 'all' | 'any';
  readonly clauses: readonly PredicateClause[];
}

export interface VisibilityRule {
  readonly scopes: readonly ViewerScope[];
  readonly when: Predicate;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export interface RegistrySection {
  readonly key: string;
  readonly label: string;
  readonly visibility: readonly ViewerScope[];
  readonly ownership: readonly WriterRole[];
  readonly origin: string;
  readonly fixed: boolean;
}

export interface RegistryField {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly string[];
  readonly requiredness: RequirednessMode;
  readonly requiredWhen: Predicate | null;
  readonly ownership: readonly WriterRole[];
  readonly visibility: readonly ViewerScope[];
  readonly visibilityRules: readonly VisibilityRule[];
  readonly collectAt: CollectAt;
  readonly classification: Classification;
  readonly piiKind: string;
  readonly requiresApproval: boolean | null;
  readonly signup: 'page' | 'after' | null;
  readonly signupAskable: boolean | null;
  readonly aiEligible: boolean | null;
  readonly aiShareable: boolean | null;
  readonly encrypted: boolean | null;
  readonly encryptable: boolean | null;
  readonly origin: string;
  readonly pending: 'added' | 'changed' | 'archived' | null;
  readonly review: boolean | null;
  readonly decimals: number | null;
  readonly currency: string | null;
}

export interface Registry {
  readonly published: { readonly version: number; readonly publishedAt: string } | null;
  readonly unpublishedChanges: number;
  readonly sections: readonly RegistrySection[];
  readonly fields: readonly RegistryField[];
  readonly choices: {
    readonly legalEntities: readonly Choice[];
    readonly countries: readonly Choice[];
    readonly employmentTypes: readonly Choice[];
    readonly workModels: readonly Choice[];
  };
}

export type ClassificationAdvice =
  | { readonly kind: 'protect'; readonly piiKind: string; readonly reason: string }
  | {
      readonly kind: 'suggest';
      readonly classification: Classification;
      readonly piiKind: string;
      readonly reason: string;
      readonly floor: Classification;
    }
  | {
      readonly kind: 'choose';
      readonly options: readonly {
        readonly classification: Classification;
        readonly reason: string;
      }[];
      readonly piiKind: string;
      readonly floor: Classification;
    }
  | {
      readonly kind: 'fallback';
      readonly classification: Classification;
      readonly piiKind: string;
      readonly floor: Classification;
    };

export const DATA_TYPE_LABEL: Readonly<Record<string, string>> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Whole number',
  decimal: 'Decimal',
  percentage: 'Percentage',
  money: 'Money',
  boolean: 'Yes or no',
  date: 'Date',
  datetime: 'Date and time',
  duration: 'Duration',
  select: 'One of a list',
  multi_select: 'Several of a list',
  tags: 'Tags',
  email: 'Email address',
  phone: 'Phone number',
  url: 'Web address',
  country: 'Country',
  currency: 'Currency',
  language: 'Language',
  time_zone: 'Time zone',
  address: 'Postal address',
  national_id: 'National identifier',
  bank_account: 'Bank account',
  person_ref: 'A person',
  org_unit_ref: 'A team or department',
  legal_entity_ref: 'A legal entity',
  location_ref: 'A work location',
  document_ref: 'A document',
  image: 'An image',
};

export const DATA_TYPE_GROUPS: readonly { label: string; types: readonly string[] }[] = [
  { label: 'Text', types: ['text', 'long_text'] },
  { label: 'Choices', types: ['select', 'multi_select', 'tags', 'boolean'] },
  { label: 'Numbers and money', types: ['number', 'decimal', 'percentage', 'money'] },
  { label: 'Dates and time', types: ['date', 'datetime', 'duration'] },
  { label: 'Contact', types: ['email', 'phone', 'url', 'address'] },
  { label: 'Standard lists', types: ['country', 'currency', 'language', 'time_zone'] },
  {
    label: 'In your organisation',
    types: ['person_ref', 'org_unit_ref', 'legal_entity_ref', 'location_ref'],
  },
  { label: 'Protected', types: ['national_id', 'bank_account'] },
  { label: 'Files', types: ['document_ref', 'image'] },
];

/** When a field is asked for, in the order a person meets each moment. */
export const COLLECT: readonly { value: CollectAt; label: string; description: string }[] = [
  {
    value: 'signup',
    label: 'At sign-up',
    description: 'When they first set up their account, before they create their passkey.',
  },
  {
    value: 'enrolment',
    label: 'When they accept their invitation',
    description: 'On the account setup page, before they can use Kithena.',
  },
  {
    value: 'onboarding',
    label: 'During onboarding',
    description:
      'In the new starter’s checklist. If required, missing from the day they are hired.',
  },
  {
    value: 'anytime',
    label: 'Any time, on their profile',
    description:
      'Nobody is chased before their first day; if required, missing from their start date.',
  },
  {
    value: 'hr_only',
    label: 'Only HR fills it in',
    description: 'The employee never sees a form for it. If required, HR sees it as missing.',
  },
];

export const CLASSIFICATION: readonly {
  value: Classification;
  label: string;
  description: string;
}[] = [
  {
    value: 'public',
    label: 'Fine for everyone at the company',
    description: 'Could appear in the directory.',
  },
  {
    value: 'internal',
    label: 'Ordinary information about the job',
    description: 'Nobody would mind HR and managers seeing it.',
  },
  {
    value: 'confidential',
    label: 'Would harm or embarrass someone if it leaked',
    description: 'Pay, home address, performance. Kept out of logs and AI.',
  },
  {
    value: 'special-category',
    label: 'Health, beliefs, ethnicity or similar',
    description:
      'Protected by law. Never sent to AI, never carried on an event, never exported without a reason.',
  },
];

export const ORDER: readonly Classification[] = [
  'public',
  'internal',
  'confidential',
  'special-category',
];
export const atLeast = (candidate: Classification, floor: Classification): boolean =>
  ORDER.indexOf(candidate) >= ORDER.indexOf(floor);

export const REQUIREDNESS: readonly { value: RequirednessMode; label: string }[] = [
  { value: 'never', label: 'Optional' },
  { value: 'always', label: 'Required' },
  { value: 'conditional', label: 'Required sometimes' },
];

export const OPERAND_LABEL: Readonly<Record<ListOperand | 'attribute', string>> = {
  legalEntity: 'Legal entity',
  country: 'Country',
  employmentType: 'Employment type',
  workModel: 'Work model',
  status: 'Status',
  attribute: 'Another field',
};

export const STATUS_VALUES: readonly Choice[] = [
  { value: 'provisional', label: 'Provisional' },
  { value: 'pre_hire', label: 'Pre-hire' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'notice', label: 'On notice' },
  { value: 'terminated', label: 'Left' },
  { value: 'discarded', label: 'Discarded' },
];

/** Who may see and change a field, one row per audience, the person outwards. */
export const AUDIENCES: readonly { id: ViewerScope; label: string; canChange: boolean }[] = [
  { id: 'self', label: 'The employee', canChange: true },
  { id: 'manager', label: 'Their manager', canChange: true },
  { id: 'manager_chain', label: 'Managers above', canChange: false },
  { id: 'hr', label: 'HR', canChange: true },
  { id: 'finance', label: 'Finance', canChange: true },
  { id: 'directory', label: 'Everyone', canChange: false },
];

const WRITER: Partial<Record<ViewerScope, WriterRole>> = {
  self: 'employee',
  manager: 'manager',
  hr: 'hr',
  finance: 'finance',
};

export type Access = 'none' | 'see' | 'change';

/** One audience's access to a field, as its row's None / See / Change. */
export function accessFor(
  id: ViewerScope,
  visibility: readonly ViewerScope[],
  ownership: readonly WriterRole[],
): Access {
  const writer = WRITER[id];
  if (writer !== undefined && ownership.includes(writer)) return 'change';
  return visibility.includes(id) ? 'see' : 'none';
}

/** One row changed: the scopes and writers again, an administrator's and a system's kept as they were. */
export function withAccess(
  id: ViewerScope,
  access: Access,
  was: { visibility: readonly ViewerScope[]; ownership: readonly WriterRole[] },
): { visibility: ViewerScope[]; ownership: WriterRole[] } {
  const writer = WRITER[id];
  const visibility = was.visibility.filter((s) => s !== id);
  const ownership = was.ownership.filter((w) => w !== writer);
  return {
    visibility: access === 'none' ? visibility : [...visibility, id],
    ownership: access === 'change' && writer !== undefined ? [...ownership, writer] : ownership,
  };
}

/** `hire_date` from "Hire date". */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

/** The key a choice's option is stored under, as People made it: a rule compares against this. */
export function optionKey(label: string): string {
  const key = label
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 60);
  return /^[a-z]/u.test(key) ? key : `f_${key}`.slice(0, 60);
}

export const EMPTY_PREDICATE: Predicate = {
  combine: 'all',
  clauses: [{ operand: 'country', in: [] }],
};

/** What stops a predicate being saved, or null when it may be. */
export function predicateProblem(predicate: Predicate): string | null {
  if (predicate.clauses.length === 0) return 'Add at least one condition.';
  for (const clause of predicate.clauses) {
    if (clause.operand !== 'attribute') {
      if (clause.in.length === 0) return 'Every condition needs at least one value.';
    } else if (clause.key === '') {
      return 'Choose the field a condition reads.';
    } else if (clause.is === 'equals' && (clause.equals ?? '').trim() === '') {
      return 'Say what the field has to equal.';
    }
  }
  return null;
}

export const WITH_OPTIONS = new Set(['select', 'multi_select']);
export const WITH_DECIMALS = new Set(['number', 'decimal', 'percentage']);
export const SEALABLE = new Set([
  'text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'decimal',
  'date',
  'national_id',
  'bank_account',
  'money',
]);
const KEY = /^[a-z][a-z0-9_]{0,62}$/;

/** On for financial data and identifiers, whatever anybody chose (PEO-077). */
export const approvalByDefault = (dataType: string, piiKind: string): boolean =>
  piiKind === 'financial' || dataType === 'bank_account' || dataType === 'national_id';

export interface Draft {
  label: string;
  key: string;
  sectionKey: string;
  decimals: number | null;
  currency: string;
  description: string;
  dataType: string;
  options: readonly string[];
  requiredness: RequirednessMode;
  requiredWhen: Predicate;
  ownership: readonly WriterRole[];
  collectAt: CollectAt;
  visibility: readonly ViewerScope[];
  visibilityRules: readonly VisibilityRule[];
  classification: Classification | null;
  confirmedSpecial: boolean;
  requiresApproval: boolean | null;
  encrypted: boolean;
}

export function draftFrom(section: RegistrySection, field: RegistryField | null): Draft {
  if (field !== null) {
    return {
      label: field.label,
      key: field.key,
      sectionKey: field.sectionKey,
      decimals: field.decimals,
      currency: field.currency ?? '',
      description: field.description ?? '',
      dataType: field.dataType,
      options: field.options,
      requiredness: field.requiredness,
      requiredWhen: field.requiredWhen ?? EMPTY_PREDICATE,
      ownership: field.ownership,
      collectAt: field.collectAt,
      visibility: field.visibility,
      visibilityRules: field.visibilityRules,
      classification: field.classification,
      confirmedSpecial: field.classification === 'special-category',
      requiresApproval: field.requiresApproval,
      encrypted: field.encrypted === true,
    };
  }
  return {
    label: '',
    key: '',
    sectionKey: section.key,
    decimals: null,
    currency: '',
    description: '',
    dataType: 'text',
    options: [],
    requiredness: 'never',
    requiredWhen: EMPTY_PREDICATE,
    ownership: section.ownership,
    collectAt: section.ownership.includes('employee') ? 'onboarding' : 'hr_only',
    visibility: section.visibility,
    visibilityRules: [],
    classification: null,
    confirmedSpecial: false,
    requiresApproval: null,
    encrypted: false,
  };
}

/** The editor's four parts, each with what stops it being saved. */
export const PARTS = ['The field', 'Access', 'When asked', 'Sensitivity'] as const;

export function problemsIn(
  part: number,
  draft: Draft,
  keyTaken: (key: string) => boolean,
  others: readonly { key: string; label: string; classification: Classification }[],
): Record<string, string> {
  const problems: Record<string, string> = {};
  if (part === 0) {
    if (draft.label.trim() === '') problems['label'] = 'Give the field a name.';
    if (draft.dataType === 'money' && draft.currency !== '' && !/^[A-Z]{3}$/.test(draft.currency)) {
      problems['currency'] = 'A three-letter currency code, like EUR.';
    }
    if (!KEY.test(draft.key)) {
      problems['key'] = 'Lower-case letters, digits and underscores, starting with a letter.';
    } else if (keyTaken(draft.key)) {
      problems['key'] = 'Another field already uses this key.';
    }
    if (WITH_OPTIONS.has(draft.dataType) && draft.options.length === 0) {
      problems['options'] = 'Add at least one option.';
    }
  }
  if (part === 1) {
    if (draft.ownership.length === 0)
      problems['ownership'] = 'Somebody has to be able to fill it in.';
    if (
      draft.visibility.length === 0 &&
      (draft.visibilityRules.length === 0 || draft.requiredness !== 'never')
    ) {
      problems['visibility'] = 'Nobody could ever read it. Choose at least one.';
    }
    for (const rule of draft.visibilityRules) {
      const problem =
        rule.scopes.length === 0
          ? 'Every rule shows the field to somebody.'
          : predicateProblem(rule.when);
      if (problem !== null) problems['rules'] = problem;
    }
  }
  if (part === 2) {
    if (draft.requiredness === 'conditional') {
      const special = draft.requiredWhen.clauses.flatMap((c) =>
        c.operand === 'attribute'
          ? others.filter((f) => f.key === c.key && f.classification === 'special-category')
          : [],
      )[0];
      const problem =
        predicateProblem(draft.requiredWhen) ??
        (special === undefined
          ? null
          : `${special.label} is special-category data, so it cannot decide whether a field is required.`);
      if (problem !== null) problems['requiredWhen'] = problem;
    }
    if (draft.requiredness !== 'never' && draft.visibility.length === 0) {
      problems['unseen'] =
        'A required field needs somebody who can always see it. Choose who under Access.';
    }
  }
  if (part === 3) {
    if (draft.classification === null) problems['kind'] = 'Choose what kind of data this is.';
    else if (draft.classification === 'special-category' && !draft.confirmedSpecial) {
      problems['kind'] = 'Special-category data needs your explicit confirmation.';
    } else if (draft.classification === 'special-category' && draft.visibilityRules.length > 0) {
      problems['kind'] =
        'Special-category data is never shown by a rule. Remove the rules under Access.';
    }
  }
  return problems;
}

/** The type or a format setting of a published field changed: its values are reviewed before publishing. */
export const reformatted = (field: RegistryField, draft: Draft): boolean =>
  draft.dataType !== field.dataType ||
  field.options.some((o) => !draft.options.includes(o)) ||
  (WITH_DECIMALS.has(draft.dataType) && (draft.decimals ?? 0) !== (field.decimals ?? 0)) ||
  (draft.dataType === 'money' && draft.currency !== (field.currency ?? ''));
