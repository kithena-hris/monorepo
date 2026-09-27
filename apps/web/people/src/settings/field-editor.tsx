import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  KeyValues,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
  Stack,
  Stepper,
  TagsInput,
  Textarea,
  useBreakpoint,
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
import { readBack, summary } from './read-back';
import {
  CLASSIFICATION_LABEL,
  COLLECT_LABEL,
  DATA_TYPE_GROUPS,
  DATA_TYPE_HINT,
  DATA_TYPE_LABEL,
  REQUIREDNESS_LABEL,
  SCOPE_HINT,
  SCOPE_LABEL,
  WRITER_HINT,
  WRITER_LABEL,
  keyFromLabel,
  listed,
} from './words';

/**
 * The four steps: what it is, who sees and edits it, when it is asked, and a
 * review. Classification sits in the review, last, as §9.2 argues: it is the
 * choice most likely to be clicked through, and by then the form knows enough
 * for the suggestion to be good.
 */
const STEPS = [
  { id: 'what', label: 'The field' },
  { id: 'who', label: 'Who sees it' },
  { id: 'when', label: 'When asked' },
  { id: 'review', label: 'Review' },
] as const;

/** The people a form is filled in by. `system` and `external` are integrations. */
const OWNERS: readonly WriterRole[] = ['employee', 'manager', 'hr', 'finance'];
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
    label: 'T-shirt size',
    description: 'For company clothing.',
    dataType: 'select',
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
  {
    label: 'Pronouns',
    description: 'How they would like to be referred to.',
    dataType: 'text',
    options: [],
    ownership: ['employee'],
    collectAt: 'signup',
    visibility: ['self', 'manager', 'hr', 'directory'],
  },
  {
    label: 'Emergency contact name',
    description: 'Who to call if something happens at work.',
    dataType: 'text',
    options: [],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
  {
    label: 'Emergency contact phone',
    description: 'Their number, with the country code.',
    dataType: 'phone',
    options: [],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    visibility: ['self', 'hr'],
  },
];
const WITH_OPTIONS: ReadonlySet<DataType> = new Set(['select', 'multi_select']);
const KEY = /^[a-z][a-z0-9_]{0,62}$/;

interface Draft {
  label: string;
  key: string;
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
}

function draftFrom(section: RegistrySection, field: RegistryField | null): Draft {
  if (field !== null) {
    return {
      label: field.label,
      key: field.key,
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
    };
  }
  return {
    label: '',
    key: '',
    description: '',
    dataType: 'text',
    options: [],
    requiredness: 'never',
    requiredWhen: EMPTY_PREDICATE,
    ownership: section.ownership,
    // Asked of the employee in onboarding when they fill the section in;
    // otherwise HR's alone. Both choices are explained in step 3.
    collectAt: section.ownership.includes('employee') ? 'onboarding' : 'hr_only',
    // Defaulted from the section, which is what §9.2 asks: most fields are
    // seen by whoever sees the rest of their section.
    visibility: section.visibility,
    visibilityRules: [],
    classification: null,
    confirmedSpecial: false,
    requiresApproval: null,
  };
}

