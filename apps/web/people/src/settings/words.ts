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
  get text(): string {
    return t('settings.words.short_text', 'Short text');
  },
  get long_text(): string {
    return t('settings.words.long_text', 'Long text');
  },
  get number(): string {
    return t('settings.words.whole_number', 'Whole number');
  },
  get decimal(): string {
    return t('settings.words.decimal', 'Decimal');
  },
  get percentage(): string {
    return t('settings.words.percentage', 'Percentage');
  },
  get money(): string {
    return t('settings.words.money', 'Money');
  },
  get boolean(): string {
    return t('settings.words.yes_or_no', 'Yes or no');
  },
  get date(): string {
    return t('settings.words.date', 'Date');
  },
  get datetime(): string {
    return t('settings.words.date_and_time', 'Date and time');
  },
  get duration(): string {
    return t('settings.words.duration', 'Duration');
  },
  get select(): string {
    return t('settings.words.one_of_a_list', 'One of a list');
  },
  get multi_select(): string {
    return t('settings.words.several_of_a_list', 'Several of a list');
  },
  get tags(): string {
    return t('settings.words.tags', 'Tags');
  },
  get email(): string {
    return t('settings.words.email_address', 'Email address');
  },
  get phone(): string {
    return t('settings.words.phone_number', 'Phone number');
  },
  get url(): string {
    return t('settings.words.web_address', 'Web address');
  },
  get country(): string {
    return t('settings.words.country', 'Country');
  },
  get currency(): string {
    return t('settings.words.currency', 'Currency');
  },
  get language(): string {
    return t('settings.words.language', 'Language');
  },
  get time_zone(): string {
    return t('settings.words.time_zone', 'Time zone');
  },
  get address(): string {
    return t('settings.words.postal_address', 'Postal address');
  },
  get national_id(): string {
    return t('settings.words.national_identifier', 'National identifier');
  },
  get bank_account(): string {
    return t('settings.words.bank_account', 'Bank account');
  },
  get person_ref(): string {
    return t('settings.words.a_person', 'A person');
  },
  get org_unit_ref(): string {
    return t('settings.words.a_team_or_department', 'A team or department');
  },
  get legal_entity_ref(): string {
    return t('settings.words.a_legal_entity', 'A legal entity');
  },
  get location_ref(): string {
    return t('settings.words.a_work_location', 'A work location');
  },
  get document_ref(): string {
    return t('settings.words.a_document', 'A document');
  },
  get image(): string {
    return t('settings.words.an_image', 'An image');
  },
  get signature(): string {
    return t('settings.words.a_signature', 'A signature');
  },
};

