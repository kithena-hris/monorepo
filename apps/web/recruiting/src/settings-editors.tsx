import {
  Alert,
  Badge,
  Button,
  Chip,
  ChipRow,
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
  FieldError,
  FieldLabel,
  formatList,
  icons,
  Input,
  NumberField,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableList,
  Switch,
  TagsInput,
  Textarea,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { EmailFields, PURPOSE_LABEL } from './composer';
import { CategoryIcon } from './benefits';
import { Refusal, money as amount, newId, useAct, words } from './shared';
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
import { t as tr } from './i18n';

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
const LANGUAGES = () =>
  [
    ['en', tr('settings-editors.english', 'English')],
    ['es', tr('settings-editors.spanish', 'Spanish')],
    ['de', tr('settings-editors.german', 'German')],
    ['hi', tr('settings-editors.hindi', 'Hindi')],
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

/**
 * What an editor checks before it saves, field by field, shown the way a
 * person expects: nothing while they first fill it in, then, once Save has
 * been pressed with something wrong, every problem under its field, kept
 * current as they fix it, and the first one focused. Save stays pressable:
 * pressing it is how the reasons are asked for.
 */
export function useChecks(problems: Readonly<Record<string, string | null>>): {
  readonly invalid: (key: string) => boolean;
  readonly error: (key: string) => string | null;
  /** Shows the problems; true when there are none. */
  readonly pass: () => boolean;
  readonly tried: boolean;
} {
  const [tried, setTried] = useState(false);
  const ok = Object.values(problems).every((p) => p === null);
  return {
    invalid: (key) => tried && (problems[key] ?? null) !== null,
    error: (key) => (tried ? (problems[key] ?? null) : null),
    tried,
    pass: () => {
      setTried(true);
      if (!ok)
        // After the errors render: the first field that needs a change takes the focus.
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              '[role="dialog"] [aria-invalid="true"], [aria-invalid="true"]',
            )
            ?.focus();
        });
      return ok;
    },
  };
}

type Checks = ReturnType<typeof useChecks>;

