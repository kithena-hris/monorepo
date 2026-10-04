import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  ChartLegend,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  IconList,
  IconListItem,
  KeyValues,
  PageHeader,
  PageSection,
  Skeleton,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TertiaryNav,
  Textarea,
  TimePicker,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { DayBar, LEGEND } from './day-bar';
import {
  addDays,
  clockTime,
  dayMonth,
  duration,
  instantAt,
  localDate,
  minuteOfDay,
  monthName,
  shortDate,
  weekdayName,
  type Day,
  type Punch,
  type PunchKind,
} from './time';

/**
 * My timesheet (T20, MT17, PRD §11.3): a week or a month, each day a bar from
 * 07:00 to 19:00, so a missed punch or a long day stands out without reading
 * numbers; in, out, breaks and worked beside it; and beside that the week
 * against the schedule, the overtime, and who can see this and for how long.
 *
 * A day nobody clocked out of is fixed here (T21, MT18): when did you finish?
 * The answer is a new punch beside the record, never an edit of it (§11.4).
 * Without the assistant (TOF-089) it asks for a time and suggests none.
 *
 * Drawn from what the shell hands it: Time Off's timesheet for the period in
 * the address, and when it asked. One component at two widths: under 40rem
 * of its own width the week's total leads, and the table keeps the day, what
 * was worked and the bar.
 */

export interface TimesheetData {
  readonly member: {
    readonly personId: string;
    readonly displayName: string;
    readonly timeZone: string;
  };
  readonly days: readonly Day[];
  readonly weeks: readonly {
    readonly monday: string;
    readonly workedMinutes: number;
    readonly plannedMinutes: number;
    readonly overtimeMinutes: number;
  }[];
  /** Days without a clock-out, waiting for one. */
  readonly open: readonly {
    readonly date: string;
    readonly lastPunchAt: string;
    /** When they probably finished, from their own evidence (TOF-089); `null` without any. */
    readonly suggestion?: FinishSuggestion | null;
  }[];
  readonly overtime: readonly {
    readonly date: string;
    readonly minutes: number;
    readonly outcome: 'comp' | 'paid' | 'declined';
  }[];
  /** The standing punches of the period. */
  readonly punches: readonly Punch[];
  /** Punches made afterwards, and whether the manager sees each beside the original. */
  readonly corrections: readonly { readonly needsManager: boolean; readonly punch: Punch }[];
  readonly period: { readonly kind: 'week' | 'month'; readonly from: string; readonly to: string };
  /** A day whose missed clock-out the address opens (`?fix=`), as a morning notification links. */
  readonly fix: string | null;
  readonly now: string;
}

/** Time Off's guess at a missed clock-out, with what it was guessed from. */
export interface FinishSuggestion {
  readonly at: string;
  /** "18:05", where the person is. */
  readonly time: string;
  /** Whether a model chose it among the domain's candidates. */
  readonly ai: boolean;
  readonly evidence: readonly {
    readonly source: 'calendar' | 'kithena';
    readonly at: string;
    readonly what: string;
  }[];
}

export interface CorrectionInput {
  readonly personId: string;
  readonly supersedes: string | null;
  readonly at: string;
  readonly kind: PunchKind;
  readonly reason: string | null;
}

export interface TimesheetProps {
  readonly load: Loadable<TimesheetData>;
  /** A punch made afterwards. Absent, a missed clock-out cannot be fixed here. */
  readonly onCorrect?: (input: CorrectionInput) => Promise<Outcome>;
}

