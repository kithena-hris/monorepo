import { t } from '../../i18n';

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
  readonly openEnded?: boolean | null;
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
  get text(): string {
    return t('people.settings.fields-model.short_text', 'Short text');
  },
  get long_text(): string {
    return t('people.settings.fields-model.long_text', 'Long text');
  },
  get number(): string {
    return t('people.settings.fields-model.whole_number', 'Whole number');
  },
  get decimal(): string {
    return t('people.settings.fields-model.decimal', 'Decimal');
  },
  get percentage(): string {
    return t('people.settings.fields-model.percentage', 'Percentage');
  },
  get money(): string {
    return t('people.settings.fields-model.money', 'Money');
  },
  get boolean(): string {
    return t('people.settings.fields-model.yes_or_no', 'Yes or no');
  },
  get date(): string {
    return t('people.settings.fields-model.date', 'Date');
  },
  get datetime(): string {
    return t('people.settings.fields-model.date_and_time', 'Date and time');
  },
  get duration(): string {
    return t('people.settings.fields-model.duration', 'Duration');
  },
  get select(): string {
    return t('people.settings.fields-model.one_of_a_list', 'One of a list');
  },
  get multi_select(): string {
    return t('people.settings.fields-model.several_of_a_list', 'Several of a list');
  },
  get tags(): string {
    return t('people.settings.fields-model.tags', 'Tags');
  },
  get email(): string {
    return t('people.settings.fields-model.email_address', 'Email address');
  },
  get phone(): string {
    return t('people.settings.fields-model.phone_number', 'Phone number');
  },
  get url(): string {
    return t('people.settings.fields-model.web_address', 'Web address');
  },
  get country(): string {
    return t('people.settings.fields-model.country', 'Country');
  },
  get currency(): string {
    return t('people.settings.fields-model.currency', 'Currency');
  },
  get language(): string {
    return t('people.settings.fields-model.language', 'Language');
  },
  get time_zone(): string {
    return t('people.settings.fields-model.time_zone', 'Time zone');
  },
  get address(): string {
    return t('people.settings.fields-model.postal_address', 'Postal address');
  },
  get national_id(): string {
    return t('people.settings.fields-model.national_identifier', 'National identifier');
  },
  get bank_account(): string {
    return t('people.settings.fields-model.bank_account', 'Bank account');
  },
  get person_ref(): string {
    return t('people.settings.fields-model.a_person', 'A person');
  },
  get org_unit_ref(): string {
    return t('people.settings.fields-model.a_team_or_department', 'A team or department');
  },
  get legal_entity_ref(): string {
    return t('people.settings.fields-model.a_legal_entity', 'A legal entity');
  },
  get location_ref(): string {
    return t('people.settings.fields-model.a_work_location', 'A work location');
  },
  get document_ref(): string {
    return t('people.settings.fields-model.a_document', 'A document');
  },
  get image(): string {
    return t('people.settings.fields-model.an_image', 'An image');
  },
  get signature(): string {
    return t('people.settings.fields-model.a_signature', 'A signature');
  },
};

export const DATA_TYPE_GROUPS: readonly { label: string; types: readonly string[] }[] = [
  {
    get label(): string {
      return t('people.settings.fields-model.text', 'Text');
    },
    types: ['text', 'long_text'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.choices', 'Choices');
    },
    types: ['select', 'multi_select', 'tags', 'boolean'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.numbers_and_money', 'Numbers and money');
    },
    types: ['number', 'decimal', 'percentage', 'money'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.dates_and_time', 'Dates and time');
    },
    types: ['date', 'datetime', 'duration'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.contact', 'Contact');
    },
    types: ['email', 'phone', 'url', 'address'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.standard_lists', 'Standard lists');
    },
    types: ['country', 'currency', 'language', 'time_zone'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.in_your_organisation', 'In your organisation');
    },
    types: ['person_ref', 'org_unit_ref', 'legal_entity_ref', 'location_ref'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.protected', 'Protected');
    },
    types: ['national_id', 'bank_account'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.files', 'Files');
    },
    types: ['document_ref', 'image'],
  },
  {
    get label(): string {
      return t('people.settings.fields-model.signing', 'Signing');
    },
    types: ['signature'],
  },
];

