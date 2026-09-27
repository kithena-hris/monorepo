import type { Classification, CollectAt, RequirednessMode, ViewerScope, WriterRole } from './model';
import { COLLECT_LABEL, SCOPE_LABEL, WRITER_LABEL, inSentence, listed } from './words';

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
    { who: 'The employee', see: sees('self', 'directory'), edit: ownership.includes('employee') },
    {
      who: 'Their manager',
      see: sees('manager', 'manager_chain', 'directory'),
      edit: ownership.includes('manager'),
    },
    { who: 'HR', see: sees('hr', 'admin'), edit: ownership.includes('hr') },
    { who: 'Finance', see: sees('finance', 'directory'), edit: ownership.includes('finance') },
  ];

  const sentences = audiences
    // Finance is only worth a sentence when it is involved at all.
    .filter((a) => a.who !== 'Finance' || a.see || a.edit)
    .map(({ who, see, edit }) => {
      if (see && edit) return `${who} can see and edit this.`;
      if (see) return `${who} can see it.`;
      // Owning a field you cannot read is possible for a system-fed value, but
      // for a person it is a form they fill in and never see again.
      if (edit) return `${who} can fill it in but not see it afterwards.`;
      return `${who} cannot.`;
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
  public: 'not sensitive',
  internal: 'not sensitive',
  confidential: 'confidential, so it is kept out of logs and AI',
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
  const label = field.label.trim() === '' ? 'this field' : field.label.trim();
  const others = field.ownership
    .filter((w) => w !== 'employee')
    .map((w) => inSentence(WRITER_LABEL[w]));
  const asked =
    field.collectAt === 'hr_only'
      ? others.length === 0
        ? `Nobody is ever asked for ${label}.`
        : `${opening(listed(others))} ${others.length === 1 ? 'fills' : 'fill'} in ${label}; the employee is never asked for it.`
      : field.ownership.includes('employee')
        ? `The employee is asked for their ${label} ${COLLECT_LABEL[field.collectAt].when}.`
        : `${opening(listed(others))} ${others.length === 1 ? 'fills' : 'fill'} in ${label} ${COLLECT_LABEL[field.collectAt].when}.`;
  const required = {
    never: 'It is optional.',
    always: 'It is required for everyone.',
    conditional: 'It is required only where its conditions hold.',
  }[field.requiredness];
  const writers = field.ownership.map((w) => inSentence(WRITER_LABEL[w]));
  const change =
    writers.length === 1
      ? `Only ${writers[0] ?? ''} can change it.`
      : `${opening(listed(writers))} can change it.`;
  const readers = field.visibility.map((s) => inSentence(SCOPE_LABEL[s]));
  const see =
    readers.length === 0
      ? 'Nobody sees it except through its rules.'
      : `${opening(listed(readers))} can see it${field.rules > 0 ? ', and others on some records' : ''}.`;
  const kind =
    field.classification === null
      ? 'How sensitive it is is still to be chosen'
      : opening(SENSITIVITY[field.classification]);
  const extras = [
    field.requiresApproval ? 'changes wait for a second HR member to approve them' : null,
    field.encrypted ? 'it is stored encrypted' : null,
  ].filter((x) => x !== null);
  return [
    asked,
    required,
    change,
    see,
    `${kind}${extras.length > 0 ? `; ${extras.join('; ')}` : ''}.`,
  ].join(' ');
}
