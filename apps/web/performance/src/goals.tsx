import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  KeyValues,
  NumberField,
  PageHeader,
  Progress,
  RadioCard,
  RadioGroup,
  Stat,
  DataTable,
  type DataColumn,
  Textarea,
  Timeline,
  TimelineItem,
  TreeView,
  type TreeViewNode,
  TrendChart,
  icons,
  WidgetGrid,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { CONFIDENCE } from './home';
import { Loaded } from './load';
import { Choose, Modal, Refusal, StepDialog, SwitchRow, To, day, useAct, type Act } from './shared';
import type { ScreenProps } from './types';
import { t } from './i18n';

/**
 * Goals (PRD §14; design PF18 v2): mine, my team's and the company's as a
 * tree, each with key results whose progress Kithena computes, check-ins on
 * the period's cadence, and a new goal in three steps.
 */

interface GoalRow {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly ownerId: string | null;
  readonly ownerKind: 'person' | 'team' | 'company';
  readonly periodId: string;
  readonly progress: number;
  readonly confidence: string;
  readonly status: string;
  readonly weight: number | null;
  readonly commitment: string;
  readonly parentId: string | null;
  readonly alignedTo: string | null;
  readonly visibility: 'owner' | 'team' | 'everyone';
}

/** Who sees a goal (§14.2), private until made public. */
const VISIBILITY = () =>
  [
    ['owner', t('goals.only_the_owner_and_their_managers', 'Only the owner and their managers')],
    ['team', t('goals.their_team_and_managers_too', 'Their team and managers too')],
    ['everyone', t('goals.everyone_at_the_company', 'Everyone at the company')],
  ] as const;
const visibleTo = (v: string): string => VISIBILITY().find(([k]) => k === v)?.[1] ?? v;

interface Period {
  readonly id: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly cadence: string;
}

export interface GoalsData {
  readonly tab: string;
  readonly periods: readonly Period[];
  readonly period: string | null;
  readonly scope: string;
  readonly rows: readonly GoalRow[];
  readonly tree: readonly GoalRow[];
  readonly due: readonly (GoalRow & { readonly dueOn: string })[];
  readonly weighted: boolean;
  readonly score: number | null;
  readonly may: { readonly create: boolean; readonly company: boolean };
}

const STATUS = () =>
  [
    ['', t('goals.all', 'All')],
    ['active', t('goals.active', 'Active')],
    ['draft', t('goals.draft', 'Draft')],
    ['completed', t('goals.completed', 'Completed')],
    ['missed', t('goals.missed', 'Missed')],
    ['cancelled', t('goals.cancelled', 'Cancelled')],
  ] as const;

function ConfidenceBadge({ value }: { readonly value: string }): JSX.Element {
  const [label, tone] = CONFIDENCE()[value] ?? [t('goals.on_track', 'On track'), 'success'];
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
}

const goalId = (g: GoalRow): string => g.id;
const goalTitle = (g: GoalRow): string => g.title;