/** One dialog shape for every editor: a title, the fields, Cancel and Save. */
function Editor({
  open,
  onClose,
  title,
  description,
  children,
  checks,
  problems,
  pending,
  error,
  onSave,
  saveLabel = tr('settings-editors.save', 'Save'),
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly checks: Checks;
  /** A problem with the whole, not one field (a list too short): said above the fields. */
  readonly problems?: readonly (string | null)[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
  readonly saveLabel?: string;
}): JSX.Element {
  const whole = (problems ?? []).filter((p): p is string => p !== null);
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
          {checks.tried && whole.length > 0 ? (
            <Alert
              tone="danger"
              title={tr('settings-editors.before_saving', 'Before saving')}
              className="animate-arrive"
            >
              {whole.join(' ')}
            </Alert>
          ) : null}
          {children}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tr('settings-editors.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              if (checks.pass()) onSave();
            }}
          >
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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr('settings-editors.give_the_entity_its_legal_name', 'Give the entity its legal name.')
        : null,
    hours:
      hours === null || hours < 10 || hours > 60
        ? tr(
            'settings-editors.a_full_time_week_is_between',
            'A full-time week is between 10 and 60 hours.',
          )
        : null,
    headcount:
      headcount === null || headcount < 0
        ? tr(
            'settings-editors.enter_how_many_people_it_employs',
            'Enter how many people it employs.',
          )
        : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={
        held === null ? tr('settings-editors.new_legal_entity', 'New legal entity') : held.name
      }
      {...(theirs
        ? {
            description: tr(
              'settings-editors.from_people_its_name_and_country',
              'From People: its name and country are changed there.',
            ),
          }
        : {})}
      checks={checks}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            disabled={theirs}
            placeholder={tr('settings-editors.acme_gmbh', 'Acme GmbH')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.country', 'Country')}</FieldLabel>
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
        <FieldDescription>
          {tr(
            'settings-editors.its_country_pack_decides_the_terms',
            'Its country pack decides the terms it can offer.',
          )}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.currency', 'Currency')}</FieldLabel>
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
        label={tr('settings-editors.full_time_week', 'Full-time week')}
        hint={
          checks.error('hours') ??
          tr(
            'settings-editors.hours_what_a_full_fte_works_here',
            'Hours; what a full FTE works here.',
          )
        }
        invalid={checks.invalid('hours')}
        value={hours}
        min={10}
        max={60}
        suffix={tr('settings-editors.hours', 'hours')}
        onChange={setHours}
      />
      <NumberField
        label={tr('settings-editors.headcount', 'Headcount')}
        hint={
          checks.error('headcount') ??
          tr(
            'settings-editors.some_statutory_thresholds_depend_on_it',
            'Some statutory thresholds depend on it.',
          )
        }
        invalid={checks.invalid('headcount')}
        value={headcount}
        min={0}
        onChange={setHeadcount}
      />
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>{tr('settings-editors.works_council', 'Works council')}</FieldLabel>
          <FieldDescription>
            {tr(
              'settings-editors.a_de_entity_with_one_presents',
              'A DE entity with one presents hires to it first.',
            )}
          </FieldDescription>
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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr(
            'settings-editors.name_the_location_as_people_call',
            'Name the location, as people call it.',
          )
        : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_location', 'New location') : held.name}
      checks={checks}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.berlin_office', 'Berlin office')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.legal_entity', 'Legal entity')}</FieldLabel>
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
              ['none', tr('settings-editors.none', 'None')] as const,
              ...entities.map(
                (e) =>
                  [
                    e.id,
                    tr('settings-editors.text', '{{name}} ({{country}})', {
                      name: e.name,
                      country: e.country,
                    }),
                  ] as const,
              ),
            ]}
          />
        </Select>
        <FieldDescription>
          {tr(
            'settings-editors.who_hires_here_the_country_follows',
            'Who hires here; the country follows it.',
          )}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.country', 'Country')}</FieldLabel>
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
        <FieldLabel>{tr('settings-editors.city', 'City')}</FieldLabel>
        <FieldControl>
          <Input
            value={city}
            placeholder={tr('settings-editors.berlin', 'Berlin')}
            onChange={(e) => {
              setCity(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.time_zone', 'Time zone')}</FieldLabel>
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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr('settings-editors.name_the_department', 'Name the department.')
        : units.some((u) => u.id !== held?.id && u.name.toLowerCase() === name.trim().toLowerCase())
          ? tr(
              'settings-editors.a_department_by_that_name_is',
              'A department by that name is already here.',
            )
          : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_department', 'New department') : held.name}
      checks={checks}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.engineering', 'Engineering')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.under', 'Under')}</FieldLabel>
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
              ['none', tr('settings-editors.the_top', 'The top')] as const,
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

const rank = (c: Stage['category']): number => CATEGORIES.indexOf(c);

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
      stage(tr('settings-editors.applied', 'Applied'), 'applied'),
      stage(tr('settings-editors.screening', 'Screening'), 'screening'),
      stage(tr('settings-editors.interview', 'Interview'), 'interview'),
      stage(tr('settings-editors.offer', 'Offer'), 'offer'),
      stage(tr('settings-editors.hired', 'Hired'), 'hired'),
    ],
  );
  const update = (id: string, patch: Partial<Stage>): void => {
    setStages(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  // Recruiting's rules for a pipeline (`validatePipeline`), said before saving rather than after.
  const backwards = stages.find(
    (s, i) => i > 0 && rank(s.category) < rank(stages[i - 1]?.category ?? 'applied'),
  );
  const shape = [
    stages.length < 2
      ? tr('settings-editors.a_pipeline_has_at_least_two', 'A pipeline has at least two steps.')
      : null,
    stages.some((s) => s.name.trim() === '')
      ? tr('settings-editors.every_step_needs_a_name', 'Every step needs a name.')
      : null,
    stages[0]?.category === 'applied'
      ? null
      : tr('settings-editors.the_first_step_is_of_the', 'The first step is of the type Applied.'),
    stages.at(-1)?.category === 'hired' && stages.filter((s) => s.category === 'hired').length === 1
      ? null
      : tr(
          'settings-editors.the_last_step_and_only_the',
          'The last step, and only the last, is of the type Hired.',
        ),
    stages.some((s) => s.category === 'offer')
      ? null
      : tr('settings-editors.one_step_is_of_the_type', 'One step is of the type Offer.'),
    backwards === undefined
      ? null
      : tr(
          'settings-editors.comes_after_a_later_type_of_step',
          '“{{name}}” comes after a later type of step; move it up or change its type.',
          { name: backwards.name },
        ),
  ];
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr(
            'settings-editors.name_the_pipeline_as_recruiters_will',
            'Name the pipeline, as recruiters will pick it.',
          )
        : null,
    steps: shape.some((p) => p !== null)
      ? tr('settings-editors.steps_are_incomplete', 'Steps are incomplete.')
      : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_pipeline', 'New pipeline') : held.name}
      description={tr(
        'settings-editors.the_steps_a_candidate_moves_through',
        'The steps a candidate moves through, from applying to being hired. A new job copies them; jobs already open keep theirs.',
      )}
      checks={checks}
      problems={shape}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.standard', 'Standard')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>{tr('settings-editors.use_for_new_jobs', 'Use for new jobs')}</FieldLabel>
          <FieldDescription>
            {tr(
              'settings-editors.a_new_job_starts_with_this',
              'A new job starts with this pipeline; it can pick another.',
            )}
          </FieldDescription>
        </span>
        <FieldControl>
          <Switch checked={isDefault} onCheckedChange={setDefault} />
        </FieldControl>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">
          {tr('settings-editors.steps_in_order', 'Steps, in order')}
        </span>
        <span className="text-sm text-fg-muted">
          {tr(
            'settings-editors.drag_to_reorder_the_type_tells',
            'Drag to reorder. The type tells Kithena what happens at a step: an interview step books interviews, an offer step sends offers.',
          )}
        </span>
        {/* What each column is, once, rather than a label on every row. */}
        <div
          aria-hidden
          className="flex items-center gap-2 ps-10 pe-9 text-xs font-medium text-fg-subtle"
        >
          <span className="min-w-32 flex-1">{tr('settings-editors.step', 'Step')}</span>
          <span className="w-36">{tr('settings-editors.type', 'Type')}</span>
          <span className="w-24 text-end">
            {tr('settings-editors.candidates_see_it', 'Candidates see it')}
          </span>
        </div>
        <SortableList
          items={stages}
          label={tr('settings-editors.steps', 'Steps')}
          activator="handle"
          appearance="plain"
          itemLabel={(s) => s.name}
          onReorder={(move) => {
            const byId = new Map(stages.map((s) => [s.id, s]));
            setStages(move.order.flatMap((id) => byId.get(id) ?? []));
          }}
        >
          {(s) => (
            <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
              <Input
                aria-label={tr('settings-editors.step_name', 'Step name')}
                className="min-w-32 flex-1"
                size="sm"
                value={s.name}
                onChange={(e) => {
                  // A step candidates see is shown to them under its name.
                  update(s.id, {
                    name: e.target.value,
                    ...(s.candidateName === null ? {} : { candidateName: e.target.value }),
                  });
                }}
              />
              <Select
                value={s.category}
                onValueChange={(c) => {
                  update(s.id, { category: c as Stage['category'] });
                }}
              >
                <SelectTrigger
                  aria-label={tr('settings-editors.type_of', 'Type of {{name}}', { name: s.name })}
                  size="sm"
                  className="w-36"
                >
                  <SelectValue />
                </SelectTrigger>
                <Options items={CATEGORIES.map((c) => [c, words(c)] as const)} />
              </Select>
              <span className="flex w-24 justify-end">
                <Switch
                  aria-label={tr('settings-editors.candidates_see', 'Candidates see {{name}}', {
                    name: s.name,
                  })}
                  checked={s.candidateName !== null}
                  onCheckedChange={(on) => {
                    update(s.id, { candidateName: on ? s.name : null });
                  }}
                />
              </span>
              <Button
                size="xs"
                variant="ghost"
                aria-label={tr('settings-editors.remove', 'Remove {{name}}', { name: s.name })}
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
              const next = stage(tr('settings-editors.new_step', 'New step'), 'interview');
              setStages(
                before < 0
                  ? [...stages, next]
                  : [...stages.slice(0, before), next, ...stages.slice(before)],
              );
            }}
          >
            {tr('settings-editors.add_step', 'Add step')}
          </Button>
        </div>
      </div>
    </Editor>
  );
}

