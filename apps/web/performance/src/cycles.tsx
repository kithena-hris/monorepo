import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Chip,
  ChipRow,
  Combobox,
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
  Input,
  KeyValues,
  NumberField,
  PageHeader,
  Pagination,
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
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TertiaryNav,
  TimePicker,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  CycleBadge,
  Live,
  Modal,
  Person,
  PersonPicker,
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
                    loading={act.pending && !copying}
                    onClick={() => {
                      create('New cycle', null);
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
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.review aria-hidden />}
                  title="No cycles here"
                  description={
                    data.hr ? 'Start one with New cycle.' : 'Cycles you take part in show here.'
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cycle</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Who</TableHead>
                        <TableHead>Activities</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>Progress</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
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
                            <span className="block text-xs text-fg-muted">
                              {c.owner === 'Automation'
                                ? 'From an automation'
                                : `Owner: ${c.owner}`}
                            </span>
                          </TableCell>
                          <TableCell>
                            <CycleBadge state={c.state} />
                          </TableCell>
                          <TableCell className="text-sm text-fg-muted">{c.who}</TableCell>
                          <TableCell className="text-sm">
                            {c.kinds.map(kindLabel).join(', ')}
                          </TableCell>
                          <TableCell className="text-sm text-fg-muted">{c.dates}</TableCell>
                          <TableCell className="min-w-28">
                            {['in_progress', 'closed', 'archived'].includes(c.state) ? (
                              <Progress
                                value={c.progress}
                                label={`${c.name}: ${String(c.progress)}%`}
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
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
}

interface CycleSetup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly start: { readonly date: string; readonly time: string; readonly zone: string };
  readonly goals: 'none' | 'context' | 'scored';
  readonly participants: {
    readonly filter: readonly { readonly field: string; readonly value: string }[];
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
      readonly manager: string | null;
      readonly note: string | null;
    }[];
    readonly noLongerMatches: readonly {
      readonly personId: string;
      readonly name: string;
      readonly title: string;
    }[];
  };
  readonly fields: {
    readonly departments: readonly string[];
    readonly statuses: readonly string[];
  };
  readonly due: Readonly<Record<string, string>>;
  readonly checks: readonly {
    readonly level: 'block' | 'warn' | 'ok';
    readonly title: string;
    readonly detail: string;
  }[];
  readonly action: 'launch' | 'schedule' | 'past';
}

/** Four steps, each one thing: when, who, which reviews, and how it ends. */
const STEPS = ['Basics', 'People', 'Reviews', 'Launch'];
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
        {step === 1 ? <Participants c={c} data={data} save={save} act={act} /> : null}
        {step === 2 ? <Reviews c={c} data={data} save={save} activity={activity} /> : null}
        {step === 3 ? <Launch c={c} data={data} save={save} /> : null}
      </StepDialog>
    </div>
  );
}

