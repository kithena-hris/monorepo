import {
  Alert,
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  icons,
  KeyValues,
  NumberField,
  numberFormat,
  RadioCard,
  RadioGroup,
  RangeBar,
  Reveal,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  staggerStyle,
  Switch,
  TimePicker,
} from '@reach/ui';
import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import { BenefitPicker } from './benefits';
import { usePicks } from './terms-view';
import { Refusal, useAct } from './shared';
import type { JobData, JobTerms, ScreenProps } from './types';
import { t as tr } from './i18n';

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

/**
 * What the setup calls before it moves on. A page holds several parts, and
 * each part that holds typed values adds what keeps them; the page moves on
 * only when every one returns true.
 */
export interface Commit {
  readonly add: (keep: () => Promise<boolean>) => () => void;
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

/**
 * Saves that are still on their way: the setup waits for them before it moves
 * on, so the next step is drawn from what was just chosen. Outside the setup
 * nothing waits.
 */
export const SaveQueue = createContext<((save: Promise<unknown>) => void) | null>(null);

/**
 * Whether each part of a setup page is answered, as it stands on the screen:
 * a part that keeps typed values until the page moves on says so here, so
 * Continue waits for every answer without waiting for a save. The setup
 * provides both; outside it nothing listens.
 */
export const Answers = createContext<((key: string, answered: boolean) => void) | null>(null);
export const PartKey = createContext<string | null>(null);

export function useAnswered(answered: boolean): void {
  const report = use(Answers);
  const key = use(PartKey);
  useEffect(() => {
    if (report !== null && key !== null) report(key, answered);
  }, [report, key, answered]);
}

function useTerms(data: JobData, props: ScreenProps<JobData>) {
  const act = useAct(props);
  const track = use(SaveQueue);
  // In the setup, picks live in one overlay every part reads; elsewhere, in this part alone.
  const shared = usePicks();
  const [error, setError] = useState<string | null>(null);
  // A pick shows the moment it is made; the server's terms replace it when they arrive.
  const [pick, setPick] = useState<{ base: JobTerms; patch: Partial<JobTerms> }>({
    base: data.terms,
    patch: {},
  });
  if (shared === null && pick.base !== data.terms) setPick({ base: data.terms, patch: {} });
  const patch = shared !== null ? shared.picks : pick.base === data.terms ? pick.patch : {};
  const terms: JobTerms = { ...data.terms, ...patch };
  return {
    act,
    error: error ?? act.error,
    /** The terms as they stand, the picks on their way included. */
    terms,
    /** A pick: shown at once, kept in the background, undone if Recruiting refuses it. */
    save: (next: Patch): void => {
      setError(null);
      const { pay: _pay, salaryShown: _shown, ...shown } = next;
      if (shared === null) setPick({ base: data.terms, patch: { ...patch, ...shown } });
      else shared.add(shown);
      const saving = act.call('SaveJobTerms', { jobId: data.job.id, input: next }).then((done) => {
        if (!done.ok) {
          setError(done.message);
          if (shared === null) setPick({ base: data.terms, patch: {} });
          else shared.drop(Object.keys(shown));
          return;
        }
        props.onRefresh?.();
      });
      track?.(saving);
    },
    /** A typed value: kept when the person moves on, and the move waits for it. */
    keep: async (next: Patch): Promise<boolean> => {
      setError(null);
      const done = await act.call('SaveJobTerms', { jobId: data.job.id, input: next });
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
  useEffect(() => commit?.add(() => latest.current()), [commit]);
}

/** A step that waits on an earlier one, said plainly rather than shown empty. */
function Waiting({ what, icon }: { readonly what: string; readonly icon: ReactNode }): JSX.Element {
  return <EmptyState icon={icon} title={tr('job-terms.not_yet', 'Not yet')} description={what} />;
}

const COUNTRY: Readonly<Record<string, string>> = {
  DE: tr('job-terms.germany', 'Germany'),
  ES: tr('job-terms.spain', 'Spain'),
  GB: tr('job-terms.the_united_kingdom', 'the United Kingdom'),
  IN: tr('job-terms.india', 'India'),
  US: tr('job-terms.the_united_states', 'the United States'),
};

export const countryName = (code: string | null): string =>
  code === null ? tr('job-terms.that_country', 'that country') : (COUNTRY[code] ?? code);

function Unreviewed({ data }: { readonly data: JobData }): JSX.Element | null {
  return data.options.reviewed || data.options.country === null ? null : (
    <Alert
      tone="info"
      title={tr('job-terms.rules_awaiting_a_local_reviewer', 'Rules awaiting a local reviewer')}
    >
      {tr(
        'job-terms.the_rules_for_are_drafted_and',
        'The rules for {{countryName}} are drafted and not yet checked by a lawyer there. Confirm them before an offer goes out.',
        { countryName: countryName(data.options.country) },
      )}
    </Alert>
  );
}

export function EntityChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label={tr('job-terms.employing_entity', 'Employing entity')}
        className="grid gap-2"
        value={terms.entityId ?? ''}
        onValueChange={(v) => {
          save({ entityId: v });
        }}
      >
        {data.options.entities.map((e, i) => (
          <div key={e.id} className="animate-arrive" style={staggerStyle(i, 'animation')}>
            <RadioCard
              value={e.id}
              icon={<icons.company aria-hidden />}
              description={tr('job-terms.pays_in', '{{countryName}} · pays in {{currency}}', {
                countryName: countryName(e.country),
                currency: e.currency,
              })}
            >
              {e.name}
            </RadioCard>
          </div>
        ))}
      </RadioGroup>
    </>
  );
}

export function PlaceChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  const { options } = data;
  if (terms.entityId === null)
    return (
      <Waiting icon={<icons.company aria-hidden />} what="Choose the employing entity first." />
    );
  if (options.locations.length === 0)
    return (
      <Alert
        tone="warning"
        title={tr('job-terms.no_workplace_in_yet', 'No workplace in {{countryName}} yet', {
          countryName: countryName(options.country),
        })}
      >
        {tr(
          'job-terms.add_one_under_settings_company_locations',
          'Add one under Settings, Company, Locations, then come back.',
        )}
      </Alert>
    );
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label={tr('job-terms.workplace', 'Workplace')}
        className="grid gap-2"
        value={terms.locationId ?? ''}
        onValueChange={(v) => {
          save({ locationId: v });
        }}
      >
        {options.locations.map((l, i) => (
          <div key={l.id} className="animate-arrive" style={staggerStyle(i, 'animation')}>
            <RadioCard
              value={l.id}
              icon={<icons.location aria-hidden />}
              description={l.city ?? countryName(l.country)}
            >
              {l.name}
            </RadioCard>
          </div>
        ))}
      </RadioGroup>
    </>
  );
}

