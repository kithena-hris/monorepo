import type { Classification, CollectAt, RequirednessMode, ViewerScope, WriterRole } from './model';
import { COLLECT_LABEL, SCOPE_LABEL, WRITER_LABEL, inSentence, listed } from './words';
import { t } from '../i18n';

/**
 * The visibility step's plain sentence: who can see this field and who can
 * change it, read back from what was ticked (§9.2).
 *
 * "The employee can see and edit this. Their manager cannot. HR can see it."
 *
 * Display, not a decision: the application layer is what enforces both rules.
 * This only says in words what the two lists of checkboxes already say.
 */
export function readBack(
  ownership: readonly WriterRole[],
  visibility: readonly ViewerScope[],
): string {
  const sees = (...scopes: ViewerScope[]): boolean => scopes.some((s) => visibility.includes(s));
  const audiences: { who: string; see: boolean; edit: boolean }[] = [
    {
      who: t('settings.read-back.the_employee', 'The employee'),
      see: sees('self', 'directory'),
      edit: ownership.includes('employee'),
    },
    {
      who: t('settings.read-back.their_manager', 'Their manager'),
      see: sees('manager', 'manager_chain', 'directory'),
      edit: ownership.includes('manager'),
    },
    { who: 'HR', see: sees('hr', 'admin'), edit: ownership.includes('hr') },
    {
      who: t('settings.read-back.finance', 'Finance'),
      see: sees('finance', 'directory'),
      edit: ownership.includes('finance'),
    },
  ];

  const sentences = audiences
    // Finance is only worth a sentence when it is involved at all.
    .filter((a) => a.who !== 'Finance' || a.see || a.edit)
    .map(({ who, see, edit }) => {
      if (see && edit)
        return t('settings.read-back.can_see_and_edit_this', '{{who}} can see and edit this.', {
          who,
        });
      if (see) return t('settings.read-back.can_see_it', '{{who}} can see it.', { who });
      // Owning a field you cannot read is possible for a system-fed value, but
      // for a person it is a form they fill in and never see again.
      if (edit)
        return t(
          'settings.read-back.can_fill_it_in_but_not',
          '{{who}} can fill it in but not see it afterwards.',
          { who },
        );
      return t('settings.read-back.cannot', '{{who}} cannot.', { who });
    });
  if (visibility.includes('directory')) sentences.push('Everyone can find it in the directory.');
  return sentences.join(' ');
}

/** What the review step reads back. The draft's own words, not a decision. */
export interface Summarised {
  readonly label: string;
  readonly ownership: readonly WriterRole[];
  readonly collectAt: CollectAt;
  readonly requiredness: RequirednessMode;
  readonly visibility: readonly ViewerScope[];
  readonly rules: number;
  readonly classification: Classification | null;
  readonly requiresApproval: boolean;
  readonly encrypted: boolean;
}

const opening = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const SENSITIVITY: Record<Classification, string> = {
  public: t('settings.read-back.not_sensitive', 'not sensitive'),
  internal: t('settings.read-back.not_sensitive', 'not sensitive'),
  confidential: t(
    'settings.read-back.confidential_so_it_is_kept_out',
    'confidential, so it is kept out of logs and AI',
  ),
  'special-category':
    'special-category data, so it never reaches AI, events or the standard export',
};

/**
 * The review step's summary, in a few plain sentences (§9.2):
 *
 * "The employee is asked for their T-shirt size during onboarding. It is
 * optional. The employee and HR can change it. The employee, their manager and
 * HR can see it. Not sensitive."
 */
export function summary(field: Summarised): string {
  return summaryParts(field)
    .map((p) => p.text)
    .join(' ');
}

/**
 * The same sentences, each tagged with the editor step that decides it
 * (1 access, 2 when it is asked, 3 sensitivity), so the step being edited
 * can be picked out in the summary beside it.
 */
export function summaryParts(field: Summarised): { text: string; step: 1 | 2 | 3 }[] {
  const label =
    field.label.trim() === ''
      ? t('settings.read-back.this_field', 'this field')
      : field.label.trim();
  const others = field.ownership
    .filter((w) => w !== 'employee')
    .map((w) => inSentence(WRITER_LABEL[w]));
  const asked =
    field.collectAt === 'hr_only'
      ? others.length === 0
        ? t('settings.read-back.nobody_is_ever_asked_for', 'Nobody is ever asked for {{label}}.', {
            label,
          })
        : `${opening(listed(others))} ${others.length === 1 ? 'fills' : 'fill'} in ${label}; the employee is never asked for it.`
      : field.ownership.includes('employee')
        ? t(
            'settings.read-back.the_employee_is_asked_for_their',
            'The employee is asked for their {{label}} {{when}}.',
            { label, when: COLLECT_LABEL[field.collectAt].when },
          )
        : t(
            'settings.read-back.in',
            {
              one: '{{opening}} fills in {{label}} {{when}}.',
              other: '{{opening}} fill in {{label}} {{when}}.',
            },
            {
              count: others.length,
              opening: opening(listed(others)),
              label,
              when: COLLECT_LABEL[field.collectAt].when,
            },
          );
  const required = {
    never: t('settings.read-back.it_is_optional', 'It is optional.'),
    always: t('settings.read-back.it_is_required_for_everyone', 'It is required for everyone.'),
    conditional: t(
      'settings.read-back.it_is_required_only_where_its',
      'It is required only where its conditions hold.',
    ),
  }[field.requiredness];
  const writers = field.ownership.map((w) => inSentence(WRITER_LABEL[w]));
  const change =
    writers.length === 1
      ? t('settings.read-back.only_can_change_it', 'Only {{value}} can change it.', {
          value: writers[0] ?? '',
        })
      : t('settings.read-back.can_change_it', '{{opening}} can change it.', {
          opening: opening(listed(writers)),
        });
  const readers = field.visibility.map((s) => inSentence(SCOPE_LABEL[s]));
  const see =
    readers.length === 0
      ? t(
          'settings.read-back.nobody_sees_it_except_through_its',
          'Nobody sees it except through its rules.',
        )
      : field.rules > 0
        ? t(
            'settings.read-back.can_see_it_and_others',
            '{{opening}} can see it, and others on some records.',
            {
              opening: opening(listed(readers)),
            },
          )
        : t('settings.read-back.can_see_it_2', '{{opening}} can see it.', {
            opening: opening(listed(readers)),
          });
  const kind =
    field.classification === null
      ? 'How sensitive it is is still to be chosen'
      : opening(SENSITIVITY[field.classification]);
  const extras = [
    field.requiresApproval
      ? t(
          'settings.read-back.changes_wait_for_a_second_hr',
          'changes wait for a second HR member to approve them',
        )
      : null,
    field.encrypted
      ? t('settings.read-back.it_is_stored_encrypted', 'it is stored encrypted')
      : null,
  ].filter((x) => x !== null);
  return [
    { text: asked, step: 2 },
    { text: required, step: 2 },
    { text: change, step: 1 },
    { text: see, step: 1 },
    { text: `${kind}${extras.length > 0 ? `; ${extras.join('; ')}` : ''}.`, step: 3 },
  ];
}
