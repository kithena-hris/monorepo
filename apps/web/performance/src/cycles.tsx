import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartCard,
  DonutChart,
  StackedBarChart,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toolbar,
  Checkbox,
  Chip,
  ChipRow,
  Combobox,
  DataTable,
  type DataColumn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  IconList,
  IconListItem,
  Input,
  KeyValues,
  Stat,
  NumberField,
  PageHeader,
  Progress,
  RadioCard,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Slider,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TertiaryNav,
  TimelineChart,
  type RowAction,
  type TimelineEntry,
  type TimelineMove,
  type TimelineRow,
  TimePicker,
  usePages,
  icons,
  FilterBuilder,
  isConditionComplete,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import {
  addDays,
  planItem,
  planRows,
  resolveDue,
  type Plan,
  KIND_ORDER,
  TONES,
} from './cycle-plan';
import { CycleAnalytics, type CycleAnalyticsData } from './analytics';
import { Loaded } from './load';
import {
  CycleBadge,
  Live,
  Modal,
  Person,
  Refusal,
  ReviewBadge,
  Search,
  StepDialog,
  SwitchRow,
  To,
  day,
  download,
  kindLabel,
  plural,
  score,
  useAct,
  words,
  type Act,
} from './shared';
import type { Kind, ScreenProps } from './types';

/**
 * Cycles (PRD §8, §19; design PF4–PF6, PF9): the list, setup in five steps in
 * a centred dialog, and the overview, live, with its table, bulk actions and
 * every change after launch.
 */

const KINDS: readonly Kind[] = ['self', 'manager', 'peer', 'upward', 'skip', 'goals'];

/* --------------------------------------------------------------- cycles -- */

export interface CyclesData {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly owner: string;
    readonly state: string;
    readonly who: string;
    readonly kinds: readonly string[];
    readonly dates: string;
    readonly progress: number;
  }[];
  readonly hr: boolean;
}

const STATES = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['scheduled', 'Scheduled'],
  ['in_progress', 'In progress'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
] as const;

export function Cycles(props: ScreenProps<CyclesData>): JSX.Element {
  const act = useAct(props);
  const [copying, setCopying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [from, setFrom] = useState('');
  const state = props.search?.['state'] ?? '';
  // Straight into setup: its Basics step names the cycle and sets its start.
  const create = (name: string, copyFrom: string | null): void => {
    act.run('CreatePerformanceCycle', { input: { name, start: null, copyFrom } }, (d) => {
      props.onNavigate?.(`/performance/cycles/${(d as { id: string }).id}/setup`);
    });
  };
  return (
    <Loaded load={props.load} what="cycles">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Cycles"
            description="A cycle is a set of review activities for a group of people, with deadlines. Filters are in the address."
            actions={
              data.hr ? (
                <>
                  <Button
                    variant="secondary"
                    startIcon={<icons.copy aria-hidden />}
                    onClick={() => {
                      setCopying(true);
                    }}
                  >
                    Copy a cycle
                  </Button>
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setStarting(true);
                    }}
                  >
                    New cycle
                  </Button>
                </>
              ) : undefined
            }
          />
          {copying ? null : <Refusal error={act.error} />}
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Search
                  label="Search cycles"
                  placeholder="Search cycles"
                  initial={props.search?.['q'] ?? ''}
                  onSearch={(q) => {
                    props.onFilter?.({ q: q === '' ? null : q });
                  }}
                />
                <ChipRow aria-label="State">
                  {STATES.map(([v, l]) => (
                    <Chip
                      key={v}
                      selected={state === v}
                      onClick={() => {
                        props.onFilter?.({ state: v === '' ? null : v });
                      }}
                    >
                      {l}
                    </Chip>
                  ))}
                </ChipRow>
                <span className="ml-auto">
                  <Live />
                </span>
              </div>
              {/* Every cycle, drawn only where it is in view. */}
              <DataTable
                label="Cycles"
                rows={data.rows}
                endLabel={`That’s every cycle · ${String(data.rows.length)}`}
                rowId={(c) => c.id}
                describeRow={(c) => c.name}
                estimateRowHeight={57}
                containerClassName="page-fill max-h-dvh min-h-96"
                stickyHeader
                columns={[
                  {
                    id: 'cycle',
                    header: 'Cycle',
                    cell: (c) => (
                      <span className="flex flex-col">
                        <To
                          href={
                            c.state === 'draft'
                              ? `/performance/cycles/${c.id}/setup`
                              : `/performance/cycles/${c.id}`
                          }
                          onNavigate={props.onNavigate}
                        >
                          {c.name}
                        </To>
                        <span className="text-xs text-fg-muted">
                          {c.owner === 'Automation' ? 'From an automation' : `Owner: ${c.owner}`}
                        </span>
                      </span>
                    ),
                  },
                  { id: 'state', header: 'State', cell: (c) => <CycleBadge state={c.state} /> },
                  {
                    id: 'who',
                    header: 'Who',
                    cell: (c) => <span className="text-sm text-fg-muted">{c.who}</span>,
                  },
                  {
                    id: 'kinds',
                    header: 'Activities',
                    cell: (c) => (
                      <span className="text-sm">{c.kinds.map(kindLabel).join(', ')}</span>
                    ),
                  },
                  {
                    id: 'dates',
                    header: 'Dates',
                    cell: (c) => <span className="text-sm text-fg-muted">{c.dates}</span>,
                  },
                  {
                    id: 'progress',
                    header: 'Progress',
                    className: 'min-w-28',
                    cell: (c) =>
                      ['in_progress', 'closed', 'archived'].includes(c.state) ? (
                        <Progress value={c.progress} label={`${c.name}: ${String(c.progress)}%`} />
                      ) : (
                        '—'
                      ),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={<icons.review aria-hidden />}
                    title="No cycles here"
                    description={
                      data.hr ? 'Start one with New cycle.' : 'Cycles you take part in show here.'
                    }
                  />
                }
              />
            </CardContent>
          </Card>
          {starting ? (
            <NewCycle
              act={act}
              onClose={() => {
                setStarting(false);
              }}
              onNavigate={props.onNavigate}
            />
          ) : null}
          <Modal
            open={copying}
            onClose={() => {
              setCopying(false);
            }}
            title="Copy a cycle"
            description="Its settings are copied; setup opens next, where you name it and set its start."
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCopying(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={from === ''}
                  loading={act.pending}
                  onClick={() => {
                    const source = data.rows.find((c) => c.id === from);
                    create(`Copy of ${source?.name ?? 'a cycle'}`, from);
                  }}
                >
                  Continue to setup
                </Button>
              </>
            }
          >
            <Refusal error={act.error} />
            <Field required>
              <FieldLabel>Copy settings from</FieldLabel>
              <Select value={from} onValueChange={setFrom}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a cycle" />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {data.rows.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Modal>
        </div>
      )}
    </Loaded>
  );
}

/**
 * New cycle, open the moment it is pressed: Basics is drawn from defaults
 * while the draft is created behind it, and Next carries what was typed into
 * the draft and on to its setup.
 */
function NewCycle({
  act,
  onClose,
  onNavigate,
}: {
  readonly act: Act;
  readonly onClose: () => void;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [basics, setBasics] = useState<Pick<CycleSetup, 'name' | 'description' | 'start'>>({
    name: 'New cycle',
    description: '',
    start: { date: addDays(today, 30), time: '09:00', zone: 'UTC' },
  });
  const [changed, setChanged] = useState<
    Partial<Pick<CycleSetup, 'name' | 'description' | 'start'>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const created = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    if (created.current !== null) return;
    created.current = act
      .call('CreatePerformanceCycle', { input: { name: 'New cycle', start: null, copyFrom: null } })
      .then((d) => {
        if (!d.ok) {
          setError(d.message);
          return null;
        }
        const made = d.data as { id: string; start: CycleSetup['start'] };
        // The company's own defaults, unless a date was already chosen here.
        setBasics((b) => (b.start.date === addDays(today, 30) ? { ...b, start: made.start } : b));
        return made.id;
      });
  }, []);
  const go = (step: number): void => {
    setGoing(true);
    void created.current?.then(async (id) => {
      if (id === null) {
        setGoing(false);
        return;
      }
      if (Object.keys(changed).length > 0) {
        const saved = await act.call('SavePerformanceCycle', { id, input: changed });
        if (!saved.ok) {
          setError(saved.message);
          setGoing(false);
          return;
        }
      }
      onNavigate?.(`/performance/cycles/${id}/setup?step=${String(step)}`);
    });
  };
  const start = basics.start.date;
  return (
    <StepDialog
      open
      wide
      onClose={onClose}
      title={basics.name}
      description="Draft · saved as you go"
      steps={STEPS}
      step={0}
      onStep={go}
      finishLabel="Next"
      finish={() => {
        go(1);
      }}
      pending={going}
    >
      <Refusal error={error} />
      <Basics
        c={basics}
        save={(patch) => {
          setBasics((b) => ({ ...b, ...patch }));
          setChanged((x) => ({ ...x, ...patch }));
        }}
        action={start > today ? 'schedule' : start === today ? 'launch' : 'past'}
      />
    </StepDialog>
  );
}

/* ---------------------------------------------------------------- setup -- */

interface Deadline {
  readonly kind: 'exact' | 'relative';
  readonly date?: string;
  readonly days?: number;
  readonly from?: 'start' | 'nominations';
}

interface ActivityConfig {
  readonly on: boolean;
  readonly templateId: string | null;
  readonly pinnedVersion: number | null;
  readonly due: Deadline;
  readonly afterOthers?: boolean;
  /** This kind's own reminders; absent, the cycle's. */
  readonly reminders?: Reminders;
}

interface Reminders {
  readonly rules: readonly string[];
  readonly email: boolean;
  readonly chat: boolean;
}

/** One condition of who is in, as Performance stores it. */
interface Cond {
  readonly field: string;
  readonly value: string;
  readonly op?: string;
}

interface CycleSetup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly start: { readonly date: string; readonly time: string; readonly zone: string };
  readonly goals: 'none' | 'context' | 'scored';
  readonly participants: {
    readonly filter: readonly Cond[];
    readonly match?: 'all' | 'any';
    readonly include: readonly {
      readonly personId: string;
      readonly reason: string | null;
      readonly by: string;
      readonly at: string;
    }[];
    readonly exclude: readonly {
      readonly personId: string;
      readonly reason: string | null;
      readonly by: string;
      readonly at: string;
    }[];
    readonly keepInStep: boolean;
  };
  readonly activities: Readonly<Record<Kind, ActivityConfig>>;
  readonly peer: {
    readonly picker: string;
    readonly min: number;
    readonly max: number;
    readonly approval: boolean;
    readonly declineReplace: boolean;
    readonly all: boolean;
    readonly perReviewerMax: number;
  };
  readonly nominations: Deadline;
  readonly visibility: {
    readonly peerNames: string;
    readonly upwardNames: string;
    readonly minimum: number;
    readonly release: { readonly mode: string; readonly date: string | null };
    readonly acknowledge: boolean;
    readonly subjectComment: boolean;
    readonly peerSummary: boolean;
  };
  readonly reminders: {
    readonly rules: readonly string[];
    readonly email: boolean;
    readonly chat: boolean;
  };
}

