import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Switch,
  TimePicker,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, useTransition, type JSX, type ReactNode } from 'react';

import { BenefitPicker } from './benefits';
import { Refusal, useAct } from './shared';
import type { JobData, JobTerms, ScreenProps } from './types';

/**
 * A job's terms, one small choice at a time and in order: the employing
 * entity, the workplace, how the work is done, the kind of work, the contracts
 * that country allows for it, the days, the hours, the leave, the pay and the
 * benefits. Every choice comes from Recruiting, which reads the country's law
 * and clears a later choice an earlier change has made impossible; this
 * screen offers only what it is given.
 *
 * Each body stands alone, so the setup can show one per step and the ad's
 * edit panel can show them grouped. A typed value (leave, pay) is kept when
 * the setup moves on, through `commit`, or by its own Save in the panel.
 */

/** What the setup calls before it moves on: true when the step's typed values are kept. */
export interface Commit {
  current: (() => Promise<boolean>) | null;
}

export interface TermsProps {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}

type Patch = Partial<JobTerms> & {
  readonly pay?: { readonly minMinor: number; readonly maxMinor: number } | null;
  readonly salaryShown?: boolean;
};

function useTerms(data: JobData, props: ScreenProps<JobData>) {
  const act = useAct(props);
  const [error, setError] = useState<string | null>(null);
  return {
    act,
    error: error ?? act.error,
    /** A pick: kept at once. */
    save: (patch: Patch): void => {
      setError(null);
      act.run('SaveJobTerms', { jobId: data.job.id, input: patch });
    },
    /** A typed value: kept when the person moves on, and the move waits for it. */
    keep: async (patch: Patch): Promise<boolean> => {
      setError(null);
      const done = await act.call('SaveJobTerms', { jobId: data.job.id, input: patch });
      if (!done.ok) {
        setError(done.message);
        return false;
      }
      props.onRefresh?.();
      return true;
    },
    setError,
  };
}

/** Registers what the setup calls before it moves on; the latest render's values win. */
export function useCommit(commit: Commit | undefined, fn: () => Promise<boolean>): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (commit === undefined) return;
    commit.current = () => latest.current();
    return () => {
      commit.current = null;
    };
  }, [commit]);
}

/** A step that waits on an earlier one, said plainly rather than shown empty. */
function Waiting({ what, icon }: { readonly what: string; readonly icon: ReactNode }): JSX.Element {
  return <EmptyState icon={icon} title="Not yet" description={what} />;
}

const COUNTRY: Readonly<Record<string, string>> = {
  DE: 'Germany',
  ES: 'Spain',
  GB: 'the United Kingdom',
  IN: 'India',
  US: 'the United States',
};

export const countryName = (code: string | null): string =>
  code === null ? 'that country' : (COUNTRY[code] ?? code);

function Unreviewed({ data }: { readonly data: JobData }): JSX.Element | null {
  return data.options.reviewed || data.options.country === null ? null : (
    <Alert tone="info" title="Rules awaiting a local reviewer">
      {`The rules for ${countryName(data.options.country)} are drafted and not yet checked by a lawyer there. Confirm them before an offer goes out.`}
    </Alert>
  );
}

export function EntityChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label="Employing entity"
        className="grid gap-2"
        value={data.terms.entityId ?? ''}
        onValueChange={(v) => {
          save({ entityId: v });
        }}
      >
        {data.options.entities.map((e) => (
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
    </>
  );
}

export function PlaceChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms, options } = data;
  if (terms.entityId === null)
    return (
      <Waiting icon={<icons.company aria-hidden />} what="Choose the employing entity first." />
    );
  if (options.locations.length === 0)
    return (
      <Alert tone="warning" title={`No workplace in ${countryName(options.country)} yet`}>
        Add one under Settings, Company, Locations, then come back.
      </Alert>
    );
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label="Workplace"
        className="grid gap-2"
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
    </>
  );
}

const MODES = [
  ['onsite', 'On site', 'Every day at the workplace.'],
  ['hybrid', 'Hybrid', 'Some days at the workplace, the rest from home.'],
  ['remote', 'Remote', 'From home, within the country’s law.'],
] as const;

export function ModeChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms } = data;
  if (terms.locationId === null)
    return <Waiting icon={<icons.location aria-hidden />} what="Choose the workplace first." />;
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label="How the work is done"
        className="grid gap-2 sm:grid-cols-3"
        value={terms.workMode ?? ''}
        onValueChange={(v) => {
          save({ workMode: v as NonNullable<JobTerms['workMode']> });
        }}
      >
        {MODES.map(([key, label, description]) => (
          <RadioCard key={key} value={key} description={description}>
            {label}
          </RadioCard>
        ))}
      </RadioGroup>
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
                {`${String(n)} day${n === 1 ? '' : 's'}`}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Field>
      ) : null}
    </>
  );
}