export function Timesheet({ load, onCorrect }: TimesheetProps): JSX.Element {
  if (load.status === 'loading') return <TimesheetSkeleton />;
  return (
    <div className="@container/sheet flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Attendance" /> : null}
      <Loaded load={load} what="your timesheet">
        {(data) => <Ready data={data} onCorrect={onCorrect} />}
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------- layout -- */

const body =
  'flex flex-col gap-5 @min-[56rem]/sheet:grid @min-[56rem]/sheet:grid-cols-[minmax(0,1fr)_18.75rem] @min-[56rem]/sheet:items-start';
/** A column at a desk; under 40rem its parts join the page's one column, in MT17's order. */
const column = 'flex min-w-0 flex-col gap-5 @max-[40rem]/sheet:contents';
/** Columns a phone leaves out: the day, what was worked and the bar are what MT17 keeps. */
const deskOnly = '@max-[40rem]/sheet:hidden';
/** Under 40rem a row is MT17's: the day, what was worked and its status, the bar under them. */
const phoneRow =
  '@max-[40rem]/sheet:grid @max-[40rem]/sheet:grid-cols-[minmax(0,1fr)_auto_auto] @max-[40rem]/sheet:items-center';
const phoneBar =
  '@max-[40rem]/sheet:order-last @max-[40rem]/sheet:col-span-3 @max-[40rem]/sheet:pt-0';

/** The address of a period, for the links between them. */
const weekHref = (monday: string): string => `/time-off/attendance/timesheet?week=${monday}`;
const monthHref = (date: string): string =>
  `/time-off/attendance/timesheet?month=${date.slice(0, 7)}`;

function Ready({
  data,
  onCorrect,
}: {
  readonly data: TimesheetData;
  readonly onCorrect: TimesheetProps['onCorrect'];
}): JSX.Element {
  const zone = data.member.timeZone;
  const today = localDate(data.now, zone);
  const [fixing, setFixing] = useState<string | null>(
    data.open.some((o) => o.date === data.fix) ? data.fix : null,
  );
  const { period } = data;
  const week = period.kind === 'week';
  const worked = data.days.reduce((n, d) => n + (d.workedMinutes ?? 0), 0);
  const planned = data.days.reduce((n, d) => n + d.plannedMinutes, 0);
  const open = data.open.toSorted((a, b) => a.date.localeCompare(b.date));
  const fixingDay = data.days.find((d) => d.date === fixing);
  const fixingOpen = open.find((o) => o.date === fixing);
  const previous = week ? weekHref(addDays(period.from, -7)) : monthHref(addDays(period.from, -1));
  const next = week ? weekHref(addDays(period.from, 7)) : monthHref(addDays(period.to, 1));
  const thisMonday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));

  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          week
            ? `Week of ${dayMonth(period.from)} · ${duration(planned)} scheduled`
            : `${monthName(period.from)} · ${duration(planned)} scheduled`
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost" startIcon={<icons.previous aria-hidden />}>
              <a href={previous} aria-label={week ? 'Previous week' : 'Previous month'} />
            </Button>
            <TertiaryNav
              label="Show by"
              orientation="horizontal"
              current="page"
              activeId={period.kind}
              items={[
                { id: 'week', label: 'Week', href: weekHref(week ? period.from : thisMonday) },
                { id: 'month', label: 'Month', href: monthHref(period.from) },
              ]}
            />
            <Button asChild size="sm" variant="ghost" startIcon={<icons.next aria-hidden />}>
              <a href={next} aria-label={week ? 'Next week' : 'Next month'} />
            </Button>
          </div>
        }
      />
      <div className={body}>
        <div className={column}>
          {open.map((o) => (
            <Alert
              key={o.date}
              tone="danger"
              className="@max-[40rem]/sheet:order-2"
              title={`You didn’t clock out on ${weekdayName(o.date)}`}
              action={
                onCorrect === undefined ? undefined : (
                  <Button
                    size="xs"
                    onClick={() => {
                      setFixing(o.date);
                    }}
                  >
                    Fix it
                  </Button>
                )
              }
            >
              {`Your last punch was at ${clockTime(minuteOfDay(o.lastPunchAt, zone))}. Say when you finished; the record is kept as it was.`}
            </Alert>
          ))}
          <Days data={data} today={today} onFix={onCorrect === undefined ? undefined : setFixing} />
          <ChartLegend items={LEGEND} className="@max-[40rem]/sheet:hidden" />
        </div>
        <div className={column}>
          <Stat
            className="@max-[40rem]/sheet:order-1"
            label={week ? 'This week' : 'This month'}
            value={duration(worked)}
            description={`Of ${duration(planned)}${
              open.length === 0
                ? ''
                : `, not counting ${open.map((o) => weekdayName(o.date)).join(' and ')}`
            }`}
          />
          <Overtime data={data} today={today} />
          <Kept />
        </div>
      </div>
      {fixingDay === undefined || fixingOpen === undefined || onCorrect === undefined ? null : (
        <FixClockOut
          key={fixingDay.date}
          day={fixingDay}
          lastPunchAt={fixingOpen.lastPunchAt}
          suggestion={fixingOpen.suggestion ?? null}
          punches={data.punches}
          personId={data.member.personId}
          zone={zone}
          onCorrect={onCorrect}
          onClose={() => {
            setFixing(null);
          }}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- days -- */

function Days({
  data,
  today,
  onFix,
}: {
  readonly data: TimesheetData;
  readonly today: string;
  readonly onFix: ((date: string) => void) | undefined;
}): JSX.Element {
  const zone = data.member.timeZone;
  const onDay = (date: string): readonly Punch[] =>
    data.punches
      .filter((p) => localDate(p.at, zone) === date)
      .toSorted((a, b) => a.at.localeCompare(b.at));
  const corrected = new Set(data.corrections.map((c) => localDate(c.punch.at, zone)));
  const now = minuteOfDay(data.now, zone);
  return (
    <Table containerClassName="@max-[40rem]/sheet:order-3" aria-label="Your days">
      {/* A phone's rows say what each figure is; the header stays for a screen reader. */}
      <TableHeader className="@max-[40rem]/sheet:sr-only">
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead className={deskOnly}>In</TableHead>
          <TableHead className={deskOnly}>Out</TableHead>
          <TableHead className={deskOnly}>Breaks</TableHead>
          <TableHead>Worked</TableHead>
          <TableHead className="w-2/5">
            <span className="flex justify-between text-xs">
              <span>07:00</span>
              <span>13:00</span>
              <span>19:00</span>
            </span>
          </TableHead>
          <TableHead>
            <span className="sr-only">Status</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.days.map((d) => {
          const punches = onDay(d.date);
          const first = punches.find((p) => p.kind === 'in');
          const last = punches.findLast((p) => p.kind === 'out');
          const time = (p: Punch | undefined): string =>
            p === undefined ? '' : clockTime(minuteOfDay(p.at, zone));
          const past = d.date < today;
          return (
            <TableRow key={d.date} className={phoneRow}>
              <TableCell className="font-medium whitespace-nowrap">{shortDate(d.date)}</TableCell>
              <TableCell className={`${deskOnly} tabular-nums`}>{time(first)}</TableCell>
              <TableCell className={`${deskOnly} tabular-nums`}>
                {d.status === 'open' ? '—' : d.status === 'live' ? 'now' : time(last)}
              </TableCell>
              <TableCell className={`${deskOnly} tabular-nums`}>
                {d.breakMinutes > 0 ? duration(d.breakMinutes) : d.status === 'live' ? '—' : ''}
              </TableCell>
              <TableCell className="font-semibold whitespace-nowrap tabular-nums">
                {d.status === 'open'
                  ? '—'
                  : d.workedMinutes === null || (d.workedMinutes === 0 && !past)
                    ? ''
                    : duration(d.workedMinutes)}
              </TableCell>
              <TableCell className={phoneBar}>
                <DayBar
                  label={shortDate(d.date)}
                  segments={d.segments}
                  axis={false}
                  now={d.date === today ? now : undefined}
                />
              </TableCell>
              <TableCell className="text-end whitespace-nowrap">
                {status(d, past, corrected.has(d.date), onFix)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** What the day needs, or is: a fix, running now, overtime, corrected, or what is planned. */
function status(
  d: Day,
  past: boolean,
  corrected: boolean,
  onFix: ((date: string) => void) | undefined,
): ReactNode {
  if (d.status === 'open') {
    return onFix === undefined ? (
      <Badge size="sm" tone="danger">
        No clock-out
      </Badge>
    ) : (
      <Button
        size="xs"
        aria-label={`Fix ${weekdayName(d.date)}`}
        onClick={() => {
          onFix(d.date);
        }}
      >
        Fix
      </Button>
    );
  }
  if (d.status === 'live') {
    return (
      <Badge size="sm" tone="success" dot>
        Clocked in
      </Badge>
    );
  }
  if (d.overtimeMinutes > 0) {
    return (
      <Badge size="sm" tone="info">
        {`+${duration(d.overtimeMinutes)}`}
        <span className="sr-only"> overtime</span>
      </Badge>
    );
  }
  if (corrected) return <Badge size="sm">Corrected</Badge>;
  if (!past && d.plannedMinutes > 0) {
    return <span className="text-sm text-fg-muted">{`Planned ${duration(d.plannedMinutes)}`}</span>;
  }
  return null;
}

/* ----------------------------------------------------------- overtime -- */

function Overtime({
  data,
  today,
}: {
  readonly data: TimesheetData;
  readonly today: string;
}): JSX.Element {
  const decided = new Map(data.overtime.map((o) => [o.date, o]));
  const sum = (outcome: string): number =>
    data.overtime.filter((o) => o.outcome === outcome).reduce((n, o) => n + o.minutes, 0);
  const waiting = data.days
    .filter((d) => d.date < today && d.overtimeMinutes > 0 && !decided.has(d.date))
    .reduce((n, d) => n + d.overtimeMinutes, 0);
  return (
    <PageSection title="Overtime" className="@max-[40rem]/sheet:order-5">
      <KeyValues
        layout="split"
        items={[
          { label: 'Waiting for approval', value: duration(waiting) },
          { label: 'Approved as comp time', value: duration(sum('comp')) },
          { label: 'Approved to be paid', value: duration(sum('paid')) },
        ]}
      />
    </PageSection>
  );
}

/**
 * Who can see this and for how long (§11.3), and what is never recorded
 * (§11.2), which the timesheet says in so many words.
 * ponytail: four years and Spanish law are Phase 1's one country pack; the
 * line reads the pack's retention once Time Off sends it.
 */
function Kept(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-xs text-fg-muted @max-[40rem]/sheet:order-6">
      <p className="flex gap-2 [&_svg]:size-3.5 [&_svg]:shrink-0">
        <icons.locked aria-hidden />
        Kept for 4 years as Spanish law requires. Only you, your manager and HR can see it.
      </p>
      <p className="flex gap-2 [&_svg]:size-3.5 [&_svg]:shrink-0">
        <icons.hidden aria-hidden />
        Kithena records only the punches you make: no location trail, no screenshots, no keyboard or
        app activity.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- fix -- */

/**
 * When did you finish (T21, MT18)? A time after the last punch, and what it
 * would make of the day, then a new clock-out beside the record. Under a
 * finger the dialog is a sheet. Time Off's suggestion, when it had evidence,
 * is filled in and shown with that evidence; it is only ever a starting point.
 */
function FixClockOut({
  day,
  lastPunchAt,
  suggestion,
  punches,
  personId,
  zone,
  onCorrect,
  onClose,
}: {
  readonly day: Day;
  readonly lastPunchAt: string;
  readonly suggestion: FinishSuggestion | null;
  readonly punches: readonly Punch[];
  readonly personId: string;
  readonly zone: string;
  readonly onCorrect: NonNullable<TimesheetProps['onCorrect']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [time, setTime] = useState<string | null>(suggestion?.time ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const after = minuteOfDay(lastPunchAt, zone);
  const lastKind = punches.find((p) => p.at === lastPunchAt)?.kind;
  // What was worked before the last punch: the bar's worked spans, nothing missing or paused.
  const before = day.segments
    .filter((s) => s.kind === 'worked' || s.kind === 'overtime' || s.kind === 'live')
    .reduce((n, s) => n + (s.to - s.from), 0);
  const chosen = time === null ? null : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const worked =
    chosen === null
      ? null
      : before + (lastKind === 'break_start' ? 0 : Math.max(0, chosen - after));
  const overtime = worked === null ? 0 : Math.max(0, worked - day.plannedMinutes);
  const segments =
    chosen === null
      ? day.segments
      : [
          ...day.segments.filter((s) => s.kind !== 'missing'),
          { kind: lastKind === 'break_start' ? 'break' : 'worked', from: after, to: chosen },
        ];
  const save = (): void => {
    if (time === null) return;
    setBusy(true);
    setRefused(null);
    void onCorrect({
      personId,
      supersedes: null,
      at: instantAt(day.date, time, zone),
      kind: 'out',
      reason: note.trim() === '' ? null : note.trim(),
    }).then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`When did you finish on ${weekdayName(day.date)}?`}</DialogTitle>
          <DialogDescription>
            {`Your last punch was at ${clockTime(after)}. The clock-out you add goes beside the record; nothing is overwritten.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <DayBar label={shortDate(day.date)} segments={segments} />
          {suggestion === null ? null : (
            <AssistantCard
              level={3}
              title={`Around ${suggestion.time}`}
              action={
                suggestion.ai ? (
                  <Badge tone="assistant" size="sm">
                    AI
                  </Badge>
                ) : undefined
              }
              note="Only your calendar and what you did in Kithena. Never screen time or where you were."
            >
              <IconList>
                {suggestion.evidence.map((e) => (
                  <IconListItem
                    key={`${e.source}:${e.at}`}
                    icon={e.source === 'calendar' ? <icons.calendar /> : <icons.history />}
                    tone="neutral"
                    description={e.what}
                  >
                    {e.source === 'calendar'
                      ? `Your meeting ended at ${clockTime(minuteOfDay(e.at, zone))}`
                      : `Your last action in Kithena was at ${clockTime(minuteOfDay(e.at, zone))}`}
                  </IconListItem>
                ))}
              </IconList>
            </AssistantCard>
          )}
          <Field required>
            <FieldLabel>Finished at</FieldLabel>
            <FieldControl>
              <TimePicker
                label="Finished at"
                value={time}
                onChange={setTime}
                step={5}
                min={clockTime(Math.ceil((after + 1) / 5) * 5)}
                max="23:55"
              />
            </FieldControl>
            <FieldDescription>
              {worked === null
                ? 'After your last punch, on the same day.'
                : `${duration(worked)} worked${overtime > 0 ? `, ${duration(overtime)} overtime` : ''}`}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Note (optional)</FieldLabel>
            <FieldControl>
              <Textarea
                value={note}
                maxLength={1000}
                placeholder="For example, forgot after the release call"
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <p className="text-sm text-fg-muted">
            Edits after 24 hours are shown to your manager with the original record.
          </p>
          {refused === null ? null : (
            <Alert tone="danger" title="Not saved">
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={time === null}
            loading={busy}
            loadingLabel="Saving"
            onClick={save}
          >
            {time === null ? 'Save' : `Save ${time}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** The timesheet while it loads, in its exact shape: header, the week's rows, the side panel. */
export function TimesheetSkeleton(): JSX.Element {
  return (
    <div className="@container/sheet flex flex-col gap-6">
      <PageHeader title="Attendance" description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">Loading your timesheet</span>
        <div className={column}>
          <div className="flex flex-col gap-2 @max-[40rem]/sheet:order-3">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <Skeleton key={n} className="h-12 rounded-sm" />
            ))}
          </div>
        </div>
        <div className={column}>
          <Skeleton className="h-28 rounded-lg @max-[40rem]/sheet:order-1" />
          <Skeleton className="h-36 rounded-lg @max-[40rem]/sheet:order-5" />
        </div>
      </div>
    </div>
  );
}
