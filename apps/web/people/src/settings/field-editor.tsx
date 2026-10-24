import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AccessMatrix,
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NumberField,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Stack,
  Stepper,
  Switch,
  TagsInput,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { AttributeInput } from '../record/attribute-input';
import type { AttributeValue } from '../record/model';
import {
  CLASSIFICATION_ORDER,
  atLeast,
  type Classification,
  type ClassificationAdvice,
  type CollectAt,
  type DataType,
  type FieldDescription as Described,
  type FieldInput,
  type Predicate,
  type RegistryDraft,
  type RegistryField,
  type RegistrySection,
  type RequirednessMode,
  type ViewerScope,
  type VisibilityRule,
  type WriterRole,
} from './model';
import {
  EMPTY_PREDICATE,
  PredicateEditor,
  predicateProblem,
  type PredicateField,
} from './predicate-editor';
import { AUDIENCES, TypeIcon, accessOf, fromAccess, seenByEveryone, withEveryone } from './access';
import { describedField } from './describe';
import { summaryParts } from './read-back';
import {
  CLASSIFICATION_LABEL,
  COLLECT_LABEL,
  DATA_TYPE_GROUPS,
  DATA_TYPE_HINT,
  DATA_TYPE_LABEL,
  REQUIREDNESS_LABEL,
  SCOPE_LABEL,
  WRITER_LABEL,
  keyFromLabel,
  listed,
} from './words';
import { t } from '../i18n';

/**
 * The five steps (design F4–F8): what it is, who sees and changes it, when it
 * is asked, how sensitive it is, and a review. Classification comes late, as
 * §9.2 argues: it is the choice most likely to be clicked through, and by then
 * the form knows enough for the suggestion to be good.
 */
const STEPS = [
  {
    id: 'editor-field',
    get label(): string {
      return t('settings.field-editor.the_field', 'The field');
    },
  },
  {
    id: 'editor-access',
    get label(): string {
      return t('settings.field-editor.access', 'Access');
    },
  },
  {
    id: 'editor-when',
    get label(): string {
      return t('settings.field-editor.when_its_asked', 'When it’s asked');
    },
  },
  {
    id: 'editor-sensitivity',
    get label(): string {
      return t('settings.field-editor.sensitivity', 'Sensitivity');
    },
  },
  {
    id: 'editor-review',
    get label(): string {
      return t('settings.field-editor.review', 'Review');
    },
  },
] as const;

/** The tiles a new field starts with; the rest are a press away. */
const COMMON_TYPES: readonly DataType[] = [
  'text',
  'long_text',
  'select',
  'multi_select',
  'number',
  'date',
  'boolean',
  'document_ref',
];

const SCOPES: readonly ViewerScope[] = [
  'self',
  'manager',
  'manager_chain',
  'hr',
  'finance',
  'directory',
];
/** The contract's bound on custom visibility rules. */
const MOST_RULES = 5;
/** In the order a person meets them. */
const COLLECT: readonly CollectAt[] = ['signup', 'enrolment', 'onboarding', 'anytime', 'hr_only'];

/**
 * Common fields to start from. Only the answers a new field would otherwise
 * be typed in from scratch; what kind of data it is is still judged in review.
 */
const TEMPLATES: readonly Pick<
  Draft,
  'label' | 'description' | 'dataType' | 'options' | 'ownership' | 'collectAt' | 'visibility'