const MODES = [
  [
    'onsite',
    tr('job-terms.on_site', 'On site'),
    tr('job-terms.every_day_at_the_workplace', 'Every day at the workplace.'),
    <icons.company key="i" aria-hidden />,
  ],
  [
    'hybrid',
    tr('job-terms.hybrid', 'Hybrid'),
    tr(
      'job-terms.some_days_at_the_workplace_the',
      'Some days at the workplace, the rest from home.',
    ),
    <icons.transfer key="i" aria-hidden />,
  ],
  [
    'remote',
    tr('job-terms.remote', 'Remote'),
    tr('job-terms.from_home_within_the_countrys_law', 'From home, within the country’s law.'),
    <icons.home key="i" aria-hidden />,
  ],
] as const;

export function ModeChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  if (terms.locationId === null)
    return <Waiting icon={<icons.location aria-hidden />} what="Choose the workplace first." />;
  return (
    <>
      <Refusal error={error} />
      <RadioGroup
        aria-label={tr('job-terms.how_the_work_is_done', 'How the work is done')}
        className="grid gap-2 sm:grid-cols-3"
        value={terms.workMode ?? ''}
        onValueChange={(v) => {
          save({ workMode: v as NonNullable<JobTerms['workMode']> });
        }}
      >
        {MODES.map(([key, label, description, icon]) => (
          <RadioCard key={key} value={key} description={description} icon={icon}>
            {label}
          </RadioCard>
        ))}
      </RadioGroup>
      <Reveal open={terms.workMode === 'hybrid'} unmountOnExit>
        <div className="flex flex-col gap-5 pt-1">
          <Field required>
            <FieldLabel>{tr('job-terms.days_on_site_a_week', 'Days on site a week')}</FieldLabel>
            <SegmentedControl
              aria-label={tr('job-terms.days_on_site_a_week', 'Days on site a week')}
              value={terms.hybridDaysOnsite === null ? '' : String(terms.hybridDaysOnsite)}
              onValueChange={(v) => {
                save({ hybridDaysOnsite: Number(v) });
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <SegmentedControlItem key={n} value={String(n)}>
                  {tr(
                    'job-terms.day',
                    { one: '{{count}} day', other: '{{count}} days' },
                    { count: n },
                  )}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('job-terms.which_days', 'Which days')}</FieldLabel>
            <RadioGroup
              aria-label={tr('job-terms.which_days_on_site', 'Which days on site')}
              className="grid gap-2 sm:grid-cols-2"
              value={terms.hybridOnsiteDays === null ? 'chosen' : 'set'}
              onValueChange={(v) => {
                save({ hybridOnsiteDays: v === 'set' ? [] : null });
              }}
            >
              <RadioCard
                value="chosen"
                icon={<icons.calendar aria-hidden />}
                description={tr(
                  'job-terms.they_pick_their_own_days_each',
                  'They pick their own days each week.',
                )}
              >
                {tr('job-terms.any_days_they_choose', 'Any days they choose')}
              </RadioCard>
              <RadioCard
                value="set"
                icon={<icons.scheduled aria-hidden />}
                description={tr(
                  'job-terms.the_same_days_every_week_for',
                  'The same days every week, for the whole team.',
                )}
              >
                {tr('job-terms.set_days', 'Set days')}
              </RadioCard>
            </RadioGroup>
          </Field>
          <Reveal open={terms.hybridOnsiteDays !== null} unmountOnExit>
            <Field required>
              <FieldLabel>{tr('job-terms.days_on_site', 'Days on site')}</FieldLabel>
              <ChipRow aria-label={tr('job-terms.days_on_site', 'Days on site')}>
                {DAYS.map(([d, label]) => {
                  const set = terms.hybridOnsiteDays ?? [];
                  const on = set.includes(d);
                  const full =
                    terms.hybridDaysOnsite !== null && set.length >= terms.hybridDaysOnsite;
                  return (
                    <Chip
                      key={d}
                      selected={on}
                      disabled={!on && full}
                      onClick={() => {
                        save({ hybridOnsiteDays: on ? set.filter((x) => x !== d) : [...set, d] });
                      }}
                    >
                      {label}
                    </Chip>
                  );
                })}
              </ChipRow>
              <FieldDescription>
                {terms.hybridDaysOnsite === null
                  ? tr('job-terms.choose_how_many_days_first', 'Choose how many days first.')
                  : tr('job-terms.of_chosen', '{{length}} of {{hybridDaysOnsite}} chosen.', {
                      length: String((terms.hybridOnsiteDays ?? []).length),
                      hybridDaysOnsite: String(terms.hybridDaysOnsite),
                    })}
              </FieldDescription>
            </Field>
          </Reveal>
        </div>
      </Reveal>
    </>
  );
}