export interface SetupData {
  readonly cycle: CycleSetup;
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: readonly string[];
    readonly published: number | null;
    readonly questions: number;
  }[];
  readonly participants: {
    readonly count: number;
    readonly fromFilter: number;
    readonly included: number;
    readonly excluded: number;
    readonly rows: readonly {
      readonly personId: string;
      readonly name: string;
      readonly title: string;
      readonly manager: { readonly id: string; readonly name: string } | null;
      readonly note: string | null;
    }[];
    readonly noLongerMatches: readonly {
      readonly personId: string;
      readonly name: string;
      readonly title: string;
    }[];
    /** Those the search matches, of whom `rows` is page `page` of `size`. */
    readonly total?: number;
    readonly page?: number;
    readonly size?: number;
    readonly everyone?: readonly {
      readonly personId: string;
      readonly name: string;
      readonly title: string;
    }[];
  };
  readonly fields: {
    readonly departments: readonly string[];
    readonly statuses: readonly string[];
    readonly locations?: readonly string[];
    readonly legalEntities?: readonly string[];
    readonly managers?: readonly { readonly value: string; readonly label: string }[];
  };
  /** Work location and legal entity names, from People when the company has it (the shell). */
  readonly places?: {
    readonly locations: Readonly<Record<string, string>>;
    readonly entities: Readonly<Record<string, string>>;
  };
  readonly due: Readonly<Record<string, string>>;
  readonly checks: readonly {
    readonly level: 'block' | 'warn' | 'ok';
    readonly title: string;
    readonly detail: string;
  }[];
  readonly action: 'launch' | 'schedule' | 'past';
}

/** Five steps, each one thing: when, who, which reviews, reminders, and how it ends. */
const STEPS = ['Basics', 'People', 'Reviews', 'Reminders', 'Launch'];
const ZONES = [
  'Europe/Madrid',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'UTC',
];
const REMINDERS = [
  ['before:7', '7 days before'],
  ['before:3', '3 days before'],
  ['on_day', 'On the day'],
  ['late:2', 'Every 2 days when late'],
  ['opens', 'When it opens'],
] as const;

/** PF4: setup in a centred dialog; each step saves as it changes. */
export function Setup(props: ScreenProps<SetupData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the cycle">
      {(data) => <SetupDialog key={data.cycle.id} data={data} {...props} />}
    </Loaded>
  );
}

function SetupDialog({
  data,
  ...props
}: ScreenProps<SetupData> & { readonly data: SetupData }): JSX.Element {
  const act = useAct(props);
  const [step, setStep] = useState(
    Math.min(STEPS.length - 1, Number(props.search?.['step'] ?? '0') || 0),
  );
  const [c, setC] = useState<CycleSetup>(data.cycle);
  const save = (patch: Partial<CycleSetup>): void => {
    setC({ ...c, ...patch });
    act.run('SavePerformanceCycle', { id: c.id, input: patch });
  };
  const go = (to: number): void => {
    setStep(to);
    props.onFilter?.({ step: String(to) });
  };
  const close = (): void => {
    props.onNavigate?.('/performance/cycles');
  };
  const blocked = data.checks.some((i) => i.level === 'block');
  const finishLabel =
    data.action === 'launch'
      ? 'Launch cycle'
      : data.action === 'past'
        ? 'The start date has passed'
        : 'Schedule cycle';
  const activity = (k: Kind, patch: Partial<ActivityConfig>): void => {
    save({ activities: { ...c.activities, [k]: { ...c.activities[k], ...patch } } });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={c.name} description="New cycle · draft saved" />
      <StepDialog
        open
        wide
        onClose={close}
        title={c.name}
        description={c.state === 'draft' ? 'Draft · saved as you go' : words(c.state)}
        steps={STEPS}
        step={step}
        onStep={go}
        finishLabel={finishLabel}
        canNext={step < STEPS.length - 1 || (!blocked && data.action !== 'past')}
        pending={act.pending}
        finish={() => {
          act.run('StartPerformanceCycle', { id: c.id }, () => {
            props.onNavigate?.(`/performance/cycles/${c.id}`);
          });
        }}
      >
        <Refusal error={act.error} />
        {step === 0 ? <Basics c={c} save={save} action={data.action} /> : null}
        {step === 1 ? (
          <Participants
            c={c}
            data={data}
            save={save}
            act={act}
            search={props.search}
            onFilter={props.onFilter}
            onNavigate={props.onNavigate}
          />
        ) : null}
        {step === 2 ? <Reviews c={c} data={data} save={save} activity={activity} /> : null}
        {step === 3 ? <RemindersStep c={c} save={save} /> : null}
        {step === 4 ? <Launch c={c} data={data} save={save} /> : null}
      </StepDialog>
    </div>
  );
}

