import type {
  Choice,
  Classification,
  CollectAt,
  DataType,
  ListOperand,
  PiiKind,
  RequirednessMode,
  ViewerScope,
  WriterRole,
} from './model';

/** How each term reads to an HR administrator, not to the schema. */

export const DATA_TYPE_LABEL: Record<DataType, string> = {
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

/** What each type holds, in one line with an example. */
export const DATA_TYPE_HINT: Record<DataType, string> = {
  text: 'A word or a short line. A nickname, a badge number.',
  long_text: 'A paragraph or more. Notes, a short biography.',
  number: 'A count with no decimals. Number of dependants.',
  decimal: 'A number that may have decimals. Weekly hours, 37.5.',
  percentage: 'A share out of 100. Time on a project, 40%.',
  money: 'An amount in a currency, stored exactly. A signing bonus.',
  boolean: 'A switch that is on or off. Has a company car.',
  date: 'A calendar day with no time. Visa expiry.',
  datetime: 'A day and a time. When the badge was issued.',
  duration: 'A length of time. A notice period of 3 months.',
  select: 'Exactly one of the options you list. T-shirt size.',
  multi_select: 'Any number of the options you list. Languages spoken at work.',
  tags: 'Free words people type themselves. Skills.',
  email: 'An email address, checked as one. A personal email.',
  phone: 'A phone number with its country code. An emergency contact’s phone.',
  url: 'A web link. A portfolio or LinkedIn page.',
  country: 'A country from the standard list. Nationality.',
  currency: 'A currency from the standard list. Currency they are paid in.',
  language: 'A language from the standard list. Preferred language.',
  time_zone: 'A time zone from the standard list. Where they usually work from.',
  address: 'A postal address over several lines. A home address.',
  national_id: 'An identity number. Stored encrypted; screens show only its last characters.',
  bank_account:
    'An IBAN or account number. Stored encrypted; screens show only its last characters.',
  person_ref: 'Somebody else in Kithena. A buddy or a mentor.',
  org_unit_ref: 'A team or department in your organisation.',
  legal_entity_ref: 'One of your legal entities.',
  location_ref: 'One of your work locations.',
  document_ref: 'A file, uploaded on the profile. A signed contract.',
  image: 'A picture, uploaded on the profile.',
};

/** The type picker's groups, so 29 types read as eight short lists. */
export const DATA_TYPE_GROUPS: readonly { label: string; types: readonly DataType[] }[] = [
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

export const WRITER_LABEL: Record<WriterRole, string> = {
  employee: 'The employee',
  manager: 'Their manager',
  hr: 'HR',
  finance: 'Finance',
  system: 'A connected system',
  external: 'An external HR system',
};

export const SCOPE_LABEL: Record<ViewerScope, string> = {
  self: 'The employee',
  manager: 'Their manager',
  manager_chain: 'Managers above them',
  hr: 'HR',
  finance: 'Finance',
  admin: 'Administrators',
  directory: 'Everyone, in the directory',
};

/**
 * When a field is asked for, as each moment really behaves.
 *
 * Every stage but `hr_only` also appears in the new starter's onboarding
 * (`onboardingView` shows everything not `hr_only`), and every stage but
 * `hr_only` is on their own profile. What differs is when a missing value
 * starts to count: `signup`, `enrolment` and `onboarding` count from the day
 * somebody is hired, before their first day; `anytime` and `hr_only` from the
 * start date (`completeness.ts`, `BEFORE_START`).
 */
/** A line under each "who can change it" choice. */
export const WRITER_HINT: Partial<Record<WriterRole, string>> = {
  employee: 'They fill it in and correct it themselves.',
  manager: 'Their direct manager can change it.',
  hr: 'Anyone in your HR team can change it.',
  finance: 'Your finance team can change it, for payroll.',
};

/** A line under each "who can see it" choice. */
export const SCOPE_HINT: Record<ViewerScope, string> = {
  self: 'The person the record is about.',
  manager: 'Their direct manager.',
  manager_chain: 'Every manager above them, up to the top.',
  hr: 'Your HR team.',
  finance: 'Your finance team, for payroll.',
  admin: 'People administrators.',
  directory: 'Anybody at the company, in the people directory.',
};

export const COLLECT_LABEL: Record<
  CollectAt,
  { label: string; short: string; when: string; description: string; example: string }
> = {
  signup: {
    label: 'At sign-up',
    short: 'At sign-up',
    when: 'when they first set up their account',
    description:
      'Asked when the person first sets up their account (and when they recover it, if it is still missing), before they create their passkey.',
    example: 'Suits: preferred name, pronouns.',
  },
  enrolment: {
    label: 'When they accept their invitation',
    short: 'On invitation',
    when: 'when they accept their invitation',
    description:
      'Asked on the account setup page when somebody HR invited follows their invitation link, before they can use Kithena.',
    example: 'Suits: a personal email, a preferred language.',
  },
  onboarding: {
    label: 'During onboarding',
    short: 'Onboarding',
    when: 'during onboarding',
    description:
      'Asked in the checklist a new starter works through after first signing in, one section at a time. If required, it counts as missing from the day they are hired.',
    example: 'Suits: emergency contact, T-shirt size, bank details.',
  },
  anytime: {
    label: 'Any time, on their profile',
    short: 'Any time',
    when: 'on their profile, whenever it changes',
    description:
      'Nobody is chased for it before their first day. It sits on their profile to fill in or update whenever it changes; if required, it counts as missing from their start date.',
    example: 'Suits: a home address after a move, a second phone number.',
  },
  hr_only: {
    label: 'Only HR fills it in',
    short: 'HR only',
    when: '',
    description:
      'The employee never sees a form for it: not in onboarding and not on their own profile. If required, HR sees it as missing from the start date.',
    example: 'Suits: laptop serial number, cost centre, internal grade.',
  },
};

export const CLASSIFICATION_LABEL: Record<Classification, { label: string; description: string }> =
  {
    public: {
      label: 'Fine for everyone at the company',
      description: 'Could appear in the directory. A job title, a work phone.',
    },
    internal: {
      label: 'Ordinary information about the job',
      description: 'Business data nobody would mind HR and managers seeing.',
    },
    confidential: {
      label: 'Would harm or embarrass someone if it leaked',
      description: 'Pay, home address, performance. Kept out of logs and AI.',
    },
    'special-category': {
      label: 'Health, beliefs, ethnicity or similar',
      description:
        'Protected by law (GDPR Article 9). Never sent to AI, never carried on an event, never exported without a reason.',
    },
  };

export const PII_LABEL: Record<PiiKind, string> = {
  identity: 'Who someone is',
  financial: 'Money or bank details',
  contact: 'How to reach someone',
  health: 'Health',
  biometric: 'Biometric',
  none: 'Not personal data',
};

export const REQUIREDNESS_LABEL: Record<RequirednessMode, string> = {
  always: 'Required',
  conditional: 'Required sometimes',
  never: 'Optional',
};

/** A predicate's facts, as a condition reads them (PEO-065). */
export const OPERAND_LABEL: Record<ListOperand | 'attribute', string> = {
  legalEntity: 'Legal entity',
  country: 'Country',
  employmentType: 'Employment type',
  workModel: 'Work model',
  status: 'Status',
  attribute: 'Another field',
};

/** The values the three enumerated facts can hold, mirrored from the contract. */
export const FACT_VALUES: Record<'employmentType' | 'workModel' | 'status', readonly Choice[]> = {
  employmentType: [
    { value: 'permanent', label: 'Permanent' },
    { value: 'fixed_term', label: 'Fixed term' },
    { value: 'contractor', label: 'Contractor' },
    { value: 'intern', label: 'Intern' },
    { value: 'apprentice', label: 'Apprentice' },
    { value: 'seasonal', label: 'Seasonal' },
  ],
  workModel: [
    { value: 'onsite', label: 'On site' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'remote', label: 'Remote' },
  ],
  status: [
    { value: 'provisional', label: 'Provisional' },
    { value: 'pre_hire', label: 'Pre-hire' },
    { value: 'active', label: 'Active' },
    { value: 'on_leave', label: 'On leave' },
    { value: 'notice', label: 'On notice' },
    { value: 'terminated', label: 'Left' },
    { value: 'discarded', label: 'Discarded' },
  ],
};

/** `hire_date` from "Hire date". Chosen once; the admin can edit it before saving. */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

/** "the employee", "their manager": a name as the middle of a sentence says it. */
export function inSentence(name: string): string {
  return name.replace(/^(The|Their|Managers|Everyone|Administrators)\b/, (m) => m.toLowerCase());
}

/** "HR, the employee and their manager": a list the way a sentence says it. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
