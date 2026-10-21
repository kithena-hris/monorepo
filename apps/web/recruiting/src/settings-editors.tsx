import {
  Chip,
  ChipRow,
  Alert,
  Badge,
  Button,
  Combobox,
  CurrencyField,
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
  FieldLabel,
  Input,
  NumberField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableList,
  Switch,
  RadioCard,
  RadioGroup,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { EmailFields, PURPOSE_LABEL } from './composer';
import { CategoryIcon } from './benefits';
import { Refusal, newId, useAct, words } from './shared';
import type {
  Knockout,
  ApprovalChain,
  Approver,
  Benefit,
  BenefitCategory,
  BenefitValue,
  MessageTemplate,
  OrgUnit,
  Question,
  QuestionKind,
  Questionnaire,
  ScreenProps,
  SettingsData,
  SettingsEntity,
  SettingsLocation,
  Stage,
} from './types';

/**
 * The editors behind Recruiting's settings (S1–S6): one dialog per thing,
 * opened to add or to change, saving through the same command either way.
 * What People owns (an entity, a location, a department that came from its
 * events) keeps People's name here and offers only what Recruiting adds.
 */

export const COUNTRIES = ['DE', 'ES', 'GB', 'IN', 'US'] as const;
export const CURRENCY: Readonly<Record<string, string>> = {
  DE: 'EUR',
  ES: 'EUR',
  GB: 'GBP',
  IN: 'INR',
  US: 'USD',
};
export const ZONE: Readonly<Record<string, string>> = {
  DE: 'Europe/Berlin',
  ES: 'Europe/Madrid',
  GB: 'Europe/London',
  IN: 'Asia/Kolkata',
  US: 'America/New_York',
};
const ZONES = [
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
] as const;
const CATEGORIES = [
  'applied',
  'screening',
  'interview',
  'assessment',
  'works_council',
  'offer',
  'hired',
] as const;
const EMPLOYMENT_TYPES = [
  'permanent',
  'fixed_term',
  'contractor',
  'intern',
  'apprentice',
  'seasonal',
] as const;
const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
const QUESTION_KINDS: readonly QuestionKind[] = [
  'short_text',
  'long_text',
  'single',
  'multiple',
  'number',
  'yes_no',
  'date',
  'file',
];
const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['hi', 'Hindi'],
] as const;

/** A name's key: lower case, words joined, starting with a letter. */
export const keyOf = (name: string): string =>
  (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || 'item'
  ).replace(/^(?![a-z])/u, 'k_');

/** Lifts a list of options into a `Select`. */
function Options({
  items,
}: {
  readonly items: readonly (readonly [value: string, label: string])[];
}): JSX.Element {
  return (
    <SelectContent>
      {items.map(([value, label]) => (
        <SelectItem key={value} value={value}>
          {label}
        </SelectItem>
      ))}
    </SelectContent>
  );
}