/** What each kind of work means, where the country's own rules give no line of their own. */
const RELATIONSHIP_NOTE: Readonly<Record<string, string>> = {
  employee: tr(
    'job-terms.on_the_payroll_with_the_full',
    'On the payroll, with the full protection of employment law.',
  ),
  worker: tr(
    'job-terms.paid_for_the_work_with_core',
    'Paid for the work, with core rights such as holiday pay and the minimum wage.',
  ),
  contractor: 'Self-employed, invoicing for the work. No leave or payroll; misuse is a legal risk.',
};

export function WorkTypeChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  const { options } = data;
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
        aria-label={tr('job-terms.work_type', 'Work type')}
        className="grid gap-2"
        value={terms.relationship ?? ''}
        onValueChange={(v) => {
          save({ relationship: v });
        }}
      >
        {options.relationships.map((r, i) => (
          <div key={r.key} className="animate-arrive" style={staggerStyle(i, 'animation')}>
            <RadioCard
              value={r.key}
              icon={<icons.work aria-hidden />}
              disabled={r.unavailable != null}
              description={r.unavailable ?? r.note ?? RELATIONSHIP_NOTE[r.key] ?? ''}
            >
              {r.label}
            </RadioCard>
          </div>
        ))}
      </RadioGroup>
    </>
  );
}