>[] = [
  {
    get label(): string {
      return t('settings.field-editor.t_shirt_size', 'T-shirt size');
    },
    get description(): string {
      return t('settings.field-editor.for_company_clothing', 'For company clothing.');
    },
    dataType: 'select',
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
  {
    get label(): string {
      return t('settings.field-editor.pronouns', 'Pronouns');
    },
    get description(): string {
      return t(
        'settings.field-editor.how_they_would_like_to_be_referred',
        'How they would like to be referred to.',
      );
    },
    dataType: 'text',
    options: [],
    ownership: ['employee'],
    collectAt: 'signup',
    visibility: ['self', 'manager', 'hr', 'directory'],
  },
  {
    get label(): string {
      return t('settings.field-editor.emergency_contact_name', 'Emergency contact name');
    },
    get description(): string {
      return t(
        'settings.field-editor.who_to_call_if_something_happens_at',
        'Who to call if something happens at work.',
      );
    },
    dataType: 'text',
    options: [],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
  {
    get label(): string {
      return t('settings.field-editor.emergency_contact_phone', 'Emergency contact phone');
    },
    get description(): string {
      return t(
        'settings.field-editor.their_number_with_the_country_code',
        'Their number, with the country code.',
      );
    },
    dataType: 'phone',
    options: [],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
];
const WITH_OPTIONS: ReadonlySet<DataType> = new Set(['select', 'multi_select']);
/** The types that keep a number of decimal places. */
const WITH_DECIMALS: ReadonlySet<DataType> = new Set(['number', 'decimal', 'percentage']);
const KEY = /^[a-z][a-z0-9_]{0,62}$/;

interface Draft {
  label: string;
  key: string;
  /** Where it sits: moved by choosing another section. */
  sectionKey: string;
  /** A number's decimal places. */
  decimals: number | null;
  /** Money in one currency only (ISO 4217), or '' for the record's own. */
  currency: string;
  /** A date that may instead be indefinite: a permanent contract's end. */
  openEnded: boolean;
  description: string;
  dataType: DataType;
  options: readonly string[];
  requiredness: RequirednessMode;
  /** Kept while the admin flips between modes, and sent only when conditional. */
  requiredWhen: Predicate;
  ownership: readonly WriterRole[];
  collectAt: CollectAt;
  visibility: readonly ViewerScope[];
  visibilityRules: readonly VisibilityRule[];
  classification: Classification | null;
  confirmedSpecial: boolean;
  /** Whether a change waits for HR's approval (PEO-077); null until the admin says. */
  requiresApproval: boolean | null;
  /** Stored sealed, by choice; financial details and identifiers are regardless. */
  encrypted: boolean;
}

function draftFrom(section: RegistrySection, field: RegistryField | null): Draft {
  if (field !== null) {
    return {
      label: field.label,
      key: field.key,
      sectionKey: field.sectionKey,
      decimals: field.decimals ?? null,
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
      requiresApproval: field.requiresApproval ?? null,
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
    // Asked of the employee in onboarding when they fill the section in;
    // otherwise HR's alone. Both choices are explained under When it’s asked.
    collectAt: section.ownership.includes('employee') ? 'onboarding' : 'hr_only',
    // Defaulted from the section, which is what §9.2 asks: most fields are
    // seen by whoever sees the rest of their section.
    visibility: section.visibility,
    visibilityRules: [],
    classification: null,
    confirmedSpecial: false,
    requiresApproval: null,
    encrypted: false,
  };
}

/**
 * What a field defaults to when nobody chose (PEO-077), as People computes
 * it: on for financial data and for anything stored encrypted.
 */
/** The types a value can be sealed as (People's `encryptable`, for a new field). */
const SEALABLE = new Set<string>([
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

export function approvalByDefault(dataType: DataType, piiKind: string): boolean {
  return piiKind === 'financial' || dataType === 'bank_account' || dataType === 'national_id';
}

/**
 * A condition on special-category data leaks through completeness: "missing"
 * tells whoever sees the gap that the condition held. People refuses it
 * (`PREDICATE_DISCLOSES`); saying so here puts the sentence beside the row.
 */
function specialCategoryProblem(
  predicate: Draft['requiredWhen'],
  others: readonly PredicateField[],
): string | null {
  for (const clause of predicate.clauses) {
    if (clause.operand !== 'attribute') continue;
    const named = others.find((f) => f.key === clause.key);
    if (named?.classification === 'special-category') {
      return t(
        'settings.field-editor.is_special_category_data_so_it',
        '{{label}} is special-category data, so it cannot decide whether a field is required: a missing value would tell whoever sees it that the condition held.',
        { label: named.label },
      );
    }
  }
  return null;
}

function problemsIn(
  step: number,
  draft: Draft,
  keyTaken: (key: string) => boolean,
  others: readonly PredicateField[],
) {
  const problems: Partial<
    Record<
      | 'label'
      | 'key'
      | 'options'
      | 'ownership'
      | 'requiredWhen'
      | 'visibility'
      | 'rules'
      | 'kind'
      | 'unseen'
      | 'currency',
      string
    >
  > = {};
  if (step === 0) {
    if (draft.label.trim() === '')
      problems.label = t('settings.field-editor.give_the_field_a_name', 'Give the field a name.');
    if (draft.dataType === 'money' && draft.currency !== '' && !/^[A-Z]{3}$/.test(draft.currency)) {
      problems.currency = t(
        'settings.field-editor.a_three_letter_currency_code_like',
        'A three-letter currency code, like EUR.',
      );
    }
    if (!KEY.test(draft.key)) {
      problems.key = t(
        'settings.field-editor.lower_case_letters_digits_and_underscores',
        'Lower-case letters, digits and underscores, starting with a letter.',
      );
    } else if (keyTaken(draft.key)) {
      problems.key = t(
        'settings.field-editor.another_field_already_uses_this_key',
        'Another field already uses this key.',
      );
    }
    if (WITH_OPTIONS.has(draft.dataType) && draft.options.length === 0) {
      problems.options = t(
        'settings.field-editor.add_at_least_one_option',
        'Add at least one option.',
      );
    }
  }
  if (step === 1 && draft.ownership.length === 0) {
    problems.ownership = t(
      'settings.field-editor.somebody_has_to_be_able_to',
      'Somebody has to be able to change it.',
    );
  }
  if (step === 2 && draft.requiredness === 'conditional') {
    const problem =
      predicateProblem(draft.requiredWhen) ?? specialCategoryProblem(draft.requiredWhen, others);
    if (problem !== null) problems.requiredWhen = problem;
  }
  // Checked again where requiredness is chosen: a required field needs
  // somebody who can always read it, not only through a rule.
  if (step === 2 && draft.requiredness !== 'never' && draft.visibility.length === 0) {
    problems.unseen = t(
      'settings.field-editor.a_required_field_needs_somebody_who',
      'A required field needs somebody who can always see it. Choose who can see it under Access.',
    );
  }
  if (step === 1) {
    // A rule holds of some records, so it is no answer for a required field:
    // the contract asks for a preset reader then, and so does this.
    if (
      draft.visibility.length === 0 &&
      (draft.visibilityRules.length === 0 || draft.requiredness !== 'never')
    ) {
      problems.visibility = t(
        'settings.field-editor.nobody_could_ever_read_it_choose',
        'Nobody could ever read it. Choose at least one.',
      );
    }
    for (const rule of draft.visibilityRules) {
      const problem =
        rule.scopes.length === 0
          ? t(
              'settings.field-editor.every_rule_shows_the_field_to',
              'Every rule shows the field to somebody.',
            )
          : predicateProblem(rule.when);
      if (problem !== null) problems.rules = problem;
    }
  }
  if (step === 3) {
    if (draft.classification === null)
      problems.kind = t(
        'settings.field-editor.choose_what_kind_of_data_this',
        'Choose what kind of data this is.',
      );
    else if (draft.classification === 'special-category' && !draft.confirmedSpecial) {
      problems.kind = t(
        'settings.field-editor.special_category_data_needs_your_explicit',
        'Special-category data needs your explicit confirmation.',
      );
    } else if (draft.classification === 'special-category' && draft.visibilityRules.length > 0) {
      problems.kind = t(
        'settings.field-editor.special_category_data_is_never_shown',
        'Special-category data is never shown by a rule. Remove the rules under Access.',
      );
    }
  }
  return problems;
}

export interface FieldEditorProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly section: RegistrySection;
  /** The field being edited, or null for a new one. */
  readonly field: RegistryField | null;
  /** Keys already in use in this draft, so a clash is caught before saving. */
  readonly takenKeys: readonly string[];
  /** What a condition's legal entity and country may name (PEO-065). */
  readonly choices: RegistryDraft['choices'];
  /** The fields a condition may name. The one being edited is left out here. */
  readonly fields: readonly PredicateField[];
  /** Every section, so a field can be moved to another; absent, it stays where it is. */
  readonly sections?: readonly RegistrySection[];
  /**
   * After a save that changed the type or a format setting of a published
   * field: review every value it holds before it is published.
   */
  readonly onReview?: (key: string, to: DataType) => void;
  /** The classification judgment, from metadata only. Never a value (§12.3). */
  readonly advise: (field: Described) => Promise<ClassificationAdvice>;
  readonly onSave: (input: FieldInput) => Promise<Outcome>;
  /**
   * Share it with the assistant, or stop, once it is saved: the Sensitivity
   * step's switch. Absent, the switch is not offered.
   */
  readonly onAssistant?: (key: string, share: boolean) => Promise<Outcome>;
}

/** The step a summary sentence, or a review row, opens. */
type Step = 0 | 1 | 2 | 3 | 4;

/**
 * Adding or changing one field, in a centred dialog, in five steps (design
 * F4–F9): the field, who sees and changes it, when it is asked, how
 * sensitive it is, and a review. The preview and the plain-words summary sit
 * beside every step, with the words the current step decides picked out.
 *
 * Editing, any step can be opened and the field saved from any of them. A new
 * field steps through in order and is added from the review. Classification
 * comes after access and timing because it is the choice most likely to be
 * clicked through, and by then the form knows enough for the suggestion to be
 * good. The suggestion may raise protection and never lower it; that rule is
 * the application layer's and arrives here as the advice's `floor`.
 */
export function FieldEditor({
  open,
  onOpenChange,
  section,
  field,
  takenKeys,
  choices,
  fields,
  sections = [],
  advise,
  onSave,
  onReview,
  onAssistant,
}: FieldEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(section, field));
  const [keyEdited, setKeyEdited] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [shown, setShown] = useState(false);
  const [advice, setAdvice] = useState<ClassificationAdvice | 'asking' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  // Steps a description filled in, marked until the admin has looked at them.
  const [drafted, setDrafted] = useState<ReadonlySet<number>>(new Set());
  const [description, setDescription] = useState('');
  const [allTypes, setAllTypes] = useState(false);
  // The assistant switch as the admin left it; null is the field's own answer.
  const [sharing, setSharing] = useState<boolean | null>(null);
  const asked = useRef(0);

  // A fresh draft every time the dialog opens, so a cancelled edit leaves nothing behind.
  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(section, field));
    setKeyEdited(field !== null);
    setAdvanced('');
    setShown(false);
    setAdvice(null);
    setRefused(null);
    setStep(0);
    setDrafted(new Set());
    setDescription('');
    setAllTypes(false);
    setSharing(null);
    asked.current += 1;
  }, [open, section, field]);

  const editing = field !== null;
  const others = fields.filter((f) => f.key !== draft.key);
  const stepProblems = STEPS.map((_, index) =>
    problemsIn(index, draft, (key) => !editing && takenKeys.includes(key), others),
  );
  const problems = Object.assign({}, ...stepProblems) as ReturnType<typeof problemsIn>;
  const set = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const goTo = (next: number): void => {
    setStep(next as Step);
    setDrafted((d) => new Set([...d].filter((i) => i !== next)));
  };

  /*
   * Ask for the judgment as the field is described, from what was described
   * by then. Asked again on every arrival, because going back and rewording
   * the description is exactly what should change the answer. A counter, so an
   * answer to a question nobody is waiting for any more is dropped.
   */
  const ask = (described: Draft): void => {
    const question = ++asked.current;
    setAdvice('asking');
    advise({
      label: described.label,
      description: described.description === '' ? null : described.description,
      dataType: described.dataType,
      sectionKey: section.key,
      options: described.options,
    }).then(
      (answer) => {
        if (question !== asked.current) return;
        setAdvice(answer);
        // Pre-select what the judgment is sure of. `choose` pre-selects
        // nothing, which is the point of it. An edit keeps its own answer.
        const preselect =
          answer.kind === 'protect'
            ? 'special-category'
            : answer.kind === 'choose'
              ? null
              : answer.classification;
        setDraft((d) =>
          editing && d.classification !== null ? d : { ...d, classification: preselect },
        );
      },
      () => {
        if (question === asked.current) setAdvice('failed');
      },
    );
  };

  // The judgment for the sensitivity step, asked as the field is described: on
  // opening, and again a moment after its name, description or type changes.
  useEffect(() => {
    if (!open || draft.label.trim() === '') return undefined;
    const timer = setTimeout(() => {
      ask(draft);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
    // Only what the judgment reads.
  }, [open, draft.label, draft.description, draft.dataType, draft.options.join('\u0000')]);

  /** A description read into the draft: name, type, options, and steps 2 to 3 marked to check. */
  const describe = (text: string): void => {
    setDescription(text);
    const d = describedField(text);
    if (!d.understood) return;
    setKeyEdited(false);
    set({
      label: d.label,
      key: d.key,
      dataType: d.dataType,
      options: d.options,
      collectAt: d.collectAt,
      ownership: d.ownership,
      visibility: d.visibility,
    });
    setDrafted(new Set([1, 2, 3]));
  };

  const piiKind = typeof advice === 'object' && advice !== null ? advice.piiKind : 'none';
  // Financial details and identifiers: encrypted, whatever the admin says.
  const forced = approvalByDefault(draft.dataType, piiKind);
  const sealed = forced || draft.encrypted;
  const wasSealed = field?.encrypted === true;
  const canSeal = field === null ? SEALABLE.has(draft.dataType) : field.encryptable === true;
  const sealLocked = forced || wasSealed || !canSeal;
  const sealWhy = forced
    ? t(
        'settings.field-editor.always_on_for_financial_details_and',
        'Always on for financial details and ID numbers.',
      )
    : wasSealed
      ? t(
          'settings.field-editor.on_encryption_cant_be_turned_off',
          'On. Encryption can’t be turned off.',
        )
      : !canSeal
        ? t(
            'settings.field-editor.not_available_for_this_field_type',
            'Not available for this field type.',
          )
        : draft.encrypted && field !== null
          ? t(
              'settings.field-editor.existing_values_are_encrypted_when_you',
              'Existing values are encrypted when you publish. This can’t be undone.',
            )
          : t(
              'settings.field-editor.only_the_last_four_characters_are',
              'Only the last four characters are shown. Never searchable or shared.',
            );
  const approval = draft.requiresApproval ?? sealed;
  // People shares a field with the assistant only where it could: public or internal, never sealed.
  const shareable =
    !sealed && (draft.classification === 'public' || draft.classification === 'internal');
  const sharedBefore = field === null ? shareable : field.aiEligible === true;
  const shared = shareable && (sharing ?? sharedBefore);

  const save = async (): Promise<void> => {
    setShown(true);
    const first = stepProblems.findIndex((p) => Object.keys(p).length > 0);
    if (first !== -1) {
      goTo(first);
      return;
    }
    if (draft.classification === null) return;
    const judged = typeof advice === 'object' && advice !== null ? advice : null;
    const suggested =
      judged === null || judged.kind === 'choose'
        ? null
        : judged.kind === 'protect'
          ? 'special-category'
          : judged.classification;
    setSaving(true);
    setRefused(null);
    const outcome = await onSave({
      key: draft.key,
      sectionKey: draft.sectionKey,
      label: draft.label.trim(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
      dataType: draft.dataType,
      options: draft.options,
      requiredness: draft.requiredness,
      requiredWhen: draft.requiredness === 'conditional' ? draft.requiredWhen : null,
      ownership: draft.ownership,
      collectAt: draft.collectAt,
      visibility: draft.visibility,
      visibilityRules: draft.visibilityRules,
      classification: draft.classification,
      piiKind: judged?.piiKind ?? 'none',
      classificationSource: suggested === draft.classification ? 'suggested' : 'human',
      requiresApproval: draft.requiresApproval,
      encrypted: sealed,
      ...(WITH_DECIMALS.has(draft.dataType) && draft.decimals !== null
        ? { decimals: draft.decimals }
        : {}),
      ...(draft.dataType === 'money'
        ? { currency: draft.currency === '' ? null : draft.currency }
        : {}),
      ...(draft.dataType === 'date' ? { openEnded: draft.openEnded } : {}),
    });
    if (outcome.ok && onAssistant !== undefined && shareable && shared !== sharedBefore) {
      const assistant = await onAssistant(draft.key, shared);
      if (!assistant.ok) {
        setSaving(false);
        setRefused(
          t(
            'settings.field-editor.the_field_is_saved_but_not',
            'The field is saved, but not whether the assistant may use it. {{message}}',
            { message: assistant.message },
          ),
        );
        return;
      }
    }
    setSaving(false);
    if (!outcome.ok) {
      setRefused(outcome.message);
      return;
    }
    onOpenChange(false);
    // A published field whose values may no longer fit goes to their review.
    if (field !== null && field.pending !== 'added' && reformatted(field, draft)) {
      onReview?.(field.key, draft.dataType);
    }
  };

  /** A new field moves on only once the step it leaves is complete; a saved one moves freely. */
  const next = (): void => {
    if (!editing && Object.keys(stepProblems[step] ?? {}).length > 0) {
      setShown(true);
      return;
    }
    goTo(step + 1);
  };

  const show = shown ? problems : {};
  const typeTiles = allTypes
    ? DATA_TYPE_GROUPS.flatMap((group) => group.types)
    : [...new Set([...COMMON_TYPES, draft.dataType])];
  const last = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-250" sheetOnTouch>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('settings.field-editor.edit', 'Edit {{label}}', { label: field.label })
              : t('settings.field-editor.new_field', 'New field')}
          </DialogTitle>
          <DialogDescription>
            {section.label}
            {field !== null && field.origin !== 'tenant'
              ? t('settings.field-editor.built_in_suffix', ' · built in: type and key are fixed')
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <Stepper
            label={t('settings.field-editor.parts_of_the_field', 'Parts of the field')}
            current={step}
            free={editing}
            onStepChange={(index) => {
              goTo(index);
            }}
            steps={STEPS.map((s, index) => ({
              id: s.id,
              label: s.label,
              ...(shown && Object.keys(stepProblems[index] ?? {}).length > 0
                ? { status: 'error' as const }
                : drafted.has(index) && index !== step
                  ? { status: 'upcoming' as const, icon: <icons.assistant aria-hidden /> }
                  : {}),
            }))}
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18.75rem]">
            <Stack gap={5} className="min-w-0">
              <h3 className="font-display text-xl font-bold">{STEPS[step].label}</h3>
              {step === 0 ? (
                <Stack gap={5}>
                  {field !== null && field.origin !== 'tenant' ? (
                    <Alert
                      tone="info"
                      title={t('settings.field-editor.built_into_kithena', 'Built into Kithena')}
                    >
                      {t(
                        'settings.field-editor.you_can_change_its_name_description',
                        'You can change its name, description and access. Its type is fixed, and protection can only be increased.',
                      )}
                    </Alert>
                  ) : null}
                  {editing ? null : (
                    <Card variant="assistant" padded>
                      <Stack gap={2}>
                        <Field>
                          <FieldLabel>
                            <span className="inline-flex items-center gap-2 text-accent-fg">
                              <icons.assistant aria-hidden className="size-4" />
                              {t('settings.field-editor.describe_it', 'Describe it')}
                            </span>
                          </FieldLabel>
                          <FieldControl>
                            <Textarea
                              value={description}
                              placeholder={t(
                                'settings.field-editor.t_shirt_size_for_the_offsite',
                                'T-shirt size for the offsite, XS to XXL. People pick it during onboarding; only HR needs it.',
                              )}
                              onChange={(e) => {
                                describe(e.target.value);
                              }}
                            />
                          </FieldControl>
                          <FieldDescription>
                            {drafted.size > 0
                              ? t(
                                  'settings.field-editor.kithena_filled_in_the_name_the',
                                  'Kithena filled in the name, the options and steps 2 to 4. Check each step before adding it.',
                                )
                              : t(
                                  'settings.field-editor.kithena_fills_in_the_name_the',
                                  'Kithena fills in the name, the type and steps 2 to 4 from it. A rule, not a model.',
                                )}
                          </FieldDescription>
                        </Field>
                      </Stack>
                    </Card>
                  )}
                  {editing ? null : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-fg-muted">
                        {t('settings.field-editor.or_start_from', 'Or start from')}
                      </span>
                      {TEMPLATES.map((template) => {
                        const key = keyFromLabel(template.label);
                        const taken = takenKeys.includes(key);
                        return (
                          <Button
                            key={key}
                            size="sm"
                            disabled={taken}
                            aria-pressed={draft.key === key}
                            onClick={() => {
                              setKeyEdited(false);
                              set({ ...template, key, requiredness: 'never' });
                            }}
                          >
                            {template.label}
                            {taken ? t('settings.field-editor.added_suffix', ' (added)') : ''}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field required invalid={show.label !== undefined}>
                      <FieldLabel>{t('settings.field-editor.field_name', 'Field name')}</FieldLabel>
                      <FieldControl>
                        <Input
                          value={draft.label}
                          placeholder={t('settings.field-editor.t_shirt_size', 'T-shirt size')}
                          onChange={(e) => {
                            const label = e.target.value;
                            set(keyEdited ? { label } : { label, key: keyFromLabel(label) });
                          }}
                        />
                      </FieldControl>
                      <FieldDescription>
                        {t(
                          'settings.field-editor.what_people_see_above_the_field',
                          'What people see above the field on a form.',
                        )}
                      </FieldDescription>
                      <FieldError>{show.label}</FieldError>
                    </Field>
                    {sections.length > 1 ? (
                      <Field>
                        <FieldLabel>{t('settings.field-editor.section', 'Section')}</FieldLabel>
                        <Select
                          value={draft.sectionKey}
                          onValueChange={(sectionKey) => {
                            set({ sectionKey });
                          }}
                        >
                          <FieldControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FieldControl>
                          <SelectContent>
                            {sections
                              .filter((s) => !s.fixed || s.key === draft.sectionKey)
                              .map((s) => (
                                <SelectItem key={s.key} value={s.key}>
                                  {s.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          {t(
                            'settings.field-editor.where_it_sits_on_the_profile',
                            'Where it sits on the profile and on forms.',
                          )}
                        </FieldDescription>
                      </Field>
                    ) : null}
                  </div>
                  {editing ? (
                    <Field disabled={field.origin !== 'tenant'}>
                      <FieldLabel>
                        {t('settings.field-editor.type_of_answer', 'Type of answer')}
                      </FieldLabel>
                      <Select
                        value={draft.dataType}
                        disabled={field.origin !== 'tenant'}
                        onValueChange={(value) => {
                          set({ dataType: value as DataType });
                        }}
                      >
                        <FieldControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FieldControl>
                        <SelectContent>
                          {DATA_TYPE_GROUPS.map((group) => (
                            <SelectGroup key={group.label}>
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.types.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {DATA_TYPE_LABEL[type]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {DATA_TYPE_HINT[draft.dataType]}{' '}
                        {field.origin !== 'tenant'
                          ? t(
                              'settings.field-editor.a_built_in_field_keeps_its',
                              'A built-in field keeps its type.',
                            )
                          : draft.dataType === field.dataType
                            ? t(
                                'settings.field-editor.changing_the_type_checks_every_saved',
                                'Changing the type checks every saved value first.',
                              )
                            : t(
                                'settings.field-editor.changed_from_after_saving_you_review',
                                'Changed from {{DATA_TYPE_LABEL}}. After saving, you review every value before it’s published.',
                                { DATA_TYPE_LABEL: DATA_TYPE_LABEL[field.dataType] },
                              )}
                      </FieldDescription>
                    </Field>
                  ) : (
                    // A new field picks its type from tiles (F9): the picture is
                    // how the eye finds one, and each says what it checks below.
                    <fieldset className="flex flex-col gap-2.5">
                      <legend className="mb-2.5 text-sm font-medium">
                        {t('settings.field-editor.type_of_answer', 'Type of answer')}
                      </legend>
                      <RadioGroup
                        aria-label={t('settings.field-editor.type_of_answer', 'Type of answer')}
                        aria-describedby="editor-type-hint"
                        value={draft.dataType}
                        onValueChange={(value) => {
                          set({ dataType: value as DataType });
                        }}
                        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                      >
                        {typeTiles.map((type) => (
                          <RadioCard key={type} value={type} icon={<TypeIcon dataType={type} />}>
                            {DATA_TYPE_LABEL[type]}
                          </RadioCard>
                        ))}
                      </RadioGroup>
                      <p id="editor-type-hint" className="text-sm text-fg-muted">
                        {DATA_TYPE_HINT[draft.dataType]}
                      </p>
                      {allTypes ? null : (
                        <div>
                          <Button
                            size="sm"
                            variant="link"
                            onClick={() => {
                              setAllTypes(true);
                            }}
                          >
                            {t('settings.field-editor.all_types', 'All {{length}} types', {
                              length: String(DATA_TYPE_GROUPS.flatMap((g) => g.types).length),
                            })}
                          </Button>
                        </div>
                      )}
                    </fieldset>
                  )}
                  {WITH_DECIMALS.has(draft.dataType) ? (
                    <NumberField
                      label={t('settings.field-editor.decimal_places', 'Decimal places')}
                      min={0}
                      max={6}
                      value={draft.decimals ?? 0}
                      onChange={(decimals) => {
                        set({ decimals: decimals === null ? 0 : Math.round(decimals) });
                      }}
                      hint={t(
                        'settings.field-editor.how_many_digits_after_the_point',
                        'How many digits after the point a value keeps.',
                      )}
                    />
                  ) : null}
                  {draft.dataType === 'money' ? (
                    <Field invalid={show.currency !== undefined}>
                      <FieldLabel>{t('settings.field-editor.currency', 'Currency')}</FieldLabel>
                      <FieldControl>
                        <Input
                          value={draft.currency}
                          placeholder={t(
                            'settings.field-editor.each_persons_own',
                            'Each person’s own',
                          )}
                          maxLength={3}
                          onChange={(e) => {
                            set({ currency: e.target.value.toUpperCase() });
                          }}
                        />
                      </FieldControl>
                      <FieldDescription>
                        {t(
                          'settings.field-editor.a_three_letter_code_like_eur',
                          'A three-letter code, like EUR, when every amount is in one currency. Leave it empty to use each person’s own.',
                        )}
                      </FieldDescription>
                      <FieldError>{show.currency}</FieldError>
                    </Field>
                  ) : null}
                  {draft.dataType === 'date' ? (
                    <Field orientation="horizontal" className="items-start justify-between gap-4">
                      <div>
                        <FieldLabel>
                          {t('settings.field-editor.can_be_indefinite', 'Can be indefinite')}
                        </FieldLabel>
                        <FieldDescription>
                          {t(
                            'settings.field-editor.offers_no_end_date_beside_the',
                            'Offers “No end date” beside the date, for things like a contract end. Indefinite is an answer, so a required field holding it is complete.',
                          )}
                        </FieldDescription>
                      </div>
                      <FieldControl>
                        <Switch
                          checked={draft.openEnded}
                          onCheckedChange={(on) => {
                            set({ openEnded: on });
                          }}
                        />
                      </FieldControl>
                    </Field>
                  ) : null}
                  {WITH_OPTIONS.has(draft.dataType) ? (
                    <TagsInput
                      label={t('settings.field-editor.options', 'Options')}
                      value={draft.options}
                      invalid={show.options !== undefined}
                      hint={
                        show.options ??
                        (editing
                          ? t(
                              'settings.field-editor.type_one_then_press_enter_a',
                              'Type one, then press Enter. A removed option is retired: records holding it are reviewed when you publish.',
                            )
                          : t(
                              'settings.field-editor.type_one_then_press_enter_add',
                              'Type one, then press Enter. Add as many as you need.',
                            ))
                      }
                      onChange={(options) => {
                        set({ options });
                      }}
                    />
                  ) : null}
                  <Field>
                    <FieldLabel>{t('settings.field-editor.help_text', 'Help text')}</FieldLabel>
                    <FieldControl>
                      <Textarea
                        value={draft.description}
                        placeholder={t(
                          'settings.field-editor.optional_what_to_enter_and_why',
                          'Optional. What to enter, and why you ask.',
                        )}
                        onChange={(e) => {
                          set({ description: e.target.value });
                        }}
                      />
                    </FieldControl>
                    <FieldDescription>
                      {t(
                        'settings.field-editor.shown_under_the_field_on_every',
                        'Shown under the field on every form.',
                      )}
                    </FieldDescription>
                  </Field>
                  <Accordion
                    type="single"
                    collapsible
                    value={show.key === undefined ? advanced : 'key'}
                    onValueChange={setAdvanced}
                  >
                    <AccordionItem value="key">
                      <AccordionTrigger meta={<span className="font-mono">{draft.key}</span>}>
                        {t('settings.field-editor.key_for_integrations', 'Key for integrations')}
                      </AccordionTrigger>
                      <AccordionContent>
                        <Field invalid={show.key !== undefined} disabled={editing}>
                          <FieldLabel>{t('settings.field-editor.key', 'Key')}</FieldLabel>
                          <FieldControl>
                            <Input
                              className="font-mono"
                              value={draft.key}
                              onChange={(e) => {
                                setKeyEdited(true);
                                set({ key: e.target.value });
                              }}
                            />
                          </FieldControl>
                          <FieldDescription>
                            {t(
                              'settings.field-editor.used_by_exports_and_integrations_generated',
                              'Used by exports and integrations. Generated from the name and fixed once published.',
                            )}
                          </FieldDescription>
                          <FieldError>{show.key}</FieldError>
                        </Field>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Stack>
              ) : null}

              {step === 1 ? (
                <Stack gap={4}>
                  <Field orientation="horizontal" className="items-start justify-between gap-4">
                    <div>
                      <FieldLabel>
                        {t(
                          'settings.field-editor.everyone_at_the_company_can_see',
                          'Everyone at the company can see it',
                        )}
                      </FieldLabel>
                      <FieldDescription>
                        {seenByEveryone(draft.visibility)
                          ? t(
                              'settings.field-editor.shows_in_the_directory_so_every',
                              'Shows in the directory, so every See box below is ticked.',
                            )
                          : t(
                              'settings.field-editor.off_only_the_groups_ticked_below',
                              'Off: only the groups ticked below can see it.',
                            )}
                      </FieldDescription>
                    </div>
                    <FieldControl>
                      <Switch
                        checked={seenByEveryone(draft.visibility)}
                        onCheckedChange={(on) => {
                          set({ visibility: withEveryone(on, draft.visibility) });
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <AccessMatrix
                    label={t(
                      'settings.field-editor.who_can_see_and_change_it',
                      'Who can see and change it',
                    )}
                    audiences={AUDIENCES}
                    value={accessOf(draft.visibility, draft.ownership)}
                    allSee={seenByEveryone(draft.visibility)}
                    onChange={(next) => {
                      set(fromAccess(next, draft));
                    }}
                  />
                  {show.ownership === undefined ? null : (
                    <Alert tone="danger">{show.ownership}</Alert>
                  )}
                  {show.visibility === undefined ? null : (
                    <Alert tone="danger">{show.visibility}</Alert>
                  )}
                  <Accordion
                    type="single"
                    collapsible
                    defaultValue={draft.visibilityRules.length > 0 ? 'rules' : ''}
                  >
                    <AccordionItem value="rules">
                      <AccordionTrigger
                        meta={
                          draft.visibilityRules.length === 0
                            ? t('settings.field-editor.no_exceptions', 'No exceptions')
                            : t(
                                'settings.field-editor.text',
                                { one: '{{count}} rule', other: '{{count}} rules' },
                                { count: draft.visibilityRules.length },
                              )
                        }
                      >
                        {t(
                          'settings.field-editor.let_more_people_see_it_on',
                          'Let more people see it, on some records only',
                        )}
                      </AccordionTrigger>
                      <AccordionContent>
                        <Rules
                          draft={draft}
                          set={set}
                          choices={choices}
                          others={others}
                          problem={show.rules}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Stack>
              ) : null}

              {step === 2 ? (
                <Stack gap={4}>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">
                      {t('settings.field-editor.when_is_it_asked', 'When is it asked?')}
                    </legend>
                    <RadioGroup
                      value={draft.collectAt}
                      onValueChange={(value) => {
                        set({ collectAt: value as CollectAt });
                      }}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      {COLLECT.map((when) => (
                        <RadioCard
                          key={when}
                          value={when}
                          description={t(
                            'settings.field-editor.text_2',
                            '{{description}} {{example}}',
                            {
                              description: COLLECT_LABEL[when].description,
                              example: COLLECT_LABEL[when].example,
                            },
                          )}
                        >
                          {COLLECT_LABEL[when].label}
                        </RadioCard>
                      ))}
                    </RadioGroup>
                  </fieldset>
                  <StageNote draft={draft} />
                  <Field>
                    <FieldLabel>
                      {t('settings.field-editor.is_it_required', 'Is it required?')}
                    </FieldLabel>
                    <SegmentedControl
                      aria-label={t('settings.field-editor.is_it_required', 'Is it required?')}
                      value={draft.requiredness}
                      onValueChange={(requiredness) => {
                        set({ requiredness: requiredness as RequirednessMode });
                      }}
                    >
                      <SegmentedControlItem value="never">
                        {REQUIREDNESS_LABEL.never}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="always">
                        {t('settings.field-editor.required_for_everyone', 'Required for everyone')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="conditional">
                        {t('settings.field-editor.required_when', 'Required when…')}
                      </SegmentedControlItem>
                    </SegmentedControl>
                    <FieldDescription>
                      {t(
                        'settings.field-editor.required_fields_count_towards_a_complete',
                        'Required fields count towards a complete record. People who already have one are reminded at most once a week.',
                      )}
                    </FieldDescription>
                  </Field>
                  {draft.requiredness === 'conditional' ? (
                    <Stack gap={2}>
                      <PredicateEditor
                        legend={t('settings.field-editor.required_when_2', 'Required when')}
                        value={draft.requiredWhen}
                        onChange={(requiredWhen) => {
                          set({ requiredWhen });
                        }}
                        choices={choices}
                        fields={others}
                      />
                      {show.requiredWhen === undefined ? null : (
                        <Alert tone="danger">{show.requiredWhen}</Alert>
                      )}
                    </Stack>
                  ) : null}
                  {show.unseen === undefined ? null : <Alert tone="danger">{show.unseen}</Alert>}
                </Stack>
              ) : null}

              {step === 3 ? (
                <Stack gap={5}>
                  <Classify
                    advice={advice}
                    value={draft.classification}
                    confirmed={draft.confirmedSpecial}
                    problem={show.kind}
                    onChange={(classification) => {
                      set({ classification, confirmedSpecial: false });
                    }}
                    onConfirm={(confirmedSpecial) => {
                      set({ confirmedSpecial });
                    }}
                  />
                  <fieldset className="flex flex-col gap-4">
                    <legend className="mb-1 text-sm font-medium">
                      {t('settings.field-editor.protection', 'Protection')}
                    </legend>
                    <Toggle
                      label={t('settings.field-editor.store_it_encrypted', 'Store it encrypted')}
                      description={sealWhy}
                      checked={sealed}
                      disabled={sealLocked}
                      onChange={(on) => {
                        set({ encrypted: on });
                      }}
                    />
                    <Toggle
                      label={t(
                        'settings.field-editor.changes_need_a_second_hr_approval',
                        'Changes need a second HR approval',
                      )}
                      description={t(
                        'settings.field-editor.the_old_value_stays_until_someone',
                        'The old value stays until someone else approves.',
                      )}
                      checked={approval}
                      onChange={(on) => {
                        set({ requiresApproval: on });
                      }}
                    />
                    {onAssistant === undefined ? null : (
                      <Toggle
                        label={t(
                          'settings.field-editor.shared_with_the_assistant',
                          'Shared with the assistant',
                        )}
                        description={
                          shareable
                            ? t(
                                'settings.field-editor.kithena_and_chat_apps_learn_its',
                                'Kithena and chat apps learn its name and options, never values.',
                              )
                            : t(
                                'settings.field-editor.confidential_special_category_or_encrypted_never',
                                'Confidential, special-category or encrypted: never shared with the assistant.',
                              )
                        }
                        checked={shared}
                        disabled={!shareable}
                        onChange={setSharing}
                      />
                    )}
                  </fieldset>
                </Stack>
              ) : null}

              {step === 4 ? (
                <Stack gap={4}>
                  <Review
                    draft={draft}
                    sections={sections}
                    section={section}
                    approval={approval}
                    encrypted={sealed}
                    shared={onAssistant === undefined ? null : shared}
                    onChange={goTo}
                  />
                  {field === null ? (
                    <Alert
                      tone="neutral"
                      title={t(
                        'settings.field-editor.what_changes_when_you_publish',
                        'What changes when you publish',
                      )}
                    >
                      {t(
                        'settings.field-editor.the_field_is_added_to_the',
                        'The field is added to the draft. Nobody sees it until the next version is published.',
                      )}
                    </Alert>
                  ) : (
                    <Changes field={field} draft={draft} approval={approval} />
                  )}
                </Stack>
              ) : null}

              {refused === null ? null : (
                <Alert tone="danger" title={t('settings.field-editor.not_saved', 'Not saved')}>
                  {refused}
                </Alert>
              )}
            </Stack>

            <aside aria-label={t('settings.field-editor.preview', 'Preview')}>
              <Card variant="fill" padded>
                <Stack gap={4}>
                  <Preview draft={draft} approval={approval} />
                  <Separator />
                  <Stack gap={2}>
                    <p className="text-sm font-semibold text-fg-muted">
                      {t('settings.field-editor.in_plain_words', 'In plain words')}
                    </p>
                    <p className="text-sm leading-7 text-pretty">
                      {summaryParts({
                        label: draft.label,
                        ownership: draft.ownership,
                        collectAt: draft.collectAt,
                        requiredness: draft.requiredness,
                        visibility: draft.visibility,
                        rules: draft.visibilityRules.length,
                        classification: draft.classification,
                        requiresApproval: approval,
                        encrypted: sealed,
                      }).map((part, i) => (
                        <span key={i}>
                          {i === 0 ? '' : ' '}
                          {part.step === step ? (
                            <mark className="rounded-sm bg-accent-subtle px-1 font-semibold text-accent-fg [box-decoration-break:clone]">
                              {part.text}
                            </mark>
                          ) : (
                            part.text
                          )}
                        </span>
                      ))}
                    </p>
                  </Stack>
                </Stack>
              </Card>
            </aside>
          </div>
        </DialogBody>
        <DialogFooter>
          <p className="me-auto text-sm text-fg-muted touch:hidden">
            {t(
              'settings.field-editor.saved_as_a_draft_applied_when',
              'Saved as a draft, applied when you publish.',
            )}
          </p>
          {step > 0 ? (
            <Button
              variant="ghost"
              onClick={() => {
                goTo(step - 1);
              }}
            >
              {t('settings.field-editor.back', 'Back')}
            </Button>
          ) : editing ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('settings.field-editor.cancel', 'Cancel')}
            </Button>
          )}
          {last ? null : (
            <Button variant={editing ? 'secondary' : 'primary'} onClick={next}>
              {t('settings.field-editor.next', 'Next: {{value}}', {
                value: STEPS[step + 1]?.label ?? '',
              })}
            </Button>
          )}
          {editing || last ? (
            <Button
              variant="primary"
              loading={saving}
              loadingLabel={t('settings.field-editor.saving_the_field', 'Saving the field')}
              // Save waits while the suggestion is worked out (F7).
              disabled={advice === 'asking' || (advice === null && draft.label.trim() !== '')}
              onClick={() => {
                void save();
              }}
            >
              {editing
                ? t('settings.field-editor.save_field', 'Save field')
                : t('settings.field-editor.add_field', 'Add field')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A switch with its name and why, on one row. */
function Toggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (on: boolean) => void;
}): JSX.Element {
  return (
    <Field orientation="horizontal" className="items-start justify-between gap-4">
      <div>
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </div>
      <FieldControl>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </FieldControl>
    </Field>
  );
}

/** Custom visibility rules (PEO-066): a preset scope, on some records only. */
function Rules({
  draft,
  set,
  choices,
  others,
  problem,
}: {
  readonly draft: Draft;
  readonly set: (patch: Partial<Draft>) => void;
  readonly choices: RegistryDraft['choices'];
  readonly others: readonly PredicateField[];
  readonly problem: string | undefined;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">
        {t(
          'settings.field-editor.let_more_people_see_it_on',
          'Let more people see it, on some records only',
        )}
      </legend>
      <p className="text-sm text-fg-muted">
        {t(
          'settings.field-editor.give_extra_access_on_matching_records',
          'Give extra access on matching records only, for example managers on contractors’ records.',
        )}
      </p>
      {draft.visibilityRules.map((rule, index) => {
        const name = t('settings.field-editor.rule_n', 'Rule {{n}}', { n: index + 1 });
        const change = (changed: VisibilityRule): void => {
          set({
            visibilityRules: draft.visibilityRules.map((r, i) => (i === index ? changed : r)),
          });
        };
        return (
          // Positional: a rule has no identity beyond its place.
          <Card key={index}>
            <CardContent>
              <Stack gap={3}>
                <Field>
                  <FieldLabel>
                    {name}
                    {t('settings.field-editor.who_else_can_see_it', ': who else can see it')}
                  </FieldLabel>
                  <FieldControl>
                    <Combobox
                      label={t(
                        'settings.field-editor.who_else_can_see_it_2',
                        '{{name}}: who else can see it',
                        { name },
                      )}
                      multiple
                      placeholder={t('settings.field-editor.choose_who', 'Choose who')}
                      options={SCOPES.map((scope) => ({
                        value: scope,
                        label: SCOPE_LABEL[scope],
                      }))}
                      value={rule.scopes}
                      onChange={(scopes) => {
                        change({
                          ...rule,
                          scopes: (Array.isArray(scopes) ? scopes : []) as ViewerScope[],
                        });
                      }}
                    />
                  </FieldControl>
                </Field>
                <PredicateEditor
                  legend={t('settings.field-editor.when', '{{name}}: when', { name })}
                  value={rule.when}
                  onChange={(when) => {
                    change({ ...rule, when });
                  }}
                  choices={choices}
                  fields={others}
                />
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      set({
                        visibilityRules: draft.visibilityRules.filter((_, i) => i !== index),
                      });
                    }}
                  >
                    {t('settings.field-editor.remove', 'Remove')} {name.toLowerCase()}
                  </Button>
                </div>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
      {problem === undefined ? null : <Alert tone="danger">{problem}</Alert>}
      {draft.visibilityRules.length < MOST_RULES ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              set({
                visibilityRules: [
                  ...draft.visibilityRules,
                  { scopes: ['manager'], when: EMPTY_PREDICATE },
                ],
              });
            }}
          >
            {t('settings.field-editor.add_a_rule', 'Add a rule')}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-fg-muted">
        {t(
          'settings.field-editor.a_rule_applies_only_to_matching',
          'A rule applies only to matching records, and only to people who can see the fields it checks.',
        )}
      </p>
    </fieldset>
  );
}

/** The last step (F8): one line per step, each with the way back to it. */
function Review({
  draft,
  sections,
  section,
  approval,
  encrypted,
  shared,
  onChange,
}: {
  readonly draft: Draft;
  readonly sections: readonly RegistrySection[];
  readonly section: RegistrySection;
  readonly approval: boolean;
  readonly encrypted: boolean;
  /** Null where the assistant is not offered. */
  readonly shared: boolean | null;
  readonly onChange: (step: number) => void;
}): JSX.Element {
  const where = sections.find((s) => s.key === draft.sectionKey)?.label ?? section.label;
  const rows: readonly { step: number; label: string; value: string }[] = [
    {
      step: 0,
      label: t('settings.field-editor.the_field', 'The field'),
      value: [
        `${draft.label.trim() || 'Unnamed'} · ${DATA_TYPE_LABEL[draft.dataType]} · ${where}`,
        draft.description.trim() === '' ? null : `Help text: “${draft.description.trim()}”`,
      ]
        .filter((x) => x !== null)
        .join('. '),
    },
    {
      step: 1,
      label: t('settings.field-editor.access', 'Access'),
      value: `${opening(writers(draft.ownership))} can change it. ${
        seenByEveryone(draft.visibility)
          ? 'Everyone can see it.'
          : `${opening(readers(draft.visibility))} can see it.`
      }`,
    },
    {
      step: 2,
      label: t('settings.field-editor.when_its_asked', 'When it’s asked'),
      value: `${COLLECT_LABEL[draft.collectAt].label} · ${
        draft.requiredness === 'always'
          ? 'required for everyone'
          : draft.requiredness === 'conditional'
            ? 'required when its conditions hold'
            : 'optional'
      }`,
    },
    {
      step: 3,
      label: t('settings.field-editor.sensitivity', 'Sensitivity'),
      value: [
        draft.classification === null
          ? 'Still to choose'
          : CLASSIFICATION_LABEL[draft.classification].label,
        encrypted ? 'encrypted' : null,
        approval ? 'second HR approval' : null,
        shared === null
          ? null
          : shared
            ? 'shared with the assistant'
            : 'not shared with the assistant',
      ]
        .filter((x) => x !== null)
        .join(' · '),
    },
  ];
  return (
    <dl className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-start gap-4 py-3 ${i === rows.length - 1 ? '' : 'border-b border-border'}`}
        >
          <dt className="w-32 shrink-0 text-sm text-fg-muted">{row.label}</dt>
          <dd className="min-w-0 flex-1 text-sm font-medium text-pretty">{row.value}</dd>
          <dd>
            <Button
              size="sm"
              variant="link"
              aria-label={t('settings.field-editor.change_2', 'Change {{label}}', {
                label: row.label.toLowerCase(),
              })}
              onClick={() => {
                onChange(row.step);
              }}
            >
              {t('settings.field-editor.change', 'Change')}
            </Button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const opening = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The last part: the judgment, drawn as it was decided (§12.3).
 *
 * Every option at or above the floor is offered and none below it. A number
 * the admin can see is a number they can disagree with, so the reason is shown
 * rather than a silent pre-selection.
 */
function Classify({
  advice,
  value,
  confirmed,
  problem,
  onChange,
  onConfirm,
}: {
  readonly advice: ClassificationAdvice | 'asking' | 'failed' | null;
  readonly value: Classification | null;
  readonly confirmed: boolean;
  readonly problem: string | undefined;
  readonly onChange: (value: Classification) => void;
  readonly onConfirm: (value: boolean) => void;
}): JSX.Element {
  if (advice === 'asking' || advice === null) {
    return (
      <Spinner
        label={t(
          'settings.field-editor.working_out_what_kind_of_data',
          'Working out what kind of data this is',
        )}
      />
    );
  }

  const floor: Classification =
    advice === 'failed' ? 'public' : advice.kind === 'protect' ? 'special-category' : advice.floor;
  const reasons = new Map<Classification, string>();
  if (typeof advice === 'object') {
    if (advice.kind === 'choose')
      for (const o of advice.options) reasons.set(o.classification, o.reason);
    else if (advice.kind === 'suggest') reasons.set(advice.classification, advice.reason);
  }
  const offered = CLASSIFICATION_ORDER.filter((c) => atLeast(c, floor)).toReversed();

  return (
    <Stack gap={4}>
      {advice === 'failed' ? (
        <Alert
          tone="warning"
          title={t('settings.field-editor.no_suggestion_this_time', 'No suggestion this time')}
        >
          {t(
            'settings.field-editor.choose_what_fits_nothing_is_suggested',
            'Choose what fits. Nothing is suggested, so nothing is pre-selected.',
          )}
        </Alert>
      ) : advice.kind === 'protect' ? (
        <Alert
          tone="warning"
          title={t(
            'settings.field-editor.this_looks_like_special_category_data',
            'This looks like special-category data',
          )}
        >
          {advice.reason}
        </Alert>
      ) : advice.kind === 'choose' ? (
        <Alert
          tone="info"
          title={t('settings.field-editor.two_answers_are_close', 'Two answers are close')}
        >
          {t(
            'settings.field-editor.nothing_is_pre_selected_each_option',
            'Nothing is pre-selected. Each option says why it might fit.',
          )}
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          {t('settings.field-editor.what_kind_of_data_is_this', 'What kind of data is this?')}
        </legend>
        <RadioGroup
          value={value ?? ''}
          onValueChange={(next) => {
            onChange(next as Classification);
          }}
        >
          {offered.map((c) => (
            <RadioCard
              key={c}
              value={c}
              description={reasons.get(c) ?? CLASSIFICATION_LABEL[c].description}
            >
              {CLASSIFICATION_LABEL[c].label}
              {typeof advice === 'object' &&
              advice.kind === 'suggest' &&
              advice.classification === c
                ? t('settings.field-editor.suggested_suffix', ' (suggested)')
                : ''}
            </RadioCard>
          ))}
        </RadioGroup>
      </fieldset>

      {value === 'special-category' ? (
        <Field orientation="horizontal" className="justify-start" invalid={problem !== undefined}>
          <FieldControl>
            <Checkbox
              checked={confirmed}
              onCheckedChange={(on) => {
                onConfirm(on === true);
              }}
            />
          </FieldControl>
          <FieldLabel>
            {t(
              'settings.field-editor.i_confirm_this_is_special_category',
              'I confirm this is special-category data. It will be excluded from AI, events and standard exports.',
            )}
          </FieldLabel>
        </Field>
      ) : null}
      {problem === undefined ? null : <Alert tone="danger">{problem}</Alert>}
    </Stack>
  );
}

/**
 * The field as a form will draw it, from the same control the profile and
 * onboarding use. Typing into it saves nothing.
 */
function Preview({ draft, approval }: { readonly draft: Draft; readonly approval: boolean }) {
  const [value, setValue] = useState<AttributeValue>(null);
  // A value typed for one type means nothing to the next.
  useEffect(() => {
    setValue(null);
  }, [draft.dataType]);
  const uploaded = draft.dataType === 'document_ref' || draft.dataType === 'image';
  const field = {
    key: 'preview',
    label:
      draft.label.trim() === ''
        ? t('settings.field-editor.your_new_field', 'Your new field')
        : draft.label.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    dataType: draft.dataType,
    options: draft.options.map((o) => ({ value: o, label: o })),
    required: draft.requiredness === 'always',
    readOnly: false,
    sensitive: approval,
  };
  return (
    <Stack gap={3}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-fg-muted">
          {t('settings.field-editor.preview', 'Preview')}
        </p>
        <p className="text-xs text-fg-subtle">
          {t('settings.field-editor.try_it_nothing_is_saved', 'Try it; nothing is saved')}
        </p>
      </div>
      {uploaded ? (
        <p className="text-sm text-fg-muted">
          {t(
            'settings.field-editor.uploaded_on_the_profile_rather_than',
            'Uploaded on the profile rather than typed into a form.',
          )}
        </p>
      ) : (
        <AttributeInput field={field} value={value} onChange={setValue} />
      )}
    </Stack>
  );
}

/** What the chosen stage means for who fills the field in, where the two disagree. */
function StageNote({ draft }: { readonly draft: Draft }): JSX.Element | null {
  const employee = draft.ownership.includes('employee');
  if (
    (draft.collectAt === 'signup' || draft.collectAt === 'enrolment') &&
    (draft.dataType === 'image' || draft.dataType === 'document_ref')
  ) {
    return (
      <Alert
        tone="info"
        title={t(
          'settings.field-editor.asked_on_the_first_screen_after',
          'Asked on the first screen after sign-up',
        )}
      >
        {employee
          ? t(
              'settings.field-editor.files_are_requested_on_the_first',
              'Files are requested on the first screen after account setup.',
            )
          : t(
              'settings.field-editor.only_the_employee_can_answer_there',
              'Only the employee can answer there. Tick The employee under Who can change it, or choose another moment.',
            )}
      </Alert>
    );
  }
  if (draft.collectAt === 'signup' || draft.collectAt === 'enrolment') {
    return (
      <Alert
        tone="info"
        title={t(
          'settings.field-editor.shown_on_the_account_setup_page',
          'Shown on the account setup page',
        )}
      >
        {employee
          ? t(
              'settings.field-editor.the_person_answers_it_while_setting',
              'The person answers it while setting up their account, before they have used Kithena.',
            )
          : t(
              'settings.field-editor.only_the_employee_can_answer_on',
              'Only the employee can answer on that page. Tick The employee under Who can change it, or choose another moment.',
            )}
      </Alert>
    );
  }
  if (draft.collectAt === 'hr_only' && employee) {
    return (
      <Alert
        tone="warning"
        title={t(
          'settings.field-editor.the_employee_is_never_shown_this',
          'The employee is never shown this field',
        )}
      >
        {t(
          'settings.field-editor.they_are_allowed_to_change_it',
          'They are allowed to change it, but no form ever asks them, so in practice only',
        )}{' '}
        {listed(draft.ownership.filter((w) => w !== 'employee').map((w) => WRITER_LABEL[w])) ||
          'nobody'}{' '}
        {t('settings.field-editor.fills_it_in', 'fills it in.')}
      </Alert>
    );
  }
  if (draft.collectAt !== 'hr_only' && !employee) {
    return (
      <Alert tone="info">
        {t(
          'settings.field-editor.employees_cant_edit_this_field_to',
          'Employees can’t edit this field. To ask them for it, allow the employee to change it.',
        )}
      </Alert>
    );
  }
  return null;
}

/**
 * Whether a save changed what a value may be: its type, an option taken off
 * the list, its decimals or its currency. People decides for certain
 * (`needsReview`); this only chooses whether to open the review after saving.
 */
function reformatted(field: RegistryField, draft: Draft): boolean {
  return (
    draft.dataType !== field.dataType ||
    field.options.some((o) => !draft.options.includes(o)) ||
    (WITH_DECIMALS.has(draft.dataType) && (draft.decimals ?? 0) !== (field.decimals ?? 0)) ||
    (draft.dataType === 'money' && draft.currency !== (field.currency ?? '')) ||
    // Taking "indefinite" away may leave an indefinite value that no longer fits.
    (field.openEnded === true && !draft.openEnded)
  );
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

const writers = (w: readonly WriterRole[]) => listed(w.map((x) => WRITER_LABEL[x])) || 'nobody';
const readers = (v: readonly ViewerScope[]) => listed(v.map((x) => SCOPE_LABEL[x])) || 'nobody';

/** Editing a published field: what publishing this draft would change about it. */
function Changes({
  field,
  draft,
  approval,
}: {
  readonly field: RegistryField;
  readonly draft: Draft;
  readonly approval: boolean;
}): JSX.Element {
  const lines: string[] = [];
  if (draft.dataType !== field.dataType) {
    lines.push(
      `Type: ${DATA_TYPE_LABEL[field.dataType]} → ${DATA_TYPE_LABEL[draft.dataType]}. You review every value before it’s published`,
    );
  }
  if (draft.label.trim() !== field.label)
    lines.push(`Name: ${field.label} → ${draft.label.trim()}`);
  if (draft.description.trim() !== (field.description ?? '')) lines.push('Help text reworded');
  if (!sameSet(draft.options, field.options)) lines.push('Options changed');
  if (draft.collectAt !== field.collectAt) {
    lines.push(
      `When it is asked: ${COLLECT_LABEL[field.collectAt].label} → ${COLLECT_LABEL[draft.collectAt].label}`,
    );
  }
  if (draft.requiredness !== field.requiredness) {
    lines.push(
      `Required: ${REQUIREDNESS_LABEL[field.requiredness]} → ${REQUIREDNESS_LABEL[draft.requiredness]}`,
    );
  } else if (
    draft.requiredness === 'conditional' &&
    JSON.stringify(draft.requiredWhen) !== JSON.stringify(field.requiredWhen)
  ) {
    lines.push('The conditions that make it required');
  }
  if (!sameSet(draft.ownership, field.ownership)) {
    lines.push(`Who can change it: ${writers(field.ownership)} → ${writers(draft.ownership)}`);
  }
  if (!sameSet(draft.visibility, field.visibility)) {
    lines.push(`Who can see it: ${readers(field.visibility)} → ${readers(draft.visibility)}`);
  }
  if (JSON.stringify(draft.visibilityRules) !== JSON.stringify(field.visibilityRules)) {
    lines.push('Who else can see it, on some records');
  }
  if (field.requiresApproval !== undefined && approval !== field.requiresApproval) {
    lines.push(approval ? 'Changes will need approval' : 'Changes will no longer need approval');
  }
  if (draft.classification !== null && draft.classification !== field.classification) {
    lines.push(
      `What kind of data: ${CLASSIFICATION_LABEL[field.classification].label} → ${CLASSIFICATION_LABEL[draft.classification].label}`,
    );
  }
  const tightened =
    field.requiredness === 'never' && draft.requiredness !== 'never'
      ? true
      : field.requiredness === 'conditional' && draft.requiredness === 'always';

  if (lines.length === 0) {
    return (
      <Alert
        tone="info"
        title={t('settings.field-editor.nothing_changed_yet', 'Nothing changed yet')}
      >
        {t(
          'settings.field-editor.saving_keeps_the_field_as_it',
          'Saving keeps the field as it is.',
        )}
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title={t(
        'settings.field-editor.what_changes_when_you_publish',
        'What changes when you publish',
      )}
    >
      <ul className="list-disc ps-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2">
        {t(
          'settings.field-editor.saving_changes_the_draft_only_nobodys',
          'Saving changes the draft only; nobody’s forms change until you publish.',
        )}
        {tightened
          ? ' ' +
            t(
              'settings.field-editor.records_without_a_value_then_become',
              'Records without a value then become incomplete, and the publish step says how many.',
            )
          : ''}
      </p>
    </Alert>
  );
}