/** What each type holds, in one line with an example. */
export const DATA_TYPE_HINT: Record<DataType, string> = {
  get text(): string {
    return t(
      'settings.words.a_word_or_a_short_line',
      'A word or a short line. A nickname, a badge number.',
    );
  },
  get long_text(): string {
    return t(
      'settings.words.a_paragraph_or_more_notes_a',
      'A paragraph or more. Notes, a short biography.',
    );
  },
  get number(): string {
    return t(
      'settings.words.a_count_with_no_decimals_number',
      'A count with no decimals. Number of dependants.',
    );
  },
  get decimal(): string {
    return t(
      'settings.words.a_number_that_may_have_decimals',
      'A number that may have decimals. Weekly hours, 37.5.',
    );
  },
  get percentage(): string {
    return t(
      'settings.words.a_share_out_of_100_time',
      'A share out of 100. Time on a project, 40%.',
    );
  },
  get money(): string {
    return t(
      'settings.words.an_amount_in_a_currency_stored',
      'An amount in a currency, stored exactly. A signing bonus.',
    );
  },
  get boolean(): string {
    return t(
      'settings.words.a_switch_that_is_on_or',
      'A switch that is on or off. Has a company car.',
    );
  },
  get date(): string {
    return t(
      'settings.words.a_calendar_day_with_no_time',
      'A calendar day with no time. Visa expiry.',
    );
  },
  get datetime(): string {
    return t(
      'settings.words.a_day_and_a_time_when',
      'A day and a time. When the badge was issued.',
    );
  },
  get duration(): string {
    return t(
      'settings.words.a_length_of_time_a_notice',
      'A length of time. A notice period of 3 months.',
    );
  },
  get select(): string {
    return t(
      'settings.words.exactly_one_of_the_options_you',
      'Exactly one of the options you list. T-shirt size.',
    );
  },
  get multi_select(): string {
    return t(
      'settings.words.any_number_of_the_options_you',
      'Any number of the options you list. Languages spoken at work.',
    );
  },
  get tags(): string {
    return t(
      'settings.words.free_words_people_type_themselves_skills',
      'Free words people type themselves. Skills.',
    );
  },
  get email(): string {
    return t(
      'settings.words.an_email_address_checked_as_one',
      'An email address, checked as one. A personal email.',
    );
  },
  get phone(): string {
    return t(
      'settings.words.a_phone_number_with_its_country',
      'A phone number with its country code. An emergency contact’s phone.',
    );
  },
  get url(): string {
    return t(
      'settings.words.a_web_link_a_portfolio_or_linkedin',
      'A web link. A portfolio or LinkedIn page.',
    );
  },
  get country(): string {
    return t(
      'settings.words.a_country_from_the_standard_list_nationality',
      'A country from the standard list. Nationality.',
    );
  },
  get currency(): string {
    return t(
      'settings.words.a_currency_from_the_standard_list',
      'A currency from the standard list. Currency they are paid in.',
    );
  },
  get language(): string {
    return t(
      'settings.words.a_language_from_the_standard_list_preferred',
      'A language from the standard list. Preferred language.',
    );
  },
  get time_zone(): string {
    return t(
      'settings.words.a_time_zone_from_the_standard',
      'A time zone from the standard list. Where they usually work from.',
    );
  },
  get address(): string {
    return t(
      'settings.words.a_postal_address_over_several_lines',
      'A postal address over several lines. A home address.',
    );
  },
  get national_id(): string {
    return t(
      'settings.words.an_identity_number_stored_encrypted_screens_show',
      'An identity number. Stored encrypted; screens show only its last characters.',
    );
  },
  get bank_account(): string {
    return t(
      'settings.words.an_iban_or_account_number_stored_encrypted',
      'An IBAN or account number. Stored encrypted; screens show only its last characters.',
    );
  },
  get person_ref(): string {
    return t(
      'settings.words.somebody_else_in_kithena_a_buddy',
      'Somebody else in Kithena. A buddy or a mentor.',
    );
  },
  get org_unit_ref(): string {
    return t(
      'settings.words.a_team_or_department_in_your',
      'A team or department in your organisation.',
    );
  },
  get legal_entity_ref(): string {
    return t('settings.words.one_of_your_legal_entities', 'One of your legal entities.');
  },
  get location_ref(): string {
    return t('settings.words.one_of_your_work_locations', 'One of your work locations.');
  },
  get document_ref(): string {
    return t(
      'settings.words.a_pdf_or_a_scan_uploaded',
      'A PDF or a scan, uploaded: a signed contract, a certificate.',
    );
  },
  get image(): string {
    return t(
      'settings.words.a_picture_uploaded_a_png_or',
      'A picture, uploaded: a PNG or a JPEG, shown on the profile.',
    );
  },
  get signature(): string {
    return t(
      'settings.words.their_own_signature_typed_in_a',
      'Their own signature, typed in a handwriting style or drawn. Documents uses it wherever they sign.',
    );
  },
};

/** The type picker's groups, so 30 types read as nine short lists. */
export const DATA_TYPE_GROUPS: readonly { label: string; types: readonly DataType[] }[] = [
  {
    get label(): string {
      return t('settings.words.text', 'Text');
    },
    types: ['text', 'long_text'],
  },
  {
    get label(): string {
      return t('settings.words.choices', 'Choices');
    },
    types: ['select', 'multi_select', 'tags', 'boolean'],
  },
  {
    get label(): string {
      return t('settings.words.numbers_and_money', 'Numbers and money');
    },
    types: ['number', 'decimal', 'percentage', 'money'],
  },
  {
    get label(): string {
      return t('settings.words.dates_and_time', 'Dates and time');
    },
    types: ['date', 'datetime', 'duration'],
  },
  {
    get label(): string {
      return t('settings.words.contact', 'Contact');
    },
    types: ['email', 'phone', 'url', 'address'],
  },
  {
    get label(): string {
      return t('settings.words.standard_lists', 'Standard lists');
    },
    types: ['country', 'currency', 'language', 'time_zone'],
  },
  {
    get label(): string {
      return t('settings.words.in_your_organisation', 'In your organisation');
    },
    types: ['person_ref', 'org_unit_ref', 'legal_entity_ref', 'location_ref'],
  },
  {
    get label(): string {
      return t('settings.words.protected', 'Protected');
    },
    types: ['national_id', 'bank_account'],
  },
  {
    get label(): string {
      return t('settings.words.files', 'Files');
    },
    types: ['document_ref', 'image'],
  },
  {
    get label(): string {
      return t('settings.words.signing', 'Signing');
    },
    types: ['signature'],
  },
];