/* --------------------------------------------------------------- S4 -- */

type DraftStep = { readonly id: string; readonly approver: Approver };

/** Who says yes at a step, in words. */
export const approverLabel = (a: Approver, members: SettingsData['members']): string =>
  a.kind === 'person'
    ? (members.find((m) => m.personId === a.personId)?.name ?? 'someone')
    : a.kind === 'managers_manager'
      ? tr('settings-editors.the_hiring_managers_manager', 'the hiring manager’s manager')
      : a.role === 'recruiting_admin'
        ? tr('settings-editors.a_recruiting_administrator', 'a Recruiting administrator')
        : a.role === 'hr'
          ? 'HR'
          : tr('settings-editors.finance', 'Finance');

/** A rule as one sentence: "New jobs over €100,000: the hiring manager's manager, then Finance." */
export const chainSentence = (
  c: Pick<ApprovalChain, 'appliesTo' | 'when' | 'steps'>,
  data: SettingsData,
): string => {
  const currency = data.entities[0]?.currency ?? 'EUR';
  const when = [
    c.when.budgetAboveMinor === undefined
      ? null
      : tr('settings-editors.with_a_budget_over', 'with a budget over {{budgetAboveMinor}}', {
          budgetAboveMinor: amount(c.when.budgetAboveMinor, currency),
        }),
    c.when.outsideBand === true
      ? tr('settings-editors.outside_the_pay_band', 'outside the pay band')
      : null,
    c.when.aboveBudget === true
      ? tr('settings-editors.above_the_jobs_budget', 'above the job’s budget')
      : null,
    c.when.legalEntityIds === undefined || c.when.legalEntityIds.length === 0
      ? null
      : tr('settings-editors.at', 'at {{join}}', {
          join: formatList(
            c.when.legalEntityIds.map((id) => data.entities.find((e) => e.id === id)?.name ?? '—'),
            'or',
          ),
        }),
  ].filter(Boolean);
  const what =
    c.appliesTo === 'requisition'
      ? when.length === 0
        ? tr('settings-editors.every_new_job', 'Every new job')
        : tr('settings-editors.new_jobs', 'New jobs')
      : when.length === 0
        ? tr('settings-editors.every_offer', 'Every offer')
        : tr('settings-editors.offers', 'Offers');
  const who = c.steps.map((a) => approverLabel(a, data.members)).join(', then ');
  return tr('settings-editors.text_2', '{{what}}{{value}}: {{value2}}', {
    what,
    value: when.length === 0 ? '' : ` ${when.join(', ')}`,
    value2: who === '' ? tr('settings-editors.nobody_yet', 'nobody yet') : who,
  });
};

