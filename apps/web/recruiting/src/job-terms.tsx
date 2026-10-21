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
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  KeyValues,
  NumberField,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimePicker,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Refusal, useAct } from './shared';
import type { JobData, JobTerms, ScreenProps } from './types';

/**
 * A job's terms, one step each and in order: where the work is, what kind of
 * work, the contracts the law of that country allows for it, the hours and
 * days, the leave, the benefits. Every choice comes from Recruiting, which
 * reads the country's rules and clears a later choice an earlier change has
 * made impossible; this screen offers only what it is given.
 */

type Props = { readonly data: JobData; readonly props: ScreenProps<JobData> };

function useTerms(data: JobData, props: ScreenProps<JobData>) {
  const act = useAct(props);
  return {
    act,
    save: (patch: Partial<JobTerms>): void => {
      act.run('SaveJobTerms', { jobId: data.job.id, input: patch });
    },
  };
}

/** A step that waits on an earlier one, said plainly rather than shown empty. */
function Waiting({ what, icon }: { readonly what: string; readonly icon: ReactNode }): JSX.Element {
  return <EmptyState icon={icon} title="Not yet" description={what} />;
}

function Step({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

const COUNTRY: Readonly<Record<string, string>> = {
  DE: 'Germany',
  ES: 'Spain',
  GB: 'the United Kingdom',
  IN: 'India',
  US: 'the United States',
};

const countryName = (code: string | null): string =>
  code === null ? 'that country' : (COUNTRY[code] ?? code);

export function Workplace({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  return (
    <Step
      title="Workplace"
      description="The employing entity and where the work is done. Everything after this follows that country’s law."
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>Employing entity</FieldLabel>
        <RadioGroup
          aria-label="Employing entity"
          className="grid gap-2 sm:grid-cols-2"
          value={terms.entityId ?? ''}
          onValueChange={(v) => {
            save({ entityId: v });
          }}
        >
          {options.entities.map((e) => (
            <RadioCard
              key={e.id}
              value={e.id}
              icon={<icons.company aria-hidden />}
              description={`${countryName(e.country)} · pays in ${e.currency}`}
            >
              {e.name}
            </RadioCard>
          ))}
        </RadioGroup>
      </Field>
      {terms.entityId === null ? null : options.locations.length === 0 ? (
        <Alert tone="warning" title={`No workplace in ${countryName(options.country)} yet`}>
          Add one under Settings, Company, Locations, then come back.
        </Alert>
      ) : (
        <Field required>
          <FieldLabel>Workplace</FieldLabel>
          <RadioGroup
            aria-label="Workplace"
            className="grid gap-2 sm:grid-cols-2"
            value={terms.locationId ?? ''}
            onValueChange={(v) => {
              save({ locationId: v });
            }}
          >
            {options.locations.map((l) => (
              <RadioCard
                key={l.id}
                value={l.id}
                icon={<icons.location aria-hidden />}
                description={l.city ?? countryName(l.country)}
              >
                {l.name}
              </RadioCard>
            ))}
          </RadioGroup>
        </Field>
      )}
      {terms.locationId === null ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field required>
            <FieldLabel>How the work is done</FieldLabel>
            <SegmentedControl
              aria-label="How the work is done"
              value={terms.workMode ?? ''}
              onValueChange={(v) => {
                save({ workMode: v as NonNullable<JobTerms['workMode']> });
              }}
            >
              <SegmentedControlItem value="onsite">On site</SegmentedControlItem>
              <SegmentedControlItem value="hybrid">Hybrid</SegmentedControlItem>
              <SegmentedControlItem value="remote">Remote</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          {terms.workMode === 'hybrid' ? (
            <Field required>
              <FieldLabel>Days on site a week</FieldLabel>
              <SegmentedControl
                aria-label="Days on site a week"
                value={terms.hybridDaysOnsite === null ? '' : String(terms.hybridDaysOnsite)}
                onValueChange={(v) => {
                  save({ hybridDaysOnsite: Number(v) });
                }}
              >
                {[1, 2, 3, 4].map((n) => (
                  <SegmentedControlItem key={n} value={String(n)}>
                    {String(n)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </Field>
          ) : null}
        </div>
      )}
    </Step>
  );
}

/** What each kind of work means, in a line; the law that decides it is the country's. */
const RELATIONSHIP_NOTE: Readonly<Record<string, string>> = {
  employee: 'On the payroll, with the full protection of employment law.',
  worker: 'Paid for the work, with core rights such as holiday pay and the minimum wage.',
  contractor: 'Self-employed, invoicing for the work. No leave or payroll; misuse is a legal risk.',
};

export function WorkType({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  return (
    <Step
      title="Work type"
      description={`The kinds of work ${countryName(options.country)} recognises. The contracts on offer depend on it.`}
    >
      <Refusal error={act.error} />
      {options.reviewed ? null : (
        <Alert tone="info" title="Rules awaiting a local reviewer">
          {`The rules for ${countryName(options.country)} are drafted and not yet checked by a lawyer there. Confirm them before an offer goes out.`}
        </Alert>
      )}
      {options.relationships.length === 0 ? (
        <Waiting
          icon={<icons.location aria-hidden />}
          what="Choose the workplace and how the work is done first."
        />
      ) : (
        <RadioGroup
          aria-label="Work type"
          className="grid gap-2"
          value={terms.relationship ?? ''}
          onValueChange={(v) => {
            save({ relationship: v });
          }}
        >
          {options.relationships.map((r) => (
            <RadioCard
              key={r.key}
              value={r.key}
              disabled={r.unavailable != null}
              description={r.unavailable ?? RELATIONSHIP_NOTE[r.key] ?? ''}
            >
              {r.label}
            </RadioCard>
          ))}
        </RadioGroup>
      )}
    </Step>
  );
}

export function Contract({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  const chosen = options.contractTypes.find((t) => t.key === terms.contractType);
  return (
    <Step
      title="Contract"
      description={`Only the contracts ${countryName(options.country)} allows for this kind of work. One that does not fit says why.`}
    >
      <Refusal error={act.error} />
      {terms.relationship === null ? (
        <Waiting icon={<icons.agreement aria-hidden />} what="Choose the work type first." />
      ) : (
        <RadioGroup
          aria-label="Contract"
          className="grid gap-2 sm:grid-cols-2"
          value={terms.contractType ?? ''}
          onValueChange={(v) => {
            save({ contractType: v });
          }}
        >
          {options.contractTypes.map((t) => (
            <RadioCard
              key={t.key}
              value={t.key}
              disabled={t.unavailable != null}
              badge={
                <Badge size="xs" variant="soft" tone={t.fixedTerm ? 'warning' : 'neutral'}>
                  {t.fixedTerm ? 'Fixed term' : 'Open-ended'}
                </Badge>
              }
              {...(t.unavailable == null ? {} : { description: t.unavailable })}
            >
              {t.label}
            </RadioCard>
          ))}
        </RadioGroup>
      )}
      {chosen?.fixedTerm === true && options.fixedTermReasons.length > 0 ? (
        <Field required>
          <FieldLabel>Why it is fixed term</FieldLabel>
          <FieldDescription>The law there asks for a reason in the contract.</FieldDescription>
          <Select
            value={terms.fixedTermReason ?? ''}
            onValueChange={(v) => {
              save({ fixedTermReason: v });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {options.fixedTermReasons.map((r) => (
                <SelectItem key={r.key} value={r.key} disabled={r.unavailable != null}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </Step>
  );
}

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

const hhmm = (minutes: number | null): string | null =>
  minutes === null
    ? null
    : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const minutesOf = (time: string | null): number | null => {
  if (time === null) return null;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const hours = (minutes: number): string => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? String(h) : h.toFixed(1)} h`;
};

const BREAKS = [0, 15, 30, 45, 60, 90] as const;

export function Hours({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  const over =
    options.weeklyMinutes !== null &&
    options.maxWeeklyMinutes !== null &&
    options.weeklyMinutes > options.maxWeeklyMinutes;
  return (
    <Step
      title="Hours and days"
      description="The days worked and the working day, in the workplace’s own time. The week is checked against the law there."
    >
      <Refusal error={act.error} />
      {terms.contractType === null ? (
        <Waiting icon={<icons.agreement aria-hidden />} what="Choose the contract first." />
      ) : (
        <>
          <Field required>
            <FieldLabel>Work days</FieldLabel>
            <ChipRow aria-label="Work days">
              {DAYS.map(([d, label]) => {
                const on = terms.workDays.includes(d);
                return (
                  <Chip
                    key={d}
                    selected={on}
                    onClick={() => {
                      save({
                        workDays: on
                          ? terms.workDays.filter((x) => x !== d)
                          : [...terms.workDays, d],
                      });
                    }}
                  >
                    {label}
                  </Chip>
                );
              })}
            </ChipRow>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field required>
              <FieldLabel>Starts</FieldLabel>
              <FieldControl>
                <TimePicker
                  label="Starts"
                  step={15}
                  value={hhmm(terms.dayStart)}
                  onChange={(t) => {
                    save({ dayStart: minutesOf(t) });
                  }}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>Ends</FieldLabel>
              <FieldControl>
                <TimePicker
                  label="Ends"
                  step={15}
                  value={hhmm(terms.dayEnd)}
                  onChange={(t) => {
                    save({ dayEnd: minutesOf(t) });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Unpaid break</FieldLabel>
              <Select
                value={String(terms.breakMinutes)}
                onValueChange={(v) => {
                  save({ breakMinutes: Number(v) });
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {BREAKS.map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      {b === 0 ? 'None' : `${String(b)} min`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {options.weeklyMinutes === null ? null : (
            <KeyValues
              layout="split"
              items={[
                { label: 'A week', value: hours(options.weeklyMinutes) },
                {
                  label: 'Full time there',
                  value:
                    options.fullTimeWeeklyMinutes === null
                      ? 'Not set'
                      : hours(options.fullTimeWeeklyMinutes),
                },
                {
                  label: 'So this is',
                  value: (
                    <Badge size="sm" variant="soft" tone="accent">
                      {options.hours === 'full_time' ? 'Full time' : 'Part time'}
                    </Badge>
                  ),
                },
                ...(options.maxWeeklyMinutes === null
                  ? []
                  : [{ label: 'The law’s limit', value: hours(options.maxWeeklyMinutes) }]),
              ]}
            />
          )}
          {over ? (
            <Alert tone="danger" title="Over the legal week">
              Shorten the day or take a day off the week.
            </Alert>
          ) : null}
        </>
      )}
    </Step>
  );
}

export function Leave({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  const [days, setDays] = useState<number | null>(
    terms.vacationDays ?? options.leave?.days ?? null,
  );
  const leave = options.leave;
  const unit = leave?.unit === 'calendar_days' ? 'calendar days' : 'working days';
  return (
    <Step
      title="Time off"
      description="Paid holiday a year, never below what the law there gives this kind of work."
    >
      <Refusal error={act.error} />
      {leave === null ? (
        <Waiting icon={<icons.vacation aria-hidden />} what="Choose the work type first." />
      ) : (
        <>
          <Alert
            tone="info"
            title={
              leave.days === 0
                ? 'No legal minimum'
                : `The legal minimum is ${String(leave.days)} ${unit} a year`
            }
          >
            {`${leave.note} (${leave.source})`}
          </Alert>
          <div className="flex flex-wrap items-end gap-3">
            <NumberField
              label={`Paid holiday (${unit} a year)`}
              value={days}
              min={leave.days}
              max={60}
              onChange={setDays}
            />
            <Button
              variant="secondary"
              loading={act.pending}
              disabled={days === null || days === terms.vacationDays}
              onClick={() => {
                save({ vacationDays: days });
              }}
            >
              Save
            </Button>
          </div>
          {terms.vacationDays === null ? null : (
            <p className="text-sm text-fg-muted">{`Saved: ${String(terms.vacationDays)} ${unit}${leave.days > 0 ? `, ${String(terms.vacationDays - leave.days)} above the minimum` : ''}.`}</p>
          )}
        </>
      )}
    </Step>
  );
}

export function Benefits({ data, props }: Props): JSX.Element {
  const { act, save } = useTerms(data, props);
  const { terms, options } = data;
  const groups = new Map<string, (typeof options.benefits)[number][]>();
  for (const b of options.benefits) groups.set(b.category, [...(groups.get(b.category) ?? []), b]);
  return (
    <Step
      title="Benefits"
      description="From the entity’s catalogue. Those the law requires are always in."
    >
      <Refusal error={act.error} />
      {terms.entityId === null ? (
        <Waiting icon={<icons.company aria-hidden />} what="Choose the workplace first." />
      ) : options.benefits.length === 0 ? (
        <EmptyState
          icon={<icons.payment aria-hidden />}
          title="No benefits in the catalogue"
          description="Add them under Settings, Recruiting, Benefits."
        />
      ) : (
        [...groups].map(([category, list]) => (
          <section key={category} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg-muted capitalize">
              {category.replaceAll('_', ' ')}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((b) => {
                const on = b.statutory || terms.benefitIds.includes(b.id);
                return (
                  <Field key={b.id} orientation="horizontal">
                    <FieldControl>
                      <Checkbox
                        checked={on}
                        disabled={b.statutory || act.pending}
                        onCheckedChange={(next) => {
                          save({
                            benefitIds:
                              next === true
                                ? [...terms.benefitIds, b.id]
                                : terms.benefitIds.filter((id) => id !== b.id),
                          });
                        }}
                      />
                    </FieldControl>
                    <span className="flex min-w-0 items-center gap-2">
                      <FieldLabel>{b.name}</FieldLabel>
                      {b.statutory ? (
                        <Badge size="xs" variant="soft" tone="info">
                          By law
                        </Badge>
                      ) : null}
                    </span>
                  </Field>
                );
              })}
            </div>
          </section>
        ))
      )}
    </Step>
  );
}