/** What each kind of work means, where the country's own rules give no line of their own. */
const RELATIONSHIP_NOTE: Readonly<Record<string, string>> = {
  employee: 'On the payroll, with the full protection of employment law.',
  worker: 'Paid for the work, with core rights such as holiday pay and the minimum wage.',
  contractor: 'Self-employed, invoicing for the work. No leave or payroll; misuse is a legal risk.',
};

export function WorkTypeChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms, options } = data;
  if (options.relationships.length === 0)
    return (
      <Waiting
        icon={<icons.location aria-hidden />}
        what="Choose the workplace and how the work is done first."
      />
    );
  return (
    <>
      <Refusal error={error} />
      <Unreviewed data={data} />
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
            icon={<icons.work aria-hidden />}
            disabled={r.unavailable != null}
            description={r.unavailable ?? r.note ?? RELATIONSHIP_NOTE[r.key] ?? ''}
          >
            {r.label}
          </RadioCard>
        ))}
      </RadioGroup>
    </>
  );
}

export function ContractChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms, options } = data;
  const chosen = options.contractTypes.find((t) => t.key === terms.contractType);
  if (terms.relationship === null)
    return <Waiting icon={<icons.agreement aria-hidden />} what="Choose the work type first." />;
  return (
    <>
      <Refusal error={error} />
      <Unreviewed data={data} />
      <RadioGroup
        aria-label="Contract"
        className="grid gap-2"
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
            description={t.unavailable ?? t.note ?? ''}
          >
            {t.label}
          </RadioCard>
        ))}
      </RadioGroup>
      {chosen?.fixedTerm === true && options.fixedTermReasons.length > 0 ? (
        <Field required>
          <FieldLabel>Why it is fixed term</FieldLabel>
          <FieldDescription>The law there asks for the reason in the contract.</FieldDescription>
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
    </>
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

export function DaysChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms } = data;
  if (terms.contractType === null)
    return <Waiting icon={<icons.agreement aria-hidden />} what="Choose the contract first." />;
  return (
    <>
      <Refusal error={error} />
      <ChipRow aria-label="Work days">
        {DAYS.map(([d, label]) => {
          const on = terms.workDays.includes(d);
          return (
            <Chip
              key={d}
              selected={on}
              onClick={() => {
                save({
                  workDays: on ? terms.workDays.filter((x) => x !== d) : [...terms.workDays, d],
                });
              }}
            >
              {label}
            </Chip>
          );
        })}
      </ChipRow>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            save({ workDays: [1, 2, 3, 4, 5] });
          }}
        >
          Monday to Friday
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            save({ workDays: [1, 2, 3, 4] });
          }}
        >
          Monday to Thursday
        </Button>
      </div>
    </>
  );
}

