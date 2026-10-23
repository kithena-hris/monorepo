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
import { t as tr } from './i18n';

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
  ['on_leave', tr('automations.on_long_leave', 'On long leave')],
  ['in_review', tr('automations.already_in_a_cycle', 'Already in a cycle')],
  ['probation', tr('automations.on_probation', 'On probation')],
] as const;

export function Automations(props: ScreenProps<AutomationsData>): JSX.Element {
  const act = useAct(props);
  const [creating, setCreating] = useState(props.search?.['new'] === '1');
  return (
    <Loaded load={props.load} what="automations">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('automations.automations', 'Automations')}
            description={tr(
              'automations.cycles_that_make_themselves_every_half',
              'Cycles that make themselves: every half, or a set time after someone starts. Each is created as a scheduled cycle you can still change.',
            )}
            actions={
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  setCreating(true);
                }}
              >
                {tr('automations.new_automation', 'New automation')}
              </Button>
            }
          />
          <Refusal error={act.error} />
          {data.overlaps.length === 0 ? null : (
            <Alert
              tone="warning"
              title={tr(
                'automations.some_people_would_be_in_two',
                'Some people would be in two cycles at once',
              )}
            >
              {data.overlaps
                .map((o) =>
                  tr(
                    'automations.from_overlaps_for',
                    '{{automation}} from {{from}} overlaps {{cycle}} for {{people}}',
                    {
                      automation: o.automation,
                      from: day(o.from),
                      cycle: o.cycle,
                      people: plural(o.people, 'person', 'people'),
                    },
                  ),
                )
                .join(' · ')}
            </Alert>
          )}
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.system aria-hidden />}
                  title={tr('automations.no_automations', 'No automations')}
                  description={tr(
                    'automations.probation_reviews_quarterly_check_ins_and',
                    'Probation reviews, quarterly check-ins and half-yearly cycles can run on their own.',
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr('automations.automation', 'Automation')}</TableHead>
                      <TableHead>{tr('automations.rule', 'Rule')}</TableHead>
                      <TableHead>{tr('automations.next', 'Next')}</TableHead>
                      <TableHead>{tr('automations.made', 'Made')}</TableHead>
                      <TableHead>{tr('automations.state', 'State')}</TableHead>
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
                            {a.paused
                              ? tr('automations.paused', 'Paused')
                              : tr('automations.on', 'On')}
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
      ? tr(
          'automations.every_starting_in_month',
          'Every {{every}}, starting in month {{startMonth}}',
          { every: t.every, startMonth: String(t.startMonth) },
        )
      : tr('automations.days_after', '{{offsetDays}} days after {{value}}{{value2}}{{value3}}', {
          offsetDays: String(t.offsetDays),
          value:
            t.event === 'hired'
              ? 'someone starts'
              : t.event === 'probation_end'
                ? 'probation ends'
                : 'their anniversary',
          value2:
            t.times > 1
              ? tr(
                  'automations.then_every_days_times_in_all',
                  ', then every {{repeatDays}} days, {{times}} times in all',
                  { repeatDays: String(t.repeatDays), times: String(t.times) },
                )
              : '',
          value3:
            t.group === 'week' ? tr('automations.one_cycle_per_week_suffix', ', one cycle per week') : '',
        });
  return tr('automations.text', '{{when}}: {{join}}{{value}}.', {
    when,
    join: a.activities.map((k) => kindLabel(k).toLowerCase()).join(', '),
    value:
      a.skip.length === 0
        ? ''
        : `; leaves out people ${a.skip.map((s) => SKIP.find(([v]) => v === s)?.[1].toLowerCase() ?? s).join(', ')}`,
  });
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
      title={
        id === undefined
          ? tr('automations.new_automation', 'New automation')
          : tr('automations.edit', 'Edit {{name}}', { name: a.name })
      }
      steps={[
        tr('automations.schedule', 'Schedule'),
        tr('automations.participants', 'Participants'),
        tr('automations.activities', 'Activities'),
        tr('automations.release', 'Release'),
        tr('automations.preview', 'Preview'),
      ]}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={a.name.trim() !== '' && a.activities.length > 0}
      finishLabel={
        id === undefined ? tr('automations.turn_on', 'Turn on') : tr('automations.save', 'Save')
      }
      finish={() => {
        if (id === undefined) act.run('CreatePerformanceAutomation', { input: a }, onClose);
        else act.run('SavePerformanceAutomation', { id, input: a }, onClose);
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>{tr('automations.name', 'Name')}</FieldLabel>
            <Input
              value={a.name}
              onChange={(e) => {
                set({ name: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{tr('automations.or_say_it_in_words', 'Or say it in words')}</FieldLabel>
            <Textarea
              autoResize
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
              }}
              placeholder={tr(
                'automations.a_self_and_manager_review_90',
                'A self and manager review 90 days after someone starts',
              )}
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
            {tr('automations.fill_in_from_words', 'Fill in from words')}
          </Button>
          <RadioGroup
            aria-label={tr('automations.when', 'When')}
            className="flex flex-col gap-2"
            value={t.kind}
            onValueChange={(v) => {
              set({ trigger: v === 'calendar' ? calendar : event });
            }}
          >
            <RadioCard
              value="event"
              description={tr('automations.probation_anniversaries', 'Probation, anniversaries')}
            >
              {tr('automations.after_an_event', 'After an event')}
            </RadioCard>
            <RadioCard
              value="calendar"
              description={tr(
                'automations.every_quarter_half_or_year',
                'Every quarter, half or year',
              )}
            >
              {tr('automations.on_a_calendar', 'On a calendar')}
            </RadioCard>
          </RadioGroup>
          {t.kind === 'event' ? (
            <div className="flex flex-col gap-4">
              <Choose
                label={tr('automations.after', 'After')}
                value={t.event}
                options={[
                  ['hired', tr('automations.someone_starts', 'Someone starts')],
                  ['probation_end', tr('automations.probation_ends', 'Probation ends')],
                  ['anniversary', tr('automations.their_anniversary', 'Their anniversary')],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, event: v as typeof t.event } });
                }}
              />
              <NumberField
                label={tr('automations.days_after_2', 'Days after')}
                value={t.offsetDays}
                min={0}
                max={730}
                onChange={(v) => {
                  set({ trigger: { ...t, offsetDays: v ?? 0 } });
                }}
              />
              <NumberField
                label={tr('automations.times_in_all', 'Times in all')}
                value={t.times}
                min={1}
                max={6}
                onChange={(v) => {
                  set({ trigger: { ...t, times: v ?? 1 } });
                }}
              />
              {t.times > 1 ? (
                <NumberField
                  label={tr('automations.then_every', 'Then every')}
                  suffix={tr('automations.days', 'days')}
                  value={t.repeatDays}
                  min={1}
                  max={730}
                  onChange={(v) => {
                    set({ trigger: { ...t, repeatDays: v ?? 90 } });
                  }}
                />
              ) : null}
              <Choose
                label={tr('automations.group', 'Group')}
                value={t.group}
                options={[
                  ['week', tr('automations.one_cycle_per_week', 'One cycle per week')],
                  ['person', tr('automations.one_cycle_per_person', 'One cycle per person')],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, group: v === 'person' ? 'person' : 'week' } });
                }}
              />
              <NumberField
                label={tr('automations.create_it_ahead_by', 'Create it ahead by')}
                suffix={tr('automations.days', 'days')}
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
                label={tr('automations.every', 'Every')}
                value={t.every}
                options={[
                  ['quarter', tr('automations.quarter', 'Quarter')],
                  ['half', tr('automations.half_year', 'Half year')],
                  ['year', tr('automations.year', 'Year')],
                ]}
                onChange={(v) => {
                  set({ trigger: { ...t, every: v as typeof t.every } });
                }}
              />
              <NumberField
                label={tr('automations.first_in_month', 'First in month')}
                value={t.startMonth}
                min={1}
                max={12}
                onChange={(v) => {
                  set({ trigger: { ...t, startMonth: v ?? 1 } });
                }}
              />
              <NumberField
                label={tr('automations.create_it_ahead_by', 'Create it ahead by')}
                suffix={tr('automations.days', 'days')}
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
              ? tr('automations.everyone_the_event_happens_to', 'Everyone the event happens to.')
              : tr(
                  'automations.everyone_at_the_company_on_the',
                  'Everyone at the company on the day it is created.',
                )}
          </p>
          <Field>
            <FieldLabel>
              {tr('automations.leave_out_people_who_are', 'Leave out people who are')}
            </FieldLabel>
            <ChipRow aria-label={tr('automations.leave_out', 'Leave out')}>
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
                        label={tr('automations.form', 'Form')}
                        value={a.templates[k] ?? 'default'}
                        options={[
                          ['default', tr('automations.the_company_default', 'The company default')],
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
                        label={tr('automations.due_after_the_start', 'Due after the start')}
                        suffix={tr('automations.days', 'days')}
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
          {tr(
            'automations.each_cycle_is_released_the_way',
            'Each cycle is released the way Settings › Performance › Release says, and HR can change any one of them before it launches.',
          )}
        </p>
      ) : null}
      {step === 4 ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">{a.name}</p>
          <p className="text-sm">{sentence(a)}</p>
          <SwitchRow
            label={tr('automations.start_paused', 'Start paused')}
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
                    {tr('automations.edit_2', 'Edit')}
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
                    {a.paused
                      ? tr('automations.turn_on', 'Turn on')
                      : tr('automations.pause', 'Pause')}
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
                    {tr('automations.delete', 'Delete')}
                  </Button>
                </>
              }
            />
            <Refusal error={act.error} />
            <Card>
              <CardContent className="overflow-x-auto">
                {data.rows.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    {tr(
                      'automations.nothing_due_in_the_next_six',
                      'Nothing due in the next six months.',
                    )}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr('automations.starts', 'Starts')}</TableHead>
                        <TableHead>{tr('automations.cycle', 'Cycle')}</TableHead>
                        <TableHead>{tr('automations.people', 'People')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="text-sm">{day(r.start)}</TableCell>
                          <TableCell>
                            {r.cycleId === null ? (
                              <span className="text-sm text-fg-muted">
                                {tr('automations.created_on', 'Created on {{createOn}}', {
                                  createOn: day(r.createOn),
                                })}
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <To
                                  href={`/performance/cycles/${r.cycleId}`}
                                  onNavigate={props.onNavigate}
                                >
                                  {r.cycle ?? tr('automations.cycle', 'Cycle')}
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
                                  ? ' ' +
                                    tr('automations.and_more', 'and {{value}} more', {
                                      value: String(r.people.length - 4),
                                    })
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