export function ContractChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  const { options } = data;
  const chosen = options.contractTypes.find((t) => t.key === terms.contractType);
  if (terms.relationship === null)
    return <Waiting icon={<icons.agreement aria-hidden />} what="Choose the work type first." />;
  return (
    <>
      <Refusal error={error} />
      <Unreviewed data={data} />
      <RadioGroup
        aria-label={tr('job-terms.contract', 'Contract')}
        className="grid gap-2"
        value={terms.contractType ?? ''}
        onValueChange={(v) => {
          save({ contractType: v });
        }}
      >
        {options.contractTypes.map((t, i) => (
          <div key={t.key} className="animate-arrive" style={staggerStyle(i, 'animation')}>
            <RadioCard
              value={t.key}
              disabled={t.unavailable != null}
              icon={t.fixedTerm ? <icons.calendar aria-hidden /> : <icons.agreement aria-hidden />}
              badge={
                <Badge size="xs" variant="soft" tone={t.fixedTerm ? 'warning' : 'neutral'}>
                  {t.fixedTerm
                    ? tr('job-terms.fixed_term', 'Fixed term')
                    : tr('job-terms.open_ended', 'Open-ended')}
                </Badge>
              }
              description={t.unavailable ?? t.note ?? ''}
            >
              {t.label}
            </RadioCard>
          </div>
        ))}
      </RadioGroup>
      {chosen?.fixedTerm === true && options.fixedTermReasons.length > 0 ? (
        <Field required>
          <FieldLabel>{tr('job-terms.why_it_is_fixed_term', 'Why it is fixed term')}</FieldLabel>
          <FieldDescription>
            {tr(
              'job-terms.the_law_there_asks_for_the',
              'The law there asks for the reason in the contract.',
            )}
          </FieldDescription>
          <Select
            value={terms.fixedTermReason ?? ''}
            onValueChange={(v) => {
              save({ fixedTermReason: v });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue placeholder={tr('job-terms.choose_a_reason', 'Choose a reason')} />
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
  [1, tr('job-terms.mon', 'Mon')],
  [2, tr('job-terms.tue', 'Tue')],
  [3, tr('job-terms.wed', 'Wed')],
  [4, tr('job-terms.thu', 'Thu')],
  [5, tr('job-terms.fri', 'Fri')],
  [6, tr('job-terms.sat', 'Sat')],
  [7, tr('job-terms.sun', 'Sun')],
] as const;

const WEEKS = [
  [[1, 2, 3, 4, 5], tr('job-terms.monday_to_friday', 'Monday to Friday')],
  [[1, 2, 3, 4], tr('job-terms.monday_to_thursday', 'Monday to Thursday')],
] as const;

export function DaysChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  if (terms.contractType === null)
    return <Waiting icon={<icons.agreement aria-hidden />} what="Choose the contract first." />;
  return (
    <>
      <Refusal error={error} />
      <ChipRow aria-label={tr('job-terms.work_days', 'Work days')}>
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
      {/* Shortcuts that fill the days above, said as such: they are not a second setting. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
        <span>{tr('job-terms.fill_in_a_common_week', 'Fill in a common week:')}</span>
        {WEEKS.filter(
          ([days]) => days.join() !== terms.workDays.toSorted((a, b) => a - b).join(),
        ).map(([days, label]) => (
          <Button
            key={label}
            size="xs"
            variant="ghost"
            startIcon={<icons.calendar aria-hidden />}
            onClick={() => {
              save({ workDays: [...days] });
            }}
          >
            {label}
          </Button>
        ))}
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
  return tr('job-terms.h', '{{value}} h', {
    value: Number.isInteger(h) ? String(h) : h.toFixed(1),
  });
};

const BREAKS = [0, 15, 30, 45, 60, 90] as const;

export function HoursChoice({ data, props }: TermsProps): JSX.Element {
  const { error, save, terms } = useTerms(data, props);
  const { options } = data;
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
          <FieldLabel>{tr('job-terms.starts', 'Starts')}</FieldLabel>
          <FieldControl>
            <TimePicker
              label={tr('job-terms.starts', 'Starts')}
              step={15}
              // Only times before the end, when the end is chosen first.
              {...(terms.dayEnd === null ? {} : { max: hhmm(terms.dayEnd - 15) ?? '23:45' })}
              value={hhmm(terms.dayStart)}
              onChange={(t) => {
                save({ dayStart: minutesOf(t) });
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>{tr('job-terms.ends', 'Ends')}</FieldLabel>
          <FieldControl>
            <TimePicker
              label={tr('job-terms.ends', 'Ends')}
              step={15}
              // Only times after the start.
              {...(terms.dayStart === null ? {} : { min: hhmm(terms.dayStart + 15) ?? '00:00' })}
              value={hhmm(terms.dayEnd)}
              onChange={(t) => {
                save({ dayEnd: minutesOf(t) });
              }}
            />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{tr('job-terms.unpaid_break', 'Unpaid break')}</FieldLabel>
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
                  {b === 0
                    ? tr('job-terms.none', 'None')
                    : tr('job-terms.min', '{{b}} min', { b: String(b) })}
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
            { label: tr('job-terms.a_week', 'A week'), value: hoursOf(options.weeklyMinutes) },
            {
              label: tr('job-terms.full_time_there', 'Full time there'),
              value:
                options.fullTimeWeeklyMinutes === null
                  ? 'Not set'
                  : hoursOf(options.fullTimeWeeklyMinutes),
            },
            {
              label: tr('job-terms.so_this_is', 'So this is'),
              value: (
                <Badge size="sm" variant="soft" tone="accent">
                  {options.hours === 'full_time' ? 'Full time' : 'Part time'}
                </Badge>
              ),
            },
            ...(options.maxWeeklyMinutes === null
              ? []
              : [
                  {
                    label: tr('job-terms.the_laws_limit', 'The law’s limit'),
                    value: hoursOf(options.maxWeeklyMinutes),
                  },
                ]),
          ]}
        />
      )}
      {over ? (
        <Alert tone="danger" title={tr('job-terms.over_the_legal_week', 'Over the legal week')}>
          {tr('job-terms.shorten_the_day_or_take_a', 'Shorten the day or take a day off the week.')}
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
  useAnswered(days !== null);
  if (leave === null)
    return <Waiting icon={<icons.vacation aria-hidden />} what="Choose the work type first." />;
  const unit =
    leave.unit === 'calendar_days'
      ? tr('job-terms.calendar_days', 'calendar days')
      : tr('job-terms.working_days', 'working days');
  return (
    <>
      <Refusal error={error} />
      <Alert
        tone="info"
        title={
          leave.days === 0
            ? tr('job-terms.no_legal_minimum', 'No legal minimum')
            : tr(
                'job-terms.the_legal_minimum_is_a_year',
                'The legal minimum is {{days}} {{unit}} a year',
                { days: String(leave.days), unit },
              )
        }
      >
        {tr('job-terms.text', '{{note}} ({{source}})', { note: leave.note, source: leave.source })}
      </Alert>
      <NumberField
        label={tr('job-terms.paid_holiday_a_year', 'Paid holiday, {{unit}} a year', { unit })}
        value={days}
        min={leave.days}
        max={60}
        suffix={days === 1 ? 'day' : 'days'}
        onChange={setDays}
        className="max-w-xs"
      />
      {leave.days > 0 ? (
        <ChipRow aria-label={tr('job-terms.common_choices', 'Common choices')}>
          {[leave.days, leave.days + 5, leave.days + 10].map((n) => (
            <Chip
              key={n}
              selected={days === n}
              onClick={() => {
                setDays(n);
              }}
            >
              {n === leave.days
                ? tr('job-terms.the_minimum', '{{n}}, the minimum', { n: String(n) })
                : tr('job-terms.days', '{{n}} days', { n: String(n) })}
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
            {tr('job-terms.save_time_off', 'Save time off')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

const major = (minor: number): number => Math.round(minor / 100);

/** "€62k": the band's axis, where the full figure would crowd. */
const short = (value: number, currency: string): string =>
  numberFormat({
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

/**
 * The pay against the market, drawn: the model's band hatched, its median a
 * line, the job's pay solid over it, and a slider under it on the same axis
 * to move the pay by eye. The figures above stay the exact way to set it.
 */
function PayBand({
  estimate,
  kind,
  min,
  max,
  floor,
  disabled,
  onChange,
}: {
  readonly estimate: NonNullable<JobTerms['payEstimate']>;
  readonly kind: 'fixed' | 'range';
  readonly min: number;
  readonly max: number;
  readonly floor: number | null;
  readonly disabled: boolean;
  readonly onChange: (min: number, max: number) => void;
}): JSX.Element {
  const low = major(estimate.lowMinor);
  const high = major(estimate.highMinor);
  const median = major(estimate.medianMinor);
  const from = Math.max(floor ?? 0, Math.floor(Math.min(low * 0.75, min) / 1000) * 1000);
  const to = Math.ceil(Math.max(high * 1.25, max) / 1000) * 1000;
  const sliver = (to - from) / 200;
  const money = (v: number): string => amount(v, estimate.currency);
  return (
    <div className="flex flex-col gap-3">
      <RangeBar
        label={tr('job-terms.the_pay_against_the_market', 'The pay against the market')}
        domain={[from, to]}
        now={median}
        format={(v) => short(v, estimate.currency)}
        summary={
          kind === 'fixed'
            ? tr(
                'job-terms.the_market_pays_this_job_pays',
                'The market pays {{low}} to {{high}}, {{median}} in the middle. This job pays {{value}}.',
                { low: money(low), high: money(high), median: money(median), value: money(min) },
              )
            : tr(
                'job-terms.the_market_pays_this_job_pays_range',
                'The market pays {{low}} to {{high}}, {{median}} in the middle. This job pays {{min}} to {{max}}.',
                {
                  low: money(low),
                  high: money(high),
                  median: money(median),
                  min: money(min),
                  max: money(max),
                },
              )
        }
        segments={[
          {
            start: low,
            end: high,
            label: tr('job-terms.what_the_market_pays', 'What the market pays'),
            tone: 'neutral',
            pattern: 'hatched',
          },
          {
            start: min,
            end: kind === 'fixed' ? min + sliver : max,
            label: tr('job-terms.this_job', 'This job'),
            tone: 'accent',
            size: 'thin',
          },
        ]}
      />
      <Slider
        label={
          kind === 'fixed'
            ? tr('job-terms.yearly_salary', 'Yearly salary')
            : tr('job-terms.pay_range', 'Pay range')
        }
        {...(kind === 'range'
          ? { thumbLabels: [tr('job-terms.from', 'From'), tr('job-terms.to', 'To')] }
          : {})}
        min={from}
        max={to}
        step={500}
        minStepsBetweenThumbs={1}
        disabled={disabled}
        value={kind === 'fixed' ? [min] : [min, max]}
        tip={money}
        onValueChange={(v) => {
          const [a = min, b = a] = v;
          onChange(a, b);
        }}
      />
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted" aria-hidden>
        <li className="flex items-center gap-1.5">
          <Badge size="xs" variant="outline">
            {tr('job-terms.hatched', 'Hatched')}
          </Badge>
          {tr('job-terms.what_the_market_pays_to', 'What the market pays, {{low}} to {{high}}', {
            low: money(low),
            high: money(high),
          })}
        </li>
        <li className="flex items-center gap-1.5">
          <Badge size="xs" variant="outline">
            {tr('job-terms.line', 'Line')}
          </Badge>
          {tr('job-terms.the_middle', 'The middle, {{median}}', { median: money(median) })}
        </li>
        <li className="flex items-center gap-1.5">
          <Badge size="xs" tone="accent" variant="soft">
            {tr('job-terms.solid', 'Solid')}
          </Badge>
          {tr('job-terms.this_job', 'This job')}
        </li>
      </ul>
    </div>
  );
}

const amount = (value: number, currency: string): string =>
  numberFormat({ style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/**
 * Pay: one figure, or a range from and to, yearly, in the entity's currency.
 * The first time, a model estimates what the market pays for the job where it
 * is and the figures arrive filled in. The estimate stays beneath them in
 * muted words, kept with the job, with a press to go back to it after a
 * change. Recruiting refuses anything below the legal minimum.
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
  // Shown in the ad unless the team has said otherwise: candidates apply more readily, and some places require it.
  const [shown, setShown] = useState(job.salary === null ? true : job.salaryShown);
  // The model's last estimate: the one kept with the job, or the one it has just given.
  const [estimate, setEstimate] = useState(terms.payEstimate);
  const [asking, startAsking] = useTransition();
  const ready = options.currency !== null && terms.locationId !== null;
  const figures = (k: 'fixed' | 'range', e: NonNullable<typeof estimate>): [number, number] =>
    k === 'fixed'
      ? [major(e.medianMinor), major(e.medianMinor)]
      : [major(e.lowMinor), major(e.highMinor)];
  const use = (k: 'fixed' | 'range', e: NonNullable<typeof estimate>): void => {
    const [low, high] = figures(k, e);
    setMin(low);
    setMax(high);
  };
  const ask = (k: 'fixed' | 'range'): void => {
    startAsking(async () => {
      const done = await act.call('SuggestJobPay', { jobId: job.id, input: { kind: k } });
      if (!done.ok) {
        setError(done.message);
        return;
      }
      const s = done.data as {
        minMinor: number;
        maxMinor: number;
        basis: string;
        confidence: 'low' | 'medium' | 'high';
        currency: string;
      };
      // The kept estimate arrives with the next read; the figures for this kind are here now.
      setMin(major(s.minMinor));
      setMax(major(s.maxMinor));
      props.onRefresh?.();
    });
  };
  // A fresh estimate from the server replaces the one shown.
  const [seen, setSeen] = useState(terms.payEstimate);
  if (seen !== terms.payEstimate) {
    setSeen(terms.payEstimate);
    setEstimate(terms.payEstimate);
  }
  // The first visit with no pay set: the market's figures arrive filled in.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || job.salary !== null || !ready) return;
    asked.current = true;
    if (estimate === null) ask(kind);
    else use(kind, estimate);
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
  useAnswered(min !== null);
  if (!ready)
    return (
      <Waiting
        icon={<icons.location aria-hidden />}
        what="Choose the employing entity and the workplace first: pay depends on where the work is."
      />
    );
  const currency = options.currency;
  const floor = options.minimumPayMinor === null ? null : Math.ceil(options.minimumPayMinor / 100);
  const suggested = estimate === null ? null : figures(kind, estimate);
  const changed =
    suggested !== null && (min !== suggested[0] || (kind === 'range' && max !== suggested[1]));
  return (
    <>
      <Refusal error={error} />
      <SegmentedControl
        aria-label={tr('job-terms.kind_of_pay', 'Kind of pay')}
        value={kind}
        onValueChange={(v) => {
          const next = v as 'fixed' | 'range';
          setKind(next);
          // Untouched figures follow the estimate into the other kind.
          if (estimate !== null && !changed) use(next, estimate);
          else if (next === 'fixed' && min !== null && max !== null)
            setMin(Math.round((min + max) / 2 / 500) * 500);
          else if (next === 'range' && max === null) setMax(min);
        }}
      >
        <SegmentedControlItem value="range">
          {tr('job-terms.a_range', 'A range')}
        </SegmentedControlItem>
        <SegmentedControlItem value="fixed">
          {tr('job-terms.a_fixed_salary', 'A fixed salary')}
        </SegmentedControlItem>
      </SegmentedControl>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label={
            kind === 'fixed'
              ? tr('job-terms.yearly_salary', 'Yearly salary')
              : tr('job-terms.from_a_year', 'From, a year')
          }
          value={min}
          min={floor ?? 0}
          step={500}
          prefix={currency}
          disabled={asking}
          onChange={setMin}
        />
        {kind === 'range' ? (
          <NumberField
            label={tr('job-terms.to_a_year', 'To, a year')}
            value={max}
            min={min ?? floor ?? 0}
            step={500}
            prefix={currency}
            disabled={asking}
            onChange={setMax}
          />
        ) : null}
      </div>
      {/* Where the pay sits against the market, drawn: dragged here, typed above. */}
      {estimate === null || min === null ? null : (
        <PayBand
          estimate={estimate}
          kind={kind}
          min={min}
          max={kind === 'fixed' ? min : (max ?? min)}
          floor={floor}
          disabled={asking}
          onChange={(low, high) => {
            setMin(low);
            if (kind === 'range') setMax(high);
          }}
        />
      )}
      {/* The model's estimate, in its own words, under the figures. */}
      <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <icons.assistant aria-hidden className="size-4 shrink-0 text-accent-fg" />
          <span className="min-w-0 flex-1 font-medium">
            {asking
              ? tr(
                  'job-terms.estimating_what_the_market_pays_for',
                  'Estimating what the market pays for this role there…',
                )
              : estimate === null || suggested === null
                ? tr('job-terms.no_estimate_yet', 'No estimate yet.')
                : kind === 'fixed'
                  ? tr(
                      'job-terms.ai_estimate_a_year_confidence',
                      'AI estimate: {{value}} a year · {{confidence}} confidence',
                      {
                        value: amount(suggested[0], estimate.currency),
                        confidence: estimate.confidence,
                      },
                    )
                  : tr(
                      'job-terms.ai_estimate_range_a_year_confidence',
                      'AI estimate: {{min}} to {{max}} a year · {{confidence}} confidence',
                      {
                        min: amount(suggested[0], estimate.currency),
                        max: amount(suggested[1], estimate.currency),
                        confidence: estimate.confidence,
                      },
                    )}
          </span>
          <span className="flex gap-1">
            {changed && estimate !== null ? (
              <Button
                size="xs"
                variant="ghost"
                startIcon={<icons.undo aria-hidden />}
                onClick={() => {
                  use(kind, estimate);
                }}
              >
                {tr('job-terms.use_the_estimate', 'Use the estimate')}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              loading={asking}
              startIcon={<icons.refresh aria-hidden />}
              onClick={() => {
                ask(kind);
              }}
            >
              {estimate === null
                ? tr('job-terms.estimate_with_ai', 'Estimate with AI')
                : tr('job-terms.estimate_again', 'Estimate again')}
            </Button>
          </span>
        </div>
        {asking || estimate === null ? null : (
          <p className="text-pretty whitespace-pre-line text-fg-muted">{estimate.basis}</p>
        )}
      </div>
      <p className="text-sm text-fg-muted">
        {floor === null
          ? tr('job-terms.yearly_and_gross_before_tax', 'Yearly and gross, before tax.')
          : tr(
              'job-terms.yearly_and_gross_the_legal_minimum',
              'Yearly and gross. The legal minimum at these hours is {{floor}}.',
              { floor: amount(floor, currency) },
            )}
      </p>
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>
            {tr('job-terms.show_the_pay_in_the_ad', 'Show the pay in the ad')}
          </FieldLabel>
          <FieldDescription>
            {tr(
              'job-terms.required_in_some_places_and_candidates',
              'Required in some places, and candidates apply more readily when they see it.',
            )}
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
            {tr('job-terms.save_pay', 'Save pay')}
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
        title={tr('job-terms.no_benefits_in_the_catalogue', 'No benefits in the catalogue')}
        description={tr(
          'job-terms.add_them_under_settings_recruiting_benefits',
          'Add them under Settings, Recruiting, Benefits.',
        )}
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
            {tr('job-terms.save_benefits', 'Save benefits')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
