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

/**
 * O3: a plan, its tasks by phase; O4: moving the start; O7: check-ins; O8:
 * the probation review. Onboarding decides who may tick what (`mine`); the
 * screen offers only that.
 */

const PHASES: readonly [Phase, string][] = [
  ['before_start', 'Before day one'],
  ['day_one', 'Day one'],
  ['first_week', 'First week'],
  ['first_month', 'First month'],
  ['probation', 'Until probation ends'],
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
        title={`${p.name}’s plan`}
        meta={<StateBadge state={p.state} />}
        description={[`Starts ${day(p.startDate)}`, p.department, p.location]
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
              Move start date
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
                          Late
                        </Badge>
                      ) : t.locked ? (
                        <Badge size="sm">Country</Badge>
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
              label={`${String(data.progress.done)} of ${String(data.progress.total)} tasks`}
            />
            <KeyValues
              items={[
                { label: 'Manager', value: data.manager ?? '—' },
                { label: 'Buddy', value: data.buddy ?? 'Not chosen' },
                {
                  label: 'Probation',
                  value: p.probationEnd === null ? 'None' : `Ends ${day(p.probationEnd)}`,
                },
              ]}
            />
            {data.may.setBuddy && open ? (
              <div className="flex items-end gap-2">
                <Field className="flex-1">
                  <FieldLabel>Buddy</FieldLabel>
                  <Select value={buddy} onValueChange={setBuddy}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      <SelectItem value="none">Nobody yet</SelectItem>
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
                  Save
                </Button>
              </div>
            ) : null}
          </Card>
          {data.may.checkIn ? (
            <Card>
              <CardHeader>
                <CardTitle level={2}>Check-in</CardTitle>
                <CardDescription>
                  At day 30, 60 and 90, for the new hire and the manager
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Select
                  value={checkDay}
                  onValueChange={(v) => {
                    setCheckDay(v as typeof checkDay);
                  }}
                >
                  <SelectTrigger aria-label="Which check-in">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['30', '60', '90'] as const).map((d) => (
                      <SelectItem key={d} value={d}>{`Day ${d}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Field>
                  <FieldLabel>How is it going?</FieldLabel>
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
                  Submit
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {data.checkIns.length === 0 ? null : (
            <Card padded>
              <KeyValues
                items={data.checkIns.map((c) => ({
                  label: `Day ${String(c.day)}`,
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
            <CardTitle level={2}>Probation review</CardTitle>
            <CardDescription>
              {`Ends ${day(p.probationEnd)}${p.allowedExtensionMonths === null || p.allowedExtensionMonths === 0 ? ' · no extension allowed' : ` · may be extended by up to ${String(p.allowedExtensionMonths)} months`}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.reviews.length === 0 ? null : (
              <Alert tone="info" title={`Recorded: ${words(data.reviews.at(-1)?.outcome ?? '')}`}>
                {day(data.reviews.at(-1)?.at ?? null)}
              </Alert>
            )}
            <RadioGroup
              aria-label="Outcome"
              value={outcome}
              onValueChange={(v) => {
                setOutcome(v as typeof outcome);
              }}
            >
              <RadioCard value="passed" description="People records the probation as passed.">
                Passed
              </RadioCard>
              <RadioCard
                value="extended"
                description="Within what the contract’s country allows."
                disabled={(p.allowedExtensionMonths ?? 0) === 0}
              >
                Extend
              </RadioCard>
              <RadioCard
                value="failed"
                description="HR is told; ending the employment is People’s flow."
              >
                Not passed
              </RadioCard>
            </RadioGroup>
            {outcome === 'extended' ? (
              <NumberField
                label="Extend by, months"
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
              Record review
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Move ${p.name}’s start date?`}</DialogTitle>
            <DialogDescription>
              Every open task that hangs off the start moves with it, and probation’s end by as
              much.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>New start date</FieldLabel>
            <FieldControl>
              <DatePicker
                label="New start date"
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
              Cancel
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
              Move the tasks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