/** PF4's list: each goal, whose it is, how far along, and how sure. Virtualised: a company's every goal is one list. */
function goalColumns(
  onNavigate: ScreenProps<GoalsData>['onNavigate'],
  weighted: boolean,
): readonly DataColumn<GoalRow>[] {
  return [
    {
      id: 'goal',
      header: t('goals.goal', 'Goal'),
      sortBy: (g) => g.title,
      cell: (g) => (
        <>
          <To href={`/performance/goals/${g.id}`} onNavigate={onNavigate}>
            {g.title}
          </To>
          {g.alignedTo === null ? null : (
            <span className="block text-xs text-fg-muted">
              {t('goals.aligned_to', 'Aligned to {{alignedTo}}', { alignedTo: g.alignedTo })}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'owner',
      header: t('goals.owner', 'Owner'),
      sortBy: (g) => g.owner,
      cell: (g) => <span className="text-sm">{g.owner}</span>,
    },
    {
      id: 'progress',
      header: t('goals.progress', 'Progress'),
      width: '10rem',
      sortBy: (g) => g.progress,
      cell: (g) => (
        <Progress
          value={g.progress}
          label={t('goals.text', '{{title}}: {{progress}}%', {
            title: g.title,
            progress: String(g.progress),
          })}
          showValue
        />
      ),
    },
    {
      id: 'confidence',
      header: t('goals.confidence', 'Confidence'),
      cardTrailing: true,
      sortBy: (g) => (g.status === 'active' ? g.confidence : g.status),
      cell: (g) =>
        g.status === 'active' ? (
          <ConfidenceBadge value={g.confidence} />
        ) : (
          <Badge size="sm">{g.status.charAt(0).toUpperCase() + g.status.slice(1)}</Badge>
        ),
    },
    ...(weighted
      ? [
          {
            id: 'weight',
            header: t('goals.weight', 'Weight'),
            numeric: true,
            sortBy: (g: GoalRow) => g.weight ?? 0,
            cell: (g: GoalRow) => (
              <span className="text-sm">{g.weight === null ? '—' : `${String(g.weight)}%`}</span>
            ),
          },
        ]
      : []),
  ];
}

export function Goals(props: ScreenProps<GoalsData>): JSX.Element {
  const act = useAct(props);
  const [creating, setCreating] = useState(props.search?.['new'] === '1');
  const status = props.search?.['status'] ?? '';
  return (
    <Loaded load={props.load} what="goals">
      {(data) => {
        const rows = status === '' ? data.rows : data.rows.filter((r) => r.status === status);
        const weight = data.rows
          .filter((r) => r.status === 'active' && r.ownerKind === 'person')
          .reduce((n, r) => n + (r.weight ?? 0), 0);
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={t('goals.goals', 'Goals')}
              description={t(
                'goals.what_each_person_team_and_the',
                'What each person, team and the company is working towards this period, and how far along it is.',
              )}
              actions={
                data.may.create ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    {t('goals.new_goal', 'New goal')}
                  </Button>
                ) : null
              }
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Choose
                  label={t('goals.period', 'Period')}
                  value={data.period ?? ''}
                  options={data.periods.map((p) => [p.id, p.name] as const)}
                  onChange={(v) => {
                    props.onFilter?.({ period: v });
                  }}
                />
              </div>
              <ChipRow aria-label={t('goals.status', 'Status')}>
                {STATUS().map(([v, l]) => (
                  <Chip
                    key={v}
                    selected={status === v}
                    onClick={() => {
                      props.onFilter?.({ status: v === '' ? null : v });
                    }}
                  >
                    {l}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            {data.due.length === 0 ? null : (
              <Alert
                tone="info"
                title={t('goals.due', '{{length}} due', {
                  length: t(
                    'goals.count_check_ins',
                    { one: '{{count}} check-in', other: '{{count}} check-ins' },
                    { count: data.due.length },
                  ),
                })}
              >
                {data.due.map((g) => g.title).join(' · ')}
              </Alert>
            )}
            {data.scope === 'mine' && data.weighted ? (
              <WidgetGrid size="sm">
                <Stat
                  label={t('goals.goal_score', 'Goal score')}
                  value={data.score === null ? '—' : `${String(data.score)}%`}
                  description={t('goals.weighted_progress_computed', 'Weighted progress, computed')}
                />
                <Stat
                  label={t('goals.weights', 'Weights')}
                  value={`${String(weight)}%`}
                  description={
                    weight === 100
                      ? t('goals.committed_set_adds_up', 'Committed set adds up')
                      : t('goals.a_committed_set_adds_up_to', 'A committed set adds up to 100%')
                  }
                  {...(weight === 100 ? {} : { sentiment: 'negative' as const })}
                />
                <Stat
                  label={t('goals.goals', 'Goals')}
                  value={String(data.rows.length)}
                  description={t('goals.this_period', 'This period')}
                />
              </WidgetGrid>
            ) : null}
            {data.tab === 'alignment' ? (
              <Tree rows={data.tree} onNavigate={props.onNavigate} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<icons.goal aria-hidden />}
                title={t('goals.no_goals_here', 'No goals here')}
                description={t(
                  'goals.a_goal_has_at_least_one',
                  'A goal has at least one key result; its progress is worked out from them.',
                )}
              />
            ) : (
              <DataTable<GoalRow>
                label={t('goals.goals', 'Goals')}
                rows={rows}
                rowId={goalId}
                describeRow={goalTitle}
                fill
                columns={goalColumns(props.onNavigate, data.weighted)}
              />
            )}
            {creating ? (
              <NewGoal
                act={act}
                data={data}
                onClose={() => {
                  setCreating(false);
                  props.onFilter?.({ new: null });
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}

/** Company goals at the top, everything aligned to them beneath (§14.4). */
/** The period's goals as Reach's tree: arrow keys move and open, Enter opens the goal. */
function Tree({
  rows,
  onNavigate,
}: {
  readonly rows: readonly GoalRow[];
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const ids = new Set(rows.map((r) => r.id));
  const node = (g: GoalRow): TreeViewNode => {
    const children = rows.filter((c) => c.parentId === g.id).map(node);
    return {
      id: g.id,
      label: g.title,
      ...(children.length === 0 ? {} : { children }),
      meta: (
        <span className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">{g.owner}</span>
          <span className="w-24">
            <Progress
              value={g.progress}
              label={t('goals.text', '{{title}}: {{progress}}%', {
                title: g.title,
                progress: String(g.progress),
              })}
            />
          </span>
          <ConfidenceBadge value={g.confidence} />
        </span>
      ),
    };
  };
  const roots = rows.filter((r) => r.parentId === null || !ids.has(r.parentId)).map(node);
  return (
    <Card>
      <CardContent>
        {roots.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t('goals.no_goals_in_this_period_yet', 'No goals in this period yet.')}
          </p>
        ) : (
          <TreeView
            label={t('goals.goals', 'Goals')}
            items={roots}
            defaultExpanded={rows.map((r) => r.id)}
            onSelectedChange={(id) => {
              onNavigate?.(`/performance/goals/${id}`);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

const MEASURES = () =>
  [
    ['number', t('goals.number', 'Number')],
    ['percentage', t('goals.percentage', 'Percentage')],
    ['currency', t('goals.amount', 'Amount')],
    ['done', t('goals.done_or_not', 'Done or not')],
  ] as const;

interface KrDraft {
  readonly title: string;
  readonly measure: string;
  readonly start: number;
  readonly target: number;
  readonly current: number;
  readonly unit: string | null;
  readonly weight: number | null;
  readonly linked: string | null;
}

/** PF18c v2: Goal · Measure · Align and share. */
function NewGoal({
  act,
  data,
  onClose,
}: {
  readonly act: Act;
  readonly data: GoalsData;
  readonly onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerKind, setOwnerKind] = useState<'person' | 'company'>('person');
  const [periodId, setPeriodId] = useState(data.period ?? data.periods[0]?.id ?? '');
  const [krs, setKrs] = useState<readonly KrDraft[]>([
    {
      title: '',
      measure: 'number',
      start: 0,
      target: 100,
      current: 0,
      unit: null,
      weight: null,
      linked: null,
    },
  ]);
  const [parentId, setParentId] = useState('none');
  const [weight, setWeight] = useState<number | null>(null);
  const [aspirational, setAspirational] = useState(false);
  const [visibility, setVisibility] = useState<string>('owner');
  const setKr = (i: number, patch: Partial<KrDraft>): void => {
    setKrs(krs.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  };
  return (
    <StepDialog
      open
      wide
      onClose={onClose}
      title={t('goals.new_goal', 'New goal')}
      steps={[
        t('goals.goal', 'Goal'),
        t('goals.measure', 'Measure'),
        t('goals.align_and_share', 'Align and share'),
      ]}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={
        step === 0
          ? title.trim() !== ''
          : step === 1
            ? krs.every((k) => k.title.trim() !== '')
            : true
      }
      finishLabel={t('goals.create_goal', 'Create goal')}
      finish={() => {
        act.run(
          'CreatePerformanceGoal',
          {
            input: {
              title,
              description,
              ownerId: null,
              ownerKind,
              periodId,
              parentId: parentId === 'none' ? null : parentId,
              weight,
              commitment: aspirational ? 'aspirational' : 'committed',
              keyResults: krs.map((k) =>
                k.measure === 'done' ? { ...k, start: 0, target: 1, current: 0 } : k,
              ),
              // A company goal is everyone's; anyone else's is private unless shared.
              visibility: ownerKind === 'company' ? 'everyone' : visibility,
            },
          },
          onClose,
        );
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>{t('goals.goal', 'Goal')}</FieldLabel>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder={t('goals.cut_checkout_latency', 'Cut checkout latency')}
            />
          </Field>
          <Field>
            <FieldLabel>{t('goals.why_it_matters', 'Why it matters')}</FieldLabel>
            <Textarea
              autoResize
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
          </Field>
          <Choose
            label={t('goals.period', 'Period')}
            value={periodId}
            options={data.periods.map((p) => [p.id, p.name] as const)}
            onChange={setPeriodId}
          />
          {data.may.company ? (
            <RadioGroup
              aria-label={t('goals.whose_goal', 'Whose goal')}
              className="flex flex-col gap-2"
              value={ownerKind}
              onValueChange={(v) => {
                setOwnerKind(v === 'company' ? 'company' : 'person');
              }}
            >
              <RadioCard value="person">{t('goals.mine', 'Mine')}</RadioCard>
              <RadioCard value="company">{t('goals.the_companys', 'The company’s')}</RadioCard>
            </RadioGroup>
          ) : null}
        </div>
      ) : null}
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          {krs.map((k, i) => (
            <Card key={`kr-${String(i)}`}>
              <CardContent className="flex flex-col gap-3">
                <Field required>
                  <FieldLabel>
                    {t('goals.key_result', 'Key result {{value}}', { value: String(i + 1) })}
                  </FieldLabel>
                  <Input
                    value={k.title}
                    onChange={(e) => {
                      setKr(i, { title: e.target.value });
                    }}
                    placeholder={t('goals.p95_under_300_ms', 'p95 under 300 ms')}
                  />
                </Field>
                <Choose
                  label={t('goals.measured_by', 'Measured by')}
                  value={k.measure}
                  options={MEASURES()}
                  onChange={(v) => {
                    setKr(i, { measure: v });
                  }}
                />
                {k.measure === 'done' ? null : (
                  <div className="flex flex-col gap-4">
                    <NumberField
                      label={t('goals.start', 'Start')}
                      value={k.start}
                      onChange={(v) => {
                        setKr(i, { start: v ?? 0, current: v ?? 0 });
                      }}
                    />
                    <NumberField
                      label={t('goals.target', 'Target')}
                      value={k.target}
                      onChange={(v) => {
                        setKr(i, { target: v ?? 0 });
                      }}
                    />
                    <Field>
                      <FieldLabel>{t('goals.unit', 'Unit')}</FieldLabel>
                      <Input
                        value={k.unit ?? ''}
                        onChange={(e) => {
                          setKr(i, { unit: e.target.value === '' ? null : e.target.value });
                        }}
                        placeholder={k.measure === 'currency' ? 'EUR' : 'ms'}
                      />
                    </Field>
                  </div>
                )}
                {krs.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => {
                      setKrs(krs.filter((_, j) => j !== i));
                    }}
                  >
                    {t('goals.remove', 'Remove')}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setKrs([
                ...krs,
                {
                  title: '',
                  measure: 'number',
                  start: 0,
                  target: 100,
                  current: 0,
                  unit: null,
                  weight: null,
                  linked: null,
                },
              ]);
            }}
          >
            {t('goals.add_a_key_result', 'Add a key result')}
          </Button>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Choose
            label={t('goals.aligned_to_2', 'Aligned to')}
            value={parentId}
            options={[
              ['none', t('goals.nothing', 'Nothing')],
              ...data.tree
                .filter((g) => g.periodId === periodId)
                .map(
                  (g) =>
                    [
                      g.id,
                      t('goals.text_2', '{{title}} · {{owner}}', {
                        title: g.title,
                        owner: g.owner,
                      }),
                    ] as const,
                ),
            ]}
            onChange={setParentId}
          />
          {data.weighted && ownerKind === 'person' ? (
            <NumberField
              label={t('goals.weight', 'Weight')}
              hint={t(
                'goals.your_goals_for_the_period_add',
                'Your goals for the period add up to 100%',
              )}
              suffix="%"
              value={weight}
              min={0}
              max={100}
              onChange={setWeight}
            />
          ) : null}
          <SwitchRow
            label={t('goals.aspirational', 'Aspirational')}
            hint={t(
              'goals.a_stretch_missing_it_is_expected',
              'A stretch: missing it is expected some of the time',
            )}
            checked={aspirational}
            onChange={setAspirational}
          />
          {ownerKind === 'company' ? (
            <p className="text-sm text-fg-muted">
              {t('goals.a_company_goal_is_visible_to', 'A company goal is visible to everyone.')}
            </p>
          ) : (
            <RadioGroup
              aria-label={t('goals.who_can_see_it', 'Who can see it')}
              value={visibility}
              onValueChange={setVisibility}
            >
              {VISIBILITY().map(([v, label]) => (
                <RadioCard key={v} value={v}>
                  {label}
                </RadioCard>
              ))}
            </RadioGroup>
          )}
        </div>
      ) : null}
    </StepDialog>
  );
}

/* ------------------------------------------------------------- one goal -- */

export interface GoalData {
  readonly goal: GoalRow & {
    readonly description: string;
    readonly keyResults: readonly {
      readonly id: string;
      readonly title: string;
      readonly measure: string;
      readonly start: number;
      readonly target: number;
      readonly current: number;
      readonly unit: string | null;
      readonly progress: number;
    }[];
    readonly createdAt: string;
  };
  readonly checkIns: readonly {
    readonly at: string;
    readonly by: string;
    readonly values: Readonly<Record<string, number>>;
    readonly confidence: string;
    readonly note: string | null;
  }[];
  readonly period: Period | null;
  readonly nextCheckIn: string | null;
  readonly score: number | null;
  readonly children: readonly GoalRow[];
  readonly may: { readonly checkIn: boolean; readonly edit: boolean };
}

export function Goal(props: ScreenProps<GoalData>): JSX.Element {
  const act = useAct(props);
  const [checking, setChecking] = useState(false);
  return (
    <Loaded load={props.load} what={t('goals.the_goal', 'the goal')}>
      {(data) => {
        const g = data.goal;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={g.title}
              description={[
                g.owner,
                ...(data.period?.name ? [data.period.name] : []),
                ...(g.alignedTo === null
                  ? []
                  : [t('goals.aligned_to_goal', 'aligned to {{goal}}', { goal: g.alignedTo })]),
              ].join(' · ')}
              actions={
                <>
                  {data.may.checkIn ? (
                    <Button
                      onClick={() => {
                        setChecking(true);
                      }}
                    >
                      {t('goals.check_in', 'Check in')}
                    </Button>
                  ) : null}
                  {data.may.edit && g.status === 'active' ? (
                    <>
                      <Button
                        variant="secondary"
                        loading={act.pending}
                        onClick={() => {
                          act.run('SetPerformanceGoalStatus', {
                            id: g.id,
                            input: { status: 'completed' },
                          });
                        }}
                      >
                        {t('goals.complete', 'Complete')}
                      </Button>
                      <Button
                        variant="ghost"
                        loading={act.pending}
                        onClick={() => {
                          act.run('SetPerformanceGoalStatus', {
                            id: g.id,
                            input: { status: 'cancelled' },
                          });
                        }}
                      >
                        {t('goals.cancel_goal', 'Cancel goal')}
                      </Button>
                    </>
                  ) : null}
                </>
              }
            />
            <Refusal error={act.error} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>{t('goals.key_results', 'Key results')}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {g.keyResults.map((k) => (
                      <div key={k.id} className="flex flex-col gap-1.5">
                        <span className="flex justify-between gap-2 text-sm">
                          <span className="font-medium">{k.title}</span>
                          <span className="text-fg-muted">
                            {k.measure === 'done'
                              ? k.current >= 1
                                ? t('goals.done', 'Done')
                                : t('goals.not_done', 'Not done')
                              : t('goals.of', '{{current}} of {{target}}{{value}}', {
                                  current: String(k.current),
                                  target: String(k.target),
                                  value: k.unit === null ? '' : ` ${k.unit}`,
                                })}
                          </span>
                        </span>
                        <Progress
                          value={k.progress}
                          label={t('goals.text', '{{title}}: {{progress}}%', {
                            title: k.title,
                            progress: String(k.progress),
                          })}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {data.checkIns.length < 2 ? null : (
                  <Card>
                    <CardHeader>
                      <CardTitle level={2}>{t('goals.check_ins', 'Check-ins')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TrendChart
                        label={t('goals.progress_at_each_check_in', 'Progress at each check-in')}
                        format={(v) => `${String(v)}%`}
                        series={g.keyResults.map((k) => ({
                          label: k.title,
                          data: data.checkIns.toReversed().map((c) => {
                            const v = c.values[k.id] ?? k.start;
                            const share =
                              k.target === k.start
                                ? 0
                                : Math.round(((v - k.start) / (k.target - k.start)) * 100);
                            return { label: day(c.at), value: Math.max(0, Math.min(100, share)) };
                          }),
                        }))}
                      />
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>{t('goals.history', 'History')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.checkIns.length === 0 ? (
                      <p className="text-sm text-fg-muted">
                        {t('goals.no_check_ins_yet', 'No check-ins yet.')}
                      </p>
                    ) : (
                      <Timeline>
                        {data.checkIns.map((c, i) => (
                          <TimelineItem
                            key={c.at}
                            title={
                              <span className="flex items-center gap-2">
                                {c.by}
                                <ConfidenceBadge value={c.confidence} />
                              </span>
                            }
                            timestamp={day(c.at)}
                            tone={CONFIDENCE()[c.confidence]?.[1] ?? 'success'}
                            last={i === data.checkIns.length - 1}
                          >
                            {c.note}
                          </TimelineItem>
                        ))}
                      </Timeline>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card className="h-fit">
                <CardContent>
                  <KeyValues
                    layout="split"
                    items={[
                      { label: t('goals.progress', 'Progress'), value: `${String(g.progress)}%` },
                      {
                        label: t('goals.confidence', 'Confidence'),
                        value: <ConfidenceBadge value={g.confidence} />,
                      },
                      { label: t('goals.owner', 'Owner'), value: g.owner },
                      {
                        label: t('goals.period', 'Period'),
                        value:
                          data.period === null
                            ? '—'
                            : `${day(data.period.from)} – ${day(data.period.to)}`,
                      },
                      {
                        label: t('goals.next_check_in', 'Next check-in'),
                        value: day(data.nextCheckIn),
                      },
                      {
                        label: t('goals.weight', 'Weight'),
                        value: g.weight === null ? '—' : `${String(g.weight)}%`,
                      },
                      {
                        label: t('goals.commitment', 'Commitment'),
                        value: g.commitment === 'aspirational' ? 'Aspirational' : 'Committed',
                      },
                      {
                        label: t('goals.visible_to', 'Visible to'),
                        value: data.may.edit ? (
                          <Choose
                            label={t('goals.visible_to', 'Visible to')}
                            value={g.visibility}
                            options={VISIBILITY()}
                            onChange={(v) => {
                              act.run('SetPerformanceGoalVisibility', {
                                id: g.id,
                                input: { visibility: v },
                              });
                            }}
                          />
                        ) : (
                          visibleTo(g.visibility)
                        ),
                      },
                    ]}
                  />
                  {data.children.length === 0 ? null : (
                    <div className="mt-4 flex flex-col gap-1">
                      <p className="text-sm font-semibold">
                        {t('goals.aligned_to_this', 'Aligned to this')}
                      </p>
                      {data.children.map((c) => (
                        <To
                          key={c.id}
                          href={`/performance/goals/${c.id}`}
                          onNavigate={props.onNavigate}
                        >
                          {t('goals.text_2', '{{title}} · {{owner}}', {
                            title: c.title,
                            owner: c.owner,
                          })}
                        </To>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            {checking ? (
              <CheckIn
                act={act}
                data={data}
                onClose={() => {
                  setChecking(false);
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}

function CheckIn({
  act,
  data,
  onClose,
}: {
  readonly act: Act;
  readonly data: GoalData;
  readonly onClose: () => void;
}): JSX.Element {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(data.goal.keyResults.map((k) => [k.id, k.current])),
  );
  const [confidence, setConfidence] = useState('on_track');
  const [note, setNote] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t('goals.check_in_on', 'Check in on {{title}}', { title: data.goal.title })}
      description={t(
        'goals.where_each_key_result_stands_today',
        'Where each key result stands today; progress is worked out from it.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('goals.cancel', 'Cancel')}
          </Button>
          <Button
            loading={act.pending}
            onClick={() => {
              act.run(
                'CheckInPerformanceGoal',
                {
                  id: data.goal.id,
                  input: { values, confidence, note: note.trim() === '' ? null : note },
                },
                onClose,
              );
            }}
          >
            {t('goals.check_in', 'Check in')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      {data.goal.keyResults.map((k) =>
        k.measure === 'done' ? (
          <SwitchRow
            key={k.id}
            label={k.title}
            checked={(values[k.id] ?? 0) >= 1}
            onChange={(on) => {
              setValues({ ...values, [k.id]: on ? 1 : 0 });
            }}
          />
        ) : (
          <NumberField
            key={k.id}
            label={k.title}
            hint={t('goals.from_to', 'From {{start}} to {{target}}', {
              start: String(k.start),
              target: String(k.target),
            })}
            value={values[k.id] ?? k.current}
            onChange={(v) => {
              if (v !== null) setValues({ ...values, [k.id]: v });
            }}
            {...(k.unit === null ? {} : { suffix: k.unit })}
          />
        ),
      )}
      <RadioGroup
        aria-label={t('goals.confidence', 'Confidence')}
        className="flex flex-col gap-2"
        value={confidence}
        onValueChange={setConfidence}
      >
        <RadioCard value="on_track">{t('goals.on_track', 'On track')}</RadioCard>
        <RadioCard value="at_risk">{t('goals.at_risk', 'At risk')}</RadioCard>
        <RadioCard value="off_track">{t('goals.off_track', 'Off track')}</RadioCard>
      </RadioGroup>
      <Field>
        <FieldLabel>{t('goals.note', 'Note')}</FieldLabel>
        <Textarea
          autoResize
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}