/**
 * What a field defaults to when nobody chose (PEO-077), as People computes
 * it: on for financial data and for anything stored encrypted.
 */
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
      return `${named.label} is special-category data, so it cannot decide whether a field is required: a missing value would tell whoever sees it that the condition held.`;
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
      | 'unseen',
      string
    >
  > = {};
  if (step === 0) {
    if (draft.label.trim() === '') problems.label = 'Give the field a name.';
    if (!KEY.test(draft.key)) {
      problems.key = 'Lower-case letters, digits and underscores, starting with a letter.';
    } else if (keyTaken(draft.key)) {
      problems.key = 'Another field already uses this key.';
    }
    if (WITH_OPTIONS.has(draft.dataType) && draft.options.length === 0) {
      problems.options = 'Add at least one option.';
    }
  }
  if (step === 1 && draft.ownership.length === 0) {
    problems.ownership = 'Somebody has to be able to fill it in.';
  }
  if (step === 2 && draft.requiredness === 'conditional') {
    const problem =
      predicateProblem(draft.requiredWhen) ?? specialCategoryProblem(draft.requiredWhen, others);
    if (problem !== null) problems.requiredWhen = problem;
  }
  // Checked again where requiredness is chosen: a required field needs
  // somebody who can always read it, not only through a rule.
  if (step === 2 && draft.requiredness !== 'never' && draft.visibility.length === 0) {
    problems.unseen =
      'A required field needs somebody who can always see it. Go back a step and choose who can see it.';
  }
  if (step === 1) {
    // A rule holds of some records, so it is no answer for a required field:
    // the contract asks for a preset reader then, and so does this.
    if (
      draft.visibility.length === 0 &&
      (draft.visibilityRules.length === 0 || draft.requiredness !== 'never')
    ) {
      problems.visibility = 'Nobody could ever read it. Choose at least one.';
    }
    for (const rule of draft.visibilityRules) {
      const problem =
        rule.scopes.length === 0
          ? 'Every rule shows the field to somebody.'
          : predicateProblem(rule.when);
      if (problem !== null) problems.rules = problem;
    }
  }
  if (step === 3) {
    if (draft.classification === null) problems.kind = 'Choose what kind of data this is.';
    else if (draft.classification === 'special-category' && !draft.confirmedSpecial) {
      problems.kind = 'Special-category data needs your explicit confirmation.';
    } else if (draft.classification === 'special-category' && draft.visibilityRules.length > 0) {
      problems.kind =
        'Special-category data is never shown by a rule. Remove the rules under Who sees it.';
    }
  }
  return problems;
}

function toggled<T>(list: readonly T[], item: T, on: boolean): readonly T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item);
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
  /** The classification judgment, from metadata only. Never a value (§12.3). */
  readonly advise: (field: Described) => Promise<ClassificationAdvice>;
  readonly onSave: (input: FieldInput) => Promise<Outcome>;
}

