import type {
  Choice,
  Classification,
  CollectAt,
  DataType,
  ListOperand,
  RequirednessMode,
  ViewerScope,
  WriterRole,
} from './model';
import { t } from '../i18n';
import { formatList } from '@reach/ui';

/** How each term reads to an HR administrator, not to the schema. */

export const DATA_TYPE_LABEL: Record<DataType, string> = {
  text: t('settings.words.short_text', 'Short text'),
  long_text: t('settings.words.long_text', 'Long text'),
  number: t('settings.words.whole_number', 'Whole number'),
  decimal: t('settings.words.decimal', 'Decimal'),
  percentage: t('settings.words.percentage', 'Percentage'),
  money: t('settings.words.money', 'Money'),
  boolean: t('settings.words.yes_or_no', 'Yes or no'),
  date: t('settings.words.date', 'Date'),
  datetime: t('settings.words.date_and_time', 'Date and time'),
  duration: t('settings.words.duration', 'Duration'),
  select: t('settings.words.one_of_a_list', 'One of a list'),
  multi_select: t('settings.words.several_of_a_list', 'Several of a list'),
  tags: t('settings.words.tags', 'Tags'),
  email: t('settings.words.email_address', 'Email address'),
  phone: t('settings.words.phone_number', 'Phone number'),
  url: t('settings.words.web_address', 'Web address'),
  country: t('settings.words.country', 'Country'),
  currency: 'Currency',
  language: t('settings.words.language', 'Language'),
  time_zone: t('settings.words.time_zone', 'Time zone'),
  address: t('settings.words.postal_address', 'Postal address'),
  national_id: t('settings.words.national_identifier', 'National identifier'),
  bank_account: t('settings.words.bank_account', 'Bank account'),
  person_ref: t('settings.words.a_person', 'A person'),
  org_unit_ref: t('settings.words.a_team_or_department', 'A team or department'),
  legal_entity_ref: t('settings.words.a_legal_entity', 'A legal entity'),
  location_ref: t('settings.words.a_work_location', 'A work location'),
  document_ref: t('settings.words.a_document', 'A document'),
  image: t('settings.words.an_image', 'An image'),
  signature: t('settings.words.a_signature', 'A signature'),
};

/** What each type holds, in one line with an example. */
export const DATA_TYPE_HINT: Record<DataType, string> = {
  text: t(
    'settings.words.a_word_or_a_short_line',
    'A word or a short line. A nickname, a badge number.',
  ),
  long_text: t(
    'settings.words.a_paragraph_or_more_notes_a',
    'A paragraph or more. Notes, a short biography.',
  ),
  number: t(
    'settings.words.a_count_with_no_decimals_number',
    'A count with no decimals. Number of dependants.',
  ),
  decimal: t(
    'settings.words.a_number_that_may_have_decimals',
    'A number that may have decimals. Weekly hours, 37.5.',
  ),
  percentage: t(
    'settings.words.a_share_out_of_100_time',
    'A share out of 100. Time on a project, 40%.',
  ),
  money: t(
    'settings.words.an_amount_in_a_currency_stored',
    'An amount in a currency, stored exactly. A signing bonus.',
  ),
  boolean: t(
    'settings.words.a_switch_that_is_on_or',
    'A switch that is on or off. Has a company car.',
  ),
  date: t(
    'settings.words.a_calendar_day_with_no_time',
    'A calendar day with no time. Visa expiry.',
  ),
  datetime: t(
    'settings.words.a_day_and_a_time_when',
    'A day and a time. When the badge was issued.',
  ),
  duration: t(
    'settings.words.a_length_of_time_a_notice',
    'A length of time. A notice period of 3 months.',
  ),
  select: t(
    'settings.words.exactly_one_of_the_options_you',
    'Exactly one of the options you list. T-shirt size.',
  ),
  multi_select: t(
    'settings.words.any_number_of_the_options_you',
    'Any number of the options you list. Languages spoken at work.',
  ),
  tags: t(
    'settings.words.free_words_people_type_themselves_skills',
    'Free words people type themselves. Skills.',
  ),
  email: t(
    'settings.words.an_email_address_checked_as_one',
    'An email address, checked as one. A personal email.',
  ),
  phone: t(
    'settings.words.a_phone_number_with_its_country',
    'A phone number with its country code. An emergency contact’s phone.',
  ),
  url: t(
    'settings.words.a_web_link_a_portfolio_or_linkedin',
    'A web link. A portfolio or LinkedIn page.',
  ),
  country: t(
    'settings.words.a_country_from_the_standard_list_nationality',
    'A country from the standard list. Nationality.',
  ),
  currency: 'A currency from the standard list. Currency they are paid in.',
  language: t(
    'settings.words.a_language_from_the_standard_list_preferred',
    'A language from the standard list. Preferred language.',
  ),
  time_zone: t(
    'settings.words.a_time_zone_from_the_standard',
    'A time zone from the standard list. Where they usually work from.',
  ),
  address: t(
    'settings.words.a_postal_address_over_several_lines',
    'A postal address over several lines. A home address.',
  ),
  national_id: t(
    'settings.words.an_identity_number_stored_encrypted_screens_show',
    'An identity number. Stored encrypted; screens show only its last characters.',
  ),
  bank_account: t(
    'settings.words.an_iban_or_account_number_stored_encrypted',
    'An IBAN or account number. Stored encrypted; screens show only its last characters.',
  ),
  person_ref: t(
    'settings.words.somebody_else_in_kithena_a_buddy',
    'Somebody else in Kithena. A buddy or a mentor.',
  ),
  org_unit_ref: t(
    'settings.words.a_team_or_department_in_your',
    'A team or department in your organisation.',
  ),
  legal_entity_ref: t('settings.words.one_of_your_legal_entities', 'One of your legal entities.'),
  location_ref: t('settings.words.one_of_your_work_locations', 'One of your work locations.'),
  document_ref: t(
    'settings.words.a_pdf_or_a_scan_uploaded',
    'A PDF or a scan, uploaded: a signed contract, a certificate.',
  ),
  image: t(
    'settings.words.a_picture_uploaded_a_png_or',
    'A picture, uploaded: a PNG or a JPEG, shown on the profile.',
  ),
  signature: t(
    'settings.words.their_own_signature_typed_in_a',
    'Their own signature, typed in a handwriting style or drawn. Documents uses it wherever they sign.',
  ),
};