function Basics({
  c,
  save,
  action,
}: {
  readonly c: Pick<CycleSetup, 'name' | 'description' | 'start'>;
  readonly save: (p: Partial<Pick<CycleSetup, 'name' | 'description' | 'start'>>) => void;
  readonly action: string;
}): JSX.Element {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  return (
    <div className="flex flex-col gap-4">
      <Field required>
        <FieldLabel>Name</FieldLabel>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            if (name.trim() !== '' && name !== c.name) save({ name });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>Description, shown to participants</FieldLabel>
        <Input
          value={description}
          placeholder="Optional"
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          onBlur={() => {
            if (description !== c.description) save({ description });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>Starts</FieldLabel>
        <FieldControl>
          <DatePicker
            label="Starts"
            value={c.start.date}
            onChange={(date) => {
              if (date !== null) save({ start: { ...c.start, date } });
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>At</FieldLabel>
        <FieldControl>
          <TimePicker
            label="At"
            value={c.start.time}
            onChange={(time) => {
              if (time !== null) save({ start: { ...c.start, time } });
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Time zone</FieldLabel>
        <Select
          value={c.start.zone}
          onValueChange={(v) => {
            save({ start: { ...c.start, zone: v } });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {[...new Set([c.start.zone, ...ZONES])].map((z) => (
              <SelectItem key={z} value={z}>
                {z}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Alert
        tone="info"
        title={
          action === 'launch'
            ? 'Starts today, so it launches when you confirm'
            : action === 'past'
              ? 'That start has passed: choose today or later'
              : 'Starts later, so it will be scheduled'
        }
      />
    </div>
  );
}

const IS = [
  { id: 'is', label: 'is any of', value: 'options' },
  { id: 'not', label: 'is none of', value: 'options' },
] as const;
const STATUS_LABEL: Readonly<Record<string, string>> = {
  active: 'Active',
  on_leave: 'On leave',
  notice: 'On notice',
  pre_hire: 'Starting soon',
};

/** What the People step filters on: what Performance knows of each person. */
function filterFields(data: {
  readonly fields: SetupData['fields'];
  readonly places?: SetupData['places'] | undefined;
}): FilterField[] {
  const f = data.fields;
  const named = (
    ids: readonly string[] | undefined,
    names: Readonly<Record<string, string>> | undefined,
  ) =>
    (ids ?? [])
      .map((id) => ({ value: id, label: names?.[id] ?? id }))
      .toSorted((a, b) => a.label.localeCompare(b.label));
  return [
    {
      id: 'department',
      label: 'Department',
      operators: IS,
      options: f.departments.map((d) => ({ value: d, label: d })),
    },
    {
      id: 'location',
      label: 'Work location',
      operators: IS,
      options: named(f.locations, data.places?.locations),
    },
    {
      id: 'legalEntity',
      label: 'Legal entity',
      operators: IS,
      options: named(f.legalEntities, data.places?.entities),
    },
    { id: 'manager', label: 'Manager', operators: IS, options: f.managers ?? [] },
    {
      id: 'status',
      label: 'Status',
      operators: IS,
      options: f.statuses.map((x) => ({ value: x, label: STATUS_LABEL[x] ?? x })),
    },
    {
      id: 'title',
      label: 'Job title',
      operators: [{ id: 'contains', label: 'contains', value: 'text' }],
    },
    {
      id: 'hiredOn',
      label: 'Start date',
      operators: [
        { id: 'before', label: 'is before', value: 'date' },
        { id: 'after', label: 'is after', value: 'date' },
        { id: 'between', label: 'is between', value: 'date-range' },
      ],
    },
  ];
}

/** Stored conditions as the builder shows them: one row per field and operator. */
function groupOf(filter: readonly Cond[], match: 'all' | 'any'): FilterGroup {
  const conditions: FilterCondition[] = [];
  for (const x of filter) {
    const field = x.field === 'startedBefore' ? 'hiredOn' : x.field;
    const op =
      x.op ?? (x.field === 'startedBefore' ? 'before' : x.field === 'title' ? 'contains' : 'is');
    const same = conditions.findIndex(
      (c) => c.field === field && c.operator === op && (op === 'is' || op === 'not'),
    );
    const at = conditions[same];
    if (at !== undefined) conditions[same] = { ...at, values: [...at.values, x.value] };
    else
      conditions.push({
        id: `${field}-${op}-${String(conditions.length)}`,
        field,
        operator: op,
        values: [x.value],
      });
  }
  return { match, conditions };
}

/** The builder's rows as Performance stores them: a start date "between" is an after and a before. */
function conditionsOf(group: FilterGroup): Cond[] {
  return group.conditions.flatMap((c): Cond[] => {
    if (c.operator === 'between') {
      const [from = '', to = ''] = c.values;
      return [
        ...(from === '' ? [] : [{ field: 'hiredOn', op: 'after', value: from }]),
        ...(to === '' ? [] : [{ field: 'hiredOn', op: 'before', value: to }]),
      ];
    }
    return c.values
      .filter((v) => v !== '')
      .map((value) => ({ field: c.field, op: c.operator, value }));
  });
}

/**
 * The filters in force as chips, and Add filter, which opens the builder in a
 * dialog applied on Apply. The cycle overview's toolbar and the setup's People
 * step share it: one holds a view in the address, the other who is in.
 */
function FilterChips({
  fields,
  value,
  match,
  onApply,
  title,
  description,
}: {
  readonly fields: readonly FilterField[];
  readonly value: readonly Cond[];
  readonly match: 'all' | 'any';
  readonly onApply: (filter: Cond[], match: 'all' | 'any') => void;
  readonly title: string;
  readonly description: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup>(() => groupOf(value, match));
  const chips = chipsOf(fields, value);
  return (
    <>
      <ChipRow role="group" aria-label="Filters in force">
        {match === 'any' && chips.length > 1 ? (
          <span className="text-xs text-fg-muted">Any of:</span>
        ) : null}
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            field={chip.field}
            onRemove={() => {
              onApply(
                value.filter((_, i) => !chip.at.includes(i)),
                match,
              );
            }}
            removeLabel={`Remove ${chip.field} ${chip.text}`}
          >
            {chip.text}
          </Chip>
        ))}
        <Chip
          variant="dashed"
          startIcon={<icons.add aria-hidden />}
          onClick={() => {
            setDraft(groupOf(value, match));
            setOpen(true);
          }}
        >
          Add filter
        </Chip>
        {chips.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onApply([], 'all');
            }}
          >
            Clear all
          </Button>
        )}
      </ChipRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-170">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FilterBuilder
              label="Conditions"
              fields={[...fields]}
              value={draft}
              onChange={setDraft}
              maxConditions={20}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              className="me-auto"
              onClick={() => {
                setDraft({ match: 'all', conditions: [] });
              }}
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onApply(
                  conditionsOf({
                    ...draft,
                    conditions: draft.conditions.filter((x) => isConditionComplete(fields, x)),
                  }),
                  draft.match,
                );
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Participant = SetupData['participants']['rows'][number];

/**
 * Who is in, as the cycle overview lists people: a question in words, then
 * one toolbar with the search, the filters as chips and Add by name, and the
 * list right under it. The filters are the cycle's and saved as they apply;
 * the search is the address's. Both are answered by Performance a page at a
 * time, the next page asked for as the list nears its end.
 */
function Participants({
  c,
  data,
  save,
  act,
  search,
  onFilter,
  onNavigate,
}: {
  readonly c: CycleSetup;
  readonly data: SetupData;
  readonly save: (p: Partial<CycleSetup>) => void;
  readonly act: Act;
  readonly search?: Readonly<Record<string, string>> | undefined;
  readonly onFilter?: ((patch: Record<string, string | null>) => void) | undefined;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const [excluding, setExcluding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [chat, setChat] = useState('');
  const [proposal, setProposal] = useState<{
    filter: Cond[];
    summary: string[];
  } | null>(null);
  const p = data.participants;
  const q = search?.['q'] ?? '';
  const pages = usePages(
    p.rows,
    p.total !== undefined &&
      p.page !== undefined &&
      p.size !== undefined &&
      p.page * p.size < p.total
      ? String(p.page + 1)
      : null,
    async (cursor) => {
      const page = Number(cursor);
      const d = await act.call('PerformanceCycleSetup', {
        id: c.id,
        q: q === '' ? null : q,
        page,
        size: p.size ?? 50,
      });
      if (!d.ok) return null;
      const more = (d.data as SetupData).participants;
      return {
        items: more.rows,
        next: page * (more.size ?? 50) < (more.total ?? 0) ? String(page + 1) : null,
      };
    },
  );
  const people = (p.everyone ?? p.rows).map((x) => ({
    value: x.personId,
    label: x.name,
    description: x.title,
  }));
  const match = c.participants.match ?? 'all';
  const fields = filterFields(data);
  const participants = (patch: Partial<CycleSetup['participants']>): void => {
    save({ participants: { ...c.participants, ...patch } });
  };
  const columns: readonly DataColumn<Participant>[] = [
    {
      id: 'person',
      width: '20rem',
      header: 'Person',
      cell: (r) => <Person name={r.name} sub={r.title} />,
    },
    {
      id: 'manager',
      width: '14rem',
      header: 'Manager',
      cell: (r) =>
        r.manager === null ? (
          <span className="text-sm text-fg-muted">No manager</span>
        ) : (
          <To
            href={`/people/${r.manager.id}`}
            onNavigate={onNavigate}
            className="inline-flex rounded-md hover:underline"
          >
            <Person name={r.manager.name} size="xs" />
          </To>
        ),
    },
    {
      id: 'note',
      width: '12rem',
      header: 'How',
      cell: (r) =>
        r.note === null ? (
          <span className="text-sm text-fg-muted">By the filters</span>
        ) : (
          <Badge size="sm" tone={r.note.startsWith('Excluded') ? 'neutral' : 'accent'}>
            {r.note}
          </Badge>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Describe who should be in, in words"
          className="flex-1"
          value={chat}
          placeholder="Ask in words: Engineering and Product in Chicago, without anyone on leave"
          onChange={(e) => {
            setChat(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && chat.trim().length >= 3)
              act.run(
                'PerformanceParticipantsInWords',
                { id: c.id, input: { text: chat } },
                (d) => {
                  setProposal(d as typeof proposal);
                },
              );
          }}
        />
        <Button
          variant="secondary"
          startIcon={<icons.assistant aria-hidden />}
          disabled={chat.trim().length < 3}
          loading={act.pending}
          onClick={() => {
            act.run('PerformanceParticipantsInWords', { id: c.id, input: { text: chat } }, (d) => {
              setProposal(d as typeof proposal);
            });
          }}
        >
          Propose
        </Button>
      </div>
      {proposal === null ? null : (
        <Alert
          tone="info"
          title="Change who is in"
          action={
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setProposal(null);
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  participants({ filter: proposal.filter });
                  setProposal(null);
                }}
              >
                Apply
              </Button>
            </span>
          }
        >
          {proposal.summary.join(' · ')}
        </Alert>
      )}
      <Toolbar
        search={
          <Search
            label="Search who is in"
            placeholder={`Search ${plural(p.count, 'person', 'people')}`}
            initial={q}
            onSearch={(next) => {
              onFilter?.({ q: next === '' ? null : next });
            }}
          />
        }
        filters={
          <FilterChips
            fields={fields}
            value={c.participants.filter}
            match={match}
            title="Who is in"
            description="Everyone these match is in, with whoever you add by name. Nothing changes until you press Apply."
            onApply={(filter, m) => {
              participants({ filter, match: m });
            }}
          />
        }
        actions={
          <span className="w-56">
            <Combobox
              label="Add by name"
              multiple
              size="sm"
              placeholder="Add by name"
              searchPlaceholder="Search people"
              emptyMessage="Nobody by that name"
              options={people}
              value={c.participants.include.map((x) => x.personId)}
              onChange={(next) => {
                const ids = Array.isArray(next) ? (next as readonly string[]) : [];
                const kept = c.participants.include.filter((x) => ids.includes(x.personId));
                const added = ids
                  .filter((id) => !kept.some((x) => x.personId === id))
                  .map((personId) => ({
                    personId,
                    reason: null,
                    by: 'You',
                    at: new Date().toISOString(),
                  }));
                participants({
                  include: [...kept, ...added],
                  exclude: c.participants.exclude.filter((x) => !ids.includes(x.personId)),
                });
              }}
            />
          </span>
        }
      />
      <p className="text-sm text-fg-muted" aria-live="polite">
        <span className="font-semibold text-fg">{plural(p.count, 'person', 'people')}</span>
        {` · ${String(p.fromFilter)} from the filters, ${String(p.included)} added by name, ${String(p.excluded)} left out`}
        {q === '' ? '' : ` · ${plural(p.total ?? p.rows.length, 'match', 'matches')} “${q}”`}
      </p>
      {/* A page at a time, only the rows in view drawn; the next page comes at 70%. */}
      <DataTable
        label="Who is in"
        rows={pages.items}
        rowId={(r) => r.personId}
        columns={columns}
        describeRow={(r) => r.name}
        estimateRowHeight={57}
        containerClassName="max-h-[28rem]"
        columnSizing="fill"
        stickyHeader
        {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
        loadingMore={pages.loading}
        {...(pages.items.length > 0 && pages.loadMore === undefined
          ? {
              endLabel: `That’s everyone · ${plural(p.total ?? p.rows.length, 'person', 'people')}`,
            }
          : {})}
        rowActions={(r) =>
          r.note === null
            ? [
                {
                  id: 'leave-out',
                  label: 'Leave out of this cycle',
                  onSelect: () => {
                    setExcluding(r.personId);
                  },
                },
              ]
            : r.note.startsWith('Excluded')
              ? [
                  {
                    id: 'back-in',
                    label: 'Take back in',
                    onSelect: () => {
                      participants({
                        exclude: c.participants.exclude.filter((x) => x.personId !== r.personId),
                      });
                    },
                  },
                ]
              : [
                  {
                    id: 'remove',
                    label: 'Remove, added by name',
                    destructive: true,
                    onSelect: () => {
                      participants({
                        include: c.participants.include.filter((x) => x.personId !== r.personId),
                      });
                    },
                  },
                ]
        }
        empty={
          <EmptyState
            icon={<icons.people aria-hidden />}
            title={q === '' ? 'Nobody yet' : 'Nobody matches'}
            description={
              q === '' ? 'Add a filter, or add people by name.' : 'Try another name or title.'
            }
          />
        }
      />
      <SwitchRow
        label="Keep in step"
        hint="People who start matching are added; people who stop matching are listed for you to decide."
        checked={c.participants.keepInStep}
        onChange={(on) => {
          participants({ keepInStep: on });
        }}
      />
      {p.noLongerMatches.length === 0 ? null : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm font-semibold">{`No longer matches · ${String(p.noLongerMatches.length)}`}</p>
          {p.noLongerMatches.map((n) => (
            <Person key={n.personId} name={n.name} sub={n.title} />
          ))}
        </div>
      )}
      <Modal
        open={excluding !== null}
        onClose={() => {
          setExcluding(null);
        }}
        title="Leave them out of this cycle?"
        description="The reason is kept with the decision, in the activity log."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setExcluding(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={reason.trim() === ''}
              onClick={() => {
                if (excluding === null) return;
                participants({
                  exclude: [
                    ...c.participants.exclude,
                    { personId: excluding, reason, by: 'You', at: new Date().toISOString() },
                  ],
                  include: c.participants.include.filter((x) => x.personId !== excluding),
                });
                setExcluding(null);
                setReason('');
              }}
            >
              Leave out
            </Button>
          </>
        }
      >
        <Field required>
          <FieldLabel>Reason</FieldLabel>
          <Input
            value={reason}
            placeholder="On leave until January"
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}

/** Which reviews, each with its form, when it is due and its settings; goals; reminders. */
function Reviews({
  c,
  data,
  save,
  activity,
}: {
  readonly c: CycleSetup;
  readonly data: SetupData;
  readonly save: (p: Partial<CycleSetup>) => void;
  readonly activity: (k: Kind, p: Partial<ActivityConfig>) => void;
}): JSX.Element {
  // The peer range while a thumb is held; saved when it is let go.
  const [dragging, setDragging] = useState<readonly [number, number] | null>(null);
  const peers = dragging ?? ([c.peer.min, c.peer.max] as const);
  return (
    <div className="flex flex-col gap-4">
      {KINDS.filter((k) => k !== 'goals').map((k) => {
        const a = c.activities[k];
        const published = data.templates.filter((t) => t.published !== null);
        const fitting = published.filter((t) => t.purpose.includes(k) || t.purpose.length === 0);
        const options = fitting.length === 0 ? published : fitting;
        const d = a.due;
        return (
          <Card key={k}>
            <CardContent className="flex flex-col gap-4">
              <SwitchRow
                label={kindLabel(k)}
                hint={a.on ? 'Part of this cycle' : 'Not in this cycle'}
                checked={a.on}
                onChange={(on) => {
                  activity(k, { on });
                }}
              />
              {a.on ? (
                <>
                  <Field>
                    <FieldLabel>Form</FieldLabel>
                    <Select
                      value={a.templateId ?? ''}
                      onValueChange={(v) => {
                        activity(k, { templateId: v });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a published form" />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {options.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {`${t.name} · v${String(t.published ?? 1)} · ${plural(t.questions, 'question')}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <NumberField
                    label={`Due after ${d.from === 'nominations' ? 'nominations close' : 'the start'}`}
                    hint={`Works out to ${day(resolveDue(c, d))}`}
                    value={d.days ?? 14}
                    suffix={unit(d.days ?? 14, 'day')}
                    min={0}
                    max={365}
                    onChange={(v) => {
                      if (v !== null)
                        activity(k, {
                          due: { kind: 'relative', days: v, from: d.from ?? 'start' },
                        });
                    }}
                  />
                </>
              ) : null}
              {k === 'peer' && a.on ? (
                <>
                  <SwitchRow
                    label="Every teammate"
                    hint={`The person’s team (same manager), up to ${String(c.peer.max)}. Off: peers are nominated.`}
                    checked={c.peer.all}
                    onChange={(on) => {
                      save({ peer: { ...c.peer, all: on } });
                    }}
                  />
                  {c.peer.all ? null : (
                    <>
                      <Field>
                        <FieldLabel>Who nominates</FieldLabel>
                        <SegmentedControl
                          value={c.peer.picker}
                          onValueChange={(v) => {
                            save({ peer: { ...c.peer, picker: v } });
                          }}
                        >
                          <SegmentedControlItem value="subject">The person</SegmentedControlItem>
                          <SegmentedControlItem value="manager">Their manager</SegmentedControlItem>
                          <SegmentedControlItem value="hr">HR</SegmentedControlItem>
                        </SegmentedControl>
                      </Field>
                      <NumberField
                        label="Nominations due after the start"
                        hint={`Works out to ${day(resolveDue(c, c.nominations))}`}
                        value={c.nominations.days ?? 3}
                        suffix={unit(c.nominations.days ?? 3, 'day')}
                        min={0}
                        max={90}
                        onChange={(v) => {
                          if (v !== null)
                            save({
                              nominations: { kind: 'relative', days: v, from: 'start' },
                            });
                        }}
                      />
                      <SwitchRow
                        label="The manager approves nominations"
                        checked={c.peer.approval}
                        onChange={(on) => {
                          save({ peer: { ...c.peer, approval: on } });
                        }}
                      />
                    </>
                  )}
                  <Slider
                    label="Peer reviewers per person"
                    thumbLabels={['At least', 'At most']}
                    valueDisplay={`${String(peers[0])} to ${String(peers[1])}`}
                    min={0}
                    max={20}
                    showTicks
                    labels={Array.from({ length: 21 }, (_, i) => String(i))}
                    value={[...peers]}
                    onValueChange={([lo = peers[0], hi = peers[1]]) => {
                      setDragging([lo, Math.max(1, hi)]);
                    }}
                    // Saved once, when the thumb is let go, not at every step of the drag.
                    onValueCommit={([lo = peers[0], hi = peers[1]]) => {
                      setDragging(null);
                      save({ peer: { ...c.peer, min: lo, max: Math.max(1, hi) } });
                    }}
                  />
                  <SwitchRow
                    label="A reviewer can decline, and is replaced"
                    checked={c.peer.declineReplace}
                    onChange={(on) => {
                      save({ peer: { ...c.peer, declineReplace: on } });
                    }}
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      <Field>
        <FieldLabel>Goals</FieldLabel>
        <RadioGroup
          aria-label="Goals"
          className="flex flex-col gap-2"
          value={c.goals}
          onValueChange={(v) => {
            save({ goals: v as CycleSetup['goals'] });
          }}
        >
          <RadioCard value="none">Not part of this cycle</RadioCard>
          <RadioCard
            value="context"
            description="Reviewers see each person’s goals beside the form."
          >
            Shown beside the review
          </RadioCard>
          <RadioCard value="scored" description="A section is added with each goal and its score.">
            Scored in the review
          </RadioCard>
        </RadioGroup>
      </Field>
    </div>
  );
}

const NAMES = [
  ['hidden', 'Hidden from the subject'],
  ['shown', 'Shown to the subject'],
  ['writer', 'The writer chooses'],
] as const;

/** One kind of review's reminders: when, and by which channels besides the Inbox. */
function ReminderOptions({
  kind,
  value,
  onChange,
}: {
  readonly kind: string;
  readonly value: Reminders;
  readonly onChange: (next: Reminders) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Reminders</p>
      <ChipRow aria-label={`When ${kind.toLowerCase()} are reminded`}>
        {REMINDERS.map(([v, l]) => (
          <Chip
            key={v}
            selected={value.rules.includes(v)}
            onClick={() => {
              onChange({
                ...value,
                rules: value.rules.includes(v)
                  ? value.rules.filter((x) => x !== v)
                  : [...value.rules, v],
              });
            }}
          >
            {l}
          </Chip>
        ))}
      </ChipRow>
      <SwitchRow
        label="Inbox"
        info="Always on: every reminder lands in each person’s Inbox in Kithena, whatever else is chosen."
        checked
        disabled
      />
      <SwitchRow
        label="Email"
        hint="By each person’s preference"
        checked={value.email}
        onChange={(email) => {
          onChange({ ...value, email });
        }}
      />
      <SwitchRow
        label="Chat app"
        hint="By each person’s preference, when connected"
        checked={value.chat}
        onChange={(chat) => {
          onChange({ ...value, chat });
        }}
      />
    </div>
  );
}

/** "3 days", "1 answer": the unit a number field counts in, after it. */
const unit = (n: number, one: string): string => (n === 1 ? one : `${one}s`);

/**
 * One set of reminders for every review in the cycle. Each deadline is
 * relative, so the same rules land on different days for each review: the
 * plan underneath shows where.
 */
function RemindersStep({
  c,
  save,
}: {
  readonly c: CycleSetup;
  readonly save: (p: Partial<CycleSetup>) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <ReminderOptions
            kind="Reviews"
            value={c.reminders}
            onChange={(reminders) => {
              // One rule for all: any kind's own rules from before give way.
              const activities = Object.fromEntries(
                KINDS.map((k) => {
                  const { reminders: _own, ...rest } = c.activities[k];
                  return [k, rest];
                }),
              ) as unknown as CycleSetup['activities'];
              save({ reminders, activities });
            }}
          />
        </CardContent>
      </Card>
      <CyclePlan c={c} edit={{ mode: 'setup', c, save }} />
    </div>
  );
}

/** What may be changed on the plan: a draft's setup, or a running cycle's deadlines. */
type PlanEdit =
  | {
      readonly mode: 'setup';
      readonly c: CycleSetup;
      readonly save: (p: Partial<CycleSetup>) => void;
    }
  | {
      readonly mode: 'live';
      /** Opens the extend dialog for everyone, at that kind and date. */
      readonly extend: (kind: string, due: string) => void;
      readonly remind: () => void;
    };

/** A change asked about before it is made; with `date`, the date is chosen in it. */
interface PlanAsk {
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly destructive?: boolean;
  readonly date?: string;
  readonly run: (date: string) => void;
}

/**
 * The whole cycle on one axis: each review's window, its deadline and its
 * reminders pinned in its colour. Zoom by dragging across the dates. Where it
 * can be changed, a bar's end drags to a new due date and the bar to a new
 * start, and a right-click offers the rest; every change is asked about first.
 */
function CyclePlan({
  c,
  today,
  edit,
}: {
  readonly c: Plan;
  readonly today?: string;
  readonly edit?: PlanEdit;
}): JSX.Element {
  const [ask, setAsk] = useState<PlanAsk | null>(null);
  const [date, setDate] = useState('');
  const open = (a: PlanAsk): void => {
    setDate(a.date ?? '');
    setAsk(a);
  };
  const rows = planRows(c, kindLabel, day);
  const dueOf = (k: string): string => {
    const a = c.activities[k];
    return a === undefined ? c.start.date : resolveDue(c, a.due);
  };
  const name = (k: string): string => `${kindLabel(k)}s`;

  const setup = edit?.mode === 'setup' ? edit : null;
  const askDue = (k: string, to: string): void => {
    if (setup === null) return;
    open({
      title: `When are ${name(k).toLowerCase()} due?`,
      description: `Counted from ${setup.c.activities[k as Kind].due.from === 'nominations' ? 'when nominations close' : 'the start'}, so it moves with it.`,
      confirm: 'Change the due date',
      date: to,
      run: (d) => {
        const a = setup.c.activities[k as Kind];
        const from = a.due.from ?? 'start';
        const base =
          from === 'nominations' ? resolveDue(setup.c, setup.c.nominations) : setup.c.start.date;
        setup.save({
          activities: {
            ...setup.c.activities,
            [k]: { ...a, due: { kind: 'relative', days: Math.max(0, daysBetween(base, d)), from } },
          },
        });
      },
    });
  };
  const askStart = (to: string): void => {
    if (setup === null) return;
    open({
      title: 'When does the cycle start?',
      description:
        'Every deadline and reminder is counted from the start, so they all move with it.',
      confirm: 'Move the start',
      date: to,
      run: (d) => {
        setup.save({ start: { ...setup.c.start, date: d } });
      },
    });
  };
  const askNominations = (to: string): void => {
    if (setup === null) return;
    open({
      title: 'When do nominations close?',
      description: 'Peer reviews counted from when nominations close move with it.',
      confirm: 'Change when they close',
      date: to,
      run: (d) => {
        setup.save({
          nominations: {
            kind: 'relative',
            days: Math.max(0, daysBetween(setup.c.start.date, d)),
            from: 'start',
          },
        });
      },
    });
  };
  const askRelease = (to: string): void => {
    if (setup === null) return;
    open({
      title: 'When are reviews released?',
      description: 'Everyone sees their reviews on this day.',
      confirm: 'Change the release date',
      date: to,
      run: (d) => {
        const v = setup.c.visibility;
        setup.save({ visibility: { ...v, release: { ...v.release, date: d } } });
      },
    });
  };

  const moved = (move: TimelineMove): void => {
    const item = planItem(move.id);
    if (item === null || edit === undefined) return;
    if (edit.mode === 'live') {
      // A running cycle's starts stand; its deadlines can be extended.
      if (item.what === 'open' && move.mode === 'resize-end' && move.to.end !== undefined)
        edit.extend(item.kind, move.to.end);
      else if (item.what === 'due') edit.extend(item.kind, move.to.start);
      return;
    }
    const shift = daysBetween(move.from.start, move.to.start);
    if (item.what === 'open' || item.what === 'nominations') {
      if (move.mode === 'resize-end' && move.to.end !== undefined) {
        if (item.what === 'open') askDue(item.kind, move.to.end);
        else askNominations(move.to.end);
      } else if (shift !== 0 && setup !== null) askStart(addDays(setup.c.start.date, shift));
    } else if (item.what === 'due') askDue(item.kind, move.to.start);
    else if (item.what === 'nominations-due') askNominations(move.to.start);
    else if (item.what === 'release') askRelease(move.to.start);
  };

  const actions = (entry: TimelineEntry): RowAction[] => {
    const item = planItem(entry.id);
    if (item === null || edit === undefined) return [];
    if (edit.mode === 'live')
      return item.what === 'open' || item.what === 'due'
        ? [
            {
              id: 'extend',
              label: 'Extend the deadline…',
              onSelect: () => {
                edit.extend(item.kind, dueOf(item.kind));
              },
            },
            {
              id: 'remind',
              label: 'Remind everyone who has not submitted…',
              onSelect: () => {
                open({
                  title: 'Remind everyone who has not submitted?',
                  description:
                    'By the cycle’s channels: the Inbox, and email or chat where they are on.',
                  confirm: 'Remind them',
                  run: () => {
                    edit.remind();
                  },
                });
              },
            },
          ]
        : [];
    const v = edit.c.visibility;
    switch (item.what) {
      case 'open':
      case 'due':
        return [
          {
            id: 'due',
            label: 'Change the due date…',
            onSelect: () => {
              askDue(item.kind, dueOf(item.kind));
            },
          },
          {
            id: 'start',
            label: 'Move the cycle’s start…',
            onSelect: () => {
              askStart(edit.c.start.date);
            },
          },
          {
            id: 'remove',
            label: `Take ${name(item.kind).toLowerCase()} out of this cycle…`,
            destructive: true,
            onSelect: () => {
              open({
                title: `Take ${name(item.kind).toLowerCase()} out of this cycle?`,
                description: 'Its form and due date are kept: turn it back on in Reviews.',
                confirm: 'Take it out',
                destructive: true,
                run: () => {
                  const a = edit.c.activities[item.kind as Kind];
                  edit.save({
                    activities: { ...edit.c.activities, [item.kind]: { ...a, on: false } },
                  });
                },
              });
            },
          },
        ];
      case 'nominations':
      case 'nominations-due':
        return [
          {
            id: 'close',
            label: 'Change when nominations close…',
            onSelect: () => {
              askNominations(resolveDue(edit.c, edit.c.nominations));
            },
          },
        ];
      case 'remind':
        return [
          {
            id: 'stop',
            label: `Stop reminding “${(REMINDER_LABEL[item.rule] ?? item.rule).toLowerCase()}”…`,
            destructive: true,
            onSelect: () => {
              open({
                title: `Stop reminding “${(REMINDER_LABEL[item.rule] ?? item.rule).toLowerCase()}”?`,
                description: 'For every review in the cycle: one set of reminders serves them all.',
                confirm: 'Stop it',
                destructive: true,
                run: () => {
                  edit.save({
                    reminders: {
                      ...edit.c.reminders,
                      rules: edit.c.reminders.rules.filter((r) => r !== item.rule),
                    },
                  });
                },
              });
            },
          },
        ];
      case 'release':
        return v.release.date === null
          ? []
          : [
              {
                id: 'release',
                label: 'Change the release date…',
                onSelect: () => {
                  askRelease(v.release.date ?? today ?? c.start.date);
                },
              },
            ];
    }
  };

  return (
    <ChartCard
      title="The cycle at a glance"
      description={
        edit === undefined
          ? 'Bars are when each review is open; pins in its colour are its due date and, outlined, its reminders. Drag across the dates to zoom.'
          : edit.mode === 'setup'
            ? 'Drag a bar’s end or its pin to change when it is due, or the bar to move the start. Right-click for more, and drag across the dates to zoom.'
            : 'Drag a due date later to extend it for everyone, or right-click a review to remind or extend. Drag across the dates to zoom.'
      }
    >
      <TimelineChart
        label="The cycle’s plan"
        rows={rows}
        unit="week"
        separator="line"
        formatDate={day}
        zoomable
        {...(today === undefined ? {} : { today })}
        {...(edit === undefined
          ? {}
          : {
              editable: true,
              // Along its own lane only: a review never becomes another kind.
              canMove: (_item: TimelineEntry, from: TimelineRow, to: TimelineRow) =>
                from.label === to.label,
              onItemMove: moved,
              itemActions: actions,
            })}
        empty={<p className="text-sm text-fg-muted">Turn a review on to see its plan.</p>}
      />
      <Modal
        open={ask !== null}
        onClose={() => {
          setAsk(null);
        }}
        title={ask?.title ?? ''}
        description={ask?.description ?? ''}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAsk(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={ask?.destructive === true ? 'danger' : 'primary'}
              disabled={ask?.date !== undefined && date === ''}
              onClick={() => {
                ask?.run(date);
                setAsk(null);
              }}
            >
              {ask?.confirm ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {ask?.date === undefined ? null : (
          <Field>
            <FieldLabel>Date</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Date"
                value={date === '' ? null : date}
                onChange={(d) => {
                  setDate(d ?? '');
                }}
              />
            </FieldControl>
          </Field>
        )}
      </Modal>
    </ChartCard>
  );
}

/** How it ends (release), who sees what, and what stops a launch. */
/** Each review kind's glyph; its colour is its place in the plan's chart. */
const KIND_GLYPH = {
  self: icons.person,
  manager: icons.approve,
  peer: icons.people,
  upward: icons.up,
  skip: icons.hierarchy,
} as const;

function KindGlyph({ kind }: { readonly kind: string }): JSX.Element {
  const Glyph = (KIND_GLYPH as Partial<Record<string, typeof icons.person>>)[kind] ?? icons.review;
  return <Glyph aria-hidden />;
}

const kindTone = (kind: string): (typeof TONES)[number] =>
  TONES[KIND_ORDER.indexOf(kind as (typeof KIND_ORDER)[number])] ?? 'chart-1';

/** "14 days after the start": when a deadline falls, in words. */
const dueAfter = (d: Deadline): string =>
  d.kind === 'exact'
    ? 'on a set date'
    : `${plural(d.days ?? 0, 'day')} after ${d.from === 'nominations' ? 'nominations close' : 'the start'}`;

const PICKER: Readonly<Record<string, string>> = {
  subject: 'the person',
  manager: 'their manager',
  hr: 'HR',
};

/**
 * The last step: whether anything stops it, what launches (who, when, and each
 * review with its form and deadline, in the plan's colours), the plan, and what
 * the subject sees once it is written.
 */
function Launch({
  c,
  data,
  save,
}: {
  readonly c: CycleSetup;
  readonly data: SetupData;
  readonly save: (p: Partial<CycleSetup>) => void;
}): JSX.Element {
  const v = c.visibility;
  const set = (patch: Partial<CycleSetup['visibility']>): void => {
    save({ visibility: { ...v, ...patch } });
  };
  const blocks = data.checks.filter((i) => i.level === 'block').length;
  const warns = data.checks.filter((i) => i.level === 'warn').length;
  const on = KINDS.filter((k) => k !== 'goals' && c.activities[k].on);
  const dues = on.map((k) => resolveDue(c, c.activities[k].due));
  const last = dues.toSorted().at(-1);
  const form = (id: string | null): string => {
    const t = data.templates.find((x) => x.id === id);
    return t === undefined
      ? 'No form chosen yet'
      : `${t.name} · v${String(t.published ?? 1)} · ${plural(t.questions, 'question')}`;
  };
  const names = (label: string, value: string, key: 'peerNames' | 'upwardNames'): JSX.Element => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(x) => {
          set({ [key]: x });
        }}
      >
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {NAMES.map(([x, l]) => (
            <SelectItem key={x} value={x}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle level={3}>
            {blocks === 0
              ? 'Ready to launch'
              : `${plural(blocks, 'thing')} to fix before it can launch`}
          </CardTitle>
          <p className="text-sm text-fg-muted">
            {blocks === 0 && warns === 0
              ? 'Every check passed.'
              : warns === 0
                ? 'Fix what is marked; nothing else stops it.'
                : `${plural(warns, 'warning')} to read. Warnings don’t stop it.`}
          </p>
        </CardHeader>
        {data.checks.length === 0 ? null : (
          <CardContent>
            <IconList divided>
              {data.checks.map((i) => (
                <IconListItem
                  key={`${i.level}-${i.title}`}
                  icon={
                    i.level === 'block' ? (
                      <icons.danger />
                    ) : i.level === 'warn' ? (
                      <icons.warning />
                    ) : (
                      <icons.success />
                    )
                  }
                  tone={i.level === 'block' ? 'danger' : i.level === 'warn' ? 'warning' : 'success'}
                  description={i.detail}
                >
                  {i.title}
                </IconListItem>
              ))}
            </IconList>
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={3}>What launches</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="People"
              icon={<icons.people aria-hidden />}
              iconPosition="start"
              value={String(data.participants.count)}
              description={`${String(data.participants.fromFilter)} by the filters, ${String(data.participants.included)} by name`}
            />
            <Stat
              label="Starts"
              icon={<icons.calendar aria-hidden />}
              iconPosition="start"
              value={day(c.start.date)}
              description={`${c.start.time} ${c.start.zone}`}
            />
            <Stat
              label="Last deadline"
              icon={<icons.flagged aria-hidden />}
              iconPosition="start"
              value={last === undefined ? '—' : day(last)}
              description={plural(on.length, 'review')}
            />
          </div>
          {on.length === 0 ? (
            <p className="text-sm text-fg-muted">No review is part of this cycle yet.</p>
          ) : (
            <IconList divided aria-label="Reviews in this cycle">
              {on.map((k, i) => {
                const a = c.activities[k];
                return (
                  <IconListItem
                    key={k}
                    icon={<KindGlyph kind={k} />}
                    tone={kindTone(k)}
                    description={
                      <>
                        <span className="block">{form(a.templateId)}</span>
                        <span className="block">
                          <span className="font-medium text-fg">{`Due ${day(dues[i] ?? '')}`}</span>
                          {` · ${dueAfter(a.due)}`}
                          {k === 'peer'
                            ? c.peer.all
                              ? ` · every teammate, up to ${String(c.peer.max)}`
                              : ` · ${String(c.peer.min)} to ${String(c.peer.max)} peers, nominated by ${PICKER[c.peer.picker] ?? c.peer.picker}`
                            : ''}
                        </span>
                      </>
                    }
                  >
                    {kindLabel(k)}
                  </IconListItem>
                );
              })}
              {c.goals === 'none' ? null : (
                <IconListItem
                  icon={<icons.goal />}
                  tone="neutral"
                  description={GOALS_LABEL[c.goals] ?? c.goals}
                >
                  Goals
                </IconListItem>
              )}
            </IconList>
          )}
        </CardContent>
      </Card>
      <CyclePlan c={c} edit={{ mode: 'setup', c, save }} />
      <Card>
        <CardHeader>
          <CardTitle level={3}>What the subject sees</CardTitle>
          <p className="text-sm text-fg-muted">Their manager and HR always see who wrote what.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel>Their reviews reach them</FieldLabel>
            <RadioGroup
              aria-label="Release"
              className="grid gap-2 sm:grid-cols-3"
              value={v.release.mode}
              onValueChange={(mode) => {
                set({ release: { ...v.release, mode } });
              }}
            >
              <RadioCard
                value="manager"
                description="The manager releases each one once it is submitted."
              >
                As each is submitted
              </RadioCard>
              <RadioCard value="hr_date" description="Everyone at once, on the day you choose.">
                On a date
              </RadioCard>
              <RadioCard
                value="close"
                description="When the cycle closes, after calibration if it has one."
              >
                When the cycle closes
              </RadioCard>
            </RadioGroup>
          </Field>
          {v.release.mode === 'hr_date' ? (
            <Field>
              <FieldLabel>Release on</FieldLabel>
              <FieldControl>
                <DatePicker
                  label="Release on"
                  value={v.release.date}
                  onChange={(date) => {
                    set({ release: { ...v.release, date } });
                  }}
                />
              </FieldControl>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {names('Peer reviews: the writers’ names', v.peerNames, 'peerNames')}
            {names('Upward reviews: the writers’ names', v.upwardNames, 'upwardNames')}
          </div>
          <div className="flex flex-col">
            <SwitchRow
              label="Ask for an acknowledgement"
              hint="“I’ve read this” is not agreement."
              checked={v.acknowledge}
              onChange={(ack) => {
                set({ acknowledge: ack });
              }}
            />
            <SwitchRow
              label="Let the subject comment"
              hint="Shown to the manager and HR"
              checked={v.subjectComment}
              onChange={(comment) => {
                set({ subjectComment: comment });
              }}
            />
            <SwitchRow
              label="Share the peer summary"
              hint="Peer answers, without names"
              checked={v.peerSummary}
              onChange={(summary) => {
                set({ peerSummary: summary });
              }}
            />
          </div>
          <NumberField
            label="Response minimum"
            hint="Confidential answers show only once this many are in."
            value={v.minimum}
            suffix={unit(v.minimum, 'answer')}
            min={1}
            max={20}
            onChange={(n) => {
              if (n !== null) set({ minimum: n });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- overview -- */

interface OverviewRow {
  readonly personId: string;
  readonly name: string;
  readonly title: string;
  readonly department?: string | null;
  readonly locationId?: string | null;
  readonly legalEntityId?: string | null;
  readonly manager: { readonly id: string; readonly name: string } | null;
  readonly self: string;
  readonly peers: string;
  readonly upward: string;
  readonly managerReview: string;
  readonly managerReviewId: string | null;
  /** Where peers are nominated for them; null before nominations open. */
  readonly nominationId: string | null;
  readonly release: string;
  readonly score: number | null;
}

export interface OverviewData {
  readonly cycle: {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly dates: string;
    readonly versions: string;
    readonly who: string;
    readonly launch: {
      readonly total: number;
      readonly created: number;
      readonly error: string | null;
      readonly at: string | null;
    };
    readonly kinds: readonly string[];
  };
  readonly tiles: readonly {
    readonly kind: string;
    readonly submitted: number;
    readonly started: number;
    readonly overdue: number;
    readonly total: number;
    readonly due: string | null;
  }[];
  readonly plan: Plan;
  readonly today: string;
  /** Where every review stands, overall and by department, least done first. */
  readonly insights?: {
    readonly status: Readonly<Record<'submitted' | 'overdue' | 'started' | 'waiting', number>>;
    /** Each state's reviews by kind, for the donut's outer ring. */
    readonly statusByKind?: Readonly<
      Record<'submitted' | 'overdue' | 'started' | 'waiting', Readonly<Record<string, number>>>
    >;
    readonly byDepartment: readonly {
      readonly department: string;
      readonly submitted: number;
      readonly started: number;
      readonly waiting: number;
      readonly overdue: number;
    }[];
  };
  readonly released: number;
  readonly overdue: number;
  readonly rows: readonly OverviewRow[];
  /** What the people table filters by: the values among the cycle's people. */
  readonly fields?: SetupData['fields'];
  /** Work location and legal entity names, from People when the company has it. */
  readonly places?: SetupData['places'];
  /** Away in the next month, from Time Off: personId → the last day away. */
  readonly away?: Readonly<Record<string, string>>;
  readonly total: number;
  readonly page: number;
  readonly size: number;
  readonly nominations: readonly {
    readonly id: string;
    readonly subject: string;
    readonly peers: readonly string[];
    readonly count: number;
    readonly state: string;
    readonly late: boolean;
  }[];
  readonly bounds: { readonly min: number; readonly max: number };
  readonly settings: {
    readonly visibility: { readonly minimum: number; readonly release: { readonly mode: string } };
    readonly peer: { readonly all: boolean; readonly min: number; readonly max: number };
    readonly reminders: Reminders;
    readonly goals: string;
  };
  readonly hr: boolean;
  /** On the Analytics tab: each view of this cycle's analytics HR may read. */
  readonly analytics?: CycleAnalyticsData;
}

type Dialog = 'extend' | 'close' | 'export' | 'add' | 'remove' | null;

const REMINDER_LABEL: Readonly<Record<string, string>> = Object.fromEntries(REMINDERS);
const RELEASE_LABEL: Readonly<Record<string, string>> = {
  manager: 'As each is submitted',
  hr_date: 'On a date',
  close: 'When the cycle closes',
};

/**
 * How the cycle is set up, in sections: each review with its deadline (in the
 * plan's colours), peers, reminders and how they reach people, and what the
 * subject sees. Read here; changed in the setup while it has not started, and
 * from the plan on the Overview once it runs.
 */
function CycleSettings({
  data,
  onEdit,
}: {
  readonly data: OverviewData;
  readonly onEdit?: () => void;
}): JSX.Element {
  const c = data.cycle;
  const st = data.settings;
  const kinds = KIND_ORDER.filter((k) => c.kinds.includes(k));
  const due = (k: string): string | null => {
    const a = data.plan.activities[k];
    return a === undefined ? null : resolveDue(data.plan, a.due);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-fg-muted">
          {onEdit === undefined
            ? 'Deadlines move from the plan on the Overview; everything else was fixed at launch.'
            : 'Not started yet, so all of it can still change.'}
        </p>
        {onEdit === undefined ? null : (
          <Button variant="secondary" startIcon={<icons.edit aria-hidden />} onClick={onEdit}>
            Edit setup
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Reviews</CardTitle>
          <p className="text-sm text-fg-muted">{`Starts ${day(data.plan.start.date)}`}</p>
        </CardHeader>
        <CardContent>
          {kinds.length === 0 ? (
            <p className="text-sm text-fg-muted">No review is part of this cycle.</p>
          ) : (
            <IconList divided aria-label="Reviews in this cycle">
              {kinds.map((k) => {
                const d = due(k);
                return (
                  <IconListItem
                    key={k}
                    icon={<KindGlyph kind={k} />}
                    tone={kindTone(k)}
                    description={d === null ? 'No deadline' : `Due ${day(d)}`}
                  >
                    {kindLabel(k)}
                  </IconListItem>
                );
              })}
              <IconListItem icon={<icons.goal />} description={GOALS_LABEL[st.goals] ?? st.goals}>
                Goals
              </IconListItem>
            </IconList>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle level={2}>Reminders</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {st.reminders.rules.length === 0 ? (
              <p className="text-sm text-fg-muted">No reminders are sent.</p>
            ) : (
              <ChipRow aria-label="When reviews are reminded">
                {st.reminders.rules.map((r) => (
                  <Badge key={r} tone="accent">
                    {REMINDER_LABEL[r] ?? r}
                  </Badge>
                ))}
              </ChipRow>
            )}
            <IconList aria-label="How reminders reach people">
              <IconListItem
                icon={<icons.inbox />}
                tone="success"
                description="Always: every reminder lands in each person’s Inbox."
              >
                Inbox
              </IconListItem>
              <IconListItem
                icon={<icons.email />}
                tone={st.reminders.email ? 'success' : 'neutral'}
                description={
                  st.reminders.email ? 'On, by each person’s preference' : 'Off for this cycle'
                }
              >
                Email
              </IconListItem>
              <IconListItem
                icon={<icons.message />}
                tone={st.reminders.chat ? 'success' : 'neutral'}
                description={
                  st.reminders.chat
                    ? 'On, by each person’s preference, when connected'
                    : 'Off for this cycle'
                }
              >
                Chat app
              </IconListItem>
            </IconList>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>What the subject sees</CardTitle>
          </CardHeader>
          <CardContent>
            <IconList>
              <IconListItem
                icon={<icons.visible />}
                description={
                  st.visibility.release.mode === 'hr_date' &&
                  data.plan.visibility?.release.date !== null &&
                  data.plan.visibility?.release.date !== undefined
                    ? `On ${day(data.plan.visibility.release.date)}`
                    : 'When their reviews are released to them'
                }
              >
                {RELEASE_LABEL[st.visibility.release.mode] ?? words(st.visibility.release.mode)}
              </IconListItem>
              <IconListItem
                icon={<icons.locked />}
                description="Confidential answers show only once this many are in."
              >
                {`At least ${plural(st.visibility.minimum, 'answer')}`}
              </IconListItem>
              {c.kinds.includes('peer') ? (
                <IconListItem
                  icon={<icons.people />}
                  description={
                    st.peer.all
                      ? `Every teammate, up to ${String(st.peer.max)}`
                      : `Nominated, ${String(st.peer.min)} to ${String(st.peer.max)} each`
                  }
                >
                  Peers
                </IconListItem>
              ) : null}
            </IconList>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
const GOALS_LABEL: Readonly<Record<string, string>> = {
  none: 'Not part of this cycle',
  context: 'Shown beside the review',
  scored: 'Scored in the review',
};

/** Whole days from one calendar date to another; negative when `to` is earlier. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const REVIEW_STATES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'draft', label: 'In progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'released', label: 'Released' },
  { value: 'ack', label: 'Acknowledged' },
  { value: 'unlock', label: 'Unlock requested' },
  { value: 'none', label: 'None' },
];
const GROUPS = [
  ['', 'No grouping'],
  ['department', 'Department'],
  ['location', 'Work location'],
  ['legalEntity', 'Legal entity'],
  ['manager', 'Manager'],
] as const;

/** A row's group heading: the name of what it is grouped by. */
function groupLabel(data: OverviewData, group: string, r: OverviewRow): string {
  switch (group) {
    case 'department':
      return r.department ?? 'No department';
    case 'location':
      return r.locationId == null
        ? 'No work location'
        : (data.places?.locations[r.locationId] ?? r.locationId);
    case 'legalEntity':
      return r.legalEntityId == null
        ? 'No legal entity'
        : (data.places?.entities[r.legalEntityId] ?? r.legalEntityId);
    case 'manager':
      return r.manager?.name ?? 'No manager';
    default:
      return '';
  }
}

const STANCES = [
  { key: 'submitted', label: 'Submitted', tone: 'success' },
  { key: 'started', label: 'In progress', tone: 'accent' },
  { key: 'waiting', label: 'Not started', tone: 'neutral' },
  { key: 'overdue', label: 'Overdue', tone: 'danger' },
] as const;

/**
 * Two charts in place of a wall of tiles, each answering its own question.
 * Left: how far along is the cycle, every review in it by where it stands,
 * with the next deadline. Right: who is behind, each department's share of
 * its reviews by the same four states, the least done first.
 */
function Insights({ data }: { readonly data: OverviewData }): JSX.Element | null {
  const got = data.insights;
  if (got === undefined) return null;
  const total = STANCES.reduce((n, x) => n + got.status[x.key], 0);
  const done = total === 0 ? 0 : Math.round((got.status.submitted / total) * 100);
  const next = data.tiles
    .filter((t) => t.due !== null && t.due >= data.today && t.submitted < t.total)
    .toSorted((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0];
  const left = next?.due == null ? null : daysBetween(data.today, next.due);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard
        title="Where every review stands"
        description={[
          `${String(got.status.submitted)} of ${plural(total, 'review')} in`,
          got.status.overdue > 0 ? `${String(got.status.overdue)} overdue` : 'none overdue',
          next === undefined || left === null
            ? null
            : `${kindLabel(next.kind)}s due ${day(next.due)}${left === 0 ? ', today' : `, in ${plural(left, 'day')}`}`,
        ]
          .filter((x) => x !== null)
          .join(' · ')}
      >
        <DonutChart
          label="Reviews by where they stand, and by kind"
          // Inside, where each review stands; around it, which kinds they are,
          // each in its colour on the timeline below.
          data={STANCES.map((x) => ({
            label: x.label,
            value: got.status[x.key],
            tone: x.tone,
            parts: KIND_ORDER.flatMap((k, i) => {
              const n = got.statusByKind?.[x.key][k] ?? 0;
              return n === 0
                ? []
                : [{ label: `${kindLabel(k)}s`, value: n, tone: TONES[i] ?? 'chart-1' }];
            }),
          }))}
          center={`${String(done)}%`}
          centerLabel="submitted"
          showLegend
        />
      </ChartCard>
      <ChartCard
        title="Who is behind"
        description="Each department’s reviews by where they stand, the least done first."
      >
        <StackedBarChart
          label="Reviews by department and where they stand"
          normalise
          categories={got.byDepartment.map((d) => d.department)}
          series={STANCES.map((x) => ({
            label: x.label,
            tone: x.tone,
            values: got.byDepartment.map((d) => d[x.key]),
          }))}
          format={(v) => plural(Math.round(v), 'review')}
        />
      </ChartCard>
    </div>
  );
}

/** What a filter's chip says: "Department: Engineering, Sales". */
function chipsOf(
  fields: readonly FilterField[],
  conds: readonly Cond[],
): {
  readonly key: string;
  readonly field: string;
  readonly text: string;
  readonly at: number[];
}[] {
  const groups = groupOf(conds, 'all').conditions;
  let at = 0;
  return groups.map((g) => {
    const f = fields.find((x) => x.id === g.field);
    const op = f?.operators.find((o) => o.id === g.operator);
    const named = g.values.map((v) => f?.options?.find((o) => o.value === v)?.label ?? v);
    const taken = g.values.map(() => at++);
    return {
      key: g.id,
      field: f?.label ?? g.field,
      text: `${op !== undefined && op.id !== 'is' ? `${op.label} ` : ''}${named.join(', ')}`,
      at: taken,
    };
  });
}

/**
 * The people table's controls, as People's directory has them: a question in
 * words above; then one toolbar with the search, the filters in force as
 * chips (Add filter opens the builder, applied on Apply), and a View menu for
 * the grouping. Everything in the address, so a view is shareable.
 */
function PeopleToolbar({
  data,
  act,
  ...props
}: ScreenProps<OverviewData> & { readonly data: OverviewData; readonly act: Act }): JSX.Element {
  const match: 'all' | 'any' = props.search?.['match'] === 'any' ? 'any' : 'all';
  const stored = ((): Cond[] => {
    try {
      const parsed: unknown = JSON.parse(props.search?.['filter'] ?? '[]');
      return Array.isArray(parsed) ? (parsed as Cond[]) : [];
    } catch {
      return [];
    }
  })();
  const fields: FilterField[] = [
    ...(data.fields === undefined
      ? []
      : filterFields({ fields: data.fields, places: data.places })),
    { id: 'self', label: 'Self review', operators: IS, options: REVIEW_STATES },
    { id: 'managerReview', label: 'Manager review', operators: IS, options: REVIEW_STATES },
    {
      id: 'overdue',
      label: 'Anything overdue',
      operators: [{ id: 'is', label: 'is', value: 'options' }],
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
  ];
  const [words, setWords] = useState('');
  const [said, setSaid] = useState<readonly string[]>([]);
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const apply = (
    filter: readonly Cond[],
    m: 'all' | 'any',
    extra: Record<string, string | null> = {},
  ): void => {
    props.onFilter?.({
      filter: filter.length === 0 ? null : JSON.stringify(filter),
      match: m === 'any' ? 'any' : null,
      page: null,
      ...extra,
    });
  };
  const ask = (): void => {
    if (words.trim().length < 3) return;
    setAsking(true);
    setRefused(null);
    void act
      .call('PerformanceOverviewInWords', {
        id: data.cycle.id,
        input: {
          text: words,
          current: stored,
          places: data.places ?? { locations: {}, entities: {} },
        },
      })
      .then((d) => {
        setAsking(false);
        if (!d.ok) {
          setRefused(d.message);
          return;
        }
        const got = d.data as {
          filter: Cond[];
          match: 'all' | 'any';
          group: string | null;
          summary: string[];
        };
        setSaid(got.summary);
        apply(got.filter, got.match, { group: got.group });
      });
  };
  const group = props.search?.['group'] ?? '';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Ask who to show, in words"
          className="flex-1"
          value={words}
          placeholder="Ask in words: Engineering in London whose self review is overdue, by manager"
          onChange={(e) => {
            setWords(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
        />
        <Button
          variant="secondary"
          startIcon={<icons.assistant aria-hidden />}
          disabled={words.trim().length < 3}
          loading={asking}
          onClick={ask}
        >
          Ask
        </Button>
      </div>
      <Refusal error={refused} />
      {said.length === 0 ? null : (
        <p
          className="text-sm text-fg-muted"
          aria-live="polite"
        >{`Understood: ${said.join(' · ')}`}</p>
      )}
      <Toolbar
        search={
          <Search
            label="Search people"
            placeholder={`Search ${String(data.total)} people`}
            initial={props.search?.['q'] ?? ''}
            onSearch={(q) => {
              props.onFilter?.({ q: q === '' ? null : q, page: null });
            }}
          />
        }
        filters={
          <FilterChips
            fields={fields}
            value={stored}
            match={match}
            title="Filter people"
            description="Who they are, and where their reviews stand. Nothing applies until you press Apply."
            onApply={(filter, m) => {
              setSaid([]);
              apply(filter, m);
            }}
          />
        }
        actions={
          <span className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">{plural(data.total, 'person', 'people')}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" startIcon={<icons.adjust aria-hidden />}>
                  {group === ''
                    ? 'View'
                    : `View · by ${(GROUPS.find(([v]) => v === group)?.[1] ?? '').toLowerCase()}`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" aria-label="View" className="flex w-72 flex-col gap-2.5">
                <p className="text-xs font-semibold text-fg-subtle">Group by</p>
                <Select
                  value={group === '' ? 'none' : group}
                  onValueChange={(v) => {
                    props.onFilter?.({ group: v === 'none' ? null : v, page: null });
                  }}
                >
                  <SelectTrigger aria-label="Group by" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPS.map(([v, l]) => (
                      <SelectItem key={v === '' ? 'none' : v} value={v === '' ? 'none' : v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PopoverContent>
            </Popover>
          </span>
        }
      />
    </div>
  );
}

/**
 * Everyone in the cycle, as People's directory lists people: the next page
 * arrives as the end comes near, and only the rows in view are mounted.
 */
function OverviewTable({
  data,
  act,
  q,
  view,
  selected,
  onSelected,
  onNavigate,
  run,
  onDialog,
  bulk,
}: {
  readonly data: OverviewData;
  readonly act: Act;
  readonly q: string | null;
  /** The filter, its match and the grouping, as the address has them. */
  readonly view: {
    readonly filter: string | null;
    readonly match: string | null;
    readonly group: string | null;
  };
  readonly selected: readonly string[];
  readonly onSelected: (ids: readonly string[]) => void;
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly run: (name: string, input: Record<string, unknown>) => void;
  readonly onDialog: (d: Exclude<Dialog, null>, personId: string) => void;
  readonly bulk: JSX.Element;
}): JSX.Element {
  const c = data.cycle;
  const id = c.id;
  const pages = usePages(
    data.rows,
    data.page * data.size < data.total ? String(data.page + 1) : null,
    async (cursor) => {
      const page = Number(cursor);
      const d = await act.call('PerformanceCycle', {
        id,
        q,
        page,
        size: data.size,
        filter: view.filter,
        match: view.match,
        group: view.group,
      });
      if (!d.ok) return null;
      const more = d.data as Pick<OverviewData, 'rows' | 'total' | 'size'>;
      return {
        items: more.rows,
        next: page * more.size < more.total ? String(page + 1) : null,
      };
    },
  );
  const has = (k: string): boolean => c.kinds.includes(k);
  const columns: DataColumn<OverviewRow>[] = [
    {
      id: 'person',
      width: '18rem',
      header: 'Person',
      cell: (r) => (
        <span className="flex flex-col">
          <span>
            <To href={`/performance/cycles/${id}/about/${r.personId}`} onNavigate={onNavigate}>
              {r.name}
            </To>
            {data.away?.[r.personId] === undefined ? null : (
              <Badge size="sm" tone="neutral" className="ml-2">
                Away until {data.away[r.personId]}
              </Badge>
            )}
          </span>
          <span className="text-xs text-fg-muted">{r.title}</span>
        </span>
      ),
    },
    {
      id: 'manager',
      width: '13rem',
      header: 'Manager',
      cell: (r) =>
        r.manager === null ? (
          <span className="text-sm text-fg-muted">No manager</span>
        ) : (
          <To
            href={`/people/${r.manager.id}`}
            onNavigate={onNavigate}
            className="inline-flex rounded-md hover:underline"
          >
            <Person name={r.manager.name} size="xs" />
          </To>
        ),
    },
    ...(has('self')
      ? [
          {
            id: 'self',
            width: '9rem',
            header: 'Self',
            cell: (r: OverviewRow) => <ReviewBadge state={r.self} />,
          },
        ]
      : []),
    ...(has('peer')
      ? [{ id: 'peers', width: '10rem', header: 'Peers', cell: (r: OverviewRow) => r.peers }]
      : []),
    ...(has('upward')
      ? [{ id: 'upward', width: '7rem', header: 'Upward', cell: (r: OverviewRow) => r.upward }]
      : []),
    ...(has('manager')
      ? [
          {
            id: 'managerReview',
            width: '10rem',
            header: 'Manager review',
            cell: (r: OverviewRow) =>
              r.managerReview === '—' ? (
                <span className="text-fg-muted">—</span>
              ) : (
                <ReviewBadge state={r.managerReview} />
              ),
          },
        ]
      : []),
    {
      id: 'release',
      width: '9rem',
      header: 'Release',
      cell: (r) => <span className="text-sm text-fg-muted">{r.release}</span>,
    },
    ...(data.hr
      ? [
          {
            id: 'score',
            width: '6rem',
            header: 'Score',
            numeric: true,
            cell: (r: OverviewRow) => score(r.score),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      label="People in this cycle"
      rows={pages.items}
      rowId={(r) => r.personId}
      columns={columns}
      describeRow={(r) => r.name}
      estimateRowHeight={57}
      // The page's one scroll: the header pins to the window's top. Widths are
      // set, not measured from whatever rows are drawn, so nothing moves as
      // the next page lands.
      scroll="page"
      columnSizing="fill"
      stickyHeader
      {...(view.group === null
        ? {}
        : { groupBy: (r: OverviewRow) => groupLabel(data, view.group ?? '', r) })}
      {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
      loadingMore={pages.loading}
      endLabel={`That’s everyone · ${plural(data.total, 'person', 'people')}`}
      {...(data.hr
        ? {
            selectable: true,
            selected,
            onSelectedChange: onSelected,
            bulkActions: () => bulk,
          }
        : {})}
      rowActions={(r) => [
        {
          id: 'open',
          label: 'Open their reviews',
          onSelect: () => {
            onNavigate?.(`/performance/cycles/${id}/about/${r.personId}`);
          },
        },
        ...(has('peer') && r.nominationId !== null
          ? [
              {
                id: 'nominate',
                label: 'Nominate peers for feedback',
                onSelect: () => {
                  onNavigate?.(`/performance/nominations/${r.nominationId ?? ''}`);
                },
              },
            ]
          : []),
        ...(data.hr && c.state === 'in_progress'
          ? [
              {
                id: 'remind',
                label: 'Remind',
                onSelect: () => {
                  run('RemindPerformanceCycle', { personIds: [r.personId] });
                },
              },
              {
                id: 'extend',
                label: 'Extend a deadline',
                onSelect: () => {
                  onDialog('extend', r.personId);
                },
              },
              {
                id: 'remove',
                label: 'Remove from the cycle',
                destructive: true,
                onSelect: () => {
                  onDialog('remove', r.personId);
                },
              },
            ]
          : []),
      ]}
      empty={
        <EmptyState
          icon={<icons.people aria-hidden />}
          title="Nobody here yet"
          description={
            c.state === 'draft'
              ? 'Participants are fixed when the cycle launches.'
              : 'No one matches the search.'
          }
        />
      }
    />
  );
}

/** PF5: live tiles and the table, bulk actions, and the changes after launch. */
export function Overview(props: ScreenProps<OverviewData>): JSX.Element {
  const act = useAct(props);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  // An extension started from the plan: for everyone, at that kind and date.
  const [preset, setPreset] = useState<{ kind: string; due: string } | null>(null);
  const tab = props.search?.['tab'] ?? 'overview';
  return (
    <Loaded load={props.load} what="the cycle">
      {(data) => {
        const c = data.cycle;
        const id = c.id;
        const chosen = [...selected];
        const run = (name: string, input: Record<string, unknown>, after?: () => void): void => {
          act.run(name, { id, input }, () => {
            setSelected(new Set());
            after?.();
          });
        };
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={c.name}
              meta={<CycleBadge state={c.state} />}
              description={`${c.who} · ${c.dates}${c.versions === '' ? '' : ` · ${c.versions}`}`}
              actions={
                data.hr ? (
                  <>
                    <Live />
                    {['in_progress', 'closed', 'archived'].includes(c.state) ? (
                      <Button
                        variant="secondary"
                        startIcon={<icons.download aria-hidden />}
                        onClick={() => {
                          setDialog('export');
                        }}
                      >
                        Export
                      </Button>
                    ) : null}
                    {c.state === 'in_progress' ? (
                      <Button
                        variant="secondary"
                        startIcon={<icons.notifications aria-hidden />}
                        loading={act.pending}
                        onClick={() => {
                          run('RemindPerformanceCycle', { personIds: [] });
                        }}
                      >
                        Remind
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          aria-label="More actions"
                          startIcon={<icons.more aria-hidden />}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {['draft', 'scheduled', 'launch_failed'].includes(c.state) ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              props.onNavigate?.(`/performance/cycles/${id}/setup`);
                            }}
                          >
                            Edit setup
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'scheduled' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              act.run('UnschedulePerformanceCycle', { id });
                            }}
                          >
                            Unschedule
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'in_progress' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setDialog('add');
                            }}
                          >
                            Add someone
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'in_progress' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setDialog('close');
                            }}
                          >
                            Close the cycle
                          </DropdownMenuItem>
                        ) : null}
                        {['in_progress', 'closed'].includes(c.state) ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              props.onNavigate?.(`/performance/calibration?cycle=${id}`);
                            }}
                          >
                            Open calibration
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'closed' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              act.run('ArchivePerformanceCycle', { id, input: { archived: true } });
                            }}
                          >
                            Archive
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'archived' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              act.run('ArchivePerformanceCycle', {
                                id,
                                input: { archived: false },
                              });
                            }}
                          >
                            Unarchive
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : undefined
              }
              tabs={
                <TertiaryNav
                  label="Cycle"
                  orientation="horizontal"
                  variant="line"
                  activeId={tab}
                  current="page"
                  // Each tab is its own address, followed by the shell's router.
                  // A `#tab` anchor and a push of `?tab=` raced, and the push lost.
                  items={[
                    { id: 'overview', label: 'Overview', href: `/performance/cycles/${id}` },
                    ...(data.hr
                      ? [
                          {
                            id: 'analytics',
                            label: 'Analytics',
                            href: `/performance/cycles/${id}?tab=analytics`,
                          },
                          {
                            id: 'changes',
                            label: 'Changes',
                            href: `/performance/cycles/${id}?tab=changes`,
                          },
                          {
                            id: 'settings',
                            label: 'Settings',
                            href: `/performance/cycles/${id}?tab=settings`,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />
            <Refusal error={act.error} />
            {c.state === 'launch_failed' ? (
              <Alert
                tone="danger"
                title={`The launch stopped at ${String(c.launch.created)} of ${String(c.launch.total)} reviews`}
                action={
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      startIcon={<icons.refresh aria-hidden />}
                      loading={act.pending}
                      onClick={() => {
                        act.run('RetryPerformanceLaunch', { id });
                      }}
                    >
                      Retry launch
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        act.run('UnschedulePerformanceCycle', { id });
                      }}
                    >
                      Back to draft
                    </Button>
                  </span>
                }
              >
                {`${c.launch.error ?? 'Something stopped it.'} Retrying continues where it stopped; nothing is created or sent twice. No participant has been told yet.`}
              </Alert>
            ) : null}
            {c.state === 'launching' ? (
              <Progress
                value={
                  c.launch.total === 0 ? 0 : Math.round((c.launch.created / c.launch.total) * 100)
                }
                label={`Creating reviews · ${String(c.launch.created)} of ${String(c.launch.total)}`}
                showValue
              />
            ) : null}
            {tab === 'overview' ? (
              <>
                {data.insights === undefined ? null : <Insights data={data} />}
                <CyclePlan
                  c={data.plan}
                  today={data.today}
                  {...(data.hr && c.state === 'in_progress'
                    ? {
                        edit: {
                          mode: 'live' as const,
                          extend: (kind: string, due: string) => {
                            setSelected(new Set());
                            setPreset({ kind, due });
                            setDialog('extend');
                          },
                          remind: () => {
                            run('RemindPerformanceCycle', { personIds: [] });
                          },
                        },
                      }
                    : {})}
                />
                <PeopleToolbar data={data} act={act} {...props} />
                <OverviewTable
                  data={data}
                  act={act}
                  q={props.search?.['q'] ?? null}
                  view={{
                    filter: props.search?.['filter'] ?? null,
                    match: props.search?.['match'] ?? null,
                    group: props.search?.['group'] ?? null,
                  }}
                  selected={chosen}
                  onSelected={(ids) => {
                    setSelected(new Set(ids));
                  }}
                  onNavigate={props.onNavigate}
                  run={run}
                  onDialog={(d, personId) => {
                    setSelected(new Set([personId]));
                    setDialog(d);
                  }}
                  bulk={
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          run('RemindPerformanceCycle', { personIds: chosen });
                        }}
                      >
                        Remind
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDialog('extend');
                        }}
                      >
                        Extend deadline
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          run('ReleasePerformanceCycle', { personIds: chosen });
                        }}
                      >
                        Release
                      </Button>
                    </>
                  }
                />
              </>
            ) : null}
            {tab === 'changes' ? (
              // Every change is a line of the company's activity log, filtered to this cycle.
              <EmptyState
                icon={<icons.history />}
                title="Changes are in the activity log"
                description="Who changed this cycle, and when, with the fields by name and never their values."
                action={
                  <Button asChild variant="outline">
                    <a href={`/settings/activity?module=performance&subject=${id}`}>
                      Open this cycle’s activity
                    </a>
                  </Button>
                }
              />
            ) : null}
            {tab === 'analytics' ? (
              <CycleAnalytics id={id} views={data.analytics ?? {}} {...props} />
            ) : null}
            {tab === 'settings' ? (
              <CycleSettings
                data={data}
                {...(['draft', 'scheduled', 'launch_failed'].includes(c.state)
                  ? {
                      onEdit: () => {
                        props.onNavigate?.(`/performance/cycles/${id}/setup`);
                      },
                    }
                  : {})}
              />
            ) : null}
            {dialog === 'extend' ? (
              <ExtendDialog
                kinds={c.kinds}
                people={chosen}
                act={act}
                {...(preset === null ? {} : { preset })}
                onDone={() => {
                  setDialog(null);
                  setPreset(null);
                  setSelected(new Set());
                }}
                id={id}
              />
            ) : null}
            {dialog === 'close' ? (
              <CloseDialog
                act={act}
                id={id}
                name={c.name}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {dialog === 'export' ? (
              <ExportDialog
                act={act}
                id={id}
                kinds={c.kinds}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {dialog === 'add' ? (
              <AddDialog
                act={act}
                id={id}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {dialog === 'remove' ? (
              <RemoveDialog
                act={act}
                id={id}
                person={data.rows.find((r) => r.personId === chosen[0])}
                onDone={() => {
                  setDialog(null);
                  setSelected(new Set());
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}

/** PF9: who has nominated, who is waiting for approval, who is late. */
function ExtendDialog({
  kinds,
  people,
  act,
  onDone,
  id,
  preset,
}: {
  readonly kinds: readonly string[];
  /** Whose reviews; none is everyone's. */
  readonly people: readonly string[];
  readonly act: Act;
  readonly onDone: () => void;
  readonly id: string;
  /** Where the plan's drag or menu left it: the kind and the new date. */
  readonly preset?: { readonly kind: string; readonly due: string };
}): JSX.Element {
  const [kind, setKind] = useState(preset?.kind ?? kinds.find((k) => k !== 'goals') ?? 'self');
  const [due, setDue] = useState(preset?.due ?? '');
  const who = people.length === 0 ? 'everyone' : plural(people.length, 'person', 'people');
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onDone}
      title={`Extend the deadline for ${who}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={due === '' || reason.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'ExtendPerformanceDeadline',
                { id, input: { kind, personIds: people, due, reason } },
                onDone,
              );
            }}
          >
            {`Extend for ${people.length === 0 ? 'everyone' : String(people.length)}`}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field>
        <FieldLabel>Activity</FieldLabel>
        <Select value={kind} onValueChange={setKind}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {kinds
              .filter((k) => k !== 'goals')
              .map((k) => (
                <SelectItem key={k} value={k}>
                  {`${kindLabel(k)}s about them`}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field required>
        <FieldLabel>New deadline</FieldLabel>
        <FieldControl>
          <DatePicker
            label="New deadline"
            value={due === '' ? null : due}
            onChange={(date) => {
              setDue(date ?? '');
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>Reason, kept in the audit log</FieldLabel>
        <Input
          value={reason}
          placeholder="Engineering offsite"
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}

function CloseDialog({
  act,
  id,
  name,
  onDone,
}: {
  readonly act: Act;
  readonly id: string;
  readonly name: string;
  readonly onDone: () => void;
}): JSX.Element {
  const [release, setRelease] = useState('now');
  return (
    <Modal
      open
      onClose={onDone}
      title={`Close ${name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={act.pending}
            onClick={() => {
              act.run(
                'ClosePerformanceCycle',
                { id, input: { releaseNow: release === 'now' } },
                onDone,
              );
            }}
          >
            Close cycle
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <p>Closing locks every review. Each one ends in one of three states:</p>
      <KeyValues
        layout="split"
        items={[
          {
            label: 'Submitted',
            value: (
              <Badge size="sm" tone="success">
                Completed
              </Badge>
            ),
          },
          {
            label: 'Unlocked and edited, once submitted before',
            value: 'Completed, on the last submitted revision',
          },
          { label: 'Draft, never submitted', value: <Badge size="sm">Withdrawn</Badge> },
          { label: 'Not started', value: <Badge size="sm">Abandoned</Badge> },
        ]}
      />
      <Field>
        <FieldLabel>Reviews not yet released</FieldLabel>
        <SegmentedControl value={release} onValueChange={setRelease}>
          <SegmentedControlItem value="now">Release them now</SegmentedControlItem>
          <SegmentedControlItem value="keep">Keep them unreleased</SegmentedControlItem>
        </SegmentedControl>
      </Field>
    </Modal>
  );
}

function ExportDialog({
  act,
  id,
  kinds,
  onDone,
}: {
  readonly act: Act;
  readonly id: string;
  readonly kinds: readonly string[];
  readonly onDone: () => void;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [full, setFull] = useState('subject');
  const [format, setFormat] = useState('pdf');
  const [include, setInclude] = useState<readonly string[]>(kinds.filter((k) => k !== 'goals'));
  return (
    <StepDialog
      open
      onClose={onDone}
      title="Export reviews"
      steps={['Whose view', 'What', 'As']}
      step={step}
      onStep={setStep}
      finishLabel="Export"
      pending={act.pending}
      finish={() => {
        act.run(
          'ExportPerformanceCycle',
          { id, input: { full: full === 'full', kinds: include, format } },
          (d) => {
            download(d as { filename: string; base64: string; mediaType: string });
            onDone();
          },
        );
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <RadioGroup aria-label="Whose view" value={full} onValueChange={setFull}>
          <RadioCard
            value="subject"
            description="Private questions and confidential names removed."
          >
            As each subject would see it
          </RadioCard>
          <RadioCard value="full" description="Every answer and name. Logged as a sensitive read.">
            Full, for HR
          </RadioCard>
        </RadioGroup>
      ) : null}
      {step === 1 ? (
        <div className="flex flex-col gap-1.5">
          {kinds
            .filter((k) => k !== 'goals')
            .map((k) => (
              <Field key={k} orientation="horizontal">
                <FieldControl>
                  <Checkbox
                    checked={include.includes(k)}
                    onCheckedChange={(on) => {
                      setInclude(on === true ? [...include, k] : include.filter((x) => x !== k));
                    }}
                  />
                </FieldControl>
                <FieldLabel>{kindLabel(k)}</FieldLabel>
              </Field>
            ))}
        </div>
      ) : null}
      {step === 2 ? (
        <RadioGroup aria-label="As" value={format} onValueChange={setFormat}>
          <RadioCard value="pdf" description="Every submitted review, a page each, in one file.">
            One PDF
          </RadioCard>
          <RadioCard
            value="zip"
            description="Each review its own PDF, named for whose it is, with an index of them all."
          >
            A zip of PDFs
          </RadioCard>
        </RadioGroup>
      ) : null}
    </StepDialog>
  );
}

function AddDialog({
  act,
  id,
  onDone,
}: {
  readonly act: Act;
  readonly id: string;
  readonly onDone: () => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<readonly { personId: string; name: string; title: string }[]>(
    [],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onDone}
      title="Add someone to the cycle"
      description="Their reviews are created from the cycle’s settings; with under a week left, they are due a week from today."
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={chosen === null}
            loading={act.pending}
            onClick={() => {
              act.run(
                'AddPerformanceParticipant',
                { id, input: { personId: chosen, reason: 'Late joiner' } },
                onDone,
              );
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <SearchField
        label="Search people"
        placeholder="Search everyone"
        value={q}
        onValueChange={setQ}
        onSearch={(v) => {
          void act.call('PerformanceDirectory', { q: v }).then((d) => {
            if (d.ok) setFound((d.data as { rows: typeof found }).rows);
          });
        }}
      />
      <RadioGroup aria-label="Who" value={chosen ?? ''} onValueChange={setChosen}>
        {found.map((p) => (
          <RadioCard key={p.personId} value={p.personId} description={p.title}>
            {p.name}
          </RadioCard>
        ))}
      </RadioGroup>
    </Modal>
  );
}

function RemoveDialog({
  act,
  id,
  person,
  onDone,
}: {
  readonly act: Act;
  readonly id: string;
  readonly person: OverviewRow | undefined;
  readonly onDone: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onDone}
      title={`Remove ${person?.name ?? 'them'} from the cycle?`}
      description="Started reviews about them become detached: kept for their authors, out of the cycle. Unstarted ones are cancelled."
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'RemovePerformanceParticipant',
                { id, input: { personId: person?.personId, reason } },
                onDone,
              );
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>Reason</FieldLabel>
        <Input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}
