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
  FieldDescription,
  FieldLabel,
  FormSection,
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
  Separator,
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
  score,
  useAct,
  words,
  type Act,
} from './shared';
import type { Kind, ScreenProps } from './types';
import { t as tr } from './i18n';

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

const STATES = () =>
  [
    ['', tr('cycles.all', 'All')],
    ['draft', tr('cycles.draft', 'Draft')],
    ['scheduled', tr('cycles.scheduled', 'Scheduled')],
    ['in_progress', tr('cycles.in_progress', 'In progress')],
    ['closed', tr('cycles.closed', 'Closed')],
    ['archived', tr('cycles.archived', 'Archived')],
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
            title={tr('cycles.cycles', 'Cycles')}
            description={tr(
              'cycles.a_cycle_is_a_set_of',
              'A cycle is a set of review activities for a group of people, with deadlines. Filters are in the address.',
            )}
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
                    {tr('cycles.copy_a_cycle', 'Copy a cycle')}
                  </Button>
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setStarting(true);
                    }}
                  >
                    {tr('cycles.new_cycle', 'New cycle')}
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
                  label={tr('cycles.search_cycles', 'Search cycles')}
                  placeholder={tr('cycles.search_cycles', 'Search cycles')}
                  initial={props.search?.['q'] ?? ''}
                  onSearch={(q) => {
                    props.onFilter?.({ q: q === '' ? null : q });
                  }}
                />
                <ChipRow aria-label={tr('cycles.state', 'State')}>
                  {STATES().map(([v, l]) => (
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
                label={tr('cycles.cycles', 'Cycles')}
                rows={data.rows}
                endLabel={tr('cycles.thats_every_cycle', 'That’s every cycle · {{length}}', {
                  length: String(data.rows.length),
                })}
                rowId={(c) => c.id}
                describeRow={(c) => c.name}
                estimateRowHeight={57}
                fill
                columns={[
                  {
                    id: 'cycle',
                    header: tr('cycles.cycle', 'Cycle'),
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
                          {c.owner === 'Automation'
                            ? tr('cycles.from_an_automation', 'From an automation')
                            : tr('cycles.owner', 'Owner: {{owner}}', { owner: c.owner })}
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: 'state',
                    header: tr('cycles.state', 'State'),
                    cell: (c) => <CycleBadge state={c.state} />,
                  },
                  {
                    id: 'who',
                    header: tr('cycles.who', 'Who'),
                    cell: (c) => <span className="text-sm text-fg-muted">{c.who}</span>,
                  },
                  {
                    id: 'kinds',
                    header: tr('cycles.activities', 'Activities'),
                    cell: (c) => (
                      <span className="text-sm">{c.kinds.map(kindLabel).join(', ')}</span>
                    ),
                  },
                  {
                    id: 'dates',
                    header: tr('cycles.dates', 'Dates'),
                    cell: (c) => <span className="text-sm text-fg-muted">{c.dates}</span>,
                  },
                  {
                    id: 'progress',
                    header: tr('cycles.progress', 'Progress'),
                    className: 'min-w-28',
                    cell: (c) =>
                      ['in_progress', 'closed', 'archived'].includes(c.state) ? (
                        <Progress
                          value={c.progress}
                          label={tr('cycles.text', '{{name}}: {{progress}}%', {
                            name: c.name,
                            progress: String(c.progress),
                          })}
                        />
                      ) : (
                        '—'
                      ),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={<icons.review aria-hidden />}
                    title={tr('cycles.no_cycles_here', 'No cycles here')}
                    description={
                      data.hr
                        ? tr('cycles.start_one_with_new_cycle', 'Start one with New cycle.')
                        : tr(
                            'cycles.cycles_you_take_part_in_show',
                            'Cycles you take part in show here.',
                          )
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
            title={tr('cycles.copy_a_cycle', 'Copy a cycle')}
            description={tr(
              'cycles.its_settings_are_copied_setup_opens',
              'Its settings are copied; setup opens next, where you name it and set its start.',
            )}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCopying(false);
                  }}
                >
                  {tr('cycles.cancel', 'Cancel')}
                </Button>
                <Button
                  disabled={from === ''}
                  loading={act.pending}
                  onClick={() => {
                    const source = data.rows.find((c) => c.id === from);
                    create(
                      source?.name == null
                        ? tr('cycles.copy_of_a_cycle', 'Copy of a cycle')
                        : tr('cycles.copy_of', 'Copy of {{value}}', { value: source.name }),
                      from,
                    );
                  }}
                >
                  {tr('cycles.continue_to_setup', 'Continue to setup')}
                </Button>
              </>
            }
          >
            <Refusal error={act.error} />
            <Field required>
              <FieldLabel>{tr('cycles.copy_settings_from', 'Copy settings from')}</FieldLabel>
              <Select value={from} onValueChange={setFrom}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder={tr('cycles.pick_a_cycle', 'Pick a cycle')} />
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
    name: tr('cycles.new_cycle', 'New cycle'),
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
      .call('CreatePerformanceCycle', {
        input: { name: tr('cycles.new_cycle', 'New cycle'), start: null, copyFrom: null },
      })
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
      description={tr('cycles.draft_saved_as_you_go', 'Draft · saved as you go')}
      steps={STEPS()}
      step={0}
      onStep={go}
      finishLabel={tr('cycles.next', 'Next')}
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

/** Five steps: when and what the subject sees, who, which reviews and their reminders, the timeline, and a last look. */
const STEPS = () => [
  tr('cycles.basics', 'Basics'),
  tr('cycles.people', 'People'),
  tr('cycles.reviews_and_reminders', 'Reviews and reminders'),
  tr('cycles.timeline', 'Timeline'),
  tr('cycles.launch', 'Launch'),
];
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
const REMINDERS = () =>
  [
    ['before:7', tr('cycles.7_days_before', '7 days before')],
    ['before:3', tr('cycles.3_days_before', '3 days before')],
    ['on_day', tr('cycles.on_the_day', 'On the day')],
    ['late:2', tr('cycles.every_2_days_when_late', 'Every 2 days when late')],
    ['opens', tr('cycles.when_it_opens', 'When it opens')],
  ] as const;

/** PF4: setup in a centred dialog; each step saves as it changes. */
export function Setup(props: ScreenProps<SetupData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('cycles.the_cycle', 'the cycle')}>
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
    Math.min(STEPS().length - 1, Number(props.search?.['step'] ?? '0') || 0),
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
      ? tr('cycles.launch_cycle', 'Launch cycle')
      : data.action === 'past'
        ? tr('cycles.the_start_date_has_passed', 'The start date has passed')
        : tr('cycles.schedule_cycle', 'Schedule cycle');
  const activity = (k: Kind, patch: Partial<ActivityConfig>): void => {
    save({ activities: { ...c.activities, [k]: { ...c.activities[k], ...patch } } });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={c.name}
        description={tr('cycles.new_cycle_draft_saved', 'New cycle · draft saved')}
      />
      <StepDialog
        open
        wide
        onClose={close}
        title={c.name}
        description={
          c.state === 'draft'
            ? tr('cycles.draft_saved_as_you_go', 'Draft · saved as you go')
            : words(c.state)
        }
        steps={STEPS()}
        step={step}
        onStep={go}
        finishLabel={finishLabel}
        canNext={step < STEPS().length - 1 || (!blocked && data.action !== 'past')}
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
        {step === 3 ? <CyclePlan c={c} edit={{ mode: 'setup', c, save }} /> : null}
        {step === 4 ? <Launch c={c} data={data} /> : null}
      </StepDialog>
    </div>
  );
}

type BasicsOf = Pick<CycleSetup, 'name' | 'description' | 'start'> &
  Partial<Pick<CycleSetup, 'visibility'>>;

/**
 * When it starts and, once the draft exists (`visibility` is known), what the
 * subject sees when their reviews are written.
 */
function Basics({
  c,
  save,
  action,
}: {
  readonly c: BasicsOf;
  readonly save: (p: Partial<BasicsOf>) => void;
  readonly action: string;
}): JSX.Element {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const v = c.visibility;
  const set = (patch: Partial<CycleSetup['visibility']>): void => {
    if (v !== undefined) save({ visibility: { ...v, ...patch } });
  };
  return (
    <div className="flex flex-col gap-4">
      <Field required>
        <FieldLabel>{tr('cycles.name', 'Name')}</FieldLabel>
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
        <FieldLabel>
          {tr('cycles.description_shown_to_participants', 'Description, shown to participants')}
        </FieldLabel>
        <Input
          value={description}
          placeholder={tr('cycles.optional', 'Optional')}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          onBlur={() => {
            if (description !== c.description) save({ description });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>{tr('cycles.starts', 'Starts')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('cycles.starts', 'Starts')}
            value={c.start.date}
            onChange={(date) => {
              if (date !== null) save({ start: { ...c.start, date } });
            }}
          />
        </FieldControl>
        <FieldDescription {...(action === 'past' ? { tone: 'warning' } : {})}>
          {action === 'launch'
            ? tr('cycles.today_so_it_launches_when_you', 'Today, so it launches when you confirm.')
            : action === 'past'
              ? tr(
                  'cycles.that_day_has_passed_choose_today',
                  'That day has passed: choose today or later.',
                )
              : tr('cycles.later_so_it_will_be_scheduled', 'Later, so it will be scheduled.')}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{tr('cycles.at', 'At')}</FieldLabel>
        <FieldControl>
          <TimePicker
            label={tr('cycles.at', 'At')}
            value={c.start.time}
            onChange={(time) => {
              if (time !== null) save({ start: { ...c.start, time } });
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{tr('cycles.time_zone', 'Time zone')}</FieldLabel>
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
      {v === undefined ? null : (
        <>
          <Separator />
          <FormSection
            headingLevel={3}
            title={tr('cycles.what_the_subject_sees', 'What the subject sees')}
            description={tr(
              'cycles.their_manager_and_hr_always_see',
              'Their manager and HR always see who wrote what.',
            )}
          >
            <Field>
              <FieldLabel>
                {tr('cycles.their_reviews_reach_them', 'Their reviews reach them')}
              </FieldLabel>
              <RadioGroup
                aria-label={tr('cycles.release', 'Release')}
                className="flex flex-col gap-2"
                value={v.release.mode}
                onValueChange={(mode) => {
                  set({ release: { ...v.release, mode } });
                }}
              >
                <RadioCard
                  value="manager"
                  description={tr(
                    'cycles.the_manager_releases_each_one_once',
                    'The manager releases each one once it is submitted.',
                  )}
                >
                  {tr('cycles.as_each_is_submitted', 'As each is submitted')}
                </RadioCard>
                <RadioCard
                  value="hr_date"
                  description={tr(
                    'cycles.everyone_at_once_on_the_day',
                    'Everyone at once, on the day you choose.',
                  )}
                >
                  {tr('cycles.on_a_date', 'On a date')}
                </RadioCard>
                <RadioCard
                  value="close"
                  description={tr(
                    'cycles.when_the_cycle_closes_after_calibration',
                    'When the cycle closes, after calibration if it has one.',
                  )}
                >
                  {tr('cycles.when_the_cycle_closes', 'When the cycle closes')}
                </RadioCard>
              </RadioGroup>
            </Field>
            {v.release.mode === 'hr_date' ? (
              <Field>
                <FieldLabel>{tr('cycles.release_on', 'Release on')}</FieldLabel>
                <FieldControl>
                  <DatePicker
                    label={tr('cycles.release_on', 'Release on')}
                    value={v.release.date}
                    onChange={(date) => {
                      set({ release: { ...v.release, date } });
                    }}
                  />
                </FieldControl>
              </Field>
            ) : null}
            <div className="flex flex-col">
              <SwitchRow
                label={tr('cycles.ask_for_an_acknowledgement', 'Ask for an acknowledgement')}
                hint={tr(
                  'cycles.ive_read_this_is_not_agreement',
                  '“I’ve read this” is not agreement.',
                )}
                checked={v.acknowledge}
                onChange={(ack) => {
                  set({ acknowledge: ack });
                }}
              />
              <SwitchRow
                label={tr('cycles.let_the_subject_comment', 'Let the subject comment')}
                hint={tr('cycles.shown_to_the_manager_and_hr', 'Shown to the manager and HR')}
                checked={v.subjectComment}
                onChange={(comment) => {
                  set({ subjectComment: comment });
                }}
              />
            </div>
            <NumberField
              label={tr('cycles.response_minimum', 'Response minimum')}
              hint={tr(
                'cycles.confidential_answers_show_only_once_this',
                'Confidential answers show only once this many are in.',
              )}
              value={v.minimum}
              suffix={unit(v.minimum, 'answer')}
              min={1}
              max={20}
              onChange={(n) => {
                if (n !== null) set({ minimum: n });
              }}
            />
          </FormSection>
        </>
      )}
    </div>
  );
}

const IS = [
  {
    id: 'is',
    get label(): string {
      return tr('cycles.is_any_of', 'is any of');
    },
    value: 'options',
  },
  {
    id: 'not',
    get label(): string {
      return tr('cycles.is_none_of', 'is none of');
    },
    value: 'options',
  },
] as const;
const STATUS_LABEL: Readonly<Record<string, string>> = {
  get active(): string {
    return tr('cycles.active', 'Active');
  },
  get on_leave(): string {
    return tr('cycles.on_leave', 'On leave');
  },
  get notice(): string {
    return tr('cycles.on_notice', 'On notice');
  },
  get pre_hire(): string {
    return tr('cycles.starting_soon', 'Starting soon');
  },
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
      label: tr('cycles.department', 'Department'),
      operators: IS,
      options: f.departments.map((d) => ({ value: d, label: d })),
    },
    {
      id: 'location',
      label: tr('cycles.work_location', 'Work location'),
      operators: IS,
      options: named(f.locations, data.places?.locations),
    },
    {
      id: 'legalEntity',
      label: tr('cycles.legal_entity', 'Legal entity'),
      operators: IS,
      options: named(f.legalEntities, data.places?.entities),
    },
    {
      id: 'manager',
      label: tr('cycles.manager', 'Manager'),
      operators: IS,
      options: f.managers ?? [],
    },
    {
      id: 'status',
      label: tr('cycles.status', 'Status'),
      operators: IS,
      options: f.statuses.map((x) => ({ value: x, label: STATUS_LABEL[x] ?? x })),
    },
    {
      id: 'title',
      label: tr('cycles.job_title', 'Job title'),
      operators: [{ id: 'contains', label: tr('cycles.contains', 'contains'), value: 'text' }],
    },
    {
      id: 'hiredOn',
      label: tr('cycles.start_date', 'Start date'),
      operators: [
        { id: 'before', label: tr('cycles.is_before', 'is before'), value: 'date' },
        { id: 'after', label: tr('cycles.is_after', 'is after'), value: 'date' },
        { id: 'between', label: tr('cycles.is_between', 'is between'), value: 'date-range' },
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
      <ChipRow role="group" aria-label={tr('cycles.filters_in_force', 'Filters in force')}>
        {match === 'any' && chips.length > 1 ? (
          <span className="text-xs text-fg-muted">{tr('cycles.any_of', 'Any of:')}</span>
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
            removeLabel={tr('cycles.remove', 'Remove {{field}} {{text}}', {
              field: chip.field,
              text: chip.text,
            })}
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
          {tr('cycles.add_filter', 'Add filter')}
        </Chip>
        {chips.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onApply([], 'all');
            }}
          >
            {tr('cycles.clear_all', 'Clear all')}
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
              label={tr('cycles.conditions', 'Conditions')}
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
              {tr('cycles.clear', 'Clear')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {tr('cycles.cancel', 'Cancel')}
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
              {tr('cycles.apply', 'Apply')}
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
      header: tr('cycles.person', 'Person'),
      cell: (r) => <Person name={r.name} sub={r.title} />,
    },
    {
      id: 'manager',
      width: '14rem',
      header: tr('cycles.manager', 'Manager'),
      cell: (r) =>
        r.manager === null ? (
          <span className="text-sm text-fg-muted">{tr('cycles.no_manager', 'No manager')}</span>
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
      header: tr('cycles.how', 'How'),
      cell: (r) =>
        r.note === null ? (
          <span className="text-sm text-fg-muted">
            {tr('cycles.by_the_filters', 'By the filters')}
          </span>
        ) : (
          <Badge size="sm" tone={r.note.startsWith('Excluded') ? 'neutral' : 'accent'}>
            {r.note}
          </Badge>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {/* The settings first; the list of who is in scrolls last. */}
      <SwitchRow
        label={tr('cycles.keep_in_step', 'Keep in step')}
        hint={tr(
          'cycles.people_who_start_matching_are_added',
          'People who start matching are added; people who stop matching are listed for you to decide.',
        )}
        checked={c.participants.keepInStep}
        onChange={(on) => {
          participants({ keepInStep: on });
        }}
      />
      {p.noLongerMatches.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">
            {tr('cycles.no_longer_matches', 'No longer matches · {{length}}', {
              length: String(p.noLongerMatches.length),
            })}
          </p>
          {p.noLongerMatches.map((n) => (
            <Person key={n.personId} name={n.name} sub={n.title} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          aria-label={tr(
            'cycles.describe_who_should_be_in_in',
            'Describe who should be in, in words',
          )}
          className="flex-1"
          value={chat}
          placeholder={tr(
            'cycles.ask_in_words_engineering_and_product',
            'Ask in words: Engineering and Product in Chicago, without anyone on leave',
          )}
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
          {tr('cycles.propose', 'Propose')}
        </Button>
      </div>
      {proposal === null ? null : (
        <Alert
          tone="info"
          title={tr('cycles.change_who_is_in', 'Change who is in')}
          action={
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setProposal(null);
                }}
              >
                {tr('cycles.discard', 'Discard')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  participants({ filter: proposal.filter });
                  setProposal(null);
                }}
              >
                {tr('cycles.apply', 'Apply')}
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
            label={tr('cycles.search_who_is_in', 'Search who is in')}
            placeholder={tr('cycles.search', 'Search {{count}}', {
              count: tr(
                'cycles.count_people',
                { one: '{{count}} person', other: '{{count}} people' },
                { count: p.count },
              ),
            })}
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
            title={tr('cycles.who_is_in', 'Who is in')}
            description={tr(
              'cycles.everyone_these_match_is_in_with',
              'Everyone these match is in, with whoever you add by name. Nothing changes until you press Apply.',
            )}
            onApply={(filter, m) => {
              participants({ filter, match: m });
            }}
          />
        }
        actions={
          <span className="w-56">
            <Combobox
              label={tr('cycles.add_by_name', 'Add by name')}
              multiple
              size="sm"
              placeholder={tr('cycles.add_by_name', 'Add by name')}
              searchPlaceholder={tr('cycles.search_people', 'Search people')}
              emptyMessage={tr('cycles.nobody_by_that_name', 'Nobody by that name')}
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
                    by: tr('cycles.you', 'You'),
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
        <span className="font-semibold text-fg">
          {tr(
            'cycles.count_people',
            { one: '{{count}} person', other: '{{count}} people' },
            { count: p.count },
          )}
        </span>
        {' · '}
        {tr(
          'cycles.from_filters_added_by_name_left_out',
          '{{fromFilter}} from the filters, {{included}} added by name, {{excluded}} left out',
          {
            fromFilter: p.fromFilter,
            included: p.included,
            excluded: p.excluded,
          },
        )}
        {q === ''
          ? ''
          : ` · ${tr('cycles.count_matches', { one: '{{count}} match', other: '{{count}} matches' }, { count: p.total ?? p.rows.length })} “${q}”`}
      </p>
      {/* A page at a time, only the rows in view drawn; the next page comes at 70%. */}
      <DataTable
        label={tr('cycles.who_is_in', 'Who is in')}
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
              endLabel: tr('cycles.thats_everyone', 'That’s everyone · {{plural}}', {
                plural: tr(
                  'cycles.count_people',
                  { one: '{{count}} person', other: '{{count}} people' },
                  { count: p.total ?? p.rows.length },
                ),
              }),
            }
          : {})}
        rowActions={(r) =>
          r.note === null
            ? [
                {
                  id: 'leave-out',
                  label: tr('cycles.leave_out_of_this_cycle', 'Leave out of this cycle'),
                  onSelect: () => {
                    setExcluding(r.personId);
                  },
                },
              ]
            : r.note.startsWith('Excluded')
              ? [
                  {
                    id: 'back-in',
                    label: tr('cycles.take_back_in', 'Take back in'),
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
                    label: tr('cycles.remove_added_by_name', 'Remove, added by name'),
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
            title={
              q === ''
                ? tr('cycles.nobody_yet', 'Nobody yet')
                : tr('cycles.nobody_matches', 'Nobody matches')
            }
            description={
              q === ''
                ? tr('cycles.add_a_filter_or_add_people', 'Add a filter, or add people by name.')
                : tr('cycles.try_another_name_or_title', 'Try another name or title.')
            }
          />
        }
      />
      <Modal
        open={excluding !== null}
        onClose={() => {
          setExcluding(null);
        }}
        title={tr('cycles.leave_them_out_of_this_cycle', 'Leave them out of this cycle?')}
        description={tr(
          'cycles.the_reason_is_kept_with_the',
          'The reason is kept with the decision, in the activity log.',
        )}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setExcluding(null);
              }}
            >
              {tr('cycles.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={reason.trim() === ''}
              onClick={() => {
                if (excluding === null) return;
                participants({
                  exclude: [
                    ...c.participants.exclude,
                    {
                      personId: excluding,
                      reason,
                      by: tr('cycles.you', 'You'),
                      at: new Date().toISOString(),
                    },
                  ],
                  include: c.participants.include.filter((x) => x.personId !== excluding),
                });
                setExcluding(null);
                setReason('');
              }}
            >
              {tr('cycles.leave_out', 'Leave out')}
            </Button>
          </>
        }
      >
        <Field required>
          <FieldLabel>{tr('cycles.reason', 'Reason')}</FieldLabel>
          <Input
            value={reason}
            placeholder={tr('cycles.on_leave_until_january', 'On leave until January')}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}

/** Which reviews, each with its form, when it is due and its settings; goals; then reminders and the plan. */
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
  const peers = dragging ?? ([c.peer.min, Math.min(PEERS_MAX, c.peer.max)] as const);
  const identity =
    (key: 'peerNames' | 'upwardNames') =>
    (next: string): void => {
      save({ visibility: { ...c.visibility, [key]: next } });
    };
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
                hint={
                  a.on
                    ? tr('cycles.part_of_this_cycle', 'Part of this cycle')
                    : tr('cycles.not_in_this_cycle', 'Not in this cycle')
                }
                checked={a.on}
                onChange={(on) => {
                  activity(k, { on });
                }}
              />
              {a.on ? (
                <>
                  <Field>
                    <FieldLabel>{tr('cycles.form', 'Form')}</FieldLabel>
                    <Select
                      value={a.templateId ?? ''}
                      onValueChange={(v) => {
                        activity(k, { templateId: v });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={tr(
                              'cycles.choose_a_published_form',
                              'Choose a published form',
                            )}
                          />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {options.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {tr('cycles.v', '{{name}} · v{{value}} · {{questions}}', {
                              name: t.name,
                              value: String(t.published ?? 1),
                              questions: tr(
                                'cycles.count_questions',
                                { one: '{{count}} question', other: '{{count}} questions' },
                                { count: t.questions },
                              ),
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <NumberField
                    label={
                      d.from === 'nominations'
                        ? tr('cycles.due_after_nominations_close', 'Due after nominations close')
                        : tr('cycles.due_after_the_start', 'Due after the start')
                    }
                    hint={tr('cycles.works_out_to', 'Works out to {{resolveDue}}', {
                      resolveDue: day(resolveDue(c, d)),
                    })}
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
                    label={tr('cycles.every_teammate', 'Every teammate')}
                    hint={tr(
                      'cycles.the_persons_team_same_manager_up',
                      'The person’s team (same manager), up to {{max}}. Off: peers are nominated.',
                      { max: String(c.peer.max) },
                    )}
                    checked={c.peer.all}
                    onChange={(on) => {
                      save({ peer: { ...c.peer, all: on } });
                    }}
                  />
                  {c.peer.all ? null : (
                    <>
                      <Field>
                        <FieldLabel>{tr('cycles.who_nominates', 'Who nominates')}</FieldLabel>
                        <SegmentedControl
                          value={c.peer.picker}
                          onValueChange={(v) => {
                            save({ peer: { ...c.peer, picker: v } });
                          }}
                        >
                          <SegmentedControlItem value="subject">
                            {tr('cycles.the_person', 'The person')}
                          </SegmentedControlItem>
                          <SegmentedControlItem value="manager">
                            {tr('cycles.their_manager', 'Their manager')}
                          </SegmentedControlItem>
                          <SegmentedControlItem value="hr">
                            {tr('cycles.hr', 'HR')}
                          </SegmentedControlItem>
                        </SegmentedControl>
                      </Field>
                      <NumberField
                        label={tr(
                          'cycles.nominations_due_after_the_start',
                          'Nominations due after the start',
                        )}
                        hint={tr('cycles.works_out_to', 'Works out to {{resolveDue}}', {
                          resolveDue: day(resolveDue(c, c.nominations)),
                        })}
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
                        label={tr(
                          'cycles.the_manager_approves_nominations',
                          'The manager approves nominations',
                        )}
                        checked={c.peer.approval}
                        onChange={(on) => {
                          save({ peer: { ...c.peer, approval: on } });
                        }}
                      />
                    </>
                  )}
                  <Field>
                    <FieldLabel>
                      {tr('cycles.peer_reviewers_per_person', 'Peer reviewers per person')}
                    </FieldLabel>
                    <FieldControl>
                      <Slider
                        label={tr('cycles.peer_reviewers_per_person', 'Peer reviewers per person')}
                        thumbLabels={[
                          tr('cycles.at_least', 'At least'),
                          tr('cycles.at_most', 'At most'),
                        ]}
                        valueDisplay={tr('cycles.to', '{{peers}} to {{peers2}}', {
                          peers: String(peers[0]),
                          peers2: String(peers[1]),
                        })}
                        min={0}
                        max={PEERS_MAX}
                        showTicks
                        labels={Array.from({ length: PEERS_MAX + 1 }, (_, i) => String(i))}
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
                    </FieldControl>
                  </Field>
                  <SwitchRow
                    label={tr(
                      'cycles.a_reviewer_can_decline_and_is',
                      'A reviewer can decline, and is replaced',
                    )}
                    checked={c.peer.declineReplace}
                    onChange={(on) => {
                      save({ peer: { ...c.peer, declineReplace: on } });
                    }}
                  />
                  <Identity value={c.visibility.peerNames} onChange={identity('peerNames')} />
                  <SwitchRow
                    label={tr('cycles.share_the_peer_summary', 'Share the peer summary')}
                    hint={tr('cycles.peer_answers_without_names', 'Peer answers, without names')}
                    checked={c.visibility.peerSummary}
                    onChange={(peerSummary) => {
                      save({ visibility: { ...c.visibility, peerSummary } });
                    }}
                  />
                </>
              ) : null}
              {k === 'upward' && a.on ? (
                <Identity value={c.visibility.upwardNames} onChange={identity('upwardNames')} />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <SwitchRow
            label={tr('cycles.goals', 'Goals')}
            hint={
              c.goals === 'none'
                ? tr('cycles.not_in_this_cycle', 'Not in this cycle')
                : tr('cycles.part_of_this_cycle', 'Part of this cycle')
            }
            checked={c.goals !== 'none'}
            onChange={(on) => {
              save({ goals: on ? 'context' : 'none' });
            }}
          />
          {c.goals === 'none' ? null : (
            <RadioGroup
              aria-label={tr('cycles.how_goals_are_used', 'How goals are used')}
              className="flex flex-col gap-2"
              value={c.goals}
              onValueChange={(v) => {
                save({ goals: v as CycleSetup['goals'] });
              }}
            >
              <RadioCard
                value="context"
                description={tr(
                  'cycles.reviewers_see_each_persons_goals_beside',
                  'Reviewers see each person’s goals beside the form.',
                )}
              >
                {tr('cycles.shown_beside_the_review', 'Shown beside the review')}
              </RadioCard>
              <RadioCard
                value="scored"
                description={tr(
                  'cycles.a_section_is_added_with_each',
                  'A section is added with each goal and its score.',
                )}
              >
                {tr('cycles.scored_in_the_review', 'Scored in the review')}
              </RadioCard>
            </RadioGroup>
          )}
        </CardContent>
      </Card>
      <Separator />
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
    </div>
  );
}

/** The most peer reviewers a person can be given; more than this is a chore, not a review. */
const PEERS_MAX = 8;

/** Whether the subject learns who wrote a peer or an upward review. */
function Identity({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{tr('cycles.reviewer_identity', 'Reviewer identity')}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {NAMES().map(([x, l]) => (
            <SelectItem key={x} value={x}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const NAMES = () =>
  [
    ['hidden', tr('cycles.hidden_from_the_subject', 'Hidden from the subject')],
    ['shown', tr('cycles.shown_to_the_subject', 'Shown to the subject')],
    ['writer', tr('cycles.the_writer_chooses', 'The writer chooses')],
  ] as const;
const NAME_LABEL: Readonly<Record<string, string>> = Object.fromEntries(NAMES());

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
      <p className="text-sm font-semibold">{tr('cycles.reminders', 'Reminders')}</p>
      <ChipRow
        aria-label={tr('cycles.when_are_reminded', 'When {{kind}} are reminded', {
          kind: kind.toLowerCase(),
        })}
      >
        {REMINDERS().map(([v, l]) => (
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
        label={tr('cycles.inbox', 'Inbox')}
        info={tr(
          'cycles.always_on_every_reminder_lands_in_each',
          'Always on: every reminder lands in each person’s Inbox in Kithena, whatever else is chosen.',
        )}
        checked
        disabled
      />
      <SwitchRow
        label={tr('cycles.email', 'Email')}
        hint={tr('cycles.by_each_persons_preference', 'By each person’s preference')}
        checked={value.email}
        onChange={(email) => {
          onChange({ ...value, email });
        }}
      />
      <SwitchRow
        label={tr('cycles.chat_app', 'Chat app')}
        hint={tr(
          'cycles.by_each_persons_preference_when_connected',
          'By each person’s preference, when connected',
        )}
        checked={value.chat}
        onChange={(chat) => {
          onChange({ ...value, chat });
        }}
      />
    </div>
  );
}

/** "3 days", "1 answer": the unit a number field counts in, after it. */
const unit = (n: number, one: string): string =>
  n === 1 ? one : tr('cycles.s', '{{one}}s', { one });

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
      title: tr('cycles.when_are_due', 'When are {{name}} due?', { name: name(k).toLowerCase() }),
      description:
        setup.c.activities[k as Kind].due.from === 'nominations'
          ? tr(
              'cycles.counted_from_nominations_close',
              'Counted from when nominations close, so it moves with it.',
            )
          : tr('cycles.counted_from_the_start', 'Counted from the start, so it moves with it.'),
      confirm: tr('cycles.change_the_due_date', 'Change the due date'),
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
      title: tr('cycles.when_does_the_cycle_start', 'When does the cycle start?'),
      description: tr(
        'cycles.every_deadline_and_reminder_is_counted',
        'Every deadline and reminder is counted from the start, so they all move with it.',
      ),
      confirm: tr('cycles.move_the_start', 'Move the start'),
      date: to,
      run: (d) => {
        setup.save({ start: { ...setup.c.start, date: d } });
      },
    });
  };
  const askNominations = (to: string): void => {
    if (setup === null) return;
    open({
      title: tr('cycles.when_do_nominations_close', 'When do nominations close?'),
      description: tr(
        'cycles.peer_reviews_counted_from_when_nominations',
        'Peer reviews counted from when nominations close move with it.',
      ),
      confirm: tr('cycles.change_when_they_close', 'Change when they close'),
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
      title: tr('cycles.when_are_reviews_released', 'When are reviews released?'),
      description: tr(
        'cycles.everyone_sees_their_reviews_on_this',
        'Everyone sees their reviews on this day.',
      ),
      confirm: tr('cycles.change_the_release_date', 'Change the release date'),
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
              label: tr('cycles.extend_the_deadline', 'Extend the deadline…'),
              onSelect: () => {
                edit.extend(item.kind, dueOf(item.kind));
              },
            },
            {
              id: 'remind',
              label: tr(
                'cycles.remind_everyone_who_has_not_submitted',
                'Remind everyone who has not submitted…',
              ),
              onSelect: () => {
                open({
                  title: tr(
                    'cycles.remind_everyone_who_has_not_submitted_2',
                    'Remind everyone who has not submitted?',
                  ),
                  description: tr(
                    'cycles.by_the_cycles_channels_the_inbox',
                    'By the cycle’s channels: the Inbox, and email or chat where they are on.',
                  ),
                  confirm: tr('cycles.remind_them', 'Remind them'),
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
            label: tr('cycles.change_the_due_date_2', 'Change the due date…'),
            onSelect: () => {
              askDue(item.kind, dueOf(item.kind));
            },
          },
          {
            id: 'start',
            label: tr('cycles.move_the_cycles_start', 'Move the cycle’s start…'),
            onSelect: () => {
              askStart(edit.c.start.date);
            },
          },
          {
            id: 'remove',
            label: tr('cycles.take_out_of_this_cycle', 'Take {{name}} out of this cycle…', {
              name: name(item.kind).toLowerCase(),
            }),
            destructive: true,
            onSelect: () => {
              open({
                title: tr('cycles.take_out_of_this_cycle_2', 'Take {{name}} out of this cycle?', {
                  name: name(item.kind).toLowerCase(),
                }),
                description: tr(
                  'cycles.its_form_and_due_date_are',
                  'Its form and due date are kept: turn it back on in Reviews.',
                ),
                confirm: tr('cycles.take_it_out', 'Take it out'),
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
            label: tr('cycles.change_when_nominations_close', 'Change when nominations close…'),
            onSelect: () => {
              askNominations(resolveDue(edit.c, edit.c.nominations));
            },
          },
        ];
      case 'remind':
        return [
          {
            id: 'stop',
            label: tr('cycles.stop_reminding', 'Stop reminding “{{value}}”…', {
              value: (REMINDER_LABEL[item.rule] ?? item.rule).toLowerCase(),
            }),
            destructive: true,
            onSelect: () => {
              open({
                title: tr('cycles.stop_reminding_2', 'Stop reminding “{{value}}”?', {
                  value: (REMINDER_LABEL[item.rule] ?? item.rule).toLowerCase(),
                }),
                description: tr(
                  'cycles.for_every_review_in_the_cycle',
                  'For every review in the cycle: one set of reminders serves them all.',
                ),
                confirm: tr('cycles.stop_it', 'Stop it'),
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
                label: tr('cycles.change_the_release_date_2', 'Change the release date…'),
                onSelect: () => {
                  askRelease(v.release.date ?? today ?? c.start.date);
                },
              },
            ];
    }
  };

  return (
    <ChartCard
      title={tr('cycles.the_cycle_at_a_glance', 'The cycle at a glance')}
      description={
        edit === undefined
          ? tr(
              'cycles.bars_are_when_each_review_is_open',
              'Bars are when each review is open; pins in its colour are its due date and, outlined, its reminders. Drag across the dates to zoom.',
            )
          : edit.mode === 'setup'
            ? tr(
                'cycles.drag_a_bars_end_or_its',
                'Drag a bar’s end or its pin to change when it is due, or the bar to move the start. Right-click for more, and drag across the dates to zoom.',
              )
            : tr(
                'cycles.drag_a_due_date_later_to',
                'Drag a due date later to extend it for everyone, or right-click a review to remind or extend. Drag across the dates to zoom.',
              )
      }
    >
      <TimelineChart
        label={tr('cycles.the_cycles_plan', 'The cycle’s plan')}
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
        empty={
          <p className="text-sm text-fg-muted">
            {tr('cycles.turn_a_review_on_to_see', 'Turn a review on to see its plan.')}
          </p>
        }
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
              {tr('cycles.cancel', 'Cancel')}
            </Button>
            <Button
              variant={ask?.destructive === true ? 'danger' : 'primary'}
              disabled={ask?.date !== undefined && date === ''}
              onClick={() => {
                ask?.run(date);
                setAsk(null);
              }}
            >
              {ask?.confirm ?? tr('cycles.confirm', 'Confirm')}
            </Button>
          </>
        }
      >
        {ask?.date === undefined ? null : (
          <Field>
            <FieldLabel>{tr('cycles.date', 'Date')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('cycles.date', 'Date')}
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
    ? tr('cycles.on_a_set_date', 'on a set date')
    : d.from === 'nominations'
      ? tr(
          'cycles.days_after_nominations_close',
          {
            one: '{{count}} day after nominations close',
            other: '{{count}} days after nominations close',
          },
          { count: d.days ?? 0 },
        )
      : tr(
          'cycles.days_after_the_start',
          { one: '{{count}} day after the start', other: '{{count}} days after the start' },
          { count: d.days ?? 0 },
        );

const PICKER: Readonly<Record<string, string>> = {
  get subject(): string {
    return tr('cycles.the_person_2', 'the person');
  },
  get manager(): string {
    return tr('cycles.their_manager_2', 'their manager');
  },
  hr: 'HR',
};

/**
 * The last step, a last look and nothing to set: whether anything stops it,
 * what launches (who, when, and each review with its form and deadline, in the
 * plan's colours), and what the subject sees once it is written.
 */
function Launch({ c, data }: { readonly c: CycleSetup; readonly data: SetupData }): JSX.Element {
  const v = c.visibility;
  const blocks = data.checks.filter((i) => i.level === 'block').length;
  const warns = data.checks.filter((i) => i.level === 'warn').length;
  const on = KINDS.filter((k) => k !== 'goals' && c.activities[k].on);
  const dues = on.map((k) => resolveDue(c, c.activities[k].due));
  const last = dues.toSorted().at(-1);
  const form = (id: string | null): string => {
    const t = data.templates.find((x) => x.id === id);
    return t === undefined
      ? tr('cycles.no_form_chosen_yet', 'No form chosen yet')
      : tr('cycles.v', '{{name}} · v{{value}} · {{questions}}', {
          name: t.name,
          value: String(t.published ?? 1),
          questions: tr(
            'cycles.count_questions',
            { one: '{{count}} question', other: '{{count}} questions' },
            { count: t.questions },
          ),
        });
  };
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle level={3}>
            {blocks === 0
              ? data.action === 'schedule'
                ? tr('cycles.ready_to_schedule', 'Ready to schedule')
                : tr('cycles.ready_to_launch', 'Ready to launch')
              : data.action === 'schedule'
                ? tr(
                    'cycles.things_to_fix_before_scheduled',
                    {
                      one: '{{count}} thing to fix before it can be scheduled',
                      other: '{{count}} things to fix before it can be scheduled',
                    },
                    { count: blocks },
                  )
                : tr(
                    'cycles.things_to_fix_before_launch',
                    {
                      one: '{{count}} thing to fix before it can launch',
                      other: '{{count}} things to fix before it can launch',
                    },
                    { count: blocks },
                  )}
          </CardTitle>
          <p className="text-sm text-fg-muted">
            {blocks === 0 && warns === 0
              ? tr('cycles.every_check_passed', 'Every check passed.')
              : warns === 0
                ? tr(
                    'cycles.fix_what_is_marked_nothing_else_stops',
                    'Fix what is marked; nothing else stops it.',
                  )
                : tr(
                    'cycles.to_read_warnings_dont_stop_it',
                    '{{warns}} to read. Warnings don’t stop it.',
                    {
                      warns: tr(
                        'cycles.count_warnings',
                        { one: '{{count}} warning', other: '{{count}} warnings' },
                        { count: warns },
                      ),
                    },
                  )}
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
          <CardTitle level={3}>{tr('cycles.what_launches', 'What launches')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={tr('cycles.people', 'People')}
              icon={<icons.people aria-hidden />}
              iconPosition="start"
              value={String(data.participants.count)}
              description={tr(
                'cycles.by_the_filters_by_name',
                '{{fromFilter}} by the filters, {{included}} by name',
                {
                  fromFilter: String(data.participants.fromFilter),
                  included: String(data.participants.included),
                },
              )}
            />
            <Stat
              label={tr('cycles.starts', 'Starts')}
              icon={<icons.calendar aria-hidden />}
              iconPosition="start"
              value={day(c.start.date)}
              description={tr('cycles.text_2', '{{time}} {{zone}}', {
                time: c.start.time,
                zone: c.start.zone,
              })}
            />
            <Stat
              label={tr('cycles.last_deadline', 'Last deadline')}
              icon={<icons.flagged aria-hidden />}
              iconPosition="start"
              value={last === undefined ? '—' : day(last)}
              description={tr(
                'cycles.count_reviews',
                { one: '{{count}} review', other: '{{count}} reviews' },
                { count: on.length },
              )}
            />
          </div>
          {on.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr('cycles.no_review_is_part_of_this', 'No review is part of this cycle yet.')}
            </p>
          ) : (
            <IconList
              divided
              aria-label={tr('cycles.reviews_in_this_cycle', 'Reviews in this cycle')}
            >
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
                          <span className="font-medium text-fg">
                            {tr('cycles.due', 'Due {{day}}', { day: day(dues[i] ?? '') })}
                          </span>
                          {` · ${dueAfter(a.due)}`}
                          {k === 'peer'
                            ? c.peer.all
                              ? ' · ' +
                                tr('cycles.every_teammate_up_to', 'every teammate, up to {{max}}', {
                                  max: c.peer.max,
                                })
                              : ' · ' +
                                tr(
                                  'cycles.peers_nominated_by',
                                  '{{min}} to {{max}} peers, nominated by {{picker}}',
                                  {
                                    min: c.peer.min,
                                    max: c.peer.max,
                                    picker: PICKER[c.peer.picker] ?? c.peer.picker,
                                  },
                                )
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
                  {tr('cycles.goals', 'Goals')}
                </IconListItem>
              )}
            </IconList>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={3}>
            {tr('cycles.what_the_subject_sees', 'What the subject sees')}
          </CardTitle>
          <p className="text-sm text-fg-muted">
            {tr(
              'cycles.set_in_basics_and_reviews_this',
              'Set in Basics and Reviews; this is a last look.',
            )}
          </p>
        </CardHeader>
        <CardContent>
          <KeyValues
            items={[
              {
                label: tr('cycles.their_reviews_reach_them', 'Their reviews reach them'),
                value:
                  v.release.mode === 'hr_date' && v.release.date !== null
                    ? `On ${day(v.release.date)}`
                    : (RELEASE_LABEL[v.release.mode] ?? v.release.mode),
              },
              ...(c.activities.peer.on
                ? [
                    {
                      label: tr('cycles.peer_reviewers', 'Peer reviewers'),
                      value: NAME_LABEL[v.peerNames] ?? v.peerNames,
                    },
                  ]
                : []),
              ...(c.activities.upward.on
                ? [
                    {
                      label: tr('cycles.upward_reviewers', 'Upward reviewers'),
                      value: NAME_LABEL[v.upwardNames] ?? v.upwardNames,
                    },
                  ]
                : []),
              {
                label: tr('cycles.acknowledgement', 'Acknowledgement'),
                value: v.acknowledge
                  ? tr('cycles.asked_for', 'Asked for')
                  : tr('cycles.not_asked_for', 'Not asked for'),
              },
              {
                label: tr('cycles.their_comment', 'Their comment'),
                value: v.subjectComment ? 'Allowed' : tr('cycles.not_allowed', 'Not allowed'),
              },
              {
                label: tr('cycles.peer_summary', 'Peer summary'),
                value: v.peerSummary
                  ? tr('cycles.shared_without_names', 'Shared, without names')
                  : tr('cycles.kept_back', 'Kept back'),
              },
              {
                label: tr('cycles.response_minimum', 'Response minimum'),
                value: tr(
                  'cycles.count_answers',
                  { one: '{{count}} answer', other: '{{count}} answers' },
                  { count: v.minimum },
                ),
              },
            ]}
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
  /** Manager reviews by someone they no longer report to (§8.8); `main` is the one the row shows. */
  readonly formerManagerReviews?: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly main: boolean;
  }[];
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

const REMINDER_LABEL: Readonly<Record<string, string>> = Object.fromEntries(REMINDERS());
const RELEASE_LABEL: Readonly<Record<string, string>> = {
  get manager(): string {
    return tr('cycles.as_each_is_submitted', 'As each is submitted');
  },
  get hr_date(): string {
    return tr('cycles.on_a_date', 'On a date');
  },
  get close(): string {
    return tr('cycles.when_the_cycle_closes', 'When the cycle closes');
  },
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
            ? tr(
                'cycles.deadlines_move_from_the_plan_on_the',
                'Deadlines move from the plan on the Overview; everything else was fixed at launch.',
              )
            : tr(
                'cycles.not_started_yet_so_all_of',
                'Not started yet, so all of it can still change.',
              )}
        </p>
        {onEdit === undefined ? null : (
          <Button variant="secondary" startIcon={<icons.edit aria-hidden />} onClick={onEdit}>
            {tr('cycles.edit_setup', 'Edit setup')}
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('cycles.reviews', 'Reviews')}</CardTitle>
          <p className="text-sm text-fg-muted">
            {tr('cycles.starts_2', 'Starts {{date}}', { date: day(data.plan.start.date) })}
          </p>
        </CardHeader>
        <CardContent>
          {kinds.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr('cycles.no_review_is_part_of_this_2', 'No review is part of this cycle.')}
            </p>
          ) : (
            <IconList
              divided
              aria-label={tr('cycles.reviews_in_this_cycle', 'Reviews in this cycle')}
            >
              {kinds.map((k) => {
                const d = due(k);
                return (
                  <IconListItem
                    key={k}
                    icon={<KindGlyph kind={k} />}
                    tone={kindTone(k)}
                    description={
                      d === null
                        ? tr('cycles.no_deadline', 'No deadline')
                        : tr('cycles.due_2', 'Due {{d}}', { d: day(d) })
                    }
                  >
                    {kindLabel(k)}
                  </IconListItem>
                );
              })}
              <IconListItem icon={<icons.goal />} description={GOALS_LABEL[st.goals] ?? st.goals}>
                {tr('cycles.goals', 'Goals')}
              </IconListItem>
            </IconList>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('cycles.reminders', 'Reminders')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {st.reminders.rules.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr('cycles.no_reminders_are_sent', 'No reminders are sent.')}
              </p>
            ) : (
              <ChipRow
                aria-label={tr('cycles.when_reviews_are_reminded', 'When reviews are reminded')}
              >
                {st.reminders.rules.map((r) => (
                  <Badge key={r} tone="accent">
                    {REMINDER_LABEL[r] ?? r}
                  </Badge>
                ))}
              </ChipRow>
            )}
            <IconList
              aria-label={tr('cycles.how_reminders_reach_people', 'How reminders reach people')}
            >
              <IconListItem
                icon={<icons.inbox />}
                tone="success"
                description={tr(
                  'cycles.always_every_reminder_lands_in_each',
                  'Always: every reminder lands in each person’s Inbox.',
                )}
              >
                {tr('cycles.inbox', 'Inbox')}
              </IconListItem>
              <IconListItem
                icon={<icons.email />}
                tone={st.reminders.email ? 'success' : 'neutral'}
                description={
                  st.reminders.email
                    ? tr('cycles.on_by_each_persons_preference', 'On, by each person’s preference')
                    : tr('cycles.off_for_this_cycle', 'Off for this cycle')
                }
              >
                {tr('cycles.email', 'Email')}
              </IconListItem>
              <IconListItem
                icon={<icons.message />}
                tone={st.reminders.chat ? 'success' : 'neutral'}
                description={
                  st.reminders.chat
                    ? tr(
                        'cycles.on_by_each_persons_preference_when',
                        'On, by each person’s preference, when connected',
                      )
                    : tr('cycles.off_for_this_cycle', 'Off for this cycle')
                }
              >
                {tr('cycles.chat_app', 'Chat app')}
              </IconListItem>
            </IconList>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('cycles.what_the_subject_sees', 'What the subject sees')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IconList>
              <IconListItem
                icon={<icons.visible />}
                description={
                  st.visibility.release.mode === 'hr_date' &&
                  data.plan.visibility?.release.date !== null &&
                  data.plan.visibility?.release.date !== undefined
                    ? tr('cycles.on', 'On {{date}}', {
                        date: day(data.plan.visibility.release.date),
                      })
                    : tr(
                        'cycles.when_their_reviews_are_released_to',
                        'When their reviews are released to them',
                      )
                }
              >
                {RELEASE_LABEL[st.visibility.release.mode] ?? words(st.visibility.release.mode)}
              </IconListItem>
              <IconListItem
                icon={<icons.locked />}
                description={tr(
                  'cycles.confidential_answers_show_only_once_this',
                  'Confidential answers show only once this many are in.',
                )}
              >
                {tr('cycles.at_least_2', 'At least {{minimum}}', {
                  minimum: tr(
                    'cycles.count_answers',
                    { one: '{{count}} answer', other: '{{count}} answers' },
                    { count: st.visibility.minimum },
                  ),
                })}
              </IconListItem>
              {c.kinds.includes('peer') ? (
                <IconListItem
                  icon={<icons.people />}
                  description={
                    st.peer.all
                      ? tr('cycles.every_teammate_up_to_2', 'Every teammate, up to {{max}}', {
                          max: String(st.peer.max),
                        })
                      : tr('cycles.nominated_to_each', 'Nominated, {{min}} to {{max}} each', {
                          min: String(st.peer.min),
                          max: String(st.peer.max),
                        })
                  }
                >
                  {tr('cycles.peers', 'Peers')}
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
  get none(): string {
    return tr('cycles.not_part_of_this_cycle', 'Not part of this cycle');
  },
  get context(): string {
    return tr('cycles.shown_beside_the_review', 'Shown beside the review');
  },
  get scored(): string {
    return tr('cycles.scored_in_the_review', 'Scored in the review');
  },
};

/** Whole days from one calendar date to another; negative when `to` is earlier. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const REVIEW_STATES = [
  {
    value: 'not_started',
    get label(): string {
      return tr('cycles.not_started', 'Not started');
    },
  },
  {
    value: 'draft',
    get label(): string {
      return tr('cycles.in_progress', 'In progress');
    },
  },
  {
    value: 'overdue',
    get label(): string {
      return tr('cycles.overdue', 'Overdue');
    },
  },
  {
    value: 'submitted',
    get label(): string {
      return tr('cycles.submitted', 'Submitted');
    },
  },
  {
    value: 'released',
    get label(): string {
      return tr('cycles.released', 'Released');
    },
  },
  {
    value: 'ack',
    get label(): string {
      return tr('cycles.acknowledged', 'Acknowledged');
    },
  },
  {
    value: 'unlock',
    get label(): string {
      return tr('cycles.unlock_requested', 'Unlock requested');
    },
  },
  {
    value: 'none',
    get label(): string {
      return tr('cycles.none', 'None');
    },
  },
];
const GROUPS = () =>
  [
    ['', tr('cycles.no_grouping', 'No grouping')],
    ['department', tr('cycles.department', 'Department')],
    ['location', tr('cycles.work_location', 'Work location')],
    ['legalEntity', tr('cycles.legal_entity', 'Legal entity')],
    ['manager', tr('cycles.manager', 'Manager')],
  ] as const;

/** A row's group heading: the name of what it is grouped by. */
function groupLabel(data: OverviewData, group: string, r: OverviewRow): string {
  switch (group) {
    case 'department':
      return r.department ?? tr('cycles.no_department', 'No department');
    case 'location':
      return r.locationId == null
        ? tr('cycles.no_work_location', 'No work location')
        : (data.places?.locations[r.locationId] ?? r.locationId);
    case 'legalEntity':
      return r.legalEntityId == null
        ? tr('cycles.no_legal_entity', 'No legal entity')
        : (data.places?.entities[r.legalEntityId] ?? r.legalEntityId);
    case 'manager':
      return r.manager?.name ?? tr('cycles.no_manager', 'No manager');
    default:
      return '';
  }
}

const STANCES = [
  {
    key: 'submitted',
    get label(): string {
      return tr('cycles.submitted', 'Submitted');
    },
    tone: 'success',
  },
  {
    key: 'started',
    get label(): string {
      return tr('cycles.in_progress', 'In progress');
    },
    tone: 'accent',
  },
  {
    key: 'waiting',
    get label(): string {
      return tr('cycles.not_started', 'Not started');
    },
    tone: 'neutral',
  },
  {
    key: 'overdue',
    get label(): string {
      return tr('cycles.overdue', 'Overdue');
    },
    tone: 'danger',
  },
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
        title={tr('cycles.where_every_review_stands', 'Where every review stands')}
        description={[
          tr('cycles.of_in', '{{submitted}} of {{total}} in', {
            submitted: String(got.status.submitted),
            total: tr(
              'cycles.count_reviews',
              { one: '{{count}} review', other: '{{count}} reviews' },
              { count: total },
            ),
          }),
          got.status.overdue > 0
            ? tr('cycles.overdue_2', '{{overdue}} overdue', { overdue: String(got.status.overdue) })
            : tr('cycles.none_overdue', 'none overdue'),
          next === undefined || left === null
            ? null
            : left === 0
              ? tr('cycles.kind_due_today', '{{kindLabel}} due {{due}}, today', {
                  kindLabel: kindLabel(next.kind),
                  due: day(next.due),
                })
              : tr(
                  'cycles.kind_due_in_days',
                  {
                    one: '{{kindLabel}} due {{due}}, in {{count}} day',
                    other: '{{kindLabel}} due {{due}}, in {{count}} days',
                  },
                  { kindLabel: kindLabel(next.kind), due: day(next.due), count: left },
                ),
        ]
          .filter((x) => x !== null)
          .join(' · ')}
      >
        <DonutChart
          label={tr(
            'cycles.reviews_by_where_they_stand_and',
            'Reviews by where they stand, and by kind',
          )}
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
                : [
                    {
                      label: tr('cycles.s_2', '{{kindLabel}}s', { kindLabel: kindLabel(k) }),
                      value: n,
                      tone: TONES[i] ?? 'chart-1',
                    },
                  ];
            }),
          }))}
          center={`${String(done)}%`}
          centerLabel={tr('cycles.submitted_center', 'submitted')}
          showLegend
        />
      </ChartCard>
      <ChartCard
        title={tr('cycles.who_is_behind', 'Who is behind')}
        description={tr(
          'cycles.each_departments_reviews_by_where_they',
          'Each department’s reviews by where they stand, the least done first.',
        )}
      >
        <StackedBarChart
          label={tr(
            'cycles.reviews_by_department_and_where_they',
            'Reviews by department and where they stand',
          )}
          normalise
          categories={got.byDepartment.map((d) => d.department)}
          series={STANCES.map((x) => ({
            label: x.label,
            tone: x.tone,
            values: got.byDepartment.map((d) => d[x.key]),
          }))}
          format={(v) =>
            tr(
              'cycles.count_reviews',
              { one: '{{count}} review', other: '{{count}} reviews' },
              { count: Math.round(v) },
            )
          }
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
    {
      id: 'self',
      label: tr('cycles.self_review', 'Self review'),
      operators: IS,
      options: REVIEW_STATES,
    },
    {
      id: 'managerReview',
      label: tr('cycles.manager_review', 'Manager review'),
      operators: IS,
      options: REVIEW_STATES,
    },
    {
      id: 'overdue',
      label: tr('cycles.anything_overdue', 'Anything overdue'),
      operators: [{ id: 'is', label: tr('cycles.is', 'is'), value: 'options' }],
      options: [
        { value: 'yes', label: tr('cycles.yes', 'Yes') },
        { value: 'no', label: tr('cycles.no', 'No') },
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
          aria-label={tr('cycles.ask_who_to_show_in_words', 'Ask who to show, in words')}
          className="flex-1"
          value={words}
          placeholder={tr(
            'cycles.ask_in_words_engineering_in_london',
            'Ask in words: Engineering in London whose self review is overdue, by manager',
          )}
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
          {tr('cycles.ask', 'Ask')}
        </Button>
      </div>
      <Refusal error={refused} />
      {said.length === 0 ? null : (
        <p className="text-sm text-fg-muted" aria-live="polite">
          {tr('cycles.understood', 'Understood: {{join}}', { join: said.join(' · ') })}
        </p>
      )}
      <Toolbar
        search={
          <Search
            label={tr('cycles.search_people', 'Search people')}
            placeholder={tr('cycles.search_people_2', 'Search {{total}} people', {
              total: String(data.total),
            })}
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
            title={tr('cycles.filter_people', 'Filter people')}
            description={tr(
              'cycles.who_they_are_and_where_their',
              'Who they are, and where their reviews stand. Nothing applies until you press Apply.',
            )}
            onApply={(filter, m) => {
              setSaid([]);
              apply(filter, m);
            }}
          />
        }
        actions={
          <span className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">
              {tr(
                'cycles.count_people',
                { one: '{{count}} person', other: '{{count}} people' },
                { count: data.total },
              )}
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" startIcon={<icons.adjust aria-hidden />}>
                  {group === ''
                    ? tr('cycles.view', 'View')
                    : tr('cycles.view_by', 'View · by {{value}}', {
                        value: (GROUPS().find(([v]) => v === group)?.[1] ?? '').toLowerCase(),
                      })}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                aria-label={tr('cycles.view', 'View')}
                className="flex w-72 flex-col gap-2.5"
              >
                <p className="text-xs font-semibold text-fg-subtle">
                  {tr('cycles.group_by', 'Group by')}
                </p>
                <Select
                  value={group === '' ? 'none' : group}
                  onValueChange={(v) => {
                    props.onFilter?.({ group: v === 'none' ? null : v, page: null });
                  }}
                >
                  <SelectTrigger aria-label={tr('cycles.group_by', 'Group by')} size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPS().map(([v, l]) => (
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
      header: tr('cycles.person', 'Person'),
      cell: (r) => (
        <span className="flex flex-col">
          <span>
            <To href={`/performance/cycles/${id}/about/${r.personId}`} onNavigate={onNavigate}>
              {r.name}
            </To>
            {data.away?.[r.personId] === undefined ? null : (
              <Badge size="sm" tone="neutral" className="ml-2">
                {tr('cycles.away_until', 'Away until')} {data.away[r.personId]}
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
      header: tr('cycles.manager', 'Manager'),
      cell: (r) =>
        r.manager === null ? (
          <span className="text-sm text-fg-muted">{tr('cycles.no_manager', 'No manager')}</span>
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
            header: tr('cycles.self', 'Self'),
            cell: (r: OverviewRow) => <ReviewBadge state={r.self} />,
          },
        ]
      : []),
    ...(has('peer')
      ? [
          {
            id: 'peers',
            width: '10rem',
            header: tr('cycles.peers', 'Peers'),
            cell: (r: OverviewRow) => r.peers,
          },
        ]
      : []),
    ...(has('upward')
      ? [
          {
            id: 'upward',
            width: '7rem',
            header: tr('cycles.upward', 'Upward'),
            cell: (r: OverviewRow) => r.upward,
          },
        ]
      : []),
    ...(has('manager')
      ? [
          {
            id: 'managerReview',
            width: '13rem',
            header: tr('cycles.manager_review', 'Manager review'),
            cell: (r: OverviewRow) => {
              // A former manager's review is said so: the row's own, or one kept beside it.
              const former = r.formerManagerReviews ?? [];
              const main = former.find((f) => f.main);
              return r.managerReview === '—' ? (
                <span className="text-fg-muted">—</span>
              ) : (
                <span className="flex flex-col items-start gap-1">
                  <ReviewBadge state={r.managerReview} />
                  {main === undefined ? null : (
                    <span className="text-xs text-warning-fg">
                      {tr('cycles.by_their_former_manager', 'By {{name}}, their former manager', {
                        name: main.name,
                      })}
                    </span>
                  )}
                  {former
                    .filter((f) => !f.main)
                    .map((f) => (
                      <span key={f.id} className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <Badge size="sm" tone="warning">
                          {tr('cycles.former_manager', 'Former manager')}
                        </Badge>
                        {`${f.name} · ${REVIEW_STATES.find((x) => x.value === f.state)?.label ?? words(f.state)}`}
                      </span>
                    ))}
                </span>
              );
            },
          },
        ]
      : []),
    {
      id: 'release',
      width: '9rem',
      header: tr('cycles.release', 'Release'),
      cell: (r) => <span className="text-sm text-fg-muted">{r.release}</span>,
    },
    ...(data.hr
      ? [
          {
            id: 'score',
            width: '6rem',
            header: tr('cycles.score', 'Score'),
            numeric: true,
            cell: (r: OverviewRow) => score(r.score),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      label={tr('cycles.people_in_this_cycle', 'People in this cycle')}
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
      total={data.total}
      endLabel={tr('cycles.thats_everyone_2', 'That’s everyone · {{total}}', {
        total: tr(
          'cycles.count_people',
          { one: '{{count}} person', other: '{{count}} people' },
          { count: data.total },
        ),
      })}
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
          label: tr('cycles.open_their_reviews', 'Open their reviews'),
          onSelect: () => {
            onNavigate?.(`/performance/cycles/${id}/about/${r.personId}`);
          },
        },
        ...(has('peer') && r.nominationId !== null
          ? [
              {
                id: 'nominate',
                label: tr('cycles.nominate_peers_for_feedback', 'Nominate peers for feedback'),
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
                label: tr('cycles.remind', 'Remind'),
                onSelect: () => {
                  run('RemindPerformanceCycle', { personIds: [r.personId] });
                },
              },
              {
                id: 'extend',
                label: tr('cycles.extend_a_deadline', 'Extend a deadline'),
                onSelect: () => {
                  onDialog('extend', r.personId);
                },
              },
              {
                id: 'remove',
                label: tr('cycles.remove_from_the_cycle', 'Remove from the cycle'),
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
          title={tr('cycles.nobody_here_yet', 'Nobody here yet')}
          description={
            c.state === 'draft'
              ? tr(
                  'cycles.participants_are_fixed_when_the_cycle',
                  'Participants are fixed when the cycle launches.',
                )
              : tr('cycles.no_one_matches_the_search', 'No one matches the search.')
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
    <Loaded load={props.load} what={tr('cycles.the_cycle', 'the cycle')}>
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
              description={tr('cycles.text_3', '{{who}} · {{dates}}{{value}}', {
                who: c.who,
                dates: c.dates,
                value: c.versions === '' ? '' : ` · ${c.versions}`,
              })}
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
                        {tr('cycles.export', 'Export')}
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
                        {tr('cycles.remind', 'Remind')}
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          aria-label={tr('cycles.more_actions', 'More actions')}
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
                            {tr('cycles.edit_setup', 'Edit setup')}
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'scheduled' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              act.run('UnschedulePerformanceCycle', { id });
                            }}
                          >
                            {tr('cycles.unschedule', 'Unschedule')}
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'in_progress' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setDialog('add');
                            }}
                          >
                            {tr('cycles.add_someone', 'Add someone')}
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'in_progress' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setDialog('close');
                            }}
                          >
                            {tr('cycles.close_the_cycle', 'Close the cycle')}
                          </DropdownMenuItem>
                        ) : null}
                        {['in_progress', 'closed'].includes(c.state) ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              props.onNavigate?.(`/performance/calibration?cycle=${id}`);
                            }}
                          >
                            {tr('cycles.open_calibration', 'Open calibration')}
                          </DropdownMenuItem>
                        ) : null}
                        {c.state === 'closed' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              act.run('ArchivePerformanceCycle', { id, input: { archived: true } });
                            }}
                          >
                            {tr('cycles.archive', 'Archive')}
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
                            {tr('cycles.unarchive', 'Unarchive')}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : undefined
              }
              tabs={
                <TertiaryNav
                  label={tr('cycles.cycle', 'Cycle')}
                  orientation="horizontal"
                  variant="line"
                  activeId={tab}
                  current="page"
                  // Each tab is its own address, followed by the shell's router.
                  // A `#tab` anchor and a push of `?tab=` raced, and the push lost.
                  items={[
                    {
                      id: 'overview',
                      label: tr('cycles.overview', 'Overview'),
                      href: `/performance/cycles/${id}`,
                    },
                    ...(data.hr
                      ? [
                          {
                            id: 'analytics',
                            label: tr('cycles.analytics', 'Analytics'),
                            href: `/performance/cycles/${id}?tab=analytics`,
                          },
                          {
                            id: 'changes',
                            label: tr('cycles.changes', 'Changes'),
                            href: `/performance/cycles/${id}?tab=changes`,
                          },
                          {
                            id: 'settings',
                            label: tr('cycles.settings', 'Settings'),
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
                title={tr(
                  'cycles.the_launch_stopped_at_of_reviews',
                  'The launch stopped at {{created}} of {{total}} reviews',
                  { created: String(c.launch.created), total: String(c.launch.total) },
                )}
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
                      {tr('cycles.retry_launch', 'Retry launch')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        act.run('UnschedulePerformanceCycle', { id });
                      }}
                    >
                      {tr('cycles.back_to_draft', 'Back to draft')}
                    </Button>
                  </span>
                }
              >
                {tr(
                  'cycles.launch_stopped_retrying_continues',
                  '{{error}} Retrying continues where it stopped; nothing is created or sent twice. No participant has been told yet.',
                  {
                    error:
                      c.launch.error ?? tr('cycles.something_stopped_it', 'Something stopped it.'),
                  },
                )}
              </Alert>
            ) : null}
            {c.state === 'launching' ? (
              <Progress
                value={
                  c.launch.total === 0 ? 0 : Math.round((c.launch.created / c.launch.total) * 100)
                }
                label={tr(
                  'cycles.creating_reviews_of',
                  'Creating reviews · {{created}} of {{total}}',
                  { created: String(c.launch.created), total: String(c.launch.total) },
                )}
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
                        {tr('cycles.remind', 'Remind')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDialog('extend');
                        }}
                      >
                        {tr('cycles.extend_deadline', 'Extend deadline')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          run('ReleasePerformanceCycle', { personIds: chosen });
                        }}
                      >
                        {tr('cycles.release', 'Release')}
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
                title={tr(
                  'cycles.changes_are_in_the_activity_log',
                  'Changes are in the activity log',
                )}
                description={tr(
                  'cycles.who_changed_this_cycle_and_when',
                  'Who changed this cycle, and when, with the fields by name and never their values.',
                )}
                action={
                  <Button asChild variant="outline">
                    <a href={`/settings/activity?module=performance&subject=${id}`}>
                      {tr('cycles.open_this_cycles_activity', 'Open this cycle’s activity')}
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
  const who =
    people.length === 0
      ? 'everyone'
      : tr(
          'cycles.count_people',
          { one: '{{count}} person', other: '{{count}} people' },
          { count: people.length },
        );
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onDone}
      title={tr('cycles.extend_the_deadline_for', 'Extend the deadline for {{who}}?', { who })}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {tr('cycles.cancel', 'Cancel')}
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
            {people.length === 0
              ? tr('cycles.extend_for_everyone', 'Extend for everyone')
              : tr(
                  'cycles.extend_for',
                  { one: 'Extend for {{count}} person', other: 'Extend for {{count}} people' },
                  {
                    count: people.length,
                  },
                )}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field>
        <FieldLabel>{tr('cycles.activity', 'Activity')}</FieldLabel>
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
                  {tr('cycles.s_about_them', '{{kindLabel}}s about them', {
                    kindLabel: kindLabel(k),
                  })}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field required>
        <FieldLabel>{tr('cycles.new_deadline', 'New deadline')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('cycles.new_deadline', 'New deadline')}
            value={due === '' ? null : due}
            onChange={(date) => {
              setDue(date ?? '');
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>
          {tr('cycles.reason_kept_in_the_audit_log', 'Reason, kept in the audit log')}
        </FieldLabel>
        <Input
          value={reason}
          placeholder={tr('cycles.engineering_offsite', 'Engineering offsite')}
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
      title={tr('cycles.close', 'Close {{name}}?', { name })}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {tr('cycles.cancel', 'Cancel')}
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
            {tr('cycles.close_cycle', 'Close cycle')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <p>
        {tr(
          'cycles.closing_locks_every_review_each_one',
          'Closing locks every review. Each one ends in one of three states:',
        )}
      </p>
      <KeyValues
        layout="split"
        items={[
          {
            label: tr('cycles.submitted', 'Submitted'),
            value: (
              <Badge size="sm" tone="success">
                {tr('cycles.completed', 'Completed')}
              </Badge>
            ),
          },
          {
            label: tr(
              'cycles.unlocked_and_edited_once_submitted_before',
              'Unlocked and edited, once submitted before',
            ),
            value: tr(
              'cycles.completed_on_the_last_submitted_revision',
              'Completed, on the last submitted revision',
            ),
          },
          {
            label: tr('cycles.draft_never_submitted', 'Draft, never submitted'),
            value: <Badge size="sm">{tr('cycles.withdrawn', 'Withdrawn')}</Badge>,
          },
          {
            label: tr('cycles.not_started', 'Not started'),
            value: <Badge size="sm">{tr('cycles.abandoned', 'Abandoned')}</Badge>,
          },
        ]}
      />
      <Field>
        <FieldLabel>{tr('cycles.reviews_not_yet_released', 'Reviews not yet released')}</FieldLabel>
        <SegmentedControl value={release} onValueChange={setRelease}>
          <SegmentedControlItem value="now">
            {tr('cycles.release_them_now', 'Release them now')}
          </SegmentedControlItem>
          <SegmentedControlItem value="keep">
            {tr('cycles.keep_them_unreleased', 'Keep them unreleased')}
          </SegmentedControlItem>
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
      title={tr('cycles.export_reviews', 'Export reviews')}
      steps={[
        tr('cycles.whose_view', 'Whose view'),
        tr('cycles.what', 'What'),
        tr('cycles.as', 'As'),
      ]}
      step={step}
      onStep={setStep}
      finishLabel={tr('cycles.export', 'Export')}
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
        <RadioGroup
          aria-label={tr('cycles.whose_view', 'Whose view')}
          value={full}
          onValueChange={setFull}
        >
          <RadioCard
            value="subject"
            description={tr(
              'cycles.private_questions_and_confidential_names_removed',
              'Private questions and confidential names removed.',
            )}
          >
            {tr('cycles.as_each_subject_would_see_it', 'As each subject would see it')}
          </RadioCard>
          <RadioCard
            value="full"
            description={tr(
              'cycles.every_answer_and_name_logged_as',
              'Every answer and name. Logged as a sensitive read.',
            )}
          >
            {tr('cycles.full_for_hr', 'Full, for HR')}
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
        <RadioGroup aria-label={tr('cycles.as', 'As')} value={format} onValueChange={setFormat}>
          <RadioCard
            value="pdf"
            description={tr(
              'cycles.every_submitted_review_a_page_each',
              'Every submitted review, a page each, in one file.',
            )}
          >
            {tr('cycles.one_pdf', 'One PDF')}
          </RadioCard>
          <RadioCard
            value="zip"
            description={tr(
              'cycles.each_review_its_own_pdf_named',
              'Each review its own PDF, named for whose it is, with an index of them all.',
            )}
          >
            {tr('cycles.a_zip_of_pdfs', 'A zip of PDFs')}
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
      title={tr('cycles.add_someone_to_the_cycle', 'Add someone to the cycle')}
      description={tr(
        'cycles.their_reviews_are_created_from_the',
        'Their reviews are created from the cycle’s settings; with under a week left, they are due a week from today.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {tr('cycles.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={chosen === null}
            loading={act.pending}
            onClick={() => {
              act.run(
                'AddPerformanceParticipant',
                {
                  id,
                  input: { personId: chosen, reason: tr('cycles.late_joiner', 'Late joiner') },
                },
                onDone,
              );
            }}
          >
            {tr('cycles.add', 'Add')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <SearchField
        label={tr('cycles.search_people', 'Search people')}
        placeholder={tr('cycles.search_everyone', 'Search everyone')}
        value={q}
        onValueChange={setQ}
        onSearch={(v) => {
          void act.call('PerformanceDirectory', { q: v }).then((d) => {
            if (d.ok) setFound((d.data as { rows: typeof found }).rows);
          });
        }}
      />
      <RadioGroup
        aria-label={tr('cycles.who', 'Who')}
        value={chosen ?? ''}
        onValueChange={setChosen}
      >
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
      title={
        person?.name == null
          ? tr('cycles.remove_them_from_the_cycle', 'Remove them from the cycle?')
          : tr('cycles.remove_from_the_cycle_2', 'Remove {{value}} from the cycle?', {
              value: person.name,
            })
      }
      description={tr(
        'cycles.started_reviews_about_them_become_detached',
        'Started reviews about them become detached: kept for their authors, out of the cycle. Unstarted ones are cancelled.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            {tr('cycles.cancel', 'Cancel')}
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
            {tr('cycles.remove_2', 'Remove')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>{tr('cycles.reason', 'Reason')}</FieldLabel>
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