/** One dialog shape for every editor: a title, the fields, Cancel and Save. */
function Editor({
  open,
  onClose,
  title,
  description,
  children,
  canSave,
  pending,
  error,
  onSave,
  saveLabel = 'Save',
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly canSave: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
  readonly saveLabel?: string;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={error} />
          {children}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} loading={pending} onClick={onSave}>
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Act = ReturnType<typeof useAct>;

/* --------------------------------------------------------------- S1 -- */

export function EntityEditor({
  held,
  act,
  onClose,
}: {
  /** The entity to change, or null to add one. */
  readonly held: SettingsEntity | null;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const theirs = held?.source === 'people';
  const [name, setName] = useState(held?.name ?? '');
  const [country, setCountry] = useState(held?.country ?? 'DE');
  const [currency, setCurrency] = useState(held?.currency ?? CURRENCY[country] ?? 'EUR');
  const [hours, setHours] = useState<number | null>((held?.fullTimeWeeklyMinutes ?? 2400) / 60);
  const [headcount, setHeadcount] = useState<number | null>(held?.headcount ?? 0);
  const [worksCouncil, setWorksCouncil] = useState(held?.worksCouncil ?? false);
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New legal entity' : held.name}
      {...(theirs ? { description: 'From People: its name and country are changed there.' } : {})}
      canSave={name.trim() !== '' && hours !== null && headcount !== null}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveEntity',
          {
            id: held?.id ?? newId(),
            input: {
              name: name.trim(),
              country,
              currency,
              fullTimeWeeklyMinutes: Math.round((hours ?? 40) * 60),
              headcount: headcount ?? 0,
              foundedOn: held?.foundedOn ?? null,
              worksCouncil,
              worksCouncilIds: held?.worksCouncilIds ?? [],
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            disabled={theirs}
            placeholder="Acme GmbH"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Country</FieldLabel>
        <Select
          value={country}
          disabled={theirs}
          onValueChange={(c) => {
            setCountry(c);
            setCurrency(CURRENCY[c] ?? currency);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={COUNTRIES.map((c) => [c, c] as const)} />
        </Select>
        <FieldDescription>Its country pack decides the terms it can offer.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Currency</FieldLabel>
        <Select value={currency} onValueChange={setCurrency}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={['EUR', 'GBP', 'INR', 'USD'].map((c) => [c, c] as const)} />
        </Select>
      </Field>
      <NumberField
        label="Full-time week"
        hint="Hours; what a full FTE works here."
        value={hours}
        min={10}
        max={60}
        suffix="hours"
        onChange={setHours}
      />
      <NumberField
        label="Headcount"
        hint="Some statutory thresholds depend on it."
        value={headcount}
        min={0}
        onChange={setHeadcount}
      />
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>Works council</FieldLabel>
          <FieldDescription>A DE entity with one presents hires to it first.</FieldDescription>
        </span>
        <FieldControl>
          <Switch checked={worksCouncil} onCheckedChange={setWorksCouncil} />
        </FieldControl>
      </Field>
    </Editor>
  );
}

export function LocationEditor({
  held,
  entities,
  act,
  onClose,
}: {
  readonly held: SettingsLocation | null;
  readonly entities: readonly SettingsEntity[];
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [entityId, setEntityId] = useState<string>(held?.entityId ?? entities[0]?.id ?? '');
  const entity = entities.find((e) => e.id === entityId) ?? null;
  const [country, setCountry] = useState(held?.country ?? entity?.country ?? 'DE');
  const [city, setCity] = useState(held?.city ?? '');
  const [timeZone, setTimeZone] = useState(held?.timeZone ?? ZONE[country] ?? 'UTC');
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New location' : held.name}
      canSave={name.trim() !== ''}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveLocation',
          {
            id: held?.id ?? newId(),
            input: {
              name: name.trim(),
              entityId: entityId === '' ? null : entityId,
              country,
              region: held?.region ?? null,
              city: city.trim() === '' ? null : city.trim(),
              timeZone,
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Berlin office"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Legal entity</FieldLabel>
        <Select
          value={entityId === '' ? 'none' : entityId}
          onValueChange={(v) => {
            const next = v === 'none' ? '' : v;
            setEntityId(next);
            const e = entities.find((x) => x.id === next);
            if (e !== undefined) {
              setCountry(e.country);
              setTimeZone(ZONE[e.country] ?? timeZone);
            }
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['none', 'None'] as const,
              ...entities.map((e) => [e.id, `${e.name} (${e.country})`] as const),
            ]}
          />
        </Select>
        <FieldDescription>Who hires here; the country follows it.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Country</FieldLabel>
        <Select
          value={country}
          disabled={entity !== null}
          onValueChange={(c) => {
            setCountry(c);
            setTimeZone(ZONE[c] ?? timeZone);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={COUNTRIES.map((c) => [c, c] as const)} />
        </Select>
      </Field>
      <Field>
        <FieldLabel>City</FieldLabel>
        <FieldControl>
          <Input
            value={city}
            placeholder="Berlin"
            onChange={(e) => {
              setCity(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Time zone</FieldLabel>
        <Select value={timeZone} onValueChange={setTimeZone}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={[...new Set([timeZone, ...ZONES])].map((z) => [z, z] as const)} />
        </Select>
      </Field>
    </Editor>
  );
}

export function DepartmentEditor({
  held,
  units,
  act,
  onClose,
}: {
  readonly held: OrgUnit | null;
  readonly units: readonly OrgUnit[];
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [parentId, setParentId] = useState(held?.parentId ?? '');
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New department' : held.name}
      canSave={name.trim() !== ''}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveOrgUnit',
          {
            id: held?.id ?? newId(),
            input: { name: name.trim(), parentId: parentId === '' ? null : parentId },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Engineering"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Under</FieldLabel>
        <Select
          value={parentId === '' ? 'none' : parentId}
          onValueChange={(v) => {
            setParentId(v === 'none' ? '' : v);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['none', 'The top'] as const,
              ...units.filter((u) => u.id !== held?.id).map((u) => [u.id, u.name] as const),
            ]}
          />
        </Select>
      </Field>
    </Editor>
  );
}

/* --------------------------------------------------------------- S2 -- */

type DraftStage = Stage & { readonly locked?: boolean };

const stage = (name: string, category: Stage['category']): DraftStage => ({
  id: newId(),
  name,
  candidateName: name,
  category,
  automations: [],
});

export function PipelineEditor({
  held,
  act,
  onClose,
}: {
  readonly held: SettingsData['pipelines'][number] | null;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [isDefault, setDefault] = useState(held?.isDefault ?? false);
  const [stages, setStages] = useState<readonly DraftStage[]>(
    held?.stages ?? [
      stage('Applied', 'applied'),
      stage('Screening', 'screening'),
      stage('Interview', 'interview'),
      stage('Offer', 'offer'),
      stage('Hired', 'hired'),
    ],
  );
  const update = (id: string, patch: Partial<Stage>): void => {
    setStages(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New pipeline' : held.name}
      description="Starts at applied, ends at hired, has an offer, and never goes back a category. A job copies it; changes here leave open jobs alone."
      canSave={
        name.trim() !== '' && stages.length >= 2 && stages.every((s) => s.name.trim() !== '')
      }
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SavePipeline',
          {
            id: held?.id ?? newId(),
            input: {
              name: name.trim(),
              isDefault,
              stages: stages.map(({ locked: _locked, ...s }) => ({
                ...s,
                name: s.name.trim(),
                candidateName:
                  s.candidateName === null || s.candidateName.trim() === ''
                    ? null
                    : s.candidateName.trim(),
              })),
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Standard"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>Default</FieldLabel>
          <FieldDescription>What a new job starts with.</FieldDescription>
        </span>
        <FieldControl>
          <Switch checked={isDefault} onCheckedChange={setDefault} />
        </FieldControl>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Stages</span>
        <SortableList
          items={stages}
          label="Stages"
          activator="handle"
          appearance="plain"
          itemLabel={(s) => s.name}
          onReorder={(move) => {
            const byId = new Map(stages.map((s) => [s.id, s]));
            setStages(move.order.flatMap((id) => byId.get(id) ?? []));
          }}
        >
          {(s) => (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
              <Input
                aria-label="Stage name"
                className="min-w-32 flex-1"
                size="sm"
                value={s.name}
                onChange={(e) => {
                  update(s.id, { name: e.target.value });
                }}
              />
              <Input
                aria-label="Name the candidate sees"
                className="min-w-32 flex-1"
                size="sm"
                placeholder="Hidden from the candidate"
                value={s.candidateName ?? ''}
                onChange={(e) => {
                  update(s.id, { candidateName: e.target.value === '' ? null : e.target.value });
                }}
              />
              <Select
                value={s.category}
                onValueChange={(c) => {
                  update(s.id, { category: c as Stage['category'] });
                }}
              >
                <SelectTrigger aria-label="Category" size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <Options items={CATEGORIES.map((c) => [c, words(c)] as const)} />
              </Select>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Remove ${s.name}`}
                startIcon={<icons.remove aria-hidden />}
                onClick={() => {
                  setStages(stages.filter((x) => x.id !== s.id));
                }}
              />
            </div>
          )}
        </SortableList>
        <div>
          <Button
            size="sm"
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              const before = stages.findIndex((s) => s.category === 'offer');
              const next = stage('New stage', 'interview');
              setStages(
                before < 0
                  ? [...stages, next]
                  : [...stages.slice(0, before), next, ...stages.slice(before)],
              );
            }}
          >
            Add stage
          </Button>
        </div>
      </div>
    </Editor>
  );
}

/* --------------------------------------------------------------- S4 -- */

type DraftStep = { readonly id: string; readonly approver: Approver };

const approverLabel = (a: Approver, members: SettingsData['members']): string =>
  a.kind === 'person'
    ? (members.find((m) => m.personId === a.personId)?.name ?? 'Somebody')
    : a.kind === 'role'
      ? words(a.role)
      : 'The hiring manager’s manager';

export function ChainEditor({
  held,
  data,
  act,
  onClose,
}: {
  readonly held: ApprovalChain | null;
  readonly data: SettingsData;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [appliesTo, setAppliesTo] = useState<ApprovalChain['appliesTo']>(
    held?.appliesTo ?? 'requisition',
  );
  const [priority, setPriority] = useState<number | null>(held?.priority ?? 10);
  const [budget, setBudget] = useState(
    held?.when.budgetAboveMinor === undefined ? '' : String(held.when.budgetAboveMinor),
  );
  const [entityIds, setEntityIds] = useState<readonly string[]>(held?.when.legalEntityIds ?? []);
  const [steps, setSteps] = useState<readonly DraftStep[]>(
    (held?.steps ?? [{ kind: 'role', role: 'hr' }]).map((approver) => ({ id: newId(), approver })),
  );
  const currency = data.entities[0]?.currency ?? 'EUR';
  const setStep = (id: string, approver: Approver): void => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, approver } : s)));
  };
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New approval chain' : held.name}
      description="Each step gets an Inbox task in turn. The first chain whose conditions hold is used, lowest priority first."
      canSave={name.trim() !== '' && steps.length > 0 && priority !== null}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveChain',
          {
            id: held?.id ?? newId(),
            input: {
              name: name.trim(),
              appliesTo,
              priority: priority ?? 10,
              when: {
                ...held?.when,
                ...(budget === ''
                  ? { budgetAboveMinor: undefined }
                  : { budgetAboveMinor: Number(budget) }),
                ...(entityIds.length === 0
                  ? { legalEntityIds: undefined }
                  : { legalEntityIds: entityIds }),
              },
              steps: steps.map((s) => s.approver),
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Large requisitions"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Applies to</FieldLabel>
        <Select
          value={appliesTo}
          onValueChange={(v) => {
            setAppliesTo(v as ApprovalChain['appliesTo']);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['requisition', 'Requisitions'],
              ['offer', 'Offers'],
            ]}
          />
        </Select>
      </Field>
      <NumberField
        label="Priority"
        hint="Lower goes first when more than one chain matches."
        value={priority}
        min={0}
        max={100}
        onChange={setPriority}
      />
      <Field>
        <FieldLabel>Only when the budget is above</FieldLabel>
        <FieldControl>
          <CurrencyField currency={currency} value={budget} onValueChange={setBudget} />
        </FieldControl>
        <FieldDescription>Blank: any budget.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Only for these entities</FieldLabel>
        <FieldControl>
          <Combobox
            label="Legal entities"
            multiple
            chips
            clearable
            placeholder="Any entity"
            options={data.entities.map((e) => ({ value: e.id, label: e.name }))}
            value={entityIds}
            onChange={(v) => {
              setEntityIds(Array.isArray(v) ? v : v === null ? [] : [v as string]);
            }}
          />
        </FieldControl>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Steps, in order</span>
        <SortableList
          items={steps}
          label="Approval steps"
          activator="handle"
          appearance="plain"
          itemLabel={(s) => approverLabel(s.approver, data.members)}
          onReorder={(move) => {
            const byId = new Map(steps.map((s) => [s.id, s]));
            setSteps(move.order.flatMap((id) => byId.get(id) ?? []));
          }}
        >
          {(s) => (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
              <Select
                value={s.approver.kind === 'role' ? `role:${s.approver.role}` : s.approver.kind}
                onValueChange={(v) => {
                  if (v === 'managers_manager') setStep(s.id, { kind: 'managers_manager' });
                  else if (v === 'person')
                    setStep(s.id, { kind: 'person', personId: data.members[0]?.personId ?? '' });
                  else
                    setStep(s.id, {
                      kind: 'role',
                      role: v.replace('role:', '') as 'hr' | 'finance' | 'recruiting_admin',
                    });
                }}
              >
                <SelectTrigger aria-label="Who approves" size="sm" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <Options
                  items={[
                    ['role:hr', 'HR'],
                    ['role:finance', 'Finance'],
                    ['role:recruiting_admin', 'A Recruiting administrator'],
                    ['managers_manager', 'The hiring manager’s manager'],
                    ['person', 'A named person'],
                  ]}
                />
              </Select>
              {s.approver.kind === 'person' ? (
                <Combobox
                  label="Person"
                  size="sm"
                  className="min-w-48 flex-1"
                  placeholder="Pick a person"
                  options={data.members.map((m) => ({ value: m.personId, label: m.name }))}
                  value={s.approver.personId}
                  onChange={(v) => {
                    if (typeof v === 'string') setStep(s.id, { kind: 'person', personId: v });
                  }}
                />
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                aria-label="Remove step"
                startIcon={<icons.remove aria-hidden />}
                onClick={() => {
                  setSteps(steps.filter((x) => x.id !== s.id));
                }}
              />
            </div>
          )}
        </SortableList>
        <div>
          <Button
            size="sm"
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setSteps([...steps, { id: newId(), approver: { kind: 'role', role: 'finance' } }]);
            }}
          >
            Add step
          </Button>
        </div>
      </div>
    </Editor>
  );
}

/* --------------------------------------------------------------- S3 -- */

const question = (): Question => ({
  id: newId(),
  text: '',
  kind: 'short_text',
  required: false,
  options: [],
  points: null,
  knockout: null,
});

/**
 * A knockout on one question (PRD §15): which answers knock out, or the
 * number below which one does; whether that flags for review (the default)
 * or rejects on its own, and whether the question is a legal requirement,
 * the only case a German or Spanish job may auto-reject.
 */
function KnockoutEditor({
  question: q,
  onChange,
}: {
  readonly question: Question;
  readonly onChange: (knockout: Knockout | null) => void;
}): JSX.Element {
  const held = q.knockout;
  const on = held !== null;
  const blank: Knockout = { answers: [], autoReject: false, legalRequirement: false };
  const set = (patch: Partial<Knockout>): void => {
    onChange({ ...(held ?? blank), ...patch });
  };
  const choices = q.kind === 'yes_no' ? ['yes', 'no'] : q.options;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface p-3">
      <Field orientation="horizontal" className="gap-2">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>Knockout</FieldLabel>
          <FieldDescription>
            {q.kind === 'number'
              ? 'An answer below a number flags the application, or rejects it.'
              : 'Certain answers flag the application, or reject it.'}
          </FieldDescription>
        </span>
        <FieldControl>
          <Switch
            checked={on}
            onCheckedChange={(next) => {
              onChange(next ? blank : null);
            }}
          />
        </FieldControl>
      </Field>
      {!on ? null : (
        <>
          {q.kind === 'number' ? (
            <NumberField
              label="Knocks out below"
              value={held.below ?? null}
              onChange={(below) => {
                const { below: _was, ...rest } = held;
                onChange(below === null ? rest : { ...rest, below });
              }}
            />
          ) : choices.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Add the options first, then pick which knock out.
            </p>
          ) : (
            <ChipRow aria-label="Answers that knock out">
              {choices.map((c) => (
                <Chip
                  key={c}
                  selected={held.answers.includes(c)}
                  onClick={() => {
                    set({
                      answers: held.answers.includes(c)
                        ? held.answers.filter((x) => x !== c)
                        : [...held.answers, c],
                    });
                  }}
                >
                  {c === 'yes' ? 'Yes' : c === 'no' ? 'No' : c}
                </Chip>
              ))}
            </ChipRow>
          )}
          <Field orientation="horizontal" className="gap-2">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>A legal requirement</FieldLabel>
              <FieldDescription>
                A licence, the right to work: what the law needs for this job.
              </FieldDescription>
            </span>
            <FieldControl>
              <Switch
                checked={held.legalRequirement}
                onCheckedChange={(legalRequirement) => {
                  set({ legalRequirement });
                }}
              />
            </FieldControl>
          </Field>
          <Field orientation="horizontal" className="gap-2">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>Reject on its own</FieldLabel>
              <FieldDescription>
                Off: a knockout flags the application for a person to review. On: it is rejected,
                and the email offers a human review. A German or Spanish job allows this only for a
                legal requirement.
              </FieldDescription>
            </span>
            <FieldControl>
              <Switch
                checked={held.autoReject}
                onCheckedChange={(autoReject) => {
                  set({ autoReject });
                }}
              />
            </FieldControl>
          </Field>
        </>
      )}
    </div>
  );
}

export function QuestionnaireEditor({
  held,
  act,
  onClose,
}: {
  readonly held: Questionnaire | null;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [questions, setQuestions] = useState<readonly Question[]>(held?.questions ?? [question()]);
  const update = (id: string, patch: Partial<Question>): void => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New questionnaire' : held.name}
      description={
        held === null
          ? 'Asked on the apply form, or sent at a stage. Changing it later makes a new version.'
          : `Version ${String(held.version)}; saving makes version ${String(held.version + 1)}.`
      }
      canSave={
        name.trim() !== '' && questions.length > 0 && questions.every((q) => q.text.trim() !== '')
      }
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveQuestionnaire',
          {
            id: held?.id ?? newId(),
            input: {
              name: name.trim(),
              questions: questions.map((q) => ({
                ...q,
                text: q.text.trim(),
                options: ['single', 'multiple'].includes(q.kind) ? q.options : [],
              })),
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Right to work"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Questions</span>
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
            <div className="flex items-start gap-2">
              <Field required className="flex-1">
                <FieldLabel>{`Question ${String(i + 1)}`}</FieldLabel>
                <FieldControl>
                  <Input
                    value={q.text}
                    onChange={(e) => {
                      update(q.id, { text: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
              <Button
                size="xs"
                variant="ghost"
                className="mt-6"
                aria-label={`Remove question ${String(i + 1)}`}
                startIcon={<icons.remove aria-hidden />}
                onClick={() => {
                  setQuestions(questions.filter((x) => x.id !== q.id));
                }}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field>
                <FieldLabel>Answer</FieldLabel>
                <Select
                  value={q.kind}
                  onValueChange={(k) => {
                    update(q.id, { kind: k as QuestionKind });
                  }}
                >
                  <FieldControl>
                    <SelectTrigger size="sm" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <Options items={QUESTION_KINDS.map((k) => [k, words(k)] as const)} />
                </Select>
              </Field>
              <Field orientation="horizontal" className="gap-2">
                <FieldLabel>Required</FieldLabel>
                <FieldControl>
                  <Switch
                    checked={q.required}
                    onCheckedChange={(on) => {
                      update(q.id, { required: on });
                    }}
                  />
                </FieldControl>
              </Field>
            </div>
            {['single', 'multiple', 'yes_no', 'number'].includes(q.kind) ? (
              <KnockoutEditor
                question={q}
                onChange={(knockout) => {
                  update(q.id, { knockout });
                }}
              />
            ) : null}
            {q.kind === 'single' || q.kind === 'multiple' ? (
              <Field>
                <FieldLabel>Options, one per line</FieldLabel>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={q.options.join('\n')}
                    onChange={(e) => {
                      update(q.id, {
                        options: e.target.value
                          .split('\n')
                          .map((o) => o.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                </FieldControl>
              </Field>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setQuestions([...questions, question()]);
            }}
          >
            Add question
          </Button>
        </div>
      </div>
    </Editor>
  );
}

/* ---------------------------------------------------------- templates -- */

export function TemplateEditor({
  held,
  act,
  onClose,
}: {
  readonly held: MessageTemplate | null;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<MessageTemplate['kind']>(held?.kind ?? 'email');
  const [purpose, setPurpose] = useState(held?.purpose ?? '');
  const [language, setLanguage] = useState(held?.language ?? 'en');
  const [name, setName] = useState(held?.name ?? '');
  const [subject, setSubject] = useState(held?.subject ?? '');
  const [body, setBody] = useState(held?.body ?? '');
  const known = Object.keys(PURPOSE_LABEL).includes(purpose);
  const [customPurpose, setCustomPurpose] = useState(!known && purpose !== '');
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New template' : held.name}
      description="What a stage, a decision or an offer sends. Placeholders are filled in for each candidate."
      canSave={name.trim() !== '' && purpose.trim() !== '' && body.trim() !== ''}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveTemplate',
          {
            id: held?.id ?? newId(),
            input: {
              kind,
              purpose: keyOf(purpose),
              language,
              name: name.trim(),
              subject: kind === 'email' && subject.trim() !== '' ? subject.trim() : null,
              body,
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Interview invitation"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Kind</FieldLabel>
        <Select
          value={kind}
          onValueChange={(k) => {
            setKind(k as MessageTemplate['kind']);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['email', 'Email'],
              ['offer_letter', 'Offer letter'],
              ['contract', 'Contract'],
            ]}
          />
        </Select>
      </Field>
      <Field required>
        <FieldLabel>Used for</FieldLabel>
        <Select
          value={customPurpose ? 'custom' : purpose === '' ? 'rejection' : purpose}
          onValueChange={(v) => {
            if (v === 'custom') {
              setCustomPurpose(true);
              setPurpose('');
            } else {
              setCustomPurpose(false);
              setPurpose(v);
            }
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ...Object.entries(PURPOSE_LABEL),
              ['custom', 'Something else, for a stage’s automation'],
            ]}
          />
        </Select>
        {customPurpose ? (
          <FieldControl>
            <Input
              value={purpose}
              placeholder="interview_invite"
              onChange={(e) => {
                setPurpose(e.target.value);
              }}
            />
          </FieldControl>
        ) : null}
        <FieldDescription>
          {customPurpose
            ? 'A short key a stage’s automation picks it by.'
            : 'The composer opens with this template at that moment.'}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Language</FieldLabel>
        <Select value={language} onValueChange={setLanguage}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={LANGUAGES} />
        </Select>
      </Field>
      {kind === 'email' ? (
        <EmailFields
          value={{ subject, body }}
          onChange={(next) => {
            setSubject(next.subject);
            setBody(next.body);
          }}
        />
      ) : (
        <Field required>
          <FieldLabel>Body</FieldLabel>
          <FieldControl>
            <Textarea
              autoResize
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
      )}
    </Editor>
  );
}

/* --------------------------------------------------------------- S6 -- */

export function BenefitEditor({
  held,
  data,
  act,
  onClose,
  startEntity,
  startCategory,
}: {
  readonly held: Benefit | null;
  readonly data: SettingsData;
  readonly act: Act;
  readonly onClose: () => void;
  /** For a new benefit: the entity and the category it was added from. */
  readonly startEntity?: string;
  readonly startCategory?: string;
}): JSX.Element {
  const [entityId, setEntityId] = useState(
    held?.legalEntityId ?? startEntity ?? data.entities[0]?.id ?? '',
  );
  const entity = data.entities.find((e) => e.id === entityId);
  const [category, setCategory] = useState(held?.category ?? startCategory ?? 'health');
  const [name, setName] = useState(held?.names['en'] ?? Object.values(held?.names ?? {})[0] ?? '');
  const [description, setDescription] = useState(held?.description ?? '');
  const [valueKind, setValueKind] = useState<BenefitValue['kind']>(
    held?.value.kind ?? 'descriptive',
  );
  const [money, setMoney] = useState(
    held?.value.kind === 'money' ? String(held.value.yearlyMinor) : '',
  );
  const [percent, setPercent] = useState<number | null>(
    held?.value.kind === 'percent' ? held.value.basisPoints / 100 : null,
  );
  const [days, setDays] = useState<number | null>(
    held?.value.kind === 'days' ? held.value.days : null,
  );
  const [waiting, setWaiting] = useState(held?.eligibility.waiting.kind ?? 'none');
  const [months, setMonths] = useState<number | null>(
    held?.eligibility.waiting.kind === 'months' ? held.eligibility.waiting.months : 6,
  );
  const [employmentTypes, setEmploymentTypes] = useState<readonly string[]>(
    held?.eligibility.employmentTypes ?? [],
  );
  const [workModes, setWorkModes] = useState<readonly string[]>(held?.eligibility.workModes ?? []);
  const [minHours, setMinHours] = useState<number | null>(
    held?.eligibility.minWeeklyMinutes == null ? null : held.eligibility.minWeeklyMinutes / 60,
  );
  const [taxNote, setTaxNote] = useState(held?.taxNote ?? '');
  const value = (): BenefitValue => {
    switch (valueKind) {
      case 'money':
        return {
          kind: 'money',
          yearlyMinor: Number(money) || 0,
          currency: entity?.currency ?? 'EUR',
        };
      case 'percent':
        return { kind: 'percent', basisPoints: Math.round((percent ?? 0) * 100) };
      case 'days':
        return { kind: 'days', days: days ?? 0 };
      default:
        return { kind: 'descriptive' };
    }
  };
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New benefit' : name}
      description="Shown on ads, the careers page, the composer and offers. A tax note describes, never calculates."
      canSave={name.trim() !== '' && entityId !== ''}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveBenefit',
          {
            id: held?.id ?? `own:${entityId.slice(0, 8)}:${keyOf(name)}`,
            input: {
              key: held?.key ?? keyOf(name),
              legalEntityId: entityId,
              category,
              names: { ...held?.names, en: name.trim() },
              description: description.trim() === '' ? null : description.trim(),
              value: value(),
              eligibility: {
                employmentTypes: employmentTypes.length === 0 ? null : employmentTypes,
                minWeeklyMinutes: minHours === null ? null : Math.round(minHours * 60),
                waiting:
                  waiting === 'months'
                    ? { kind: 'months', months: months ?? 6 }
                    : { kind: waiting },
                workModes: workModes.length === 0 ? null : workModes,
                locationIds: held?.eligibility.locationIds ?? null,
              },
              statutory: false,
              taxNote: taxNote.trim() === '' ? null : taxNote.trim(),
            },
          },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Private health insurance"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Description</FieldLabel>
        <FieldDescription>One line a candidate reads under the name, on the ad.</FieldDescription>
        <FieldControl>
          <Textarea
            autoResize
            value={description}
            placeholder="A yearly budget for courses, books and conferences."
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>Legal entity</FieldLabel>
        <Select value={entityId} disabled={held !== null} onValueChange={setEntityId}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose an entity" />
            </SelectTrigger>
          </FieldControl>
          <Options items={data.entities.map((e) => [e.id, `${e.name} (${e.country})`] as const)} />
        </Select>
        <FieldDescription>Who offers it; a benefit belongs to one entity.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Category</FieldLabel>
        <Select value={category} onValueChange={setCategory}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={data.benefitCategories.map((c) => [c.key, c.name] as const)} />
        </Select>
      </Field>
      <Field>
        <FieldLabel>Worth</FieldLabel>
        <Select
          value={valueKind}
          onValueChange={(k) => {
            setValueKind(k as BenefitValue['kind']);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['descriptive', 'Described, no number'],
              ['money', 'An amount a year'],
              ['percent', 'A share of pay'],
              ['days', 'Days'],
            ]}
          />
        </Select>
      </Field>
      {valueKind === 'money' ? (
        <Field>
          <FieldLabel>A year</FieldLabel>
          <FieldControl>
            <CurrencyField
              currency={entity?.currency ?? 'EUR'}
              value={money}
              onValueChange={setMoney}
            />
          </FieldControl>
        </Field>
      ) : valueKind === 'percent' ? (
        <NumberField
          label="Share of pay"
          value={percent}
          min={0}
          max={100}
          precision={2}
          suffix="%"
          onChange={setPercent}
        />
      ) : valueKind === 'days' ? (
        <NumberField
          label="Days a year"
          value={days}
          min={0}
          max={365}
          suffix="days"
          onChange={setDays}
        />
      ) : null}
      <Field>
        <FieldLabel>From when</FieldLabel>
        <Select
          value={waiting}
          onValueChange={(w) => {
            setWaiting(w as typeof waiting);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={[
              ['none', 'The first day'],
              ['after_probation', 'After probation'],
              ['months', 'After some months'],
            ]}
          />
        </Select>
      </Field>
      {waiting === 'months' ? (
        <NumberField
          label="Months"
          value={months}
          min={1}
          max={36}
          suffix="months"
          onChange={setMonths}
        />
      ) : null}
      <Field>
        <FieldLabel>Only these contracts</FieldLabel>
        <FieldControl>
          <Combobox
            label="Employment types"
            multiple
            chips
            clearable
            placeholder="Everyone"
            options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: words(t) }))}
            value={employmentTypes}
            onChange={(v) => {
              setEmploymentTypes(Array.isArray(v) ? v : v === null ? [] : [v as string]);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Only these ways of working</FieldLabel>
        <FieldControl>
          <Combobox
            label="Work modes"
            multiple
            chips
            clearable
            placeholder="Any"
            options={WORK_MODES.map((m) => ({ value: m, label: words(m) }))}
            value={workModes}
            onChange={(v) => {
              setWorkModes(Array.isArray(v) ? v : v === null ? [] : [v as string]);
            }}
          />
        </FieldControl>
      </Field>
      <NumberField
        label="At least"
        hint="Hours a week; blank for any."
        value={minHours}
        min={1}
        max={60}
        suffix="hours"
        onChange={setMinHours}
      />
      <Field>
        <FieldLabel>Tax note</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={taxNote}
            placeholder="Exempt up to the statutory limit."
            onChange={(e) => {
              setTaxNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </Editor>
  );
}

/** The icons a category may wear, named for what they look like. */
const ICON_NAMES: Readonly<Record<string, string>> = {
  health: 'Health',
  payroll: 'Savings',
  break: 'Food',
  travel: 'Travel',
  parental: 'Family',
  goal: 'Growth',
  system: 'Equipment',
  favourite: 'Heart',
  location: 'Place',
  analytics: 'Chart',
  payment: 'Money',
  vacation: 'Holiday',
  locked: 'Protection',
  transfer: 'Exchange',
  home: 'Home',
  more: 'More',
  team: 'Team',
  company: 'Company',
  calendar: 'Calendar',
  document: 'Document',
  starred: 'Star',
  work: 'Work',
  meeting: 'Meeting',
  approve: 'Tick',
};

/** S6: a benefit category of the company's own: its name and the icon it wears. */
export function CategoryEditor({
  held,
  data,
  act,
  onClose,
}: {
  readonly held: BenefitCategory | null;
  readonly data: SettingsData;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [icon, setIcon] = useState(held?.icon ?? 'starred');
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? 'New category' : held.name}
      description="Benefits are grouped under it, with its icon, on the job’s tiles and on the ad."
      canSave={name.trim() !== ''}
      pending={act.pending}
      error={act.error}
      onSave={() => {
        act.run(
          'SaveBenefitCategory',
          { input: { key: held?.key ?? null, name: name.trim(), icon } },
          onClose,
        );
      }}
    >
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder="Community"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>Icon</FieldLabel>
        <RadioGroup
          aria-label="Icon"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          value={icon}
          onValueChange={setIcon}
        >
          {data.categoryIcons.map((key) => (
            <RadioCard key={key} value={key} icon={<CategoryIcon icon={key} />}>
              {ICON_NAMES[key] ?? words(key)}
            </RadioCard>
          ))}
        </RadioGroup>
      </Field>
    </Editor>
  );
}

/* ---------------------------------------------------------- in words -- */

interface Proposed {
  readonly change: Readonly<Record<string, unknown>> & { readonly op: string };
  readonly summary: string;
}

/**
 * Settings asked for in words: a request goes to Recruiting, which has the
 * model plan changes as the same inputs the editors send, and shows them
 * here as a list to read. Apply runs each through its own command, so every
 * check still runs; nothing was written until then.
 */
export function InWords({
  data,
  props,
  placeholder,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
  readonly placeholder: string;
}): JSX.Element | null {
  const act = useAct(props);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<{ say: string; changes: readonly Proposed[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (!data.general.ai.assistant) return null;
  const ask = (): void => {
    setPlan(null);
    act.run('RecruitingSettingsInWords', { input: { text: text.trim() } }, (d) => {
      setPlan(d as { say: string; changes: readonly Proposed[] });
    });
  };
  const apply = async (): Promise<void> => {
    if (plan === null) return;
    setApplying(true);
    setRefused(null);
    for (const { change, summary } of plan.changes) {
      const [name, variables] = operationOf(change, data);
      const done = await act.call(name, variables);
      if (!done.ok) {
        setRefused(`${summary}: ${done.message}`);
        setApplying(false);
        props.onRefresh?.();
        return;
      }
    }
    setApplying(false);
    setPlan(null);
    setText('');
    props.onRefresh?.();
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Ask for a change in words"
          className="flex-1"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim().length >= 3) ask();
          }}
        />
        <Button
          variant="secondary"
          startIcon={<icons.assistant aria-hidden />}
          disabled={text.trim().length < 3}
          loading={act.pending}
          onClick={ask}
        >
          Propose
        </Button>
      </div>
      <Refusal error={act.error ?? refused} />
      {plan === null ? null : (
        <Alert
          tone="info"
          icon={<icons.assistant aria-hidden />}
          title={plan.say}
          actions={
            plan.changes.length === 0 ? undefined : (
              <>
                <Button
                  size="sm"
                  loading={applying}
                  onClick={() => {
                    void apply();
                  }}
                >
                  {`Apply ${String(plan.changes.length)} change${plan.changes.length === 1 ? '' : 's'}`}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPlan(null);
                  }}
                >
                  Dismiss
                </Button>
              </>
            )
          }
        >
          {plan.changes.length === 0 ? null : (
            <ul className="list-disc ps-5">
              {plan.changes.map((c) => (
                <li key={c.summary}>
                  {c.summary}
                  {c.change['op'] === 'remove' ? (
                    <Badge size="xs" tone="danger" className="ms-2">
                      Removes
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}

const REMOVE_OP: Readonly<Record<string, string>> = {
  entity: 'RemoveEntity',
  location: 'RemoveLocation',
  orgUnit: 'RemoveOrgUnit',
  pipeline: 'RemovePipeline',
  chain: 'RemoveChain',
  questionnaire: 'RemoveQuestionnaire',
  template: 'RemoveTemplate',
  benefit: 'RemoveBenefit',
  payBand: 'RemovePayBand',
};

/** A proposed change as the command and variables the editors would send. */
function operationOf(
  c: Readonly<Record<string, unknown>> & { readonly op: string },
  data: SettingsData,
): [name: string, variables: Readonly<Record<string, unknown>>] {
  const id = typeof c['id'] === 'string' ? c['id'] : '';
  switch (c.op) {
    case 'saveEntity': {
      const held = data.entities.find((e) => e.id === id);
      return [
        'SaveEntity',
        {
          id,
          input: {
            name: c['name'],
            country: c['country'],
            currency: c['currency'],
            fullTimeWeeklyMinutes: held?.fullTimeWeeklyMinutes ?? 2400,
            headcount: held?.headcount ?? 0,
            foundedOn: held?.foundedOn ?? null,
            worksCouncil: c['worksCouncil'],
            worksCouncilIds: held?.worksCouncilIds ?? [],
          },
        },
      ];
    }
    case 'saveLocation': {
      const held = data.locations.find((l) => l.id === id);
      return [
        'SaveLocation',
        {
          id,
          input: {
            name: c['name'],
            entityId: c['entityId'],
            country: c['country'],
            region: held?.region ?? null,
            city: c['city'],
            timeZone: c['timeZone'],
          },
        },
      ];
    }
    case 'saveOrgUnit':
      return ['SaveOrgUnit', { id, input: { name: c['name'], parentId: c['parentId'] } }];
    case 'savePipeline': {
      const held = data.pipelines.find((p) => p.id === id);
      const stages = (c['stages'] as readonly Record<string, unknown>[]).map((s) => {
        const sid = typeof s['id'] === 'string' ? s['id'] : newId();
        return {
          id: sid,
          name: s['name'],
          candidateName: s['candidateName'],
          category: s['category'],
          automations: held?.stages.find((x) => x.id === sid)?.automations ?? [],
        };
      });
      return [
        'SavePipeline',
        { id, input: { name: c['name'], isDefault: c['isDefault'], stages } },
      ];
    }
    case 'saveChain': {
      const held = data.chains.find((x) => x.id === id);
      const entityIds = c['legalEntityIds'] as readonly string[];
      return [
        'SaveChain',
        {
          id,
          input: {
            name: c['name'],
            appliesTo: c['appliesTo'],
            priority: c['priority'],
            when: {
              ...held?.when,
              ...(c['budgetAboveMinor'] === null
                ? {}
                : { budgetAboveMinor: c['budgetAboveMinor'] }),
              ...(entityIds.length === 0 ? {} : { legalEntityIds: entityIds }),
            },
            steps: c['steps'],
          },
        },
      ];
    }
    case 'saveBenefit': {
      const held = data.benefits.find((b) => b.id === id);
      const name = String(c['name']);
      return [
        'SaveBenefit',
        {
          id,
          input: {
            key: held?.key ?? keyOf(name),
            legalEntityId: c['legalEntityId'],
            category: c['category'],
            names: { ...held?.names, en: name },
            value: c['value'],
            eligibility: {
              employmentTypes: held?.eligibility.employmentTypes ?? null,
              minWeeklyMinutes: held?.eligibility.minWeeklyMinutes ?? null,
              waiting: { kind: c['waiting'] },
              workModes: held?.eligibility.workModes ?? null,
              locationIds: held?.eligibility.locationIds ?? null,
            },
            statutory: false,
            taxNote: c['taxNote'],
          },
        },
      ];
    }
    case 'saveTemplate':
      return [
        'SaveTemplate',
        {
          id,
          input: {
            kind: c['kind'],
            purpose: c['purpose'],
            language: c['language'],
            name: c['name'],
            subject: c['subject'],
            body: c['body'],
          },
        },
      ];
    default:
      return [REMOVE_OP[String(c['kind'])] ?? 'RemoveEntity', { id }];
  }
}