/**
 * Adding or changing one field, in a sheet, in four steps (§9.2).
 *
 * Classification is the last step because it is the one most likely to be
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
  advise,
  onSave,
}: FieldEditorProps): JSX.Element {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(section, field));
  const [keyEdited, setKeyEdited] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [shown, setShown] = useState(false);
  const [advice, setAdvice] = useState<ClassificationAdvice | 'asking' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const asked = useRef(0);
  const wide = useBreakpoint('sm');

  // A fresh draft every time the sheet opens, so a cancelled edit leaves nothing behind.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDraft(draftFrom(section, field));
    setKeyEdited(field !== null);
    setAdvanced('');
    setShown(false);
    setAdvice(null);
    setRefused(null);
    asked.current += 1;
  }, [open, section, field]);

  const editing = field !== null;
  const others = fields.filter((f) => f.key !== draft.key);
  const problems = problemsIn(step, draft, (key) => !editing && takenKeys.includes(key), others);
  const blocked = Object.keys(problems).length > 0;
  const set = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  /*
   * Ask for the judgment on arriving at the last step, from what was described
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

  const next = (): void => {
    setShown(true);
    if (blocked) return;
    setShown(false);
    if (step + 1 === STEPS.length - 1) ask(draft);
    setStep(step + 1);
  };

  const save = async (): Promise<void> => {
    setShown(true);
    if (blocked || draft.classification === null) return;
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
      sectionKey: section.key,
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
    });
    setSaving(false);
    if (outcome.ok) onOpenChange(false);
    else setRefused(outcome.message);
  };

  const show = shown ? problems : {};
  const piiKind = typeof advice === 'object' && advice !== null ? advice.piiKind : 'none';
  // What People will store: encrypted for these, whatever the admin says.
  const encrypted = approvalByDefault(draft.dataType, piiKind);
  const approval = draft.requiresApproval ?? encrypted;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* From the side at a desk, from the bottom on a phone (§17.2). */}
      <SheetContent side={wide ? 'right' : 'bottom'} size="xl">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${field.label}` : 'New field'}</SheetTitle>
          <SheetDescription>
            {section.label} · step {step + 1} of {STEPS.length}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="pt-6 pb-8">
          {/* The form, and beside it on a desk the field as it will look: kept
              in view on every step, so each choice shows where it lands. */}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <Stack gap={6} className="min-w-0">
              {field !== null && field.origin !== 'tenant' ? (
                <Alert tone="info" title="Built into Kithena">
                  You can rename it, explain it, and change who fills it in and who sees it. Its
                  type stays, and its protection can be made stricter but never looser.
                </Alert>
              ) : null}
              <Stepper
                label="Adding a field"
                size="sm"
                steps={STEPS}
                current={step}
                onStepChange={(index) => {
                  setStep(index);
                }}
              />

              {step === 0 ? (
                <Stack gap={5}>
                  {editing ? null : (
                    <Stack gap={2}>
                      <p className="text-sm font-medium">Start from a common field</p>
                      <div className="flex flex-wrap gap-2">
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
                              {taken ? ' (added)' : ''}
                            </Button>
                          );
                        })}
                      </div>
                      <p className="text-sm text-fg-muted">
                        Fills in every step with sensible answers. You can change any of them.
                      </p>
                    </Stack>
                  )}
                  <Field required invalid={show.label !== undefined}>
                    <FieldLabel>Field name</FieldLabel>
                    <FieldControl>
                      <Input
                        value={draft.label}
                        placeholder="T-shirt size"
                        onChange={(e) => {
                          const label = e.target.value;
                          set(keyEdited ? { label } : { label, key: keyFromLabel(label) });
                        }}
                      />
                    </FieldControl>
                    <FieldDescription>What people see above the field on a form.</FieldDescription>
                    <FieldError>{show.label}</FieldError>
                  </Field>
                  <Field disabled={editing}>
                    <FieldLabel>Type of answer</FieldLabel>
                    <Select
                      value={draft.dataType}
                      disabled={editing}
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
                      {DATA_TYPE_HINT[draft.dataType]}
                      {editing ? ' The type cannot change once the field exists.' : ''}
                    </FieldDescription>
                  </Field>
                  {WITH_OPTIONS.has(draft.dataType) ? (
                    <TagsInput
                      label="Options"
                      value={draft.options}
                      invalid={show.options !== undefined}
                      hint={show.options ?? 'Type one, then press Enter. Add as many as you need.'}
                      onChange={(options) => {
                        set({ options });
                      }}
                    />
                  ) : null}
                  <Field>
                    <FieldLabel>Help text</FieldLabel>
                    <FieldControl>
                      <Textarea
                        value={draft.description}
                        onChange={(e) => {
                          set({ description: e.target.value });
                        }}
                      />
                    </FieldControl>
                    <FieldDescription>
                      Optional. Shown under the field on every form: what to enter, and why you ask.
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
                        Key for integrations
                      </AccordionTrigger>
                      <AccordionContent>
                        <Field invalid={show.key !== undefined} disabled={editing}>
                          <FieldLabel>Key</FieldLabel>
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
                            Made from the name; most people never change it. What exports, webhooks
                            and integrations call the field. It cannot change once published.
                          </FieldDescription>
                          <FieldError>{show.key}</FieldError>
                        </Field>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Stack>
              ) : null}

              {step === 1 ? (
                <Stack gap={5}>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">Who can change it?</legend>
                    {OWNERS.map((owner) => (
                      <Field
                        key={owner}
                        orientation="horizontal"
                        className="items-start justify-start"
                      >
                        <FieldControl>
                          <Checkbox
                            checked={draft.ownership.includes(owner)}
                            onCheckedChange={(on) => {
                              set({ ownership: toggled(draft.ownership, owner, on === true) });
                            }}
                          />
                        </FieldControl>
                        <div>
                          <FieldLabel>{WRITER_LABEL[owner]}</FieldLabel>
                          <FieldDescription>{WRITER_HINT[owner]}</FieldDescription>
                        </div>
                      </Field>
                    ))}
                    {show.ownership === undefined ? null : (
                      <Alert tone="danger">{show.ownership}</Alert>
                    )}
                  </fieldset>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">Who can see it?</legend>
                    {SCOPES.map((scope) => (
                      <Field
                        key={scope}
                        orientation="horizontal"
                        className="items-start justify-start"
                      >
                        <FieldControl>
                          <Checkbox
                            checked={draft.visibility.includes(scope)}
                            onCheckedChange={(on) => {
                              set({ visibility: toggled(draft.visibility, scope, on === true) });
                            }}
                          />
                        </FieldControl>
                        <div>
                          <FieldLabel>{SCOPE_LABEL[scope]}</FieldLabel>
                          <FieldDescription>{SCOPE_HINT[scope]}</FieldDescription>
                        </div>
                      </Field>
                    ))}
                  </fieldset>
                  {show.visibility === undefined ? (
                    <Alert tone="info">{readBack(draft.ownership, draft.visibility)}</Alert>
                  ) : (
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
                            ? 'No exceptions'
                            : `${String(draft.visibilityRules.length)} ${draft.visibilityRules.length === 1 ? 'rule' : 'rules'}`
                        }
                      >
                        Let more people see it, on some records only
                      </AccordionTrigger>
                      <AccordionContent>
                        {/* Custom rules (PEO-066): a preset scope, on some records only. */}
                        <fieldset className="flex flex-col gap-3">
                          <legend className="sr-only">
                            Let more people see it, on some records only
                          </legend>
                          <p className="text-sm text-fg-muted">
                            An exception to “Who can see it?” above. For example: managers may also
                            see Agency, but only on contractors’ records. Nobody loses access here.
                          </p>
                          {draft.visibilityRules.map((rule, index) => {
                            const name = `Rule ${String(index + 1)}`;
                            const change = (changed: VisibilityRule): void => {
                              set({
                                visibilityRules: draft.visibilityRules.map((r, i) =>
                                  i === index ? changed : r,
                                ),
                              });
                            };
                            return (
                              // Positional: a rule has no identity beyond its place.
                              <Card key={index}>
                                <CardContent>
                                  <Stack gap={3}>
                                    <Field>
                                      <FieldLabel>{name}: who else can see it</FieldLabel>
                                      <FieldControl>
                                        <Combobox
                                          label={`${name}: who else can see it`}
                                          multiple
                                          placeholder="Choose who"
                                          options={SCOPES.map((scope) => ({
                                            value: scope,
                                            label: SCOPE_LABEL[scope],
                                          }))}
                                          value={rule.scopes}
                                          onChange={(scopes) => {
                                            change({
                                              ...rule,
                                              scopes: (Array.isArray(scopes)
                                                ? scopes
                                                : []) as ViewerScope[],
                                            });
                                          }}
                                        />
                                      </FieldControl>
                                    </Field>
                                    <PredicateEditor
                                      legend={`${name}: when`}
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
                                            visibilityRules: draft.visibilityRules.filter(
                                              (_, i) => i !== index,
                                            ),
                                          });
                                        }}
                                      >
                                        Remove {name.toLowerCase()}
                                      </Button>
                                    </div>
                                  </Stack>
                                </CardContent>
                              </Card>
                            );
                          })}
                          {show.rules === undefined ? null : (
                            <Alert tone="danger">{show.rules}</Alert>
                          )}
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
                                Add a rule
                              </Button>
                            </div>
                          ) : null}
                          <p className="text-sm text-fg-muted">
                            A rule shows the field to somebody only on the records its conditions
                            hold for, and only if they can already see every field a condition
                            reads. Never for special-category data.
                          </p>
                        </fieldset>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Stack>
              ) : null}

              {step === 2 ? (
                <Stack gap={5}>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">When is it asked?</legend>
                    <RadioGroup
                      value={draft.collectAt}
                      onValueChange={(value) => {
                        set({ collectAt: value as CollectAt });
                      }}
                    >
                      {COLLECT.map((when) => (
                        <RadioCard
                          key={when}
                          value={when}
                          description={
                            <>
                              {COLLECT_LABEL[when].description}
                              <span className="mt-1 block text-fg-subtle">
                                {COLLECT_LABEL[when].example}
                              </span>
                            </>
                          }
                        >
                          {COLLECT_LABEL[when].label}
                        </RadioCard>
                      ))}
                    </RadioGroup>
                  </fieldset>
                  <StageNote draft={draft} />
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Is it required?</legend>
                    <RadioGroup
                      value={draft.requiredness}
                      onValueChange={(requiredness) => {
                        set({ requiredness: requiredness as RequirednessMode });
                      }}
                    >
                      <RadioCard
                        value="never"
                        description="Nobody is reminded about it, and a record is complete without it."
                      >
                        {REQUIREDNESS_LABEL.never}
                      </RadioCard>
                      <RadioCard
                        value="always"
                        description="A record without it shows as incomplete, and whoever fills it in is reminded until it is."
                      >
                        Required for everyone
                      </RadioCard>
                      <RadioCard
                        value="conditional"
                        description="Only where the conditions below hold: a country, a legal entity, a contract type, another field."
                      >
                        Required when…
                      </RadioCard>
                    </RadioGroup>
                  </fieldset>
                  {draft.requiredness === 'conditional' ? (
                    <Stack gap={2}>
                      <PredicateEditor
                        legend="Required when"
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
                  <Alert tone="info" title="In plain words">
                    {summary({
                      label: draft.label,
                      ownership: draft.ownership,
                      collectAt: draft.collectAt,
                      requiredness: draft.requiredness,
                      visibility: draft.visibility,
                      rules: draft.visibilityRules.length,
                      classification: draft.classification,
                      requiresApproval: approval,
                      encrypted,
                    })}
                  </Alert>
                  {field === null ? null : (
                    <Changes field={field} draft={draft} approval={approval} />
                  )}
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
                  <Accordion type="single" collapsible>
                    <AccordionItem value="more">
                      <AccordionTrigger meta={approval ? 'Changes need approval' : 'No approval'}>
                        Approval, encryption and dates
                      </AccordionTrigger>
                      <AccordionContent>
                        <Stack gap={4}>
                          <Field orientation="horizontal" className="items-start justify-start">
                            <FieldControl>
                              <Checkbox
                                checked={approval}
                                onCheckedChange={(on) => {
                                  set({ requiresApproval: on === true });
                                }}
                              />
                            </FieldControl>
                            <div>
                              <FieldLabel>Changes need a second person to approve them</FieldLabel>
                              <FieldDescription>
                                A new value is held until another HR member approves it, within
                                seven days, and the field is marked Sensitive wherever it is shown.
                                On by default for money, bank details and identity numbers.
                              </FieldDescription>
                            </div>
                          </Field>
                          {encrypted ? (
                            <Alert tone="info" title="Stored encrypted">
                              The value is kept apart from the rest of the record, and everyday
                              screens show only its last characters.
                            </Alert>
                          ) : null}
                          <p className="text-sm text-fg-muted">
                            Custom fields are not effective-dated: a new value applies once it is
                            saved (or approved), not from a date somebody chooses.
                          </p>
                        </Stack>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Stack>
              ) : null}

              {refused === null ? null : (
                <Alert tone="danger" title="Not saved">
                  {refused}
                </Alert>
              )}
            </Stack>
            <aside aria-label="Preview" className="order-first lg:order-none">
              <div className="lg:sticky lg:top-0">
                <Preview draft={draft} approval={approval} />
              </div>
            </aside>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button
            disabled={step === 0 || saving}
            onClick={() => {
              setStep((s) => s - 1);
            }}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next}>
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={saving}
              loadingLabel="Saving the field"
              disabled={advice === 'asking'}
              onClick={() => {
                void save();
              }}
            >
              {editing ? 'Save field' : 'Add field'}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The last step: the judgment, drawn as it was decided (§12.3).
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
    return <Spinner label="Working out what kind of data this is" />;
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
        <Alert tone="warning" title="No suggestion this time">
          Choose what fits. Nothing is suggested, so nothing is pre-selected.
        </Alert>
      ) : advice.kind === 'protect' ? (
        <Alert tone="warning" title="This looks like special-category data">
          {advice.reason}
        </Alert>
      ) : advice.kind === 'choose' ? (
        <Alert tone="info" title="Two answers are close">
          Nothing is pre-selected. Each option says why it might fit.
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">What kind of data is this?</legend>
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
                ? ' (suggested)'
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
            I confirm this field may hold special-category data, and that it will be kept out of AI
            prompts, event payloads and the standard export.
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
    label: draft.label.trim() === '' ? 'Your new field' : draft.label.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    dataType: draft.dataType,
    options: draft.options.map((o) => ({ value: o, label: o })),
    required: draft.requiredness === 'always',
    readOnly: false,
    sensitive: approval,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>
          How it looks on a form, as you build it. Try it: nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={4}>
          {uploaded ? (
            <p className="text-sm text-fg-muted">
              Uploaded on the profile rather than typed into a form.
            </p>
          ) : (
            <AttributeInput field={field} value={value} onChange={setValue} />
          )}
          <KeyValues
            className="border-t border-border pt-3"
            items={[
              {
                label: 'Filled in by',
                value:
                  draft.ownership.length === 0
                    ? 'Nobody yet'
                    : draft.ownership.map((o) => WRITER_LABEL[o]).join(', '),
              },
              {
                label: 'Seen by',
                value:
                  (draft.visibility.length === 0
                    ? 'Nobody yet'
                    : draft.visibility.map((v) => SCOPE_LABEL[v]).join(', ')) +
                  (draft.visibilityRules.length === 0 ? '' : ', and more on some records'),
              },
            ]}
          />
        </Stack>
      </CardContent>
    </Card>
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
      <Alert tone="info" title="Asked on the first screen after sign-up">
        {employee
          ? 'A file is never taken on the account setup page. It is asked for on the first screen they see once their account is set up, beside their photo if you ask for one.'
          : 'Only the employee can answer there. Tick The employee under Who can change it, or choose another moment.'}
      </Alert>
    );
  }
  if (draft.collectAt === 'signup' || draft.collectAt === 'enrolment') {
    return (
      <Alert tone="info" title="Shown on the account setup page">
        {employee
          ? 'The person answers it while setting up their account, before they have used Kithena.'
          : 'Only the employee can answer on that page. Tick The employee under Who can change it, or choose another moment.'}
      </Alert>
    );
  }
  if (draft.collectAt === 'hr_only' && employee) {
    return (
      <Alert tone="warning" title="The employee is never shown this field">
        They are allowed to change it, but no form ever asks them, so in practice only{' '}
        {listed(draft.ownership.filter((w) => w !== 'employee').map((w) => WRITER_LABEL[w])) ||
          'nobody'}{' '}
        fills it in.
      </Alert>
    );
  }
  if (draft.collectAt !== 'hr_only' && !employee) {
    return (
      <Alert tone="info">
        The employee cannot change this field, so they see it read-only rather than being asked for
        it. To ask them, tick The employee under Who can change it.
      </Alert>
    );
  }
  return null;
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
      <Alert tone="info" title="Nothing changed yet">
        Saving keeps the field as it is.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title="What changes when you publish">
      <ul className="list-disc ps-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2">
        Saving changes the draft only; nobody’s forms change until you publish.
        {tightened
          ? ' Records without a value then become incomplete, and the publish step says how many.'
          : ''}
      </p>
    </Alert>
  );
}