/**
 * One approval rule, set out as a sentence: what needs a yes, when, and who
 * says it, in turn. The narrowest rule wins, so the order is worked out from
 * the conditions rather than asked for.
 */
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
  const [budget, setBudget] = useState(
    held?.when.budgetAboveMinor === undefined ? '' : String(held.when.budgetAboveMinor),
  );
  const [outsideBand, setOutsideBand] = useState(held?.when.outsideBand === true);
  const [aboveBudget, setAboveBudget] = useState(held?.when.aboveBudget === true);
  const [entityIds, setEntityIds] = useState<readonly string[]>(held?.when.legalEntityIds ?? []);
  const [steps, setSteps] = useState<readonly DraftStep[]>(
    (held?.steps ?? [{ kind: 'managers_manager' }]).map((approver) => ({
      id: newId(),
      approver,
    })),
  );
  const currency = data.entities[0]?.currency ?? 'EUR';
  const setStep = (id: string, approver: Approver): void => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, approver } : s)));
  };
  const job = appliesTo === 'requisition';
  const when: ApprovalChain['when'] = {
    // What this editor does not show (reasons, grades) is kept as it was.
    ...(held?.when.reasons === undefined ? {} : { reasons: held.when.reasons }),
    ...(held?.when.grades === undefined ? {} : { grades: held.when.grades }),
    ...(job && budget !== '' ? { budgetAboveMinor: Number(budget) } : {}),
    ...(!job && outsideBand ? { outsideBand: true } : {}),
    ...(!job && aboveBudget ? { aboveBudget: true } : {}),
    ...(entityIds.length === 0 ? {} : { legalEntityIds: entityIds }),
  };
  const draft = { appliesTo, when, steps: steps.map((s) => s.approver) };
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr(
            'settings-editors.name_the_rule_such_as_large',
            'Name the rule, such as “Large budgets”.',
          )
        : null,
    steps: steps.length === 0 ? tr('settings-editors.add_who_says_yes', 'Add who says yes.') : null,
    person: steps.some((s) => s.approver.kind === 'person' && s.approver.personId === '')
      ? tr('settings-editors.pick_the_person', 'Pick the person.')
      : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={
        held === null ? tr('settings-editors.new_approval_rule', 'New approval rule') : held.name
      }
      description={tr(
        'settings-editors.when_something_fits_this_rule_each',
        'When something fits this rule, each person below gets a task in their Inbox, one after another. It goes ahead once the last says yes; anyone can say no.',
      )}
      checks={checks}
      problems={[
        steps.length === 0
          ? tr(
              'settings-editors.add_at_least_one_person_who',
              'Add at least one person who says yes.',
            )
          : null,
        checks.error('person'),
      ]}
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
              // The narrowest rule first: each condition makes it more particular.
              priority: 100 - 10 * Object.keys(when).length,
              when,
              steps: steps.map((s) => s.approver),
            },
          },
          onClose,
        );
      }}
    >
      <Field>
        <FieldLabel>{tr('settings-editors.what_needs_a_yes', 'What needs a yes')}</FieldLabel>
        <RadioGroup
          aria-label={tr('settings-editors.what_needs_a_yes', 'What needs a yes')}
          className="grid gap-2 sm:grid-cols-2"
          value={appliesTo}
          onValueChange={(v) => {
            setAppliesTo(v as ApprovalChain['appliesTo']);
          }}
        >
          <RadioCard
            value="requisition"
            icon={<icons.work />}
            description={tr(
              'settings-editors.a_hiring_manager_asks_to_open',
              'A hiring manager asks to open a job (a requisition).',
            )}
          >
            {tr('settings-editors.opening_a_new_job', 'Opening a new job')}
          </RadioCard>
          <RadioCard
            value="offer"
            icon={<icons.document />}
            description={tr(
              'settings-editors.an_offer_before_it_goes_to',
              'An offer, before it goes to the candidate.',
            )}
          >
            {tr('settings-editors.sending_an_offer', 'Sending an offer')}
          </RadioCard>
        </RadioGroup>
      </Field>
      {job ? (
        <Field>
          <FieldLabel>
            {tr('settings-editors.only_when_the_budget_is_over', 'Only when the budget is over')}
          </FieldLabel>
          <FieldControl>
            <CurrencyField currency={currency} value={budget} onValueChange={setBudget} />
          </FieldControl>
          <FieldDescription>
            {tr(
              'settings-editors.leave_it_empty_to_ask_for',
              'Leave it empty to ask for every new job.',
            )}
          </FieldDescription>
        </Field>
      ) : (
        <div className="flex flex-col gap-3">
          <Field orientation="horizontal">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>
                {tr(
                  'settings-editors.only_when_the_pay_is_outside',
                  'Only when the pay is outside the pay band',
                )}
              </FieldLabel>
              <FieldDescription>
                {tr(
                  'settings-editors.the_grades_band_under_pay_bands',
                  'The grade’s band, under Pay bands.',
                )}
              </FieldDescription>
            </span>
            <FieldControl>
              <Switch checked={outsideBand} onCheckedChange={setOutsideBand} />
            </FieldControl>
          </Field>
          <Field orientation="horizontal">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>
                {tr(
                  'settings-editors.only_when_the_pay_is_above',
                  'Only when the pay is above the job’s budget',
                )}
              </FieldLabel>
              <FieldDescription>
                {tr('settings-editors.both_off_every_offer_asks', 'Both off: every offer asks.')}
              </FieldDescription>
            </span>
            <FieldControl>
              <Switch checked={aboveBudget} onCheckedChange={setAboveBudget} />
            </FieldControl>
          </Field>
        </div>
      )}
      {data.entities.length < 2 ? null : (
        <Field>
          <FieldLabel>
            {tr('settings-editors.only_at_these_entities', 'Only at these entities')}
          </FieldLabel>
          <FieldControl>
            <Combobox
              label={tr('settings-editors.legal_entities', 'Legal entities')}
              multiple
              chips
              clearable
              placeholder={tr('settings-editors.any_entity', 'Any entity')}
              options={data.entities.map((e) => ({ value: e.id, label: e.name }))}
              value={entityIds}
              onChange={(v) => {
                setEntityIds(Array.isArray(v) ? v : v === null ? [] : [v as string]);
              }}
            />
          </FieldControl>
        </Field>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">
          {tr('settings-editors.who_says_yes_in_this_order', 'Who says yes, in this order')}
        </span>
        <SortableList
          items={steps}
          label={tr('settings-editors.who_says_yes', 'Who says yes')}
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
                  else if (v === 'person') setStep(s.id, { kind: 'person', personId: '' });
                  else
                    setStep(s.id, {
                      kind: 'role',
                      role: v.replace('role:', '') as 'hr' | 'finance' | 'recruiting_admin',
                    });
                }}
              >
                <SelectTrigger
                  aria-label={tr('settings-editors.who_says_yes', 'Who says yes')}
                  size="sm"
                  className="w-60"
                >
                  <SelectValue />
                </SelectTrigger>
                <Options
                  items={[
                    [
                      'managers_manager',
                      tr(
                        'settings-editors.the_hiring_managers_manager_2',
                        'The hiring manager’s manager',
                      ),
                    ],
                    ['role:hr', tr('settings-editors.anyone_in_hr', 'Anyone in HR')],
                    ['role:finance', tr('settings-editors.anyone_in_finance', 'Anyone in Finance')],
                    [
                      'role:recruiting_admin',
                      tr(
                        'settings-editors.a_recruiting_administrator_2',
                        'A Recruiting administrator',
                      ),
                    ],
                    ['person', tr('settings-editors.a_person_i_choose', 'A person I choose')],
                  ]}
                />
              </Select>
              {s.approver.kind === 'person' ? (
                <Combobox
                  label={tr('settings-editors.person', 'Person')}
                  size="sm"
                  className="min-w-48 flex-1"
                  placeholder={tr('settings-editors.pick_a_person', 'Pick a person')}
                  aria-invalid={checks.invalid('person') && s.approver.personId === ''}
                  options={data.members.map((m) => ({ value: m.personId, label: m.name }))}
                  value={s.approver.personId === '' ? null : s.approver.personId}
                  onChange={(v) => {
                    if (typeof v === 'string') setStep(s.id, { kind: 'person', personId: v });
                  }}
                />
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                aria-label={tr('settings-editors.remove_2', 'Remove')}
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
            {tr('settings-editors.add_someone', 'Add someone')}
          </Button>
        </div>
      </div>
      <Alert
        tone="accent"
        icon={<icons.approve aria-hidden />}
        title={tr('settings-editors.this_rule_reads', 'This rule reads')}
      >
        {chainSentence(draft, data)}
      </Alert>
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={
              job
                ? tr('settings-editors.large_budgets', 'Large budgets')
                : tr('settings-editors.offers_outside_the_band', 'Offers outside the band')
            }
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
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
          <FieldLabel>{tr('settings-editors.knockout', 'Knockout')}</FieldLabel>
          <FieldDescription>
            {q.kind === 'number'
              ? tr(
                  'settings-editors.an_answer_below_a_number_flags',
                  'An answer below a number flags the application, or rejects it.',
                )
              : tr(
                  'settings-editors.certain_answers_flag_the_application_or',
                  'Certain answers flag the application, or reject it.',
                )}
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
              label={tr('settings-editors.knocks_out_below', 'Knocks out below')}
              value={held.below ?? null}
              onChange={(below) => {
                const { below: _was, ...rest } = held;
                onChange(below === null ? rest : { ...rest, below });
              }}
            />
          ) : choices.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr(
                'settings-editors.add_the_options_first_then_pick',
                'Add the options first, then pick which knock out.',
              )}
            </p>
          ) : (
            <ChipRow
              aria-label={tr('settings-editors.answers_that_knock_out', 'Answers that knock out')}
            >
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
                  {c === 'yes'
                    ? tr('settings-editors.yes', 'Yes')
                    : c === 'no'
                      ? tr('settings-editors.no', 'No')
                      : c}
                </Chip>
              ))}
            </ChipRow>
          )}
          <Field orientation="horizontal" className="gap-2">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>
                {tr('settings-editors.a_legal_requirement', 'A legal requirement')}
              </FieldLabel>
              <FieldDescription>
                {tr(
                  'settings-editors.a_licence_the_right_to_work',
                  'A licence, the right to work: what the law needs for this job.',
                )}
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
              <FieldLabel>
                {tr('settings-editors.reject_on_its_own', 'Reject on its own')}
              </FieldLabel>
              <FieldDescription>
                {tr(
                  'settings-editors.off_a_knockout_flags_the_application',
                  'Off: a knockout flags the application for a person to review. On: it is rejected and the rejection email sent the next working day at 09:00 in the candidate’s time zone, never the moment they apply; until then the team can move it on instead. A German or Spanish job allows this only for a legal requirement.',
                )}
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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr('settings-editors.name_the_questionnaire', 'Name the questionnaire.')
        : null,
    questions:
      questions.length === 0 || questions.some((q) => q.text.trim() === '')
        ? tr('settings-editors.questions_are_incomplete', 'Questions are incomplete.')
        : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={
        held === null ? tr('settings-editors.new_questionnaire', 'New questionnaire') : held.name
      }
      description={
        held === null
          ? tr(
              'settings-editors.asked_on_the_apply_form_or',
              'Asked on the apply form, or sent at a stage. Changing it later makes a new version.',
            )
          : tr(
              'settings-editors.version_saving_makes_version',
              'Version {{version}}; saving makes version {{next}}.',
              { version: held.version, next: held.version + 1 },
            )
      }
      checks={checks}
      problems={[
        questions.length === 0
          ? tr('settings-editors.add_at_least_one_question', 'Add at least one question.')
          : null,
        questions.some((q) => q.text.trim() === '')
          ? tr('settings-editors.every_question_needs_its_words', 'Every question needs its words.')
          : null,
      ]}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.right_to_work', 'Right to work')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">
          {tr('settings-editors.questions', 'Questions')}
        </span>
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
            <div className="flex items-start gap-2">
              <Field required className="flex-1">
                <FieldLabel>
                  {tr('settings-editors.question', 'Question {{value}}', { value: String(i + 1) })}
                </FieldLabel>
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
                aria-label={tr('settings-editors.remove_question', 'Remove question {{value}}', {
                  value: String(i + 1),
                })}
                startIcon={<icons.remove aria-hidden />}
                onClick={() => {
                  setQuestions(questions.filter((x) => x.id !== q.id));
                }}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field>
                <FieldLabel>{tr('settings-editors.answer', 'Answer')}</FieldLabel>
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
                <FieldLabel>{tr('settings-editors.required', 'Required')}</FieldLabel>
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
              <TagsInput
                label={tr('settings-editors.answers_to_choose_from', 'Answers to choose from')}
                value={q.options}
                placeholder={tr('settings-editors.type_one_then_enter', 'Type one, then Enter')}
                hint={tr(
                  'settings-editors.press_enter_after_each_one',
                  'Press Enter after each one.',
                )}
                validate={(o) =>
                  q.options.some((x) => x.toLowerCase() === o.trim().toLowerCase())
                    ? tr('settings-editors.already_there', 'Already there.')
                    : null
                }
                onChange={(options) => {
                  update(q.id, { options });
                }}
              />
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
            {tr('settings-editors.add_question', 'Add question')}
          </Button>
        </div>
      </div>
    </Editor>
  );
}