/** The type picker's groups, so 30 types read as nine short lists. */
export const DATA_TYPE_GROUPS: readonly { label: string; types: readonly DataType[] }[] = [
  { label: t('settings.words.text', 'Text'), types: ['text', 'long_text'] },
  {
    label: t('settings.words.choices', 'Choices'),
    types: ['select', 'multi_select', 'tags', 'boolean'],
  },
  {
    label: t('settings.words.numbers_and_money', 'Numbers and money'),
    types: ['number', 'decimal', 'percentage', 'money'],
  },
  {
    label: t('settings.words.dates_and_time', 'Dates and time'),
    types: ['date', 'datetime', 'duration'],
  },
  { label: t('settings.words.contact', 'Contact'), types: ['email', 'phone', 'url', 'address'] },
  {
    label: t('settings.words.standard_lists', 'Standard lists'),
    types: ['country', 'currency', 'language', 'time_zone'],
  },
  {
    label: t('settings.words.in_your_organisation', 'In your organisation'),
    types: ['person_ref', 'org_unit_ref', 'legal_entity_ref', 'location_ref'],
  },
  { label: t('settings.words.protected', 'Protected'), types: ['national_id', 'bank_account'] },
  { label: t('settings.words.files', 'Files'), types: ['document_ref', 'image'] },
  { label: t('settings.words.signing', 'Signing'), types: ['signature'] },
];

export const WRITER_LABEL: Record<WriterRole, string> = {
  employee: t('settings.words.the_employee', 'The employee'),
  manager: t('settings.words.their_manager', 'Their manager'),
  hr: 'HR',
  finance: t('settings.words.finance', 'Finance'),
  system: t('settings.words.a_connected_system', 'A connected system'),
  external: t('settings.words.an_external_hr_system', 'An external HR system'),
};