function Basics({
  c,
  save,
  action,
}: {
  readonly c: CycleSetup;
  readonly save: (p: Partial<CycleSetup>) => void;
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

/** The filter's departments, as many as wanted, and whether people on leave are in. */
function Participants({
  c,
  data,
  save,
  act,
}: {
  readonly c: CycleSetup;
  readonly data: SetupData;
  readonly save: (p: Partial<CycleSetup>) => void;
  readonly act: Act;
}): JSX.Element {
  const [excluding, setExcluding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState<readonly string[]>([]);
  const [chat, setChat] = useState('');
  const [proposal, setProposal] = useState<{
    filter: { field: string; value: string }[];
    summary: string[];
  } | null>(null);
  const p = data.participants;
  const filter = c.participants.filter;
  const setFilter = (next: readonly { field: string; value: string }[]): void => {
    save({ participants: { ...c.participants, filter: next } });
  };
  const departments = filter.filter((f) => f.field === 'department').map((f) => f.value);
  const onLeave = filter.some((f) => f.field === 'status' && f.value === 'on_leave');
  // Anything else the filter holds (set in words, or before) is kept as it was.
  const others = filter.filter((f) => f.field !== 'department' && f.field !== 'status');
  const statuses = (leave: boolean) => [
    { field: 'status', value: 'active' },
    ...(leave ? [{ field: 'status', value: 'on_leave' }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Departments</FieldLabel>
        {data.fields.departments.length === 0 ? (
          <FieldDescription>
            No departments yet. Everyone active is in; add people by name below.
          </FieldDescription>
        ) : (
          <FieldControl>
            <Combobox
              label="Departments"
              multiple
              chips
              clearable
              placeholder="Every department"
              searchPlaceholder="Find a department"
              options={data.fields.departments.map((d) => ({ value: d, label: d }))}
              value={departments}
              onChange={(v) => {
                const chosen = Array.isArray(v) ? v : v === null ? [] : [v];
                setFilter([
                  ...chosen.map((value) => ({ field: 'department', value: String(value) })),
                  ...statuses(onLeave),
                  ...others,
                ]);
              }}
            />
          </FieldControl>
        )}
      </Field>
      <SwitchRow
        label="Include people on leave"
        hint="Off: only people working now are reviewed."
        checked={onLeave}
        onChange={(on) => {
          setFilter([
            ...departments.map((value) => ({ field: 'department', value })),
            ...statuses(on),
            ...others,
          ]);
        }}
      />
      <Field>
        <FieldLabel>Add someone by name</FieldLabel>
        <PersonPicker
          act={act}
          label="Add someone by name"
          value={adding}
          onChange={(ids) => {
            setAdding([]);
            const id = ids[0];
            if (id === undefined || c.participants.include.some((x) => x.personId === id)) return;
            save({
              participants: {
                ...c.participants,
                include: [
                  ...c.participants.include,
                  { personId: id, reason: null, by: 'You', at: new Date().toISOString() },
                ],
                exclude: c.participants.exclude.filter((x) => x.personId !== id),
              },
            });
          }}
        />
      </Field>
      <Card>
        <CardHeader>
          <CardTitle level={3}>{plural(p.count, 'person', 'people')}</CardTitle>
          <p className="text-sm text-fg-muted">{`${String(p.fromFilter)} from the filter, ${String(p.included)} added by name, ${String(p.excluded)} left out`}</p>
        </CardHeader>
        <CardContent className="max-h-80 overflow-auto">
          {p.rows.length === 0 ? (
            <EmptyState
              title="Nobody yet"
              description="Choose a department, or add people by name."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>
                    <span className="sr-only">Leave out</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.rows.map((r) => (
                  <TableRow key={r.personId}>
                    <TableCell>
                      <Person name={r.name} sub={r.title} />
                    </TableCell>
                    <TableCell className="text-sm text-fg-muted">
                      {r.manager ?? 'No manager'}
                    </TableCell>
                    <TableCell>
                      {r.note === null ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setExcluding(r.personId);
                          }}
                        >
                          Leave out
                        </Button>
                      ) : (
                        <Badge
                          size="sm"
                          tone={r.note.startsWith('Excluded') ? 'neutral' : 'accent'}
                        >
                          {r.note}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={3}>Describe who, in words</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel>Who should be in</FieldLabel>
              <Input
                value={chat}
                placeholder="Product design and engineering, without anyone on leave"
                onChange={(e) => {
                  setChat(e.target.value);
                }}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              startIcon={<icons.assistant aria-hidden />}
              disabled={chat.trim().length < 3}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'PerformanceParticipantsInWords',
                  { id: c.id, input: { text: chat } },
                  (d) => {
                    setProposal(d as typeof proposal);
                  },
                );
              }}
            >
              Propose the change
            </Button>
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
                        setFilter(proposal.filter);
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
          </div>
        </CardContent>
      </Card>
      <SwitchRow
        label="Keep in step"
        hint="People who start matching are added; people who stop matching are listed for you to decide."
        checked={c.participants.keepInStep}
        onChange={(on) => {
          save({ participants: { ...c.participants, keepInStep: on } });
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
                save({
                  participants: {
                    ...c.participants,
                    exclude: [
                      ...c.participants.exclude,
                      { personId: excluding, reason, by: 'You', at: new Date().toISOString() },
                    ],
                    include: c.participants.include.filter((x) => x.personId !== excluding),
                  },
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
  const rules = c.reminders.rules;
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
                    label={`Due, days after ${d.from === 'nominations' ? 'nominations close' : 'the start'}`}
                    hint={`Works out to ${day(data.due[k])}`}
                    value={d.days ?? 14}
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
                        label="Nominations due, days after the start"
                        hint={`Works out to ${day(data.due['nominations'])}`}
                        value={c.nominations.days ?? 3}
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
      <Card>
        <CardHeader>
          <CardTitle level={3}>Reminders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <ChipRow aria-label="When">
              {REMINDERS.map(([v, l]) => (
                <Chip
                  key={v}
                  selected={rules.includes(v)}
                  onClick={() => {
                    save({
                      reminders: {
                        ...c.reminders,
                        rules: rules.includes(v) ? rules.filter((x) => x !== v) : [...rules, v],
                      },
                    });
                  }}
                >
                  {l}
                </Chip>
              ))}
            </ChipRow>
            <SwitchRow label="Inbox" hint="Always" checked locked="Always on" />
            <SwitchRow
              label="Email"
              hint="By each person’s preference"
              checked={c.reminders.email}
              onChange={(on) => {
                save({ reminders: { ...c.reminders, email: on } });
              }}
            />
            <SwitchRow
              label="Chat app"
              hint="By each person’s preference, when connected"
              checked={c.reminders.chat}
              onChange={(on) => {
                save({ reminders: { ...c.reminders, chat: on } });
              }}
            />
            <p className="text-sm text-fg-muted">A review’s reminders stop once it is submitted.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const NAMES = [
  ['hidden', 'Hidden from the subject'],
  ['shown', 'Shown to the subject'],
  ['writer', 'The writer chooses'],
] as const;

/** How it ends (release), who sees what, and what stops a launch. */
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
    <div className="flex flex-col gap-4">
      {data.checks.map((i) => (
        <Alert
          key={`${i.level}-${i.title}`}
          tone={i.level === 'block' ? 'danger' : i.level === 'warn' ? 'warning' : 'success'}
          title={i.title}
        >
          {i.detail}
        </Alert>
      ))}
      <p className="text-sm text-fg-muted">
        {blocks === 0
          ? 'Nothing stops this cycle. Warnings don’t.'
          : `${plural(blocks, 'issue')} ${blocks === 1 ? 'stops' : 'stop'} it. Warnings don’t.`}
      </p>
      <Card>
        <CardContent>
          <KeyValues
            layout="split"
            items={[
              { label: 'People', value: plural(data.participants.count, 'person', 'people') },
              {
                label: 'Reviews',
                value:
                  KINDS.filter((k) => k !== 'goals' && c.activities[k].on)
                    .map(kindLabel)
                    .join(', ') || 'None',
              },
              { label: 'Starts', value: `${day(c.start.date)}, ${c.start.time} ${c.start.zone}` },
            ]}
          />
        </CardContent>
      </Card>
      <Field>
        <FieldLabel>The subject sees their reviews</FieldLabel>
        <RadioGroup
          aria-label="Release"
          className="flex flex-col gap-2"
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
      <Card>
        <CardHeader>
          <CardTitle level={3}>Names and what the subject can do</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {names('Peer reviews: the writers’ names', v.peerNames, 'peerNames')}
            {names('Upward reviews: the writers’ names', v.upwardNames, 'upwardNames')}
            <p className="text-sm text-fg-muted">
              The subject’s manager and HR always see who wrote what.
            </p>
            <SwitchRow
              label="Ask for an acknowledgement"
              hint="“I’ve read this” is not agreement."
              checked={v.acknowledge}
              onChange={(on) => {
                set({ acknowledge: on });
              }}
            />
            <SwitchRow
              label="Let the subject comment"
              hint="Shown to the manager and HR"
              checked={v.subjectComment}
              onChange={(on) => {
                set({ subjectComment: on });
              }}
            />
            <SwitchRow
              label="Share the peer summary"
              hint="Peer answers, without names"
              checked={v.peerSummary}
              onChange={(on) => {
                set({ peerSummary: on });
              }}
            />
            <NumberField
              label="Response minimum"
              hint="Confidential answers show only once this many are in."
              value={v.minimum}
              min={1}
              max={20}
              onChange={(n) => {
                if (n !== null) set({ minimum: n });
              }}
            />
          </div>
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
  readonly manager: string | null;
  readonly self: string;
  readonly peers: string;
  readonly upward: string;
  readonly managerReview: string;
  readonly managerReviewId: string | null;
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
    readonly total: number;
    readonly due: string | null;
  }[];
  readonly released: number;
  readonly overdue: number;
  readonly rows: readonly OverviewRow[];
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
  };
  readonly hr: boolean;
}

type Dialog = 'extend' | 'close' | 'export' | 'add' | 'remove' | null;

/** PF5: live tiles and the table, bulk actions, and the changes after launch. */
export function Overview(props: ScreenProps<OverviewData>): JSX.Element {
  const act = useAct(props);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
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
                  onSelect={(t) => {
                    props.onFilter?.({ tab: t === 'overview' ? null : t, page: null });
                  }}
                  items={[
                    { id: 'overview', label: 'Overview' },
                    ...(c.kinds.includes('peer')
                      ? [{ id: 'nominations', label: 'Nominations' }]
                      : []),
                    ...(data.hr
                      ? [
                          { id: 'changes', label: 'Changes' },
                          { id: 'settings', label: 'Settings' },
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
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {data.tiles.map((t) => (
                    <Stat
                      key={t.kind}
                      label={`${kindLabel(t.kind)}s`}
                      value={String(t.submitted)}
                      description={`of ${String(t.total)}${t.due === null ? '' : ` · due ${day(t.due)}`}`}
                    />
                  ))}
                  <Stat
                    label="Released"
                    value={String(data.released)}
                    description="Manager reviews"
                  />
                  <Stat
                    label="Overdue"
                    value={String(data.overdue)}
                    {...(data.overdue > 0 ? { sentiment: 'negative' as const } : {})}
                  />
                </div>
                <Card>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Search
                        label="Search people"
                        placeholder={`Search ${String(data.total)} people`}
                        initial={props.search?.['q'] ?? ''}
                        onSearch={(q) => {
                          props.onFilter?.({ q: q === '' ? null : q, page: null });
                        }}
                      />
                      <span className="ml-auto text-sm text-fg-muted">{`Showing ${String(Math.min(data.total, (data.page - 1) * data.size + 1))}–${String(Math.min(data.total, data.page * data.size))} of ${String(data.total)}`}</span>
                    </div>
                    {data.rows.length === 0 ? (
                      <EmptyState
                        icon={<icons.people aria-hidden />}
                        title="Nobody here yet"
                        description={
                          c.state === 'draft'
                            ? 'Participants are fixed when the cycle launches.'
                            : 'No one matches the search.'
                        }
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {data.hr ? (
                                <TableHead>
                                  <Checkbox
                                    aria-label="Select everyone on this page"
                                    checked={
                                      selected.size > 0 && selected.size === data.rows.length
                                    }
                                    onCheckedChange={(on) => {
                                      setSelected(
                                        on === true
                                          ? new Set(data.rows.map((r) => r.personId))
                                          : new Set(),
                                      );
                                    }}
                                  />
                                </TableHead>
                              ) : null}
                              <TableHead>Person</TableHead>
                              <TableHead>Manager</TableHead>
                              {c.kinds.includes('self') ? <TableHead>Self</TableHead> : null}
                              {c.kinds.includes('peer') ? <TableHead>Peers</TableHead> : null}
                              {c.kinds.includes('upward') ? <TableHead>Upward</TableHead> : null}
                              {c.kinds.includes('manager') ? (
                                <TableHead>Manager review</TableHead>
                              ) : null}
                              <TableHead>Release</TableHead>
                              {data.hr ? <TableHead>Score</TableHead> : null}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.rows.map((r) => (
                              <TableRow key={r.personId}>
                                {data.hr ? (
                                  <TableCell>
                                    <Checkbox
                                      aria-label={`Select ${r.name}`}
                                      checked={selected.has(r.personId)}
                                      onCheckedChange={(on) => {
                                        const next = new Set(selected);
                                        if (on === true) next.add(r.personId);
                                        else next.delete(r.personId);
                                        setSelected(next);
                                      }}
                                    />
                                  </TableCell>
                                ) : null}
                                <TableCell>
                                  <To
                                    href={`/performance/cycles/${id}/about/${r.personId}`}
                                    onNavigate={props.onNavigate}
                                  >
                                    {r.name}
                                  </To>
                                  {data.away?.[r.personId] === undefined ? null : (
                                    <Badge size="sm" tone="neutral" className="ml-2">
                                      Away until {data.away[r.personId]}
                                    </Badge>
                                  )}
                                  <span className="block text-xs text-fg-muted">{r.title}</span>
                                </TableCell>
                                <TableCell className="text-sm text-fg-muted">
                                  {r.manager ?? 'No manager'}
                                </TableCell>
                                {c.kinds.includes('self') ? (
                                  <TableCell>
                                    <ReviewBadge state={r.self} />
                                  </TableCell>
                                ) : null}
                                {c.kinds.includes('peer') ? (
                                  <TableCell className="text-sm">{r.peers}</TableCell>
                                ) : null}
                                {c.kinds.includes('upward') ? (
                                  <TableCell className="text-sm">{r.upward}</TableCell>
                                ) : null}
                                {c.kinds.includes('manager') ? (
                                  <TableCell>
                                    <ReviewBadge state={r.managerReview} />
                                  </TableCell>
                                ) : null}
                                <TableCell className="text-sm text-fg-muted">{r.release}</TableCell>
                                {data.hr ? (
                                  <TableCell className="tabular-nums">{score(r.score)}</TableCell>
                                ) : null}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    {data.total > data.size ? (
                      <Pagination
                        page={data.page}
                        pageCount={Math.ceil(data.total / data.size)}
                        totalItems={data.total}
                        pageSize={data.size}
                        onPageChange={(p) => {
                          props.onFilter?.({ page: p === 1 ? null : String(p) });
                        }}
                      />
                    ) : null}
                  </CardContent>
                </Card>
                {selected.size > 0 ? (
                  <div
                    role="toolbar"
                    aria-label="Selected people"
                    className="sticky bottom-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-inverse p-3 text-fg-inverse shadow-lg"
                  >
                    <span className="mr-auto font-semibold">{`${String(selected.size)} selected`}</span>
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
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={selected.size !== 1}
                      onClick={() => {
                        setDialog('remove');
                      }}
                    >
                      Remove from cycle
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {tab === 'nominations' ? <Nominations data={data} act={act} id={id} /> : null}
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
            {tab === 'settings' ? (
              <Card>
                <CardContent>
                  <KeyValues
                    layout="split"
                    items={[
                      {
                        label: 'Response minimum',
                        value: String(data.settings.visibility.minimum),
                      },
                      { label: 'Release', value: words(data.settings.visibility.release.mode) },
                      {
                        label: 'Peers',
                        value: data.settings.peer.all
                          ? `All peers, up to ${String(data.settings.peer.max)}`
                          : `Nominated, ${String(data.settings.peer.min)} to ${String(data.settings.peer.max)}`,
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            ) : null}
            {dialog === 'extend' ? (
              <ExtendDialog
                kinds={c.kinds}
                people={chosen}
                act={act}
                onDone={() => {
                  setDialog(null);
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
function Nominations({
  data,
  act,
  id,
}: {
  readonly data: OverviewData;
  readonly act: Act;
  readonly id: string;
}): JSX.Element {
  const late = data.nominations.filter((n) => n.state === 'Not nominated').length;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        {data.hr && late > 0 ? (
          <div>
            <Button
              size="sm"
              variant="secondary"
              startIcon={<icons.notifications aria-hidden />}
              loading={act.pending}
              onClick={() => {
                act.run('RemindPerformanceCycle', { id, input: { personIds: [] } });
              }}
            >
              {`Remind ${String(late)} who haven’t nominated`}
            </Button>
          </div>
        ) : null}
        {data.nominations.length === 0 ? (
          <EmptyState title="No nominations" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Peers</TableHead>
                <TableHead>{`${String(data.bounds.min)} to ${String(data.bounds.max)}`}</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.nominations.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <Person name={n.subject} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {n.peers.length === 0 ? '—' : n.peers.join(', ')}
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" tone={n.count >= data.bounds.min ? 'success' : 'danger'}>
                      {String(n.count)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      size="sm"
                      tone={
                        n.state === 'Approved'
                          ? 'success'
                          : n.state.startsWith('Waiting')
                            ? 'warning'
                            : n.state === 'Not nominated'
                              ? 'danger'
                              : 'neutral'
                      }
                    >
                      {n.state}
                    </Badge>
                    {n.late ? <span className="ml-2 text-xs text-danger-fg">Late</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ExtendDialog({
  kinds,
  people,
  act,
  onDone,
  id,
}: {
  readonly kinds: readonly string[];
  readonly people: readonly string[];
  readonly act: Act;
  readonly onDone: () => void;
  readonly id: string;
}): JSX.Element {
  const [kind, setKind] = useState(kinds.find((k) => k !== 'goals') ?? 'self');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onDone}
      title={`Extend the deadline for ${plural(people.length, 'person', 'people')}?`}
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
            {`Extend for ${String(people.length)}`}
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