/** When a field is asked for, in the order a person meets each moment. */
export const COLLECT: readonly { value: CollectAt; label: string; description: string }[] = [
  {
    value: 'signup',
    get label(): string {
      return t('people.settings.fields-model.at_sign_up', 'At sign-up');
    },
    get description(): string {
      return t(
        'people.settings.fields-model.when_they_first_set_up_their',
        'When they first set up their account, before they create their passkey.',
      );
    },
  },
  {
    value: 'enrolment',
    get label(): string {
      return t(
        'people.settings.fields-model.when_they_accept_their_invitation',
        'When they accept their invitation',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.on_the_account_setup_page_before',
        'On the account setup page, before they can use Kithena.',
      );
    },
  },
  {
    value: 'onboarding',
    get label(): string {
      return t('people.settings.fields-model.during_onboarding', 'During onboarding');
    },
    get description(): string {
      return t(
        'people.settings.fields-model.in_the_new_starters_checklist_if',
        'In the new starter’s checklist. If required, missing from the day they are hired.',
      );
    },
  },
  {
    value: 'anytime',
    get label(): string {
      return t(
        'people.settings.fields-model.any_time_on_their_profile',
        'Any time, on their profile',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.nobody_is_chased_before_their_first',
        'Nobody is chased before their first day; if required, missing from their start date.',
      );
    },
  },
  {
    value: 'hr_only',
    get label(): string {
      return t('people.settings.fields-model.only_hr_fills_it_in', 'Only HR fills it in');
    },
    get description(): string {
      return t(
        'people.settings.fields-model.the_employee_never_sees_a_form',
        'The employee never sees a form for it. If required, HR sees it as missing.',
      );
    },
  },
];

