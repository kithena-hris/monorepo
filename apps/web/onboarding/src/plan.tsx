import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  KeyValues,
  NumberField,
  PageHeader,
  Progress,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  icons,
  DatePicker,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, useAct, words } from './shared';
import type { Phase, PlanData, ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * O3: a plan, its tasks by phase; O4: moving the start; O7: check-ins; O8:
 * the probation review. Onboarding decides who may tick what (`mine`); the
 * screen offers only that.
 */

const PHASES: readonly [Phase, string][] = [
  ['before_start', tr('plan.before_day_one', 'Before day one')],
  ['day_one', tr('plan.day_one', 'Day one')],
  ['first_week', tr('plan.first_week', 'First week')],
  ['first_month', tr('plan.first_month', 'First month')],
  ['probation', tr('plan.until_probation_ends', 'Until probation ends')],
];

const owner = (role: string) => (role === 'it' ? 'IT' : role === 'hr' ? 'HR' : words(role));

export function Plan(props: ScreenProps<PlanData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the plan">
      {(data) => <PlanBody data={data} props={props} />}
    </Loaded>
  );
}

function PlanBody({
  data,
  props,
}: {
  readonly data: PlanData;
  readonly props: ScreenProps<PlanData>;
}): JSX.Element {
  const act = useAct(props);
  const p = data.plan;
  const [moving, setMoving] = useState(false);
  const [start, setStart] = useState(p.startDate);
  const [buddy, setBuddy] = useState(p.buddyId ?? 'none');
  const [notes, setNotes] = useState('');
  const [checkDay, setCheckDay] = useState<'30' | '60' | '90'>('30');
  const [outcome, setOutcome] = useState<'passed' | 'extended' | 'failed'>('passed');
  const [months, setMonths] = useState<number | null>(1);
  const open = p.state === 'scheduled' || p.state === 'in_progress';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={tr('plan.s_plan', '{{name}}’s plan', { name: p.name })}
        meta={<StateBadge state={p.state} />}
        description={[
          tr('plan.starts', 'Starts {{startDate}}', { startDate: day(p.startDate) }),
          p.department,
          p.location,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          data.may.moveStart && open ? (
            <Button
              variant="secondary"
              startIcon={<icons.calendar aria-hidden />}
              onClick={() => {
                setMoving(true);
              }}
            >
              {tr('plan.move_start_date', 'Move start date')}
            </Button>
          ) : null
        }
      />
      <Refusal error={act.error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent className="flex flex-col gap-1">
            {PHASES.map(([phase, label]) => {
              const tasks = data.tasks.filter((t) => t.phase === phase);
              if (tasks.length === 0) return null;
              return (
                <section key={phase} className="flex flex-col">
                  <h2 className="bg-[var(--reach-fill)] px-3 py-2 text-sm font-semibold text-fg-muted">
                    {label}
                  </h2>
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center gap-3 border-b border-[var(--reach-line)] px-3 py-2"
                    >
                      <Checkbox
                        aria-label={t.title}
                        checked={t.state === 'done'}
                        disabled={!t.mine || !open || act.pending}
                        onCheckedChange={(on) => {
                          act.run(on === true ? 'CompleteOnboardingTask' : 'ReopenOnboardingTask', {
                            planId: p.id,
                            taskId: t.id,
                          });
                        }}
                      />
                      <span
                        className={`min-w-0 flex-1 font-medium ${t.state === 'done' ? 'text-fg-muted line-through' : ''}`}
                      >
                        {t.link === null ? (
                          t.title
                        ) : (
                          <To href={t.link} onNavigate={props.onNavigate}>
                            {t.title}
                          </To>
                        )}
                      </span>
                      <Badge size="sm">{owner(t.ownerRole)}</Badge>
                      <span className="w-24 text-sm text-fg-muted">{day(t.dueOn)}</span>
                      {t.late ? (
                        <Badge size="sm" tone="danger">
                          {tr('plan.late', 'Late')}
                        </Badge>
                      ) : t.locked ? (
                        <Badge size="sm">{tr('plan.country', 'Country')}</Badge>
                      ) : null}
                    </div>
                  ))}
                </section>
              );
            })}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card padded className="flex flex-col gap-3">
            <Progress
              value={
                data.progress.total === 0
                  ? 0
                  : Math.round((data.progress.done / data.progress.total) * 100)
              }
              label={tr('plan.of_tasks', '{{done}} of {{total}} tasks', {
                done: String(data.progress.done),
                total: String(data.progress.total),
              })}
            />
            <KeyValues
              items={[
                { label: tr('plan.manager', 'Manager'), value: data.manager ?? '—' },
                { label: tr('plan.buddy', 'Buddy'), value: data.buddy ?? 'Not chosen' },
                {
                  label: tr('plan.probation', 'Probation'),
                  value: p.probationEnd === null ? 'None' : `Ends ${day(p.probationEnd)}`,
                },
              ]}
            />
            {data.may.setBuddy && open ? (
              <div className="flex items-end gap-2">
                <Field className="flex-1">
                  <FieldLabel>{tr('plan.buddy', 'Buddy')}</FieldLabel>
                  <Select value={buddy} onValueChange={setBuddy}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      <SelectItem value="none">{tr('plan.nobody_yet', 'Nobody yet')}</SelectItem>
                      {data.members.map((m) => (
                        <SelectItem key={m.personId} value={m.personId}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  variant="secondary"
                  loading={act.pending}
                  onClick={() => {
                    act.run('SetOnboardingBuddy', {
                      planId: p.id,
                      input: { buddyId: buddy === 'none' ? null : buddy },
                    });
                  }}
                >
                  {tr('plan.save', 'Save')}
                </Button>
              </div>
            ) : null}
          </Card>
          {data.may.checkIn ? (
            <Card>
              <CardHeader>
                <CardTitle level={2}>{tr('plan.check_in', 'Check-in')}</CardTitle>
                <CardDescription>
                  {tr(
                    'plan.at_day_30_60_and_90',
                    'At day 30, 60 and 90, for the new hire and the manager',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Select
                  value={checkDay}
                  onValueChange={(v) => {
                    setCheckDay(v as typeof checkDay);
                  }}
                >
                  <SelectTrigger aria-label={tr('plan.which_check_in', 'Which check-in')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['30', '60', '90'] as const).map((d) => (
                      <SelectItem key={d} value={d}>
                        {tr('plan.day', 'Day {{d}}', { d })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Field>
                  <FieldLabel>{tr('plan.how_is_it_going', 'How is it going?')}</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={notes}
                      onChange={(e) => {
                        setNotes(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Button
                  disabled={notes.trim() === ''}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'OnboardingCheckIn',
                      { planId: p.id, input: { day: Number(checkDay), notes } },
                      () => {
                        setNotes('');
                      },
                    );
                  }}
                >
                  {tr('plan.submit', 'Submit')}
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {data.checkIns.length === 0 ? null : (
            <Card padded>
              <KeyValues
                items={data.checkIns.map((c) => ({
                  label: tr('plan.day_2', 'Day {{day}}', { day: String(c.day) }),
                  value: c.notes,
                }))}
              />
            </Card>
          )}
        </div>
      </div>
      {data.may.review && open ? (
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('plan.probation_review', 'Probation review')}</CardTitle>
            <CardDescription>
              {tr('plan.ends', 'Ends {{probationEnd}}{{value}}', {
                probationEnd: day(p.probationEnd),
                value:
                  p.allowedExtensionMonths === null || p.allowedExtensionMonths === 0
                    ? ' · no extension allowed'
                    : ` · may be extended by up to ${String(p.allowedExtensionMonths)} months`,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.reviews.length === 0 ? null : (
              <Alert
                tone="info"
                title={tr('plan.recorded', 'Recorded: {{words}}', {
                  words: words(data.reviews.at(-1)?.outcome ?? ''),
                })}
              >
                {day(data.reviews.at(-1)?.at ?? null)}
              </Alert>
            )}
            <RadioGroup
              aria-label={tr('plan.outcome', 'Outcome')}
              value={outcome}
              onValueChange={(v) => {
                setOutcome(v as typeof outcome);
              }}
            >
              <RadioCard
                value="passed"
                description={tr(
                  'plan.people_records_the_probation_as_passed',
                  'People records the probation as passed.',
                )}
              >
                {tr('plan.passed', 'Passed')}
              </RadioCard>
              <RadioCard
                value="extended"
                description={tr(
                  'plan.within_what_the_contracts_country_allows',
                  'Within what the contract’s country allows.',
                )}
                disabled={(p.allowedExtensionMonths ?? 0) === 0}
              >
                {tr('plan.extend', 'Extend')}
              </RadioCard>
              <RadioCard
                value="failed"
                description={tr(
                  'plan.hr_is_told_ending_the_employment',
                  'HR is told; ending the employment is People’s flow.',
                )}
              >
                {tr('plan.not_passed', 'Not passed')}
              </RadioCard>
            </RadioGroup>
            {outcome === 'extended' ? (
              <NumberField
                label={tr('plan.extend_by_months', 'Extend by, months')}
                value={months}
                min={1}
                max={p.allowedExtensionMonths ?? 1}
                onChange={setMonths}
              />
            ) : null}
            <Button
              className="self-end"
              loading={act.pending}
              onClick={() => {
                act.run('ReviewProbation', {
                  planId: p.id,
                  input: { outcome, extendMonths: outcome === 'extended' ? months : null },
                });
              }}
            >
              {tr('plan.record_review', 'Record review')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('plan.move_s_start_date', 'Move {{name}}’s start date?', { name: p.name })}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'plan.every_open_task_that_hangs_off',
                'Every open task that hangs off the start moves with it, and probation’s end by as much.',
              )}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{tr('plan.new_start_date', 'New start date')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('plan.new_start_date', 'New start date')}
                value={start === '' ? null : start}
                onChange={(d) => {
                  setStart(d ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setMoving(false);
              }}
            >
              {tr('plan.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={start === p.startDate || start === ''}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'MoveOnboardingStart',
                  { planId: p.id, input: { startDate: start } },
                  () => {
                    setMoving(false);
                  },
                );
              }}
            >
              {tr('plan.move_the_tasks', 'Move the tasks')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
