import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Combobox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
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
import {
  CLASSIFICATION_ORDER,
  DATA_TYPES,
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
import { readBack } from './read-back';
import {
  CLASSIFICATION_LABEL,
  COLLECT_LABEL,
  DATA_TYPE_LABEL,
  REQUIREDNESS_LABEL,
  SCOPE_LABEL,
  WRITER_LABEL,
  keyFromLabel,
} from './words';

/** The four steps, in the order §9.2 argues for. Classification is last. */
const STEPS = [
  { id: 'what', label: 'What is it' },
  { id: 'who', label: 'Who fills it in' },
  { id: 'see', label: 'Who can see it' },
  { id: 'kind', label: 'What kind of data' },
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
const COLLECT: readonly CollectAt[] = ['onboarding', 'anytime', 'hr_only', 'enrolment', 'signup'];
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
    collectAt: 'anytime',
    // Defaulted from the section, which is what §9.2 asks: most fields are
    // seen by whoever sees the rest of their section.
    visibility: section.visibility,
    visibilityRules: [],
    classification: null,
    confirmedSpecial: false,
  };
}

/** What stops each step from moving on, or null when it may. */
function problemsIn(step: number, draft: Draft, keyTaken: (key: string) => boolean) {
  const problems: Partial<
    Record<
      'label' | 'key' | 'options' | 'ownership' | 'requiredWhen' | 'visibility' | 'rules' | 'kind',
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
  if (step === 1 && draft.requiredness === 'conditional') {
    const problem = predicateProblem(draft.requiredWhen);
    if (problem !== null) problems.requiredWhen = problem;
  }
  if (step === 2) {
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
        'Special-category data is never shown by a rule. Remove the rules under Who can see it.';
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
    setShown(false);
    setAdvice(null);
    setRefused(null);
    asked.current += 1;
  }, [open, section, field]);

  const editing = field !== null;
  const others = fields.filter((f) => f.key !== draft.key);
  const problems = problemsIn(step, draft, (key) => !editing && takenKeys.includes(key));
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
    });
    setSaving(false);
    if (outcome.ok) onOpenChange(false);
    else setRefused(outcome.message);
  };

  const show = shown ? problems : {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* From the side at a desk, from the bottom on a phone (§17.2). */}
      <SheetContent side={wide ? 'right' : 'bottom'} size="lg">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${field.label}` : 'New field'}</SheetTitle>
          <SheetDescription>
            {section.label} · step {step + 1} of {STEPS.length}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Stack gap={6}>
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
              <Stack gap={4}>
                <Field required invalid={show.label !== undefined}>
                  <FieldLabel>Label</FieldLabel>
                  <FieldControl>
                    <Input
                      value={draft.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        set(keyEdited ? { label } : { label, key: keyFromLabel(label) });
                      }}
                    />
                  </FieldControl>
                  <FieldError>{show.label}</FieldError>
                </Field>
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
                    What exports, webhooks and integrations call it. It cannot change once
                    published.
                  </FieldDescription>
                  <FieldError>{show.key}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <FieldControl>
                    <Textarea
                      value={draft.description}
                      onChange={(e) => {
                        set({ description: e.target.value });
                      }}
                    />
                  </FieldControl>
                  <FieldDescription>Shown under the field on every form.</FieldDescription>
                </Field>
                <Field disabled={editing}>
                  <FieldLabel>Type</FieldLabel>
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
                      {DATA_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {DATA_TYPE_LABEL[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {WITH_OPTIONS.has(draft.dataType) ? (
                  <TagsInput
                    label="Options"
                    value={draft.options}
                    invalid={show.options !== undefined}
                    hint={show.options ?? 'Press Enter after each one.'}
                    onChange={(options) => {
                      set({ options });
                    }}
                  />
                ) : null}
              </Stack>
            ) : null}

            {step === 1 ? (
              <Stack gap={5}>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Filled in by</legend>
                  {OWNERS.map((owner) => (
                    <Field key={owner} orientation="horizontal" className="justify-start">
                      <FieldControl>
                        <Checkbox
                          checked={draft.ownership.includes(owner)}
                          onCheckedChange={(on) => {
                            set({ ownership: toggled(draft.ownership, owner, on === true) });
                          }}
                        />
                      </FieldControl>
                      <FieldLabel>{WRITER_LABEL[owner]}</FieldLabel>
                    </Field>
                  ))}
                  {show.ownership === undefined ? null : (
                    <Alert tone="danger">{show.ownership}</Alert>
                  )}
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Required</legend>
                  <RadioGroup
                    value={draft.requiredness}
                    onValueChange={(requiredness) => {
                      set({ requiredness: requiredness as RequirednessMode });
                    }}
                  >
                    <RadioCard value="never" description="Nobody is chased for it.">
                      {REQUIREDNESS_LABEL.never}
                    </RadioCard>
                    <RadioCard value="always" description="Every record is incomplete without it.">
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
                <Field>
                  <FieldLabel>Asked for</FieldLabel>
                  <Select
                    value={draft.collectAt}
                    onValueChange={(value) => {
                      set({ collectAt: value as CollectAt });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {COLLECT.map((when) => (
                        <SelectItem key={when} value={when}>
                          {COLLECT_LABEL[when].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{COLLECT_LABEL[draft.collectAt].description}</FieldDescription>
                </Field>
              </Stack>
            ) : null}

            {step === 2 ? (
              <Stack gap={4}>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Who can see it</legend>
                  {SCOPES.map((scope) => (
                    <Field key={scope} orientation="horizontal" className="justify-start">
                      <FieldControl>
                        <Checkbox
                          checked={draft.visibility.includes(scope)}
                          onCheckedChange={(on) => {
                            set({ visibility: toggled(draft.visibility, scope, on === true) });
                          }}
                        />
                      </FieldControl>
                      <FieldLabel>{SCOPE_LABEL[scope]}</FieldLabel>
                    </Field>
                  ))}
                </fieldset>
                {show.visibility === undefined ? (
                  <Alert tone="info">{readBack(draft.ownership, draft.visibility)}</Alert>
                ) : (
                  <Alert tone="danger">{show.visibility}</Alert>
                )}

                {/* Custom rules (PEO-066): a preset scope, on some records only. */}
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-sm font-medium">
                    Also visible, on some records
                  </legend>
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
                  {show.rules === undefined ? null : <Alert tone="danger">{show.rules}</Alert>}
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
                    A rule shows the field to somebody only on the records its conditions hold for,
                    and only if they can already see every field a condition reads. Never for
                    special-category data.
                  </p>
                </fieldset>
              </Stack>
            ) : null}

            {step === 3 ? (
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
            ) : null}

            {refused === null ? null : (
              <Alert tone="danger" title="Not saved">
                {refused}
              </Alert>
            )}
          </Stack>
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
