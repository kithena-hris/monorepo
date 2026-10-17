import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  RadioCard,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  Choose,
  CycleBadge,
  Refusal,
  StepDialog,
  SwitchRow,
  To,
  day,
  kindLabel,
  plural,
  useAct,
  type Act,
} from './shared';
import type { ScreenProps } from './types';

/**
 * Automations (PRD §16; design PF16 v2): cycles made on a calendar or from an
 * event, "90 days after the start, twice", grouped a week at a time, each
 * created ahead of its start as a scheduled cycle HR can still change.
 */

type Trigger =
  | {
      readonly kind: 'calendar';
      readonly every: 'quarter' | 'half' | 'year';
      readonly startMonth: number;
      readonly leadDays: number;
    }
  | {
      readonly kind: 'event';
      readonly event: 'hired' | 'probation_end' | 'anniversary';
      readonly offsetDays: number;
      readonly repeatDays: number;
      readonly times: number;
      readonly group: 'week' | 'person';
      readonly leadDays: number;
    };

interface AutomationBody {
  readonly name: string;
  readonly trigger: Trigger;
  readonly activities: readonly string[];
  readonly templates: Readonly<Record<string, string>>;
  readonly dueDays: Readonly<Record<string, number>>;
  readonly skip: readonly string[];
  readonly paused: boolean;
}

export interface AutomationsData {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly trigger: Trigger;
    readonly label: string;
    readonly paused: boolean;
    readonly activities: readonly string[];
    readonly next: readonly {
      readonly key: string;
      readonly start: string;
      readonly createOn: string;
      readonly people: readonly string[] | null;
    }[];
    readonly created: number;
  }[];
  readonly overlaps: readonly {
    readonly automationId: string;
    readonly automation: string;
    readonly cycle: string;
    readonly people: number;
    readonly from: string;
  }[];
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: readonly string[];
  }[];
}

const KINDS = ['self', 'manager', 'peer', 'upward', 'goals'] as const;
const SKIP = [
  ['on_leave', 'On long leave'],
  ['in_review', 'Already in a cycle'],
  ['probation', 'On probation'],
] as const;