export const CLASSIFICATION: readonly {
  value: Classification;
  label: string;
  description: string;
}[] = [
  {
    value: 'public',
    get label(): string {
      return t(
        'people.settings.fields-model.fine_for_everyone_at_the_company',
        'Fine for everyone at the company',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.could_appear_in_the_directory',
        'Could appear in the directory.',
      );
    },
  },
  {
    value: 'internal',
    get label(): string {
      return t(
        'people.settings.fields-model.ordinary_information_about_the_job',
        'Ordinary information about the job',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.nobody_would_mind_hr_and_managers',
        'Nobody would mind HR and managers seeing it.',
      );
    },
  },
  {
    value: 'confidential',
    get label(): string {
      return t(
        'people.settings.fields-model.would_harm_or_embarrass_someone_if',
        'Would harm or embarrass someone if it leaked',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.pay_home_address_performance_kept_out',
        'Pay, home address, performance. Kept out of logs and AI.',
      );
    },
  },
  {
    value: 'special-category',
    get label(): string {
      return t(
        'people.settings.fields-model.health_beliefs_ethnicity_or_similar',
        'Health, beliefs, ethnicity or similar',
      );
    },
    get description(): string {
      return t(
        'people.settings.fields-model.protected_by_law_never_sent_to',
        'Protected by law. Never sent to AI, never carried on an event, never exported without a reason.',
      );
    },
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
  {
    value: 'never',
    get label(): string {
      return t('people.settings.fields-model.optional', 'Optional');
    },
  },
  {
    value: 'always',
    get label(): string {
      return t('people.settings.fields-model.required', 'Required');
    },
  },
  {
    value: 'conditional',
    get label(): string {
      return t('people.settings.fields-model.required_sometimes', 'Required sometimes');
    },
  },
];

export const OPERAND_LABEL: Readonly<Record<ListOperand | 'attribute', string>> = {
  get legalEntity(): string {
    return t('people.settings.fields-model.legal_entity', 'Legal entity');
  },
  get country(): string {
    return t('people.settings.fields-model.country', 'Country');
  },
  get employmentType(): string {
    return t('people.settings.fields-model.employment_type', 'Employment type');
  },
  get workModel(): string {
    return t('people.settings.fields-model.work_model', 'Work model');
  },
  get status(): string {
    return t('people.settings.fields-model.status', 'Status');
  },
  get attribute(): string {
    return t('people.settings.fields-model.another_field', 'Another field');
  },
};

export const STATUS_VALUES: readonly Choice[] = [
  {
    value: 'provisional',
    get label(): string {
      return t('people.settings.fields-model.provisional', 'Provisional');
    },
  },
  {
    value: 'pre_hire',
    get label(): string {
      return t('people.settings.fields-model.pre_hire', 'Pre-hire');
    },
  },
  {
    value: 'active',
    get label(): string {
      return t('people.settings.fields-model.active', 'Active');
    },
  },
  {
    value: 'on_leave',
    get label(): string {
      return t('people.settings.fields-model.on_leave', 'On leave');
    },
  },
  {
    value: 'notice',
    get label(): string {
      return t('people.settings.fields-model.on_notice', 'On notice');
    },
  },
  {
    value: 'terminated',
    get label(): string {
      return t('people.settings.fields-model.left', 'Left');
    },
  },
  {
    value: 'discarded',
    get label(): string {
      return t('people.settings.fields-model.discarded', 'Discarded');
    },
  },
];

/** Who may see and change a field, one row per audience, the person outwards. */
export const AUDIENCES: readonly { id: ViewerScope; label: string; canChange: boolean }[] = [
  {
    id: 'self',
    get label(): string {
      return t('people.settings.fields-model.the_employee', 'The employee');
    },
    canChange: true,
  },
  {
    id: 'manager',
    get label(): string {
      return t('people.settings.fields-model.their_manager', 'Their manager');
    },
    canChange: true,
  },
  {
    id: 'manager_chain',
    get label(): string {
      return t('people.settings.fields-model.managers_above', 'Managers above');
    },
    canChange: false,
  },
  {
    id: 'hr',
    get label(): string {
      return t('people.settings.fields-model.hr', 'HR');
    },
    canChange: true,
  },
  {
    id: 'finance',
    get label(): string {
      return t('people.settings.fields-model.finance', 'Finance');
    },
    canChange: true,
  },
  {
    id: 'directory',
    get label(): string {
      return t('people.settings.fields-model.everyone', 'Everyone');
    },
    canChange: false,
  },
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

/**
 * The groups of the access table (design M4), from the person out to
 * Finance. Everyone at the company (the directory) is the switch above them.
 */
export const GROUPS: readonly {
  id: ViewerScope;
  label: string;
  description?: string;
  canChange: boolean;
}[] = [
  {
    id: 'self',
    get label(): string {
      return t('people.settings.fields-model.the_employee', 'The employee');
    },
    canChange: true,
  },
  {
    id: 'manager',
    get label(): string {
      return t('people.settings.fields-model.manager', 'Manager');
    },
    get description(): string {
      return t('people.settings.fields-model.their_direct_manager', 'Their direct manager');
    },
    canChange: true,
  },
  {
    id: 'manager_chain',
    get label(): string {
      return t('people.settings.fields-model.line_managers', 'Line managers');
    },
    get description(): string {
      return t('people.settings.fields-model.managers_above', 'Managers above');
    },
    canChange: false,
  },
  {
    id: 'hr',
    get label(): string {
      return t('people.settings.fields-model.hr', 'HR');
    },
    canChange: true,
  },
  {
    id: 'finance',
    get label(): string {
      return t('people.settings.fields-model.finance', 'Finance');
    },
    get description(): string {
      return t('people.settings.fields-model.for_payroll', 'For payroll');
    },
    canChange: true,
  },
];

/** Everyone at the company can see it: it shows in the directory. */
export const seenByEveryone = (visibility: readonly ViewerScope[]): boolean =>
  visibility.includes('directory');

/** The Everyone switch: the directory on or off, every other reader kept as ticked. */
export function withEveryone(on: boolean, visibility: readonly ViewerScope[]): ViewerScope[] {
  const rest = visibility.filter((s) => s !== 'directory');
  return on ? [...rest, 'directory'] : rest;
}

/** A field's readers and writers as the access table's value: group ids that see, and that change. */
export function accessOf(
  visibility: readonly ViewerScope[],
  ownership: readonly WriterRole[],
): { see: string[]; change: string[] } {
  return {
    see: visibility.filter((s) => GROUPS.some((g) => g.id === s)),
    change: GROUPS.flatMap((g) => {
      const writer = WRITER[g.id];
      return writer !== undefined && ownership.includes(writer) ? [g.id] : [];
    }),
  };
}

/** The table's value back as readers and writers; the directory, an administrator and a system keep what they had. */
export function fromAccess(
  value: { readonly see: readonly string[]; readonly change: readonly string[] },
  was: { visibility: readonly ViewerScope[]; ownership: readonly WriterRole[] },
): { visibility: ViewerScope[]; ownership: WriterRole[] } {
  const seen = new Set([...value.see, ...value.change]);
  return {
    visibility: [
      ...GROUPS.map((g) => g.id).filter((id) => seen.has(id)),
      ...was.visibility.filter((s) => s === 'admin' || s === 'directory'),
    ],
    ownership: [
      ...GROUPS.flatMap((g) => {
        const writer = WRITER[g.id];
        return writer !== undefined && value.change.includes(g.id) ? [writer] : [];
      }),
      ...was.ownership.filter((w) => w === 'system' || w === 'external'),
    ],
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
  if (predicate.clauses.length === 0)
    return t(
      'people.settings.fields-model.add_at_least_one_condition',
      'Add at least one condition.',
    );
  for (const clause of predicate.clauses) {
    if (clause.operand !== 'attribute') {
      if (clause.in.length === 0)
        return t(
          'people.settings.fields-model.every_condition_needs_at_least_one',
          'Every condition needs at least one value.',
        );
    } else if (clause.key === '') {
      return t(
        'people.settings.fields-model.choose_the_field_a_condition_reads',
        'Choose the field a condition reads.',
      );
    } else if (clause.is === 'equals' && (clause.equals ?? '').trim() === '') {
      return t(
        'people.settings.fields-model.say_what_the_field_has_to',
        'Say what the field has to equal.',
      );
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
  /** A date that may instead be indefinite: a permanent contract's end. */
  openEnded: boolean;
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
      openEnded: field.openEnded === true,
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
    openEnded: false,
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
export const PARTS = () =>
  [
    t('people.settings.fields-model.the_field', 'The field'),
    t('people.settings.fields-model.access', 'Access'),
    t('people.settings.fields-model.when_its_asked', 'When it’s asked'),
    t('people.settings.fields-model.sensitivity', 'Sensitivity'),
    t('people.settings.fields-model.review', 'Review'),
  ] as const;

export function problemsIn(
  part: number,
  draft: Draft,
  keyTaken: (key: string) => boolean,
  others: readonly { key: string; label: string; classification: Classification }[],
): Record<string, string> {
  const problems: Record<string, string> = {};
  if (part === 0) {
    if (draft.label.trim() === '')
      problems['label'] = t(
        'people.settings.fields-model.give_the_field_a_name',
        'Give the field a name.',
      );
    if (draft.dataType === 'money' && draft.currency !== '' && !/^[A-Z]{3}$/.test(draft.currency)) {
      problems['currency'] = t(
        'people.settings.fields-model.a_three_letter_currency_code_like',
        'A three-letter currency code, like EUR.',
      );
    }
    if (!KEY.test(draft.key)) {
      problems['key'] = t(
        'people.settings.fields-model.lower_case_letters_digits_and_underscores',
        'Lower-case letters, digits and underscores, starting with a letter.',
      );
    } else if (keyTaken(draft.key)) {
      problems['key'] = t(
        'people.settings.fields-model.another_field_already_uses_this_key',
        'Another field already uses this key.',
      );
    }
    if (WITH_OPTIONS.has(draft.dataType) && draft.options.length === 0) {
      problems['options'] = t(
        'people.settings.fields-model.add_at_least_one_option',
        'Add at least one option.',
      );
    }
  }
  if (part === 1) {
    if (draft.ownership.length === 0)
      problems['ownership'] = t(
        'people.settings.fields-model.somebody_has_to_be_able_to',
        'Somebody has to be able to change it.',
      );
    if (
      draft.visibility.length === 0 &&
      (draft.visibilityRules.length === 0 || draft.requiredness !== 'never')
    ) {
      problems['visibility'] = t(
        'people.settings.fields-model.nobody_could_ever_read_it_choose',
        'Nobody could ever read it. Choose at least one.',
      );
    }
    for (const rule of draft.visibilityRules) {
      const problem =
        rule.scopes.length === 0
          ? t(
              'people.settings.fields-model.every_rule_shows_the_field_to',
              'Every rule shows the field to somebody.',
            )
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
      problems['unseen'] = t(
        'people.settings.fields-model.a_required_field_needs_somebody_who',
        'A required field needs somebody who can always see it. Choose who under Access.',
      );
    }
  }
  if (part === 3) {
    if (draft.classification === null)
      problems['kind'] = t(
        'people.settings.fields-model.choose_what_kind_of_data_this',
        'Choose what kind of data this is.',
      );
    else if (draft.classification === 'special-category' && !draft.confirmedSpecial) {
      problems['kind'] = t(
        'people.settings.fields-model.special_category_data_needs_your_explicit',
        'Special-category data needs your explicit confirmation.',
      );
    } else if (draft.classification === 'special-category' && draft.visibilityRules.length > 0) {
      problems['kind'] = t(
        'people.settings.fields-model.special_category_data_is_never_shown',
        'Special-category data is never shown by a rule. Remove the rules under Access.',
      );
    }
  }
  return problems;
}

/** The type or a format setting of a published field changed: its values are reviewed before publishing. */
export const reformatted = (field: RegistryField, draft: Draft): boolean =>
  draft.dataType !== field.dataType ||
  field.options.some((o) => !draft.options.includes(o)) ||
  (WITH_DECIMALS.has(draft.dataType) && (draft.decimals ?? 0) !== (field.decimals ?? 0)) ||
  (draft.dataType === 'money' && draft.currency !== (field.currency ?? '')) ||
  // Taking "indefinite" away may leave an indefinite value that no longer fits.
  (field.openEnded === true && !draft.openEnded);