/* ---------------------------------------------------------- templates -- */

/** What a template can be for: the composer's moments, and the invitation to choose interview times. */
export const TEMPLATE_PURPOSES: Readonly<Record<string, string>> = {
  ...PURPOSE_LABEL,
  get interview_invitation(): string {
    return tr(
      'settings-editors.invitation_to_choose_interview_times',
      'Invitation to choose interview times',
    );
  },
};

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
  const known = Object.keys(TEMPLATE_PURPOSES).includes(purpose);
  const [customPurpose, setCustomPurpose] = useState(!known && purpose !== '');
  const checks = useChecks({
    name:
      name.trim() === '' ? tr('settings-editors.name_the_template', 'Name the template.') : null,
    purpose:
      purpose.trim() === ''
        ? tr('settings-editors.choose_what_it_is_used_for', 'Choose what it is used for.')
        : null,
    body:
      body.trim() === '' ? tr('settings-editors.write_what_it_says', 'Write what it says.') : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_template', 'New template') : held.name}
      description={tr(
        'settings-editors.what_a_stage_a_decision_or',
        'What a stage, a decision or an offer sends. Placeholders are filled in for each candidate.',
      )}
      checks={checks}
      problems={[
        kind === 'email' && body.trim() === ''
          ? tr('settings-editors.write_the_emails_words', 'Write the email’s words.')
          : null,
      ]}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.interview_invitation', 'Interview invitation')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.kind', 'Kind')}</FieldLabel>
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
              ['email', tr('settings-editors.email', 'Email')],
              ['offer_letter', tr('settings-editors.offer_letter', 'Offer letter')],
              ['contract', tr('settings-editors.contract', 'Contract')],
            ]}
          />
        </Select>
      </Field>
      <Field required invalid={checks.invalid('purpose')}>
        <FieldLabel>{tr('settings-editors.used_for', 'Used for')}</FieldLabel>
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
              ...Object.entries(TEMPLATE_PURPOSES),
              [
                'custom',
                tr(
                  'settings-editors.something_else_for_a_stages_automation',
                  'Something else, for a stage’s automation',
                ),
              ],
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
            ? tr(
                'settings-editors.a_short_key_a_stages_automation',
                'A short key a stage’s automation picks it by.',
              )
            : tr(
                'settings-editors.the_composer_opens_with_this_template',
                'The composer opens with this template at that moment.',
              )}
        </FieldDescription>
        <FieldError>{checks.error('purpose')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.language', 'Language')}</FieldLabel>
        <Select value={language} onValueChange={setLanguage}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <Options items={LANGUAGES()} />
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
        <Field required invalid={checks.invalid('body')}>
          <FieldLabel>{tr('settings-editors.body', 'Body')}</FieldLabel>
          <FieldControl>
            <Textarea
              autoResize
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
          </FieldControl>
          <FieldError>{checks.error('body')}</FieldError>
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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr(
            'settings-editors.name_the_benefit_as_a_candidate',
            'Name the benefit, as a candidate reads it.',
          )
        : null,
    entity:
      entityId === ''
        ? tr(
            'settings-editors.choose_the_entity_that_offers_it',
            'Choose the entity that offers it.',
          )
        : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_benefit', 'New benefit') : name}
      description={tr(
        'settings-editors.shown_on_ads_the_careers_page',
        'Shown on ads, the careers page, the composer and offers. A tax note describes, never calculates.',
      )}
      checks={checks}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr(
              'settings-editors.private_health_insurance',
              'Private health insurance',
            )}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.description', 'Description')}</FieldLabel>
        <FieldDescription>
          {tr(
            'settings-editors.one_line_a_candidate_reads_under',
            'One line a candidate reads under the name, on the ad.',
          )}
        </FieldDescription>
        <FieldControl>
          <Textarea
            autoResize
            value={description}
            placeholder={tr(
              'settings-editors.a_yearly_budget_for_courses_books',
              'A yearly budget for courses, books and conferences.',
            )}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field required invalid={checks.invalid('entity')}>
        <FieldLabel>{tr('settings-editors.legal_entity', 'Legal entity')}</FieldLabel>
        <Select value={entityId} disabled={held !== null} onValueChange={setEntityId}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue
                placeholder={tr('settings-editors.choose_an_entity', 'Choose an entity')}
              />
            </SelectTrigger>
          </FieldControl>
          <Options
            items={data.entities.map(
              (e) =>
                [
                  e.id,
                  tr('settings-editors.text', '{{name}} ({{country}})', {
                    name: e.name,
                    country: e.country,
                  }),
                ] as const,
            )}
          />
        </Select>
        <FieldDescription>
          {tr(
            'settings-editors.who_offers_it_a_benefit_belongs',
            'Who offers it; a benefit belongs to one entity.',
          )}
        </FieldDescription>
        <FieldError>{checks.error('entity')}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{tr('settings-editors.category', 'Category')}</FieldLabel>
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
        <FieldLabel>{tr('settings-editors.worth', 'Worth')}</FieldLabel>
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
              ['descriptive', tr('settings-editors.described_no_number', 'Described, no number')],
              ['money', tr('settings-editors.an_amount_a_year', 'An amount a year')],
              ['percent', tr('settings-editors.a_share_of_pay', 'A share of pay')],
              ['days', tr('settings-editors.days', 'Days')],
            ]}
          />
        </Select>
      </Field>
      {valueKind === 'money' ? (
        <Field>
          <FieldLabel>{tr('settings-editors.a_year', 'A year')}</FieldLabel>
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
          label={tr('settings-editors.share_of_pay', 'Share of pay')}
          value={percent}
          min={0}
          max={100}
          precision={2}
          suffix="%"
          onChange={setPercent}
        />
      ) : valueKind === 'days' ? (
        <NumberField
          label={tr('settings-editors.days_a_year', 'Days a year')}
          value={days}
          min={0}
          max={365}
          suffix={tr('settings-editors.days_2', 'days')}
          onChange={setDays}
        />
      ) : null}
      <Field>
        <FieldLabel>{tr('settings-editors.from_when', 'From when')}</FieldLabel>
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
              ['none', tr('settings-editors.the_first_day', 'The first day')],
              ['after_probation', tr('settings-editors.after_probation', 'After probation')],
              ['months', tr('settings-editors.after_some_months', 'After some months')],
            ]}
          />
        </Select>
      </Field>
      {waiting === 'months' ? (
        <NumberField
          label={tr('settings-editors.months', 'Months')}
          value={months}
          min={1}
          max={36}
          suffix={tr('settings-editors.months_2', 'months')}
          onChange={setMonths}
        />
      ) : null}
      <Field>
        <FieldLabel>
          {tr('settings-editors.only_these_contracts', 'Only these contracts')}
        </FieldLabel>
        <FieldControl>
          <Combobox
            label={tr('settings-editors.employment_types', 'Employment types')}
            multiple
            chips
            clearable
            placeholder={tr('settings-editors.everyone', 'Everyone')}
            options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: words(t) }))}
            value={employmentTypes}
            onChange={(v) => {
              setEmploymentTypes(Array.isArray(v) ? v : v === null ? [] : [v as string]);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>
          {tr('settings-editors.only_these_ways_of_working', 'Only these ways of working')}
        </FieldLabel>
        <FieldControl>
          <Combobox
            label={tr('settings-editors.work_modes', 'Work modes')}
            multiple
            chips
            clearable
            placeholder={tr('settings-editors.any', 'Any')}
            options={WORK_MODES.map((m) => ({ value: m, label: words(m) }))}
            value={workModes}
            onChange={(v) => {
              setWorkModes(Array.isArray(v) ? v : v === null ? [] : [v as string]);
            }}
          />
        </FieldControl>
      </Field>
      <NumberField
        label={tr('settings-editors.at_least', 'At least')}
        hint={tr('settings-editors.hours_a_week_blank_for_any', 'Hours a week; blank for any.')}
        value={minHours}
        min={1}
        max={60}
        suffix={tr('settings-editors.hours', 'hours')}
        onChange={setMinHours}
      />
      <Field>
        <FieldLabel>{tr('settings-editors.tax_note', 'Tax note')}</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={taxNote}
            placeholder={tr(
              'settings-editors.exempt_up_to_the_statutory_limit',
              'Exempt up to the statutory limit.',
            )}
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
const ICON_NAMES = (): Readonly<Record<string, string>> => ({
  get health(): string {
    return tr('settings-editors.health', 'Health');
  },
  get payroll(): string {
    return tr('settings-editors.savings', 'Savings');
  },
  get break(): string {
    return tr('settings-editors.food', 'Food');
  },
  get travel(): string {
    return tr('settings-editors.travel', 'Travel');
  },
  get parental(): string {
    return tr('settings-editors.family', 'Family');
  },
  get goal(): string {
    return tr('settings-editors.growth', 'Growth');
  },
  get system(): string {
    return tr('settings-editors.equipment', 'Equipment');
  },
  get favourite(): string {
    return tr('settings-editors.heart', 'Heart');
  },
  get location(): string {
    return tr('settings-editors.place', 'Place');
  },
  analytics: tr('settings-editors.chart', 'Chart'),
  get payment(): string {
    return tr('settings-editors.money', 'Money');
  },
  get vacation(): string {
    return tr('settings-editors.holiday', 'Holiday');
  },
  get locked(): string {
    return tr('settings-editors.protection', 'Protection');
  },
  get transfer(): string {
    return tr('settings-editors.exchange', 'Exchange');
  },
  home: tr('settings-editors.home', 'Home'),
  get more(): string {
    return tr('settings-editors.more', 'More');
  },
  get team(): string {
    return tr('settings-editors.team', 'Team');
  },
  get company(): string {
    return tr('settings-editors.company', 'Company');
  },
  get calendar(): string {
    return tr('settings-editors.calendar', 'Calendar');
  },
  get document(): string {
    return tr('settings-editors.document', 'Document');
  },
  get starred(): string {
    return tr('settings-editors.star', 'Star');
  },
  get work(): string {
    return tr('settings-editors.work', 'Work');
  },
  get meeting(): string {
    return tr('settings-editors.meeting', 'Meeting');
  },
  get approve(): string {
    return tr('settings-editors.tick', 'Tick');
  },
});

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
  const checks = useChecks({
    name:
      name.trim() === ''
        ? tr('settings-editors.name_the_category', 'Name the category.')
        : data.benefitCategories.some(
              (c) => c.key !== held?.key && c.name.toLowerCase() === name.trim().toLowerCase(),
            )
          ? tr(
              'settings-editors.a_category_by_that_name_is',
              'A category by that name is already here.',
            )
          : null,
  });
  return (
    <Editor
      open
      onClose={onClose}
      title={held === null ? tr('settings-editors.new_category', 'New category') : held.name}
      description={tr(
        'settings-editors.benefits_are_grouped_under_it_with',
        'Benefits are grouped under it, with its icon, on the job’s tiles and on the ad.',
      )}
      checks={checks}
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
      <Field required invalid={checks.invalid('name')}>
        <FieldLabel>{tr('settings-editors.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            placeholder={tr('settings-editors.community', 'Community')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{checks.error('name')}</FieldError>
      </Field>
      <Field required>
        <FieldLabel>{tr('settings-editors.icon', 'Icon')}</FieldLabel>
        <RadioGroup
          aria-label={tr('settings-editors.icon', 'Icon')}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          value={icon}
          onValueChange={setIcon}
        >
          {data.categoryIcons.map((key) => (
            <RadioCard key={key} value={key} icon={<CategoryIcon icon={key} />}>
              {ICON_NAMES()[key] ?? words(key)}
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
        setRefused(
          tr('settings-editors.text_3', '{{summary}}: {{message}}', {
            summary,
            message: done.message,
          }),
        );
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
          aria-label={tr('settings-editors.ask_for_a_change_in_words', 'Ask for a change in words')}
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
          {tr('settings-editors.propose', 'Propose')}
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
                  {tr(
                    'settings-editors.apply_change',
                    { one: 'Apply {{count}} change', other: 'Apply {{count}} changes' },
                    { count: plan.changes.length },
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPlan(null);
                  }}
                >
                  {tr('settings-editors.dismiss', 'Dismiss')}
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
                      {tr('settings-editors.removes', 'Removes')}
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
