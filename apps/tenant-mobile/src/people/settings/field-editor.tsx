import {
  AccessMatrix,
  Alert,
  Button,
  Card,
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
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  NumberField,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stack,
  StepperProgress,
  Switch,
  TagsInput,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Plus, Sparkles, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { useAct } from '../act';
import { ask, useSigned, type Value } from '../api';
import { AttributeInput } from '../attribute-input';
import { describedField, fieldSentence } from './sentences';
import {
  approvalByDefault,
  atLeast,
  AUDIENCES,
  accessOf,
  CLASSIFICATION,
  COLLECT,
  DATA_TYPE_GROUPS,
  DATA_TYPE_LABEL,
  draftFrom,
  EMPTY_PREDICATE,
  fromAccess,
  GROUPS,
  keyFromLabel,
  OPERAND_LABEL,
  optionKey,
  PARTS,
  problemsIn,
  reformatted,
  REQUIREDNESS,
  SEALABLE,
  seenByEveryone,
  STATUS_VALUES,
  WITH_DECIMALS,
  WITH_OPTIONS,
  withEveryone,
  type ClassificationAdvice,
  type Draft,
  type ListOperand,
  type Predicate,
  type PredicateClause,
  type Registry,
  type RegistryField,
  type RegistrySection,
  type ViewerScope,
} from './fields-model';

const OPERANDS = [
  'country',
  'legalEntity',
  'employmentType',
  'workModel',
  'status',
  'attribute',
] as const;
const MOST_RULES = 5;

/** The closed predicate, as rows: a fact and its values, or another field filled in or equal to something. */
function PredicateEditor({
  legend,
  value,
  onChange,
  registry,
  fields,
}: {
  legend: string;
  value: Predicate;
  onChange: (next: Predicate) => void;
  registry: Registry;
  fields: readonly RegistryField[];
}): React.JSX.Element {
  const listed = (operand: ListOperand) =>
    ({
      legalEntity: registry.choices.legalEntities,
      country: registry.choices.countries,
      employmentType: registry.choices.employmentTypes,
      workModel: registry.choices.workModels,
      status: STATUS_VALUES,
    })[operand];
  const set = (index: number, clause: PredicateClause): void => {
    onChange({ ...value, clauses: value.clauses.map((c, i) => (i === index ? clause : c)) });
  };
  const select = (
    label: string,
    current: string,
    onValue: (v: string) => void,
    items: readonly { value: string; label: string }[],
    placeholder?: string,
  ) => (
    <Select value={current} onValueChange={onValue}>
      <SelectTrigger size="sm" accessibilityLabel={label}>
        <SelectValue {...(placeholder === undefined ? {} : { placeholder })} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <Stack gap={3}>
      <Text weight="semibold">{legend}</Text>
      {value.clauses.length > 1
        ? select(
            `${legend}: how the conditions combine`,
            value.combine,
            (combine) => {
              onChange({ ...value, combine: combine === 'any' ? 'any' : 'all' });
            },
            [
              { value: 'all', label: 'All of these hold' },
              { value: 'any', label: 'Any of these holds' },
            ],
          )
        : null}
      {value.clauses.map((clause, index) => {
        const n = `${legend}, condition ${String(index + 1)}`;
        const named =
          clause.operand === 'attribute' ? fields.find((f) => f.key === clause.key) : undefined;
        return (
          <Card key={index} variant="outline">
            <Stack gap={2}>
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  {select(
                    `${n}: what it reads`,
                    clause.operand,
                    (operand) => {
                      set(
                        index,
                        operand === 'attribute'
                          ? { operand: 'attribute', key: '', is: 'set', equals: null }
                          : { operand: operand as ListOperand, in: [] },
                      );
                    },
                    OPERANDS.map((o) => ({ value: o, label: OPERAND_LABEL[o] })),
                  )}
                </View>
                <Button
                  size="sm"
                  variant="ghost"
                  startIcon={<Icon icon={Trash2} />}
                  accessibilityLabel={`Remove ${n}`}
                  disabled={value.clauses.length === 1}
                  onPress={() => {
                    onChange({ ...value, clauses: value.clauses.filter((_, i) => i !== index) });
                  }}
                />
              </View>
              {clause.operand === 'attribute' ? (
                <>
                  {select(
                    `${n}: which field`,
                    clause.key,
                    (key) => {
                      set(index, { ...clause, key, equals: clause.is === 'equals' ? '' : null });
                    },
                    fields.map((f) => ({ value: f.key, label: f.label })),
                    'Choose a field',
                  )}
                  {select(
                    `${n}: how it is compared`,
                    clause.is,
                    (is) => {
                      set(index, {
                        ...clause,
                        is: is === 'equals' ? 'equals' : 'set',
                        equals: is === 'equals' ? '' : null,
                      });
                    },
                    [
                      { value: 'set', label: 'is filled in' },
                      { value: 'equals', label: 'equals' },
                    ],
                  )}
                  {clause.is !== 'equals' ? null : named !== undefined &&
                    named.options.length > 0 ? (
                    select(
                      `${n}: the value`,
                      clause.equals ?? '',
                      (equals) => {
                        set(index, { ...clause, equals });
                      },
                      named.options.map((o) => ({ value: optionKey(o), label: o })),
                      'Choose',
                    )
                  ) : (
                    <Input
                      size="sm"
                      accessibilityLabel={`${n}: the value`}
                      maxLength={200}
                      value={clause.equals ?? ''}
                      onChange={(equals) => {
                        set(index, { ...clause, equals });
                      }}
                    />
                  )}
                </>
              ) : (
                <Combobox
                  label={`${n}: is one of`}
                  multiple
                  size="sm"
                  placeholder="Choose values"
                  options={listed(clause.operand)}
                  value={clause.in}
                  onChange={(next) => {
                    set(index, {
                      ...clause,
                      in: Array.isArray(next)
                        ? (next as readonly string[])
                        : typeof next === 'string'
                          ? [next]
                          : [],
                    });
                  }}
                />
              )}
            </Stack>
          </Card>
        );
      })}
      {value.clauses.length < 10 ? (
        <Button
          size="sm"
          startIcon={<Icon icon={Plus} />}
          onPress={() => {
            onChange({ ...value, clauses: [...value.clauses, { operand: 'country', in: [] }] });
          }}
        >
          Add a condition
        </Button>
      ) : null}
    </Stack>
  );
}

/** A draft as People's `DraftFieldInput`: the field editor's and the sentence editor's save. */
export function draftInput(
  draft: Draft,
  piiKind: string,
  classificationSource: 'suggested' | 'human',
  encrypted: boolean,
): Record<string, unknown> {
  return {
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
    piiKind,
    classificationSource,
    requiresApproval: draft.requiresApproval,
    encrypted,
    ...(WITH_DECIMALS.has(draft.dataType) && draft.decimals !== null
      ? { decimals: draft.decimals }
      : {}),
    ...(draft.dataType === 'money'
      ? { currency: draft.currency === '' ? null : draft.currency }
      : {}),
    ...(draft.dataType === 'date' ? { openEnded: draft.openEnded } : {}),
  };
}

/**
 * One field, added or changed (design M3–M8): a centred dialog, one step per
 * screen — the field, who sees and changes it (a See and Change table, with
 * Everyone as the switch that ticks every See box), when it is asked, how
 * sensitive it is, judged from its description and never a value, and a
 * review. Editing, tap any bar to jump and save from any step; a new field
 * steps through to the review, and may be drafted from a sentence.
 */
export function FieldEditor({
  registry,
  section,
  field,
  described,
  onClose,
  onSaved,
}: {
  registry: Registry;
  section: RegistrySection;
  field: RegistryField | null;
  /** A new field described in the search, read into the draft as it opens. */
  described?: string;
  onClose: () => void;
  /** Saved; the type or a format of a published field changed when `review` is set. */
  onSaved: (review: { key: string; to: string } | null) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(section, field));
  const [keyEdited, setKeyEdited] = useState(field !== null);
  const [part, setPart] = useState(0);
  const [shown, setShown] = useState(false);
  const [advice, setAdvice] = useState<ClassificationAdvice | 'asking' | 'failed' | null>(null);
  const [description, setDescription] = useState('');
  // Steps a description filled in, marked until they are looked at.
  const [drafted, setDrafted] = useState<ReadonlySet<number>>(new Set());
  const [sharing, setSharing] = useState<boolean | null>(null);
  const asked = useRef(0);
  const editing = field !== null;
  const builtIn = field !== null && field.origin !== 'tenant';
  const others = registry.fields.filter((f) => f.key !== draft.key);
  const problems = PARTS.map((_, i) =>
    problemsIn(i, draft, (key) => !editing && registry.fields.some((f) => f.key === key), others),
  );
  const set = (patch: Partial<Draft>): void => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const goTo = (next: number): void => {
    setPart(next);
    setDrafted((d) => new Set([...d].filter((i) => i !== next)));
  };

  // The judgment, asked again as the field is described; an answer nobody waits for is dropped.
  useEffect(() => {
    if (draft.label.trim() === '') return undefined;
    const timer = setTimeout(() => {
      const question = ++asked.current;
      setAdvice('asking');
      void ask<ClassificationAdvice>(signed, 'ClassificationAdvice', {
        label: draft.label,
        description: draft.description === '' ? null : draft.description,
        dataType: draft.dataType,
        sectionKey: section.key,
        options: draft.options,
      }).then((answer) => {
        if (question !== asked.current) return;
        if (!answer.ok) {
          setAdvice('failed');
          return;
        }
        setAdvice(answer.data);
        const pre =
          answer.data.kind === 'protect'
            ? 'special-category'
            : answer.data.kind === 'choose'
              ? null
              : answer.data.classification;
        setDraft((d) => (editing && d.classification !== null ? d : { ...d, classification: pre }));
      });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [draft.label, draft.description, draft.dataType, draft.options.join('\u0000')]);

  /** A sentence read into the draft (M8): name, type, options, and steps 2 to 4 marked to check. */
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

  // Opened from a description in the search: read it in once.
  useEffect(() => {
    if (described !== undefined && field === null) describe(described);
  }, []);

  const judged = typeof advice === 'object' && advice !== null ? advice : null;
  const piiKind = judged?.piiKind ?? 'none';
  const forced = approvalByDefault(draft.dataType, piiKind);
  const sealed = forced || draft.encrypted;
  const wasSealed = field?.encrypted === true;
  const canSeal = field === null ? SEALABLE.has(draft.dataType) : field.encryptable === true;
  const sealLocked = forced || wasSealed || !canSeal;
  const sealWhy = forced
    ? 'Always on for financial details and ID numbers.'
    : wasSealed
      ? 'On. Encryption can’t be turned off.'
      : !canSeal
        ? 'Not available for this field type.'
        : draft.encrypted && field !== null
          ? 'Existing values are encrypted when you publish. This can’t be undone.'
          : 'Only the last four characters are shown. Never searchable or shared.';
  const approval = draft.requiresApproval ?? sealed;
  const floor = judged !== null && judged.kind !== 'protect' ? judged.floor : null;
  const show = shown ? (problems[part] ?? {}) : {};
  // People shares a field with the assistant only where it could: public or internal, never sealed.
  const shareable =
    !sealed && (draft.classification === 'public' || draft.classification === 'internal');
  const sharedBefore = field === null ? shareable : field.aiEligible === true;
  const shared = shareable && (sharing ?? sharedBefore);
  const last = part === PARTS.length - 1;
  const everyone = seenByEveryone(draft.visibility);

  const save = (): void => {
    setShown(true);
    const first = problems.findIndex((p) => Object.keys(p).length > 0);
    if (first !== -1) {
      goTo(first);
      return;
    }
    if (draft.classification === null) return;
    const suggested =
      judged === null || judged.kind === 'choose'
        ? null
        : judged.kind === 'protect'
          ? 'special-category'
          : judged.classification;
    void act(
      'SaveDraftField',
      {
        input: draftInput(
          draft,
          piiKind,
          suggested === draft.classification ? 'suggested' : 'human',
          sealed,
        ),
        editing: field?.key ?? null,
      },
      editing ? 'Saved to the draft' : 'Added to the draft',
    ).then(async (done) => {
      if (done === null) return;
      if (shareable && shared !== sharedBefore) {
        await act('SetFieldAssistant', { field: draft.key, share: shared });
      }
      onSaved(
        field !== null && field.pending !== 'added' && reformatted(field, draft)
          ? { key: field.key, to: draft.dataType }
          : null,
      );
    });
  };

  /** A new field moves on only once the step it leaves is complete. */
  const next = (): void => {
    if (!editing && Object.keys(problems[part] ?? {}).length > 0) {
      setShown(true);
      return;
    }
    goTo(part + 1);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? field.label : 'New field'}</DialogTitle>
          <DialogDescription>{`${section.label}${builtIn ? ' · built in: type and key are fixed' : ''}`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <View className="gap-2.5">
            <StepperProgress
              step={part + 1}
              count={PARTS.length}
              label="Parts of the field"
              segments={PARTS.map((label, i) => ({
                label,
                ...(shown && Object.keys(problems[i] ?? {}).length > 0
                  ? { status: 'failed' as const }
                  : drafted.has(i) && i !== part
                    ? { status: 'todo' as const, description: 'Drafted for you to check' }
                    : {}),
                // Editing, any step opens; a new field goes back only.
                ...(editing || i < part
                  ? {
                      onPress: () => {
                        goTo(i);
                      },
                    }
                  : {}),
              }))}
            />
            <Text variant="headline">{PARTS[part]}</Text>
          </View>
          <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerClassName="gap-4 pb-2">
            {part === 0 ? (
              <>
                {builtIn ? (
                  <Alert tone="info" title="Built into Kithena">
                    You can change its name, description and access. Its type is fixed, and
                    protection can only be increased.
                  </Alert>
                ) : null}
                {editing ? null : (
                  <Card variant="assistant" className="gap-2">
                    <View className="flex-row items-center gap-2">
                      <Icon icon={Sparkles} size={16} tone="accent" />
                      <Text weight="semibold" tone="accent">
                        Describe it
                      </Text>
                    </View>
                    <Textarea
                      value={description}
                      maxLength={500}
                      placeholder="T-shirt size for the offsite, XS to XXL. People pick it during onboarding; only HR needs it."
                      accessibilityLabel="Describe the field"
                      onChange={describe}
                    />
                    <Text variant="footnote" tone="muted">
                      {drafted.size > 0
                        ? 'Filled in the name, options and steps 2 to 4. Check each one.'
                        : 'Kithena fills in the rest from it. A rule, not a model.'}
                    </Text>
                  </Card>
                )}
                <Field required invalid={show['label'] !== undefined}>
                  <FieldLabel>Field name</FieldLabel>
                  <Input
                    size="sm"
                    value={draft.label}
                    maxLength={120}
                    onChange={(label) => {
                      set({ label, ...(keyEdited ? {} : { key: keyFromLabel(label) }) });
                    }}
                  />
                  <FieldError>{show['label'] ?? ''}</FieldError>
                </Field>
                {registry.sections.length > 1 ? (
                  <Field>
                    <FieldLabel>Section</FieldLabel>
                    <Select
                      value={draft.sectionKey}
                      onValueChange={(sectionKey) => {
                        set({ sectionKey });
                      }}
                    >
                      <SelectTrigger size="sm" accessibilityLabel="Section">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {registry.sections
                          .filter((s) => !s.fixed)
                          .map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              {s.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>Type of answer</FieldLabel>
                  <Select
                    value={draft.dataType}
                    disabled={builtIn}
                    onValueChange={(dataType) => {
                      set({ dataType });
                    }}
                  >
                    <SelectTrigger size="sm" accessibilityLabel="Type of answer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_TYPE_GROUPS.flatMap((g) => g.types).map((t) => (
                        <SelectItem key={t} value={t}>
                          {DATA_TYPE_LABEL[t] ?? t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {WITH_OPTIONS.has(draft.dataType) ? (
                  <Field required invalid={show['options'] !== undefined}>
                    <FieldLabel>Options</FieldLabel>
                    <TagsInput
                      value={[...draft.options]}
                      onChange={(options) => {
                        set({ options });
                      }}
                      label="Options"
                      placeholder="Add an option"
                    />
                    <FieldError>{show['options'] ?? ''}</FieldError>
                  </Field>
                ) : null}
                {WITH_DECIMALS.has(draft.dataType) ? (
                  <NumberField
                    label="Decimal places"
                    size="sm"
                    value={draft.decimals}
                    min={0}
                    max={6}
                    onChange={(decimals) => {
                      set({ decimals });
                    }}
                  />
                ) : null}
                {draft.dataType === 'money' ? (
                  <Field invalid={show['currency'] !== undefined}>
                    <FieldLabel>Currency</FieldLabel>
                    <Input
                      size="sm"
                      maxLength={3}
                      autoCapitalize="characters"
                      placeholder="Any"
                      value={draft.currency}
                      onChange={(currency) => {
                        set({ currency: currency.toUpperCase() });
                      }}
                    />
                    <FieldDescription>Empty: each record’s own currency.</FieldDescription>
                    <FieldError>{show['currency'] ?? ''}</FieldError>
                  </Field>
                ) : null}
                {draft.dataType === 'date' ? (
                  <List>
                    <ListItem
                      description="Offers “No end date” beside the date, for a permanent contract."
                      trailing={
                        <Switch
                          checked={draft.openEnded}
                          accessibilityLabel="Can be indefinite"
                          onCheckedChange={(openEnded) => {
                            set({ openEnded });
                          }}
                        />
                      }
                    >
                      Can be indefinite
                    </ListItem>
                  </List>
                ) : null}
                <Field>
                  <FieldLabel>Help text</FieldLabel>
                  <Textarea
                    value={draft.description}
                    maxLength={500}
                    placeholder="Optional. What to enter, and why."
                    onChange={(text) => {
                      set({ description: text });
                    }}
                  />
                </Field>
                <Field required invalid={show['key'] !== undefined}>
                  <FieldLabel>Key for integrations</FieldLabel>
                  <Input
                    size="sm"
                    value={draft.key}
                    readOnly={editing}
                    autoCapitalize="none"
                    onChange={(key) => {
                      setKeyEdited(true);
                      set({ key });
                    }}
                  />
                  <FieldDescription>
                    How integrations and imports name it. Fixed once saved.
                  </FieldDescription>
                  <FieldError>{show['key'] ?? ''}</FieldError>
                </Field>
              </>
            ) : null}

            {part === 1 ? (
              <>
                <ListItem
                  listitem={false}
                  description="Ticks every See box"
                  trailing={
                    <Switch
                      checked={everyone}
                      accessibilityLabel="Everyone at the company can see it"
                      onCheckedChange={(on) => {
                        set({ visibility: withEveryone(on, draft.visibility) });
                      }}
                    />
                  }
                >
                  Everyone at the company can see it
                </ListItem>
                <AccessMatrix
                  audiences={GROUPS}
                  value={accessOf(draft.visibility, draft.ownership)}
                  allSee={everyone}
                  onChange={(value) => {
                    set(fromAccess(value, draft));
                  }}
                />
                <Text variant="footnote" tone="muted">
                  Anyone ticked under Change can also see it.
                </Text>
                {show['ownership'] === undefined ? null : (
                  <Alert tone="danger">{show['ownership']}</Alert>
                )}
                {show['visibility'] === undefined ? null : (
                  <Alert tone="danger">{show['visibility']}</Alert>
                )}
                <Text weight="semibold">Also visible when</Text>
                <Text variant="footnote" tone="muted">
                  Rules show the field to more people on the records a condition holds for.
                </Text>
                {draft.visibilityRules.map((rule, i) => (
                  <Card key={i} variant="outline">
                    <Stack gap={3}>
                      <Combobox
                        label={`Rule ${String(i + 1)}: who also sees it`}
                        multiple
                        size="sm"
                        placeholder="Who also sees it"
                        options={AUDIENCES.map((a) => ({ value: a.id, label: a.label }))}
                        value={rule.scopes}
                        onChange={(nextScopes) => {
                          const scopes = (
                            Array.isArray(nextScopes) ? nextScopes : []
                          ) as ViewerScope[];
                          set({
                            visibilityRules: draft.visibilityRules.map((r, j) =>
                              j === i ? { ...r, scopes } : r,
                            ),
                          });
                        }}
                      />
                      <PredicateEditor
                        legend="When"
                        value={rule.when}
                        registry={registry}
                        fields={others}
                        onChange={(when) => {
                          set({
                            visibilityRules: draft.visibilityRules.map((r, j) =>
                              j === i ? { ...r, when } : r,
                            ),
                          });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="danger-soft"
                        onPress={() => {
                          set({ visibilityRules: draft.visibilityRules.filter((_, j) => j !== i) });
                        }}
                      >
                        Remove this rule
                      </Button>
                    </Stack>
                  </Card>
                ))}
                {show['rules'] === undefined ? null : <Alert tone="danger">{show['rules']}</Alert>}
                {draft.visibilityRules.length < MOST_RULES &&
                draft.classification !== 'special-category' ? (
                  <Button
                    size="sm"
                    startIcon={<Icon icon={Plus} />}
                    onPress={() => {
                      set({
                        visibilityRules: [
                          ...draft.visibilityRules,
                          { scopes: [], when: EMPTY_PREDICATE },
                        ],
                      });
                    }}
                  >
                    Add a rule
                  </Button>
                ) : null}
              </>
            ) : null}

            {part === 2 ? (
              <>
                <RadioGroup
                  accessibilityLabel="When it’s asked"
                  value={draft.collectAt}
                  onValueChange={(v) => {
                    set({ collectAt: v as Draft['collectAt'] });
                  }}
                >
                  {COLLECT.map((c) => (
                    <RadioCard
                      key={c.value}
                      value={c.value}
                      // Only the chosen timing explains itself, to keep the step on one screen (M5).
                      {...(c.value === draft.collectAt ? { description: c.description } : {})}
                    >
                      {c.label}
                    </RadioCard>
                  ))}
                </RadioGroup>
                <Text weight="semibold">Is it required?</Text>
                <SegmentedControl
                  fullWidth
                  size="sm"
                  value={draft.requiredness}
                  accessibilityLabel="Is it required?"
                  onValueChange={(v) => {
                    set({ requiredness: v as Draft['requiredness'] });
                  }}
                >
                  {REQUIREDNESS.map((r) => (
                    <SegmentedControlItem key={r.value} value={r.value}>
                      {r.label}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                {draft.requiredness === 'conditional' ? (
                  <PredicateEditor
                    legend="Required when"
                    value={draft.requiredWhen}
                    registry={registry}
                    fields={others}
                    onChange={(requiredWhen) => {
                      set({ requiredWhen });
                    }}
                  />
                ) : null}
                {show['requiredWhen'] === undefined ? null : (
                  <Alert tone="danger">{show['requiredWhen']}</Alert>
                )}
                {show['unseen'] === undefined ? null : (
                  <Alert tone="danger">{show['unseen']}</Alert>
                )}
              </>
            ) : null}

            {part === 3 ? (
              <>
                {advice === 'asking' ? (
                  <Spinner label="Judging what kind of data this is" />
                ) : advice === 'failed' ? (
                  <Alert tone="warning">No suggestion could be made. Choose below.</Alert>
                ) : judged === null ? null : (
                  <Alert tone={judged.kind === 'protect' ? 'warning' : 'info'} title="Suggested">
                    {judged.kind === 'choose'
                      ? judged.options.map((o) => o.reason).join(' ')
                      : judged.kind === 'fallback'
                        ? 'The section’s default, as no judgment was available.'
                        : `${judged.reason} A Kithena rule, not a model.`}
                  </Alert>
                )}
                <RadioGroup
                  accessibilityLabel="What kind of data this is"
                  value={draft.classification ?? undefined}
                  onValueChange={(v) => {
                    set({ classification: v as Draft['classification'], confirmedSpecial: false });
                  }}
                >
                  {CLASSIFICATION.map((c) => (
                    <RadioCard
                      key={c.value}
                      value={c.value}
                      description={c.description}
                      disabled={
                        (floor !== null && !atLeast(c.value, floor)) ||
                        (judged?.kind === 'protect' && c.value !== 'special-category') ||
                        (builtIn &&
                          field.classification !== c.value &&
                          !atLeast(c.value, field.classification))
                      }
                    >
                      {c.label}
                    </RadioCard>
                  ))}
                </RadioGroup>
                {draft.classification === 'special-category' ? (
                  <ListItem
                    listitem={false}
                    leading={
                      <Checkbox
                        checked={draft.confirmedSpecial}
                        accessibilityLabel="I confirm this is special-category data"
                        onCheckedChange={(on) => {
                          set({ confirmedSpecial: on });
                        }}
                      />
                    }
                  >
                    I confirm this is special-category data
                  </ListItem>
                ) : null}
                {show['kind'] === undefined ? null : <Alert tone="danger">{show['kind']}</Alert>}
                <List>
                  <ListItem
                    description={sealWhy}
                    trailing={
                      <Switch
                        checked={sealed}
                        disabled={sealLocked}
                        accessibilityLabel="Store it encrypted"
                        onCheckedChange={(encrypted) => {
                          set({ encrypted });
                        }}
                      />
                    }
                  >
                    Store it encrypted
                  </ListItem>
                  <ListItem
                    description="The old value stays until someone else approves."
                    trailing={
                      <Switch
                        checked={approval}
                        accessibilityLabel="Second HR approval"
                        onCheckedChange={(requiresApproval) => {
                          set({ requiresApproval });
                        }}
                      />
                    }
                  >
                    Second HR approval
                  </ListItem>
                  <ListItem
                    description={
                      shareable
                        ? 'Its name, never values'
                        : 'Never, for confidential or encrypted data'
                    }
                    trailing={
                      <Switch
                        checked={shared}
                        disabled={!shareable}
                        accessibilityLabel="Shared with the assistant"
                        onCheckedChange={setSharing}
                      />
                    }
                  >
                    Shared with the assistant
                  </ListItem>
                </List>
              </>
            ) : null}

            {part === 4 ? (
              <>
                <Card variant="fill" className="gap-2">
                  <Text variant="caption" tone="muted">
                    How it looks on a form
                  </Text>
                  <Preview draft={draft} approval={approval} />
                </Card>
                <List>
                  {[
                    {
                      step: 0,
                      label: 'The field',
                      value: `${DATA_TYPE_LABEL[draft.dataType] ?? draft.dataType} · ${registry.sections.find((s) => s.key === draft.sectionKey)?.label ?? section.label}`,
                    },
                    {
                      step: 1,
                      label: 'Access',
                      value: `${fieldSentence(draft).who} change it; ${everyone ? 'everyone sees it' : `${fieldSentence(draft).see.charAt(0).toLowerCase()}${fieldSentence(draft).see.slice(1)} see it`}.`,
                    },
                    {
                      step: 2,
                      label: 'When it’s asked',
                      value: `${COLLECT.find((c) => c.value === draft.collectAt)?.label ?? ''} · ${REQUIREDNESS.find((r) => r.value === draft.requiredness)?.label.toLowerCase() ?? ''}`,
                    },
                    {
                      step: 3,
                      label: 'Sensitivity',
                      value: [
                        CLASSIFICATION.find((c) => c.value === draft.classification)?.label ??
                          'Still to choose',
                        sealed ? 'encrypted' : null,
                        approval ? 'second approval' : null,
                        shared ? 'shared with the assistant' : null,
                      ]
                        .filter((x) => x !== null)
                        .join(' · '),
                    },
                  ].map((row) => (
                    <ListItem
                      key={row.label}
                      description={row.value}
                      wrap
                      trailing={
                        <Button
                          size="sm"
                          variant="link"
                          accessibilityLabel={`Change ${row.label.toLowerCase()}`}
                          onPress={() => {
                            goTo(row.step);
                          }}
                        >
                          Change
                        </Button>
                      }
                    >
                      {row.label}
                    </ListItem>
                  ))}
                </List>
                <Text variant="footnote" tone="muted">
                  Nothing changes for anybody until you publish.
                </Text>
              </>
            ) : null}
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          {part > 0 ? (
            <Button
              className="flex-1"
              onPress={() => {
                goTo(part - 1);
              }}
            >
              Back
            </Button>
          ) : (
            <Button className="flex-1" onPress={onClose}>
              Cancel
            </Button>
          )}
          {last ? null : (
            <Button className="flex-1" variant={editing ? 'secondary' : 'primary'} onPress={next}>
              {editing ? 'Next' : `Next: ${PARTS[part + 1] ?? ''}`}
            </Button>
          )}
          {editing || last ? (
            <Button
              className="flex-1"
              variant="primary"
              disabled={advice === 'asking' || (advice === null && draft.label.trim() !== '')}
              loading={busy === 'SaveDraftField' || busy === 'SetFieldAssistant'}
              onPress={save}
            >
              {editing ? 'Save' : 'Add field'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The field as a form draws it, from the profile's own control. Typing saves nothing. */
function Preview({ draft, approval }: { draft: Draft; approval: boolean }): React.JSX.Element {
  const [value, setValue] = useState<Value | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
  }, [draft.dataType]);
  if (draft.dataType === 'document_ref' || draft.dataType === 'image') {
    return (
      <Text variant="footnote" tone="muted">
        Uploaded on the profile rather than typed into a form.
      </Text>
    );
  }
  return (
    <AttributeInput
      field={{
        key: 'preview',
        label: draft.label.trim() === '' ? 'Your new field' : draft.label.trim(),
        description: draft.description.trim() === '' ? null : draft.description.trim(),
        dataType: draft.dataType,
        options: draft.options.map((o) => ({ value: o, label: o })),
        required: draft.requiredness === 'always',
        missing: null,
        readOnly: false,
        currency: draft.currency === '' ? null : draft.currency,
        openEnded: draft.openEnded,
        ownedBy: null,
        keptIn: null,
        sensitive: approval,
        askable: null,
      }}
      value={value}
      onChange={setValue}
    />
  );
}
