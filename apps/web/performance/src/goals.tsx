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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  TrendChart,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { CONFIDENCE } from './home';
import { Loaded } from './load';
import {
  Choose,
  Modal,
  Refusal,
  StepDialog,
  SwitchRow,
  To,
  day,
  plural,
  useAct,
  type Act,
} from './shared';
import type { ScreenProps } from './types';

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
const VISIBILITY = [
  ['owner', 'Only the owner and their managers'],
  ['team', 'Their team and managers too'],
  ['everyone', 'Everyone at the company'],
] as const;
const visibleTo = (v: string): string => VISIBILITY.find(([k]) => k === v)?.[1] ?? v;

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

const STATUS = [
  ['', 'All'],
  ['active', 'Active'],
  ['draft', 'Draft'],
  ['completed', 'Completed'],
  ['missed', 'Missed'],
  ['cancelled', 'Cancelled'],
] as const;

function ConfidenceBadge({ value }: { readonly value: string }): JSX.Element {
  const [label, tone] = CONFIDENCE[value] ?? ['On track', 'success'];
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
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
              title="Goals"
              description="What each person, team and the company is working towards this period, and how far along it is."
              actions={
                data.may.create ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    New goal
                  </Button>
                ) : null
              }
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Choose
                  label="Period"
                  value={data.period ?? ''}
                  options={data.periods.map((p) => [p.id, p.name] as const)}
                  onChange={(v) => {
                    props.onFilter?.({ period: v });
                  }}
                />
              </div>
              <ChipRow aria-label="Status">
                {STATUS.map(([v, l]) => (
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
              <Alert tone="info" title={`${plural(data.due.length, 'check-in')} due`}>
                {data.due.map((g) => g.title).join(' · ')}
              </Alert>
            )}
            {data.scope === 'mine' && data.weighted ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Goal score"
                  value={data.score === null ? '—' : `${String(data.score)}%`}
                  description="Weighted progress, computed"
                />
                <Stat
                  label="Weights"
                  value={`${String(weight)}%`}
                  description={
                    weight === 100 ? 'Committed set adds up' : 'A committed set adds up to 100%'
                  }
                  {...(weight === 100 ? {} : { sentiment: 'negative' as const })}
                />
                <Stat label="Goals" value={String(data.rows.length)} description="This period" />
              </div>
            ) : null}
            {data.tab === 'alignment' ? (
              <Tree rows={data.tree} onNavigate={props.onNavigate} />
            ) : (
              <Card>
                <CardContent className="overflow-x-auto">
                  {rows.length === 0 ? (
                    <EmptyState
                      icon={<icons.goal aria-hidden />}
                      title="No goals here"
                      description="A goal has at least one key result; its progress is worked out from them."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Goal</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead>Confidence</TableHead>
                          {data.weighted ? <TableHead>Weight</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((g) => (
                          <TableRow key={g.id}>
                            <TableCell>
                              <To href={`/performance/goals/${g.id}`} onNavigate={props.onNavigate}>
                                {g.title}
                              </To>
                              {g.alignedTo === null ? null : (
                                <span className="block text-xs text-fg-muted">{`Aligned to ${g.alignedTo}`}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{g.owner}</TableCell>
                            <TableCell className="w-40">
                              <Progress
                                value={g.progress}
                                label={`${g.title}: ${String(g.progress)}%`}
                                showValue
                              />
                            </TableCell>
                            <TableCell>
                              {g.status === 'active' ? (
                                <ConfidenceBadge value={g.confidence} />
                              ) : (
                                <Badge size="sm">
                                  {g.status.charAt(0).toUpperCase() + g.status.slice(1)}
                                </Badge>
                              )}
                            </TableCell>
                            {data.weighted ? (
                              <TableCell className="text-sm">
                                {g.weight === null ? '—' : `${String(g.weight)}%`}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
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
function Tree({
  rows,
  onNavigate,
}: {
  readonly rows: readonly GoalRow[];
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter((r) => r.parentId === null || !ids.has(r.parentId));
  const branch = (g: GoalRow, depth: number): JSX.Element => (
    <li key={g.id} className="flex flex-col gap-2">
      <span
        className="flex flex-wrap items-center gap-3"
        style={{ paddingInlineStart: `${String(depth * 1.5)}rem` }}
      >
        <To href={`/performance/goals/${g.id}`} onNavigate={onNavigate}>
          {g.title}
        </To>
        <span className="text-sm text-fg-muted">{g.owner}</span>
        <span className="w-32">
          <Progress value={g.progress} label={`${g.title}: ${String(g.progress)}%`} />
        </span>
        <ConfidenceBadge value={g.confidence} />
      </span>
      {rows.some((c) => c.parentId === g.id) ? (
        <ul className="flex flex-col gap-2">
          {rows.filter((c) => c.parentId === g.id).map((c) => branch(c, depth + 1))}
        </ul>
      ) : null}
    </li>
  );
  return (
    <Card>
      <CardContent>
        {roots.length === 0 ? (
          <p className="text-sm text-fg-muted">No goals in this period yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">{roots.map((r) => branch(r, 0))}</ul>
        )}
      </CardContent>
    </Card>
  );
}

const MEASURES = [
  ['number', 'Number'],
  ['percentage', 'Percentage'],
  ['currency', 'Amount'],
  ['done', 'Done or not'],
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
      title="New goal"
      steps={['Goal', 'Measure', 'Align and share']}
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
      finishLabel="Create goal"
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
            <FieldLabel>Goal</FieldLabel>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder="Cut checkout latency"
            />
          </Field>
          <Field>
            <FieldLabel>Why it matters</FieldLabel>
            <Textarea
              autoResize
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
          </Field>
          <Choose
            label="Period"
            value={periodId}
            options={data.periods.map((p) => [p.id, p.name] as const)}
            onChange={setPeriodId}
          />
          {data.may.company ? (
            <RadioGroup
              aria-label="Whose goal"
              className="grid gap-2 sm:grid-cols-2"
              value={ownerKind}
              onValueChange={(v) => {
                setOwnerKind(v === 'company' ? 'company' : 'person');
              }}
            >
              <RadioCard value="person">Mine</RadioCard>
              <RadioCard value="company">The company’s</RadioCard>
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
                  <FieldLabel>{`Key result ${String(i + 1)}`}</FieldLabel>
                  <Input
                    value={k.title}
                    onChange={(e) => {
                      setKr(i, { title: e.target.value });
                    }}
                    placeholder="p95 under 300 ms"
                  />
                </Field>
                <Choose
                  label="Measured by"
                  value={k.measure}
                  options={MEASURES}
                  onChange={(v) => {
                    setKr(i, { measure: v });
                  }}
                />
                {k.measure === 'done' ? null : (
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField
                      label="Start"
                      value={k.start}
                      onChange={(v) => {
                        setKr(i, { start: v ?? 0, current: v ?? 0 });
                      }}
                    />
                    <NumberField
                      label="Target"
                      value={k.target}
                      onChange={(v) => {
                        setKr(i, { target: v ?? 0 });
                      }}
                    />
                    <Field>
                      <FieldLabel>Unit</FieldLabel>
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
                    Remove
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
            Add a key result
          </Button>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Choose
            label="Aligned to"
            value={parentId}
            options={[
              ['none', 'Nothing'],
              ...data.tree
                .filter((g) => g.periodId === periodId)
                .map((g) => [g.id, `${g.title} · ${g.owner}`] as const),
            ]}
            onChange={setParentId}
          />
          {data.weighted && ownerKind === 'person' ? (
            <NumberField
              label="Weight"
              hint="Your goals for the period add up to 100%"
              suffix="%"
              value={weight}
              min={0}
              max={100}
              onChange={setWeight}
            />
          ) : null}
          <SwitchRow
            label="Aspirational"
            hint="A stretch: missing it is expected some of the time"
            checked={aspirational}
            onChange={setAspirational}
          />
          {ownerKind === 'company' ? (
            <p className="text-sm text-fg-muted">A company goal is visible to everyone.</p>
          ) : (
            <RadioGroup aria-label="Who can see it" value={visibility} onValueChange={setVisibility}>
              {VISIBILITY.map(([v, label]) => (
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
    <Loaded load={props.load} what="the goal">
      {(data) => {
        const g = data.goal;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={g.title}
              description={`${g.owner} · ${data.period?.name ?? ''}${g.alignedTo === null ? '' : ` · aligned to ${g.alignedTo}`}`}
              actions={
                <>
                  {data.may.checkIn ? (
                    <Button
                      onClick={() => {
                        setChecking(true);
                      }}
                    >
                      Check in
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
                        Complete
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
                        Cancel goal
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
                    <CardTitle level={2}>Key results</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {g.keyResults.map((k) => (
                      <div key={k.id} className="flex flex-col gap-1.5">
                        <span className="flex justify-between gap-2 text-sm">
                          <span className="font-medium">{k.title}</span>
                          <span className="text-fg-muted">
                            {k.measure === 'done'
                              ? k.current >= 1
                                ? 'Done'
                                : 'Not done'
                              : `${String(k.current)} of ${String(k.target)}${k.unit === null ? '' : ` ${k.unit}`}`}
                          </span>
                        </span>
                        <Progress value={k.progress} label={`${k.title}: ${String(k.progress)}%`} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {data.checkIns.length < 2 ? null : (
                  <Card>
                    <CardHeader>
                      <CardTitle level={2}>Check-ins</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TrendChart
                        label="Progress at each check-in"
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
                    <CardTitle level={2}>History</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                    {data.checkIns.length === 0 ? (
                      <p className="text-sm text-fg-muted">No check-ins yet.</p>
                    ) : (
                      data.checkIns.map((c) => (
                        <div key={c.at} className="flex flex-col gap-1 py-2.5">
                          <span className="flex items-center gap-2 text-sm">
                            <span className="font-medium">{`${c.by} · ${day(c.at)}`}</span>
                            <ConfidenceBadge value={c.confidence} />
                          </span>
                          {c.note === null ? null : <p className="text-sm">{c.note}</p>}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card className="h-fit">
                <CardContent>
                  <KeyValues
                    layout="split"
                    items={[
                      { label: 'Progress', value: `${String(g.progress)}%` },
                      { label: 'Confidence', value: <ConfidenceBadge value={g.confidence} /> },
                      { label: 'Owner', value: g.owner },
                      {
                        label: 'Period',
                        value:
                          data.period === null
                            ? '—'
                            : `${day(data.period.from)} – ${day(data.period.to)}`,
                      },
                      { label: 'Next check-in', value: day(data.nextCheckIn) },
                      { label: 'Weight', value: g.weight === null ? '—' : `${String(g.weight)}%` },
                      {
                        label: 'Commitment',
                        value: g.commitment === 'aspirational' ? 'Aspirational' : 'Committed',
                      },
                      {
                        label: 'Visible to',
                        value: data.may.edit ? (
                          <Choose
                            label="Visible to"
                            value={g.visibility}
                            options={VISIBILITY}
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
                      <p className="text-sm font-semibold">Aligned to this</p>
                      {data.children.map((c) => (
                        <To
                          key={c.id}
                          href={`/performance/goals/${c.id}`}
                          onNavigate={props.onNavigate}
                        >
                          {`${c.title} · ${c.owner}`}
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
      title={`Check in on ${data.goal.title}`}
      description="Where each key result stands today; progress is worked out from it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
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
            Check in
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
            hint={`From ${String(k.start)} to ${String(k.target)}`}
            value={values[k.id] ?? k.current}
            onChange={(v) => {
              if (v !== null) setValues({ ...values, [k.id]: v });
            }}
            {...(k.unit === null ? {} : { suffix: k.unit })}
          />
        ),
      )}
      <RadioGroup
        aria-label="Confidence"
        className="grid gap-2 sm:grid-cols-3"
        value={confidence}
        onValueChange={setConfidence}
      >
        <RadioCard value="on_track">On track</RadioCard>
        <RadioCard value="at_risk">At risk</RadioCard>
        <RadioCard value="off_track">Off track</RadioCard>
      </RadioGroup>
      <Field>
        <FieldLabel>Note</FieldLabel>
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