export const SCOPE_LABEL: Record<ViewerScope, string> = {
  self: t('settings.words.the_employee', 'The employee'),
  manager: t('settings.words.their_manager', 'Their manager'),
  manager_chain: t('settings.words.managers_above_them', 'Managers above them'),
  hr: 'HR',
  finance: t('settings.words.finance', 'Finance'),
  admin: t('settings.words.administrators', 'Administrators'),
  directory: t('settings.words.everyone_in_the_directory', 'Everyone, in the directory'),
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

export const COLLECT_LABEL: Record<
  CollectAt,
  { label: string; short: string; when: string; description: string; example: string }
> = {
  signup: {
    label: t('settings.words.at_sign_up', 'At sign-up'),
    short: t('settings.words.at_sign_up', 'At sign-up'),
    when: t('settings.words.when_they_first_set_up_their', 'when they first set up their account'),
    description: t(
      'settings.words.asked_when_the_person_first_sets',
      'Asked when the person first sets up their account (and when they recover it, if it is still missing), before they create their passkey.',
    ),
    example: t('settings.words.suits_preferred_name_pronouns', 'Suits: preferred name, pronouns.'),
  },
  enrolment: {
    label: t(
      'settings.words.when_they_accept_their_invitation',
      'When they accept their invitation',
    ),
    short: t('settings.words.on_invitation', 'On invitation'),
    when: t(
      'settings.words.when_they_accept_their_invitation_2',
      'when they accept their invitation',
    ),
    description: t(
      'settings.words.asked_on_the_account_setup_page',
      'Asked on the account setup page when somebody HR invited follows their invitation link, before they can use Kithena.',
    ),
    example: t(
      'settings.words.suits_a_personal_email_a_preferred',
      'Suits: a personal email, a preferred language.',
    ),
  },
  onboarding: {
    label: t('settings.words.during_onboarding', 'During onboarding'),
    short: t('settings.words.onboarding', 'Onboarding'),
    when: t('settings.words.during_onboarding_2', 'during onboarding'),
    description: t(
      'settings.words.asked_in_the_checklist_a_new',
      'Asked in the checklist a new starter works through after first signing in, one section at a time. If required, it counts as missing from the day they are hired.',
    ),
    example: t(
      'settings.words.suits_emergency_contact_t_shirt_size',
      'Suits: emergency contact, T-shirt size, bank details.',
    ),
  },
  anytime: {
    label: t('settings.words.any_time_on_their_profile', 'Any time, on their profile'),
    short: t('settings.words.any_time', 'Any time'),
    when: t(
      'settings.words.on_their_profile_whenever_it_changes',
      'on their profile, whenever it changes',
    ),
    description: t(
      'settings.words.nobody_is_chased_before_first_day',
      'Nobody is chased for it before their first day. It sits on their profile to fill in or update whenever it changes; if required, it counts as missing from their start date.',
    ),
    example: t(
      'settings.words.suits_a_home_address_after_a',
      'Suits: a home address after a move, a second phone number.',
    ),
  },
  hr_only: {
    label: t('settings.words.only_hr_fills_it_in', 'Only HR fills it in'),
    short: t('settings.words.hr_only', 'HR only'),
    when: '',
    description: t(
      'settings.words.the_employee_never_sees_a_form',
      'The employee never sees a form for it: not in onboarding and not on their own profile. If required, HR sees it as missing from the start date.',
    ),
    example: t(
      'settings.words.suits_laptop_serial_number_cost_centre',
      'Suits: laptop serial number, cost centre, internal grade.',
    ),
  },
};

export const CLASSIFICATION_LABEL: Record<Classification, { label: string; description: string }> =
  {
    public: {
      label: t(
        'settings.words.fine_for_everyone_at_the_company',
        'Fine for everyone at the company',
      ),
      description: t(
        'settings.words.could_appear_in_the_directory_a_job',
        'Could appear in the directory. A job title, a work phone.',
      ),
    },
    internal: {
      label: t(
        'settings.words.ordinary_information_about_the_job',
        'Ordinary information about the job',
      ),
      description: t(
        'settings.words.business_data_nobody_would_mind_hr_and',
        'Business data nobody would mind HR and managers seeing.',
      ),
    },
    confidential: {
      label: t(
        'settings.words.would_harm_or_embarrass_someone_if_it',
        'Would harm or embarrass someone if it leaked',
      ),
      description: t(
        'settings.words.pay_home_address_performance_kept_out_of',
        'Pay, home address, performance. Kept out of logs and AI.',
      ),
    },
    'special-category': {
      label: t(
        'settings.words.health_beliefs_ethnicity_or_similar',
        'Health, beliefs, ethnicity or similar',
      ),
      description: t(
        'settings.words.protected_by_law_gdpr_article_9_never',
        'Protected by law (GDPR Article 9). Never sent to AI, never carried on an event, never exported without a reason.',
      ),
    },
  };

export const REQUIREDNESS_LABEL: Record<RequirednessMode, string> = {
  always: t('settings.words.required', 'Required'),
  conditional: t('settings.words.required_sometimes', 'Required sometimes'),
  never: t('settings.words.optional', 'Optional'),
};

/** A predicate's facts, as a condition reads them (PEO-065). */
export const OPERAND_LABEL: Record<ListOperand | 'attribute', string> = {
  legalEntity: t('settings.words.legal_entity', 'Legal entity'),
  country: t('settings.words.country', 'Country'),
  employmentType: t('settings.words.employment_type', 'Employment type'),
  workModel: t('settings.words.work_model', 'Work model'),
  status: 'Status',
  attribute: t('settings.words.another_field', 'Another field'),
};

/**
 * The values status can hold, mirrored from the contract. Employment type and
 * work model are the company's own lists, from the registry's `choices`.
 */
export const FACT_VALUES: Record<'status', readonly Choice[]> = {
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
  return formatList(items);
}