export function Automations(props: ScreenProps<AutomationsData>): JSX.Element {
  const act = useAct(props);
  const [creating, setCreating] = useState(props.search?.['new'] === '1');
  return (
    <Loaded load={props.load} what="automations">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Automations"
            description="Cycles that make themselves: every half, or a set time after someone starts. Each is created as a scheduled cycle you can still change."
            actions={
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  setCreating(true);
                }}
              >
                New automation
              </Button>
            }
          />
          <Refusal error={act.error} />
          {data.overlaps.length === 0 ? null : (
            <Alert tone="warning" title="Some people would be in two cycles at once">
              {data.overlaps
                .map(
                  (o) =>
                    `${o.automation} from ${day(o.from)} overlaps ${o.cycle} for ${plural(o.people, 'person', 'people')}`,
                )
                .join(' · ')}
            </Alert>
          )}
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.system aria-hidden />}
                  title="No automations"
                  description="Probation reviews, quarterly check-ins and half-yearly cycles can run on their own."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Automation</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Next</TableHead>
                      <TableHead>Made</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <To
                            href={`/performance/automations/${a.id}`}
                            onNavigate={props.onNavigate}
                          >
                            {a.name}
                          </To>
                          <span className="block text-xs text-fg-muted">
                            {a.activities.map(kindLabel).join(', ')}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{a.label}</TableCell>
                        <TableCell className="text-sm">
                          {a.next[0] === undefined
                            ? '—'
                            : `${day(a.next[0].start)}${a.next[0].people === null ? '' : ` · ${plural(a.next[0].people.length, 'person', 'people')}`}`}
                        </TableCell>
                        <TableCell className="text-sm">{plural(a.created, 'cycle')}</TableCell>
                        <TableCell>
                          <Badge size="sm" tone={a.paused ? 'neutral' : 'success'}>
                            {a.paused ? 'Paused' : 'On'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {creating ? (
            <AutomationDialog
              act={act}
              templates={data.templates}
              onClose={() => {
                setCreating(false);
                props.onFilter?.({ new: null });
              }}
            />
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

const sentence = (a: AutomationBody): string => {
  const t = a.trigger;
  const when =
    t.kind === 'calendar'
      ? `Every ${t.every}, starting in month ${String(t.startMonth)}`
      : `${String(t.offsetDays)} days after ${t.event === 'hired' ? 'someone starts' : t.event === 'probation_end' ? 'probation ends' : 'their anniversary'}${t.times > 1 ? `, then every ${String(t.repeatDays)} days, ${String(t.times)} times in all` : ''}${t.group === 'week' ? ', one cycle per week' : ''}`;
  return `${when}: ${a.activities.map((k) => kindLabel(k).toLowerCase()).join(', ')}${a.skip.length === 0 ? '' : `; leaves out people ${a.skip.map((s) => SKIP.find(([v]) => v === s)?.[1].toLowerCase() ?? s).join(', ')}`}.`;
};

/** PF16b v2: Schedule · Participants · Activities · Release · Preview. */
function AutomationDialog({
  act,
  templates,
  onClose,
  start,
  id,
}: {
  readonly act: Act;
  readonly templates: AutomationsData['templates'];
  readonly onClose: () => void;
  readonly start?: AutomationBody;
  readonly id?: string;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<AutomationBody>(
    start ?? {
      name: 'Probation reviews',
      trigger: {
        kind: 'event',
        event: 'hired',
        offsetDays: 90,
        repeatDays: 90,
        times: 1,
        group: 'week',
        leadDays: 7,
      },
      activities: ['self', 'manager'],
      templates: {},
      dueDays: { self: 7, manager: 14 },
      skip: [],
      paused: false,
    },
  );
  const [words, setWords] = useState('');
  const set = (patch: Partial<AutomationBody>): void => {
    setA({ ...a, ...patch });
  };
  const t = a.trigger;
  const event =
    t.kind === 'event'
      ? t
      : {
          kind: 'event' as const,
          event: 'hired' as const,
          offsetDays: 90,
          repeatDays: 90,
          times: 1,
          group: 'week' as const,
          leadDays: 7,
        };
  const calendar =
    t.kind === 'calendar'
      ? t
      : { kind: 'calendar' as const, every: 'half' as const, startMonth: 1, leadDays: 14 };
  return (
    <StepDialog
      open
      wide
      onClose={onClose}
      title={id === undefined ? 'New automation' : `Edit ${a.name}`}
      steps={['Schedule', 'Participants', 'Activities', 'Release', 'Preview']}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={a.name.trim() !== '' && a.activities.length > 0}
      finishLabel={id === undefined ? 'Turn on' : 'Save'}
      finish={() => {
        if (id === undefined) act.run('CreatePerformanceAutomation', { input: a }, onClose);
        else act.run('SavePerformanceAutomation', { id, input: a }, onClose);
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={a.name}
              onChange={(e) => {
                set({ name: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>Or say it in words</FieldLabel>
            <Textarea
              autoResize
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
              }}
              placeholder="A self and manager review 90 days after someone starts"
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={words.trim().length < 5}
            loading={act.pending}
            onClick={() => {
              void act
                .call('PerformanceAutomationInWords', { input: { text: words } })
                .then((d) => {
                  if (d.ok) setA({ ...a, ...(d.data as { draft: Partial<AutomationBody> }).draft });
                });
            }}
          >
            Fill in from words
          </Button>
          <RadioGroup
            aria-label="When"
            className="flex flex-col gap-2"
            value={t.kind}
            onValueChange={(v) => {
              set({ trigger: v === 'calendar' ? calendar : event });
            }}
          >
            <RadioCard value="event" description="Probation, anniversaries">
              After an event
            </RadioCard>
            <RadioCard value="calendar" description="Every quarter, half or year">
              On a calendar
            </RadioCard>
          </RadioGroup>
          {t.kind === 'event' ? (
            <div className="flex flex-col gap-4">
              <Choose
                label="After"
                value={t.event}
                options={[
                  ['hired', 'Someone starts'],
                  ['probation_end', 'Probation ends'],
                  ['anniversary', 'Their anniversary'],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, event: v as typeof t.event } });
                }}
              />
              <NumberField
                label="Days after"
                value={t.offsetDays}
                min={0}
                max={730}
                onChange={(v) => {
                  set({ trigger: { ...t, offsetDays: v ?? 0 } });
                }}
              />
              <NumberField
                label="Times in all"
                value={t.times}
                min={1}
                max={6}
                onChange={(v) => {
                  set({ trigger: { ...t, times: v ?? 1 } });
                }}
              />
              {t.times > 1 ? (
                <NumberField
                  label="Then every"
                  suffix="days"
                  value={t.repeatDays}
                  min={1}
                  max={730}
                  onChange={(v) => {
                    set({ trigger: { ...t, repeatDays: v ?? 90 } });
                  }}
                />
              ) : null}
              <Choose
                label="Group"
                value={t.group}
                options={[
                  ['week', 'One cycle per week'],
                  ['person', 'One cycle per person'],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, group: v === 'person' ? 'person' : 'week' } });
                }}
              />
              <NumberField
                label="Create it ahead by"
                suffix="days"
                value={t.leadDays}
                min={0}
                max={90}
                onChange={(v) => {
                  set({ trigger: { ...t, leadDays: v ?? 0 } });
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Choose
                label="Every"
                value={t.every}
                options={[
                  ['quarter', 'Quarter'],
                  ['half', 'Half year'],
                  ['year', 'Year'],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, every: v as typeof t.every } });
                }}
              />
              <NumberField
                label="First in month"
                value={t.startMonth}
                min={1}
                max={12}
                onChange={(v) => {
                  set({ trigger: { ...t, startMonth: v ?? 1 } });
                }}
              />
              <NumberField
                label="Create it ahead by"
                suffix="days"
                value={t.leadDays}
                min={0}
                max={90}
                onChange={(v) => {
                  set({ trigger: { ...t, leadDays: v ?? 0 } });
                }}
              />
            </div>
          )}
        </div>
      ) : null}
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {t.kind === 'event'
              ? 'Everyone the event happens to.'
              : 'Everyone at the company on the day it is created.'}
          </p>
          <Field>
            <FieldLabel>Leave out people who are</FieldLabel>
            <ChipRow aria-label="Leave out">
              {SKIP.map(([v, l]) => (
                <Chip
                  key={v}
                  selected={a.skip.includes(v)}
                  onClick={() => {
                    set({
                      skip: a.skip.includes(v) ? a.skip.filter((x) => x !== v) : [...a.skip, v],
                    });
                  }}
                >
                  {l}
                </Chip>
              ))}
            </ChipRow>
          </Field>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          {KINDS.map((k) => {
            const on = a.activities.includes(k);
            const forms = templates.filter((x) => x.purpose.includes(k));
            return (
              <Card key={k}>
                <CardContent className="flex flex-col gap-2">
                  <SwitchRow
                    label={kindLabel(k)}
                    checked={on}
                    onChange={(v) => {
                      set({
                        activities: v ? [...a.activities, k] : a.activities.filter((x) => x !== k),
                      });
                    }}
                  />
                  {on && k !== 'goals' ? (
                    <div className="flex flex-col gap-4">
                      <Choose
                        label="Form"
                        value={a.templates[k] ?? 'default'}
                        options={[
                          ['default', 'The company default'],
                          ...forms.map((f) => [f.id, f.name] as const),
                        ]}
                        onChange={(v) => {
                          set({
                            templates:
                              v === 'default'
                                ? Object.fromEntries(
                                    Object.entries(a.templates).filter(([x]) => x !== k),
                                  )
                                : { ...a.templates, [k]: v },
                          });
                        }}
                      />
                      <NumberField
                        label="Due after the start"
                        suffix="days"
                        value={a.dueDays[k] ?? 14}
                        min={0}
                        max={365}
                        onChange={(v) => {
                          set({ dueDays: { ...a.dueDays, [k]: v ?? 14 } });
                        }}
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
      {step === 3 ? (
        <p className="text-sm">
          Each cycle is released the way Settings › Performance › Release says, and HR can change
          any one of them before it launches.
        </p>
      ) : null}
      {step === 4 ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">{a.name}</p>
          <p className="text-sm">{sentence(a)}</p>
          <SwitchRow
            label="Start paused"
            checked={a.paused}
            onChange={(v) => {
              set({ paused: v });
            }}
          />
        </div>
      ) : null}
    </StepDialog>
  );
}

export interface AutomationData {
  readonly automation: AutomationBody & {
    readonly id: string;
    readonly label: string;
    readonly by: string;
    readonly at: string;
  };
  readonly rows: readonly {
    readonly key: string;
    readonly start: string;
    readonly cycle: string | null;
    readonly cycleId: string | null;
    readonly state: string | null;
    readonly createOn?: string;
    readonly people: readonly string[];
  }[];
}

export function Automation(props: ScreenProps<AutomationData>): JSX.Element {
  const act = useAct(props);
  const [editing, setEditing] = useState(false);
  return (
    <Loaded load={props.load} what="the automation">
      {(data) => {
        const a = data.automation;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={a.name}
              description={sentence(a)}
              actions={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    loading={act.pending}
                    onClick={() => {
                      act.run('PausePerformanceAutomation', {
                        id: a.id,
                        input: { paused: !a.paused },
                      });
                    }}
                  >
                    {a.paused ? 'Turn on' : 'Pause'}
                  </Button>
                  <Button
                    variant="ghost"
                    loading={act.pending}
                    onClick={() => {
                      act.run('DeletePerformanceAutomation', { id: a.id }, () => {
                        props.onNavigate?.('/performance/automations');
                      });
                    }}
                  >
                    Delete
                  </Button>
                </>
              }
            />
            <Refusal error={act.error} />
            <Card>
              <CardContent className="overflow-x-auto">
                {data.rows.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nothing due in the next six months.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Starts</TableHead>
                        <TableHead>Cycle</TableHead>
                        <TableHead>People</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="text-sm">{day(r.start)}</TableCell>
                          <TableCell>
                            {r.cycleId === null ? (
                              <span className="text-sm text-fg-muted">{`Created on ${day(r.createOn)}`}</span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <To
                                  href={`/performance/cycles/${r.cycleId}`}
                                  onNavigate={props.onNavigate}
                                >
                                  {r.cycle ?? 'Cycle'}
                                </To>
                                {r.state === null ? null : <CycleBadge state={r.state} />}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.people.length === 0
                              ? '—'
                              : r.people.slice(0, 4).join(', ') +
                                (r.people.length > 4
                                  ? ` and ${String(r.people.length - 4)} more`
                                  : '')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            {editing ? (
              <AutomationDialog
                act={act}
                templates={[]}
                id={a.id}
                start={a}
                onClose={() => {
                  setEditing(false);
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}