export const WRITER_LABEL: Record<WriterRole, string> = {
  get employee(): string {
    return t('settings.words.the_employee', 'The employee');
  },
  get manager(): string {
    return t('settings.words.their_manager', 'Their manager');
  },
  hr: 'HR',
  get finance(): string {
    return t('settings.words.finance', 'Finance');
  },
  get system(): string {
    return t('settings.words.a_connected_system', 'A connected system');
  },
  get external(): string {
    return t('settings.words.an_external_hr_system', 'An external HR system');
  },
};

export const SCOPE_LABEL: Record<ViewerScope, string> = {
  get self(): string {
    return t('settings.words.the_employee', 'The employee');
  },
  get manager(): string {
    return t('settings.words.their_manager', 'Their manager');
  },
  get manager_chain(): string {
    return t('settings.words.managers_above_them', 'Managers above them');
  },
  hr: 'HR',
  get finance(): string {
    return t('settings.words.finance', 'Finance');
  },
  get admin(): string {
    return t('settings.words.administrators', 'Administrators');
  },
  get directory(): string {
    return t('settings.words.everyone_in_the_directory', 'Everyone, in the directory');
  },
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
    get label(): string {
      return t('settings.words.at_sign_up', 'At sign-up');
    },
    get short(): string {
      return t('settings.words.at_sign_up', 'At sign-up');
    },
    get when(): string {
      return t(
        'settings.words.when_they_first_set_up_their',
        'when they first set up their account',
      );
    },
    get description(): string {
      return t(
        'settings.words.asked_when_the_person_first_sets',
        'Asked when the person first sets up their account (and when they recover it, if it is still missing), before they create their passkey.',
      );
    },
    get example(): string {
      return t('settings.words.suits_preferred_name_pronouns', 'Suits: preferred name, pronouns.');
    },
  },
  enrolment: {
    get label(): string {
      return t(
        'settings.words.when_they_accept_their_invitation',
        'When they accept their invitation',
      );
    },
    get short(): string {
      return t('settings.words.on_invitation', 'On invitation');
    },
    get when(): string {
      return t(
        'settings.words.when_they_accept_their_invitation_2',
        'when they accept their invitation',
      );
    },
    get description(): string {
      return t(
        'settings.words.asked_on_the_account_setup_page',
        'Asked on the account setup page when somebody HR invited follows their invitation link, before they can use Kithena.',
      );
    },
    get example(): string {
      return t(
        'settings.words.suits_a_personal_email_a_preferred',
        'Suits: a personal email, a preferred language.',
      );
    },
  },
  onboarding: {
    get label(): string {
      return t('settings.words.during_onboarding', 'During onboarding');
    },
    get short(): string {
      return t('settings.words.onboarding', 'Onboarding');
    },
    get when(): string {
      return t('settings.words.during_onboarding_2', 'during onboarding');
    },
    get description(): string {
      return t(
        'settings.words.asked_in_the_checklist_a_new',
        'Asked in the checklist a new starter works through after first signing in, one section at a time. If required, it counts as missing from the day they are hired.',
      );
    },
    get example(): string {
      return t(
        'settings.words.suits_emergency_contact_t_shirt_size',
        'Suits: emergency contact, T-shirt size, bank details.',
      );
    },
  },
  anytime: {
    get label(): string {
      return t('settings.words.any_time_on_their_profile', 'Any time, on their profile');
    },
    get short(): string {
      return t('settings.words.any_time', 'Any time');
    },
    get when(): string {
      return t(
        'settings.words.on_their_profile_whenever_it_changes',
        'on their profile, whenever it changes',
      );
    },
    get description(): string {
      return t(
        'settings.words.nobody_is_chased_before_first_day',
        'Nobody is chased for it before their first day. It sits on their profile to fill in or update whenever it changes; if required, it counts as missing from their start date.',
      );
    },
    get example(): string {
      return t(
        'settings.words.suits_a_home_address_after_a',
        'Suits: a home address after a move, a second phone number.',
      );
    },
  },
  hr_only: {
    get label(): string {
      return t('settings.words.only_hr_fills_it_in', 'Only HR fills it in');
    },
    get short(): string {
      return t('settings.words.hr_only', 'HR only');
    },
    when: '',
    get description(): string {
      return t(
        'settings.words.the_employee_never_sees_a_form',
        'The employee never sees a form for it: not in onboarding and not on their own profile. If required, HR sees it as missing from the start date.',
      );
    },
    get example(): string {
      return t(
        'settings.words.suits_laptop_serial_number_cost_centre',
        'Suits: laptop serial number, cost centre, internal grade.',
      );
    },
  },
};

