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

export const COLLECT_LABEL: Record<CollectAt, { label: string; description: string }> = {
  signup: {
    label: 'At sign-up',
    description: 'Before the person has an account. Nothing confidential.',
  },
  enrolment: {
    label: 'When they set up their account',
    description: 'On the sign-in page, alongside their name.',
  },
  onboarding: {
    label: 'During onboarding',
    description: 'In the sections a new starter works through after first sign-in.',
  },
  hr_only: { label: 'Only HR fills it in', description: 'The employee never sees a form for it.' },
  anytime: { label: 'Any time', description: 'On the profile, whenever it changes.' },
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

/** "HR, the employee and their manager": a list the way a sentence says it. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