const hhmm = (minutes: number | null): string | null =>
  minutes === null
    ? null
    : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const minutesOf = (time: string | null): number | null => {
  if (time === null) return null;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const hoursOf = (minutes: number): string => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? String(h) : h.toFixed(1)} h`;
};

const BREAKS = [0, 15, 30, 45, 60, 90] as const;

export function HoursChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save } = useTerms(data, props);
  const { terms, options } = data;
  if (terms.workDays.length === 0)
    return <Waiting icon={<icons.calendar aria-hidden />} what="Choose the work days first." />;
  const over =
    options.weeklyMinutes !== null &&
    options.maxWeeklyMinutes !== null &&
    options.weeklyMinutes > options.maxWeeklyMinutes;
  return (
    <>
      <Refusal error={error} />
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
            { label: 'A week', value: hoursOf(options.weeklyMinutes) },
            {
              label: 'Full time there',
              value:
                options.fullTimeWeeklyMinutes === null
                  ? 'Not set'
                  : hoursOf(options.fullTimeWeeklyMinutes),
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
              : [{ label: 'The law’s limit', value: hoursOf(options.maxWeeklyMinutes) }]),
          ]}
        />
      )}
      {over ? (
        <Alert tone="danger" title="Over the legal week">
          Shorten the day or take a day off the week.
        </Alert>
      ) : null}
    </>
  );
}

export function LeaveChoice({ data, props, commit }: TermsProps): JSX.Element {
  const { act, error, keep } = useTerms(data, props);
  const { terms, options } = data;
  const leave = options.leave;
  // Prefilled with the law's minimum, so the step can be passed as it stands.
  const [days, setDays] = useState<number | null>(terms.vacationDays ?? leave?.days ?? null);
  const persist = async (): Promise<boolean> =>
    days === null || days === terms.vacationDays ? true : keep({ vacationDays: days });
  useCommit(commit, persist);
  if (leave === null)
    return <Waiting icon={<icons.vacation aria-hidden />} what="Choose the work type first." />;
  const unit = leave.unit === 'calendar_days' ? 'calendar days' : 'working days';
  return (
    <>
      <Refusal error={error} />
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
      <NumberField
        label={`Paid holiday, ${unit} a year`}
        value={days}
        min={leave.days}
        max={60}
        onChange={setDays}
        className="max-w-xs"
      />
      {leave.days > 0 ? (
        <ChipRow aria-label="Common choices">
          {[leave.days, leave.days + 5, leave.days + 10].map((n) => (
            <Chip
              key={n}
              selected={days === n}
              onClick={() => {
                setDays(n);
              }}
            >
              {n === leave.days ? `${String(n)}, the minimum` : `${String(n)} days`}
            </Chip>
          ))}
        </ChipRow>
      ) : null}
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={days === null || days === terms.vacationDays}
            onClick={() => {
              void persist();
            }}
          >
            Save time off
          </Button>
        </div>
      ) : null}
    </>
  );
}

const major = (minor: number): number => Math.round(minor / 100);

interface PaySuggestion {
  readonly minMinor: number;
  readonly maxMinor: number;
  readonly basis: string;
  readonly confidence: 'low' | 'medium' | 'high';
}

/**
 * Pay: one figure, or a range from and to, yearly, in the entity's currency.
 * The first time, a model estimates what the market pays for the job where it
 * is and the figures arrive filled in, marked as its suggestion; a person
 * keeps or changes them. Recruiting refuses anything below the legal minimum.
 */
export function PayChoice({ data, props, commit }: TermsProps): JSX.Element {
  const { act, error, keep, setError } = useTerms(data, props);
  const { terms, options, job } = data;
  const [kind, setKind] = useState<'fixed' | 'range'>(terms.payKind ?? 'range');
  const [min, setMin] = useState<number | null>(
    job.salary === null ? null : major(job.salary.minMinor),
  );
  const [max, setMax] = useState<number | null>(
    job.salary === null ? null : major(job.salary.maxMinor),
  );
  const [shown, setShown] = useState(job.salaryShown);
  const [suggested, setSuggested] = useState<PaySuggestion | null>(null);
  const [touched, setTouched] = useState(false);
  const [asking, startAsking] = useTransition();
  const ready = options.currency !== null && terms.locationId !== null;
  const ask = (k: 'fixed' | 'range'): void => {
    startAsking(async () => {
      const done = await act.call('SuggestJobPay', { jobId: job.id, input: { kind: k } });
      if (!done.ok) {
        setError(done.message);
        return;
      }
      const s = done.data as PaySuggestion;
      setSuggested(s);
      setTouched(false);
      setMin(major(s.minMinor));
      setMax(major(s.maxMinor));
    });
  };
  // The first visit with no pay set: the market's figures arrive filled in.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || job.salary !== null || !ready) return;
    asked.current = true;
    ask(kind);
  });
  const persist = async (): Promise<boolean> => {
    if (min === null) return true;
    const top = kind === 'fixed' ? min : (max ?? min);
    return keep({
      payKind: kind,
      pay: { minMinor: Math.round(min * 100), maxMinor: Math.round(top * 100) },
      salaryShown: shown,
    });
  };
  useCommit(commit, persist);
  if (!ready)
    return (
      <Waiting
        icon={<icons.location aria-hidden />}
        what="Choose the employing entity and the workplace first: pay depends on where the work is."
      />
    );
  const currency = options.currency;
  const floor = options.minimumPayMinor === null ? null : Math.ceil(options.minimumPayMinor / 100);
  return (
    <>
      <Refusal error={error} />
      <SegmentedControl
        aria-label="Kind of pay"
        value={kind}
        onValueChange={(v) => {
          const next = v as 'fixed' | 'range';
          setKind(next);
          // Untouched figures are the model's: ask it again for the other kind.
          if (!touched && suggested !== null) ask(next);
          else if (next === 'fixed' && min !== null && max !== null)
            setMin(Math.round((min + max) / 2 / 500) * 500);
          else if (next === 'range' && max === null) setMax(min);
        }}
      >
        <SegmentedControlItem value="range">A range</SegmentedControlItem>
        <SegmentedControlItem value="fixed">A fixed salary</SegmentedControlItem>
      </SegmentedControl>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label={kind === 'fixed' ? 'Yearly salary' : 'From, a year'}
          value={min}
          min={floor ?? 0}
          step={500}
          prefix={currency}
          disabled={asking}
          onChange={(n) => {
            setTouched(true);
            setMin(n);
          }}
        />
        {kind === 'range' ? (
          <NumberField
            label="To, a year"
            value={max}
            min={min ?? floor ?? 0}
            step={500}
            prefix={currency}
            disabled={asking}
            onChange={(n) => {
              setTouched(true);
              setMax(n);
            }}
          />
        ) : null}
      </div>
      {asking ? (
        <Alert tone="info" icon={<icons.assistant aria-hidden />} title="Estimating the market pay">
          From the role, the level and the place.
        </Alert>
      ) : suggested !== null ? (
        <Alert
          tone="info"
          icon={<icons.assistant aria-hidden />}
          title={`${touched ? 'Changed from the' : 'The'} AI’s estimate, ${suggested.confidence} confidence`}
        >
          {`${suggested.basis} An estimate, not survey data: check it against what you pay today.`}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {floor === null
            ? 'Yearly and gross, before tax.'
            : `Yearly and gross. The legal minimum at these hours is ${currency} ${floor.toLocaleString()}.`}
        </p>
        <Button
          size="sm"
          variant="secondary"
          loading={asking}
          startIcon={<icons.assistant aria-hidden />}
          onClick={() => {
            ask(kind);
          }}
        >
          {suggested === null ? 'Suggest with AI' : 'Estimate again'}
        </Button>
      </div>
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>Show the pay in the ad</FieldLabel>
          <FieldDescription>
            Required in some places, and candidates apply more readily when they see it.
          </FieldDescription>
        </span>
        <FieldControl>
          <Switch checked={shown} onCheckedChange={setShown} />
        </FieldControl>
      </Field>
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={min === null}
            onClick={() => {
              void persist();
            }}
          >
            Save pay
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Benefits: every category's tiles, chosen as many as suit, kept when the
 * setup moves on (or by Save in the ad's panel), so a run of picks is one
 * save rather than one per press.
 */
export function BenefitsChoice({ data, props, commit }: TermsProps): JSX.Element {
  const { act, error, keep } = useTerms(data, props);
  const { terms, options } = data;
  const [chosen, setChosen] = useState<readonly string[]>(terms.benefitIds);
  const changed =
    chosen.length !== terms.benefitIds.length ||
    chosen.some((id) => !terms.benefitIds.includes(id));
  const persist = async (): Promise<boolean> =>
    changed ? keep({ benefitIds: [...chosen] }) : true;
  useCommit(commit, persist);
  if (terms.entityId === null)
    return (
      <Waiting icon={<icons.company aria-hidden />} what="Choose the employing entity first." />
    );
  if (options.benefits.length === 0)
    return (
      <EmptyState
        icon={<icons.payment aria-hidden />}
        title="No benefits in the catalogue"
        description="Add them under Settings, Recruiting, Benefits."
      />
    );
  return (
    <>
      <Refusal error={error} />
      <BenefitPicker
        benefits={options.benefits}
        categories={options.categories}
        chosen={chosen}
        onChange={setChosen}
      />
      {commit === undefined ? (
        <div className="sticky bottom-0 flex justify-end bg-canvas/95 py-3 backdrop-blur">
          <Button
            loading={act.pending}
            disabled={!changed}
            onClick={() => {
              void persist();
            }}
          >
            Save benefits
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Group({
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

/** The ad's edit panel: every term grouped, in the same order the setup asks for them. */
export function TermsCards({ data, props }: TermsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Group title="Workplace" description="The employing entity, where the work is, and how.">
        <EntityChoice data={data} props={props} />
        <PlaceChoice data={data} props={props} />
        <ModeChoice data={data} props={props} />
      </Group>
      <Group
        title="Work type"
        description={`The kinds of work ${countryName(data.options.country)} recognises.`}
      >
        <WorkTypeChoice data={data} props={props} />
      </Group>
      <Group title="Contract" description="Only what the law there allows for this kind of work.">
        <ContractChoice data={data} props={props} />
      </Group>
      <Group title="Days and hours" description="Checked against the legal week.">
        <DaysChoice data={data} props={props} />
        <HoursChoice data={data} props={props} />
      </Group>
      <Group title="Time off" description="Never below the legal minimum.">
        <LeaveChoice data={data} props={props} />
      </Group>
      <Group title="Pay" description="Yearly, in the entity’s currency.">
        <PayChoice data={data} props={props} />
      </Group>
    </div>
  );
}