export const CLASSIFICATION_LABEL: Record<Classification, { label: string; description: string }> =
  {
    public: {
      get label(): string {
        return t(
          'settings.words.fine_for_everyone_at_the_company',
          'Fine for everyone at the company',
        );
      },
      get description(): string {
        return t(
          'settings.words.could_appear_in_the_directory_a_job',
          'Could appear in the directory. A job title, a work phone.',
        );
      },
    },
    internal: {
      get label(): string {
        return t(
          'settings.words.ordinary_information_about_the_job',
          'Ordinary information about the job',
        );
      },
      get description(): string {
        return t(
          'settings.words.business_data_nobody_would_mind_hr_and',
          'Business data nobody would mind HR and managers seeing.',
        );
      },
    },
    confidential: {
      get label(): string {
        return t(
          'settings.words.would_harm_or_embarrass_someone_if_it',
          'Would harm or embarrass someone if it leaked',
        );
      },
      get description(): string {
        return t(
          'settings.words.pay_home_address_performance_kept_out_of',
          'Pay, home address, performance. Kept out of logs and AI.',
        );
      },
    },
    'special-category': {
      get label(): string {
        return t(
          'settings.words.health_beliefs_ethnicity_or_similar',
          'Health, beliefs, ethnicity or similar',
        );
      },
      get description(): string {
        return t(
          'settings.words.protected_by_law_gdpr_article_9_never',
          'Protected by law (GDPR Article 9). Never sent to AI, never carried on an event, never exported without a reason.',
        );
      },
    },
  };

export const REQUIREDNESS_LABEL: Record<RequirednessMode, string> = {
  get always(): string {
    return t('settings.words.required', 'Required');
  },
  get conditional(): string {
    return t('settings.words.required_sometimes', 'Required sometimes');
  },
  get never(): string {
    return t('settings.words.optional', 'Optional');
  },
};

/** A predicate's facts, as a condition reads them (PEO-065). */
export const OPERAND_LABEL: Record<ListOperand | 'attribute', string> = {
  get legalEntity(): string {
    return t('settings.words.legal_entity', 'Legal entity');
  },
  get country(): string {
    return t('settings.words.country', 'Country');
  },
  get employmentType(): string {
    return t('settings.words.employment_type', 'Employment type');
  },
  get workModel(): string {
    return t('settings.words.work_model', 'Work model');
  },
  get status(): string {
    return t('settings.words.status', 'Status');
  },
  get attribute(): string {
    return t('settings.words.another_field', 'Another field');
  },
};

/**
 * The values status can hold, mirrored from the contract. Employment type and
 * work model are the company's own lists, from the registry's `choices`.
 */
export const FACT_VALUES: Record<'status', readonly Choice[]> = {
  status: [
    {
      value: 'provisional',
      get label(): string {
        return t('settings.words.provisional', 'Provisional');
      },
    },
    {
      value: 'pre_hire',
      get label(): string {
        return t('settings.words.pre_hire', 'Pre-hire');
      },
    },
    {
      value: 'active',
      get label(): string {
        return t('settings.words.active', 'Active');
      },
    },
    {
      value: 'on_leave',
      get label(): string {
        return t('settings.words.on_leave', 'On leave');
      },
    },
    {
      value: 'notice',
      get label(): string {
        return t('settings.words.on_notice', 'On notice');
      },
    },
    {
      value: 'terminated',
      get label(): string {
        return t('settings.words.left', 'Left');
      },
    },
    {
      value: 'discarded',
      get label(): string {
        return t('settings.words.discarded', 'Discarded');
      },
    },
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
