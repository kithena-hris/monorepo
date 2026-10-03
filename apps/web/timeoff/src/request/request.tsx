import {
  Alert,
  AppBarBack,
  Avatar,
  Badge,
  Button,
  Calendar,
  Field,
  FieldControl,
  FieldLabel,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stat,
  Textarea,
  icons,
  useCoarsePointer,
  type CalendarDayStyle,
  type CalendarMarker,
  type DateRange,
} from '@reach/ui';
import { useState, useTransition, type JSX, type ReactNode } from 'react';

import type { Loadable } from '../load';
import { Overview, OverviewSkeleton, type OverviewData } from '../overview/overview';
import {
  addDays,
  amount,
  chartTone,
  days,
  leaveIcon,
  longSpan,
  shortDate,
  spanLabel,
} from '../words';

/**
 * Requesting time off (T3, T5, MT5–MT7, MT9): one panel over the overview,
 * three parts — the type with its balance, the dates on a month with
 * teammates' days off as dots and holidays struck through, and what it
 * costs: working days, days away, the balance before and after, a team
 * minimum it breaks, and, below zero, the choice to borrow, go unpaid or
 * shorten (PRD §7.4, §8.2).
 *
 * Nothing here computes a number. What is asked (type, dates, half day, the
 * month on show and a phone's step) lives in the address, so every change is
 * the host asking Time Off's request panel again and the screen drawing its
 * answer (`onAsk`). Sending is the host's (`onSend`).
 *
 * At a desk it is a side panel, everything at once. Under a finger it is
 * MT5's sheet of types, then MT6's dates full screen with a bar at the
 * bottom holding the count and the balance after, then MT7's review.
 */

type Step = 'type' | 'dates' | 'review';

interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

export interface CoverageDay {
  readonly date: string;
  readonly in: number;
  readonly of: number;
  readonly required: number;
  readonly below: boolean;
}

export interface RequestData {
  /** The page behind the panel at a desk; null when Time Off did not send it. */
  readonly overview: OverviewData | null;
  readonly leaveTypes: readonly {
    readonly key: string;
    readonly name: string;
    readonly category: string;
    readonly unit: 'day' | 'hour';
    readonly tracked: boolean;
    readonly colorToken: string;
    readonly icon: string;
    /** Decimal string; null for a type not taken from a balance. */
    readonly left: string | null;
  }[];
  /** What the dates would mean; null until a type and dates are chosen. */
  readonly preview: {
    readonly span: Span & { readonly workingDays: string };
    readonly daysAway: { readonly days: string; readonly from: string; readonly to: string };
    readonly balance: { readonly before: string; readonly after: string } | null;
    readonly belowMinimum: readonly CoverageDay[];
    /** The team's minimum refuses it outright. */
    readonly blocked: boolean;
    /** In order: `manager`, `hr`. None, and it is approved as it is recorded. */
    readonly approvers: readonly string[];
    readonly approver: { readonly personId: string; readonly displayName: string } | null;
    readonly negative: {
      readonly kind: 'fits' | 'borrow' | 'refused';
      readonly days: string | null;
      readonly limit: string | null;
      readonly nextYearStartsAt: string | null;
      readonly approvers: readonly string[];
      readonly unpaid: { readonly days: string } | null;
      readonly shorten: {
        readonly to: string;
        readonly endsHalfDay: boolean;
        readonly days: string;
      } | null;
    };
  } | null;
  /** What the address asks for, as the host read it. */
  readonly asked: {
    readonly type: string | null;
    readonly from: string | null;
    readonly to: string | null;
    readonly half: boolean;
    readonly step: Step | null;
    /** The month on show, `2026-10`. */
    readonly month: string;
  };
  /** The team's month: who is off and the days already short. */
  readonly team: {
    readonly people: readonly { readonly personId: string; readonly displayName: string }[];
    readonly entries: readonly {
      readonly personId: string;
      readonly leaveTypeKey: string | null;
      readonly span: Span;
    }[];
    readonly coverage: readonly CoverageDay[];
  } | null;
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  readonly today: string;
  /** What Time Off refused about the dates asked; the panel is shown without them. */
  readonly problem: string | null;
}

/** What may change in the address: a value, or null to drop it. */
export type Ask = Partial<
  Record<'type' | 'from' | 'to' | 'half' | 'step' | 'month', string | null>
>;

export type Sent =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly message: string };

export interface RequestProps {
  readonly load: Loadable<RequestData>;
  /** Put a change in the address; the host asks Time Off again. `push` is a step Back undoes. */
  readonly onAsk?: ((patch: Ask, mode: 'push' | 'replace') => void) | undefined;
  readonly onSend?:
    | ((input: {
        readonly leaveTypeKey: string;
        readonly span: Span;
        readonly note: string | null;
      }) => Promise<Sent>)
    | undefined;
  /** Go somewhere else: closing the panel, or the request once it is sent. */
  readonly onNavigate?: ((href: string) => void) | undefined;
}

const CLOSE = '/time-off/overview';

export function RequestTimeOff({ load, onAsk, onSend, onNavigate }: RequestProps): JSX.Element {
  const close = (): void => {
    onNavigate?.(CLOSE);
  };
  const behind =
    load.status === 'ready' && load.data.overview !== null ? (
      <Overview load={{ status: 'ready', data: load.data.overview }} />
    ) : (
      <OverviewSkeleton />
    );
  return (
    <>
      {behind}
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {load.status === 'ready' ? (
          <Panel data={load.data} onAsk={onAsk} onSend={onSend} onNavigate={onNavigate} />
        ) : (
          <SheetContent size="xl">
            <SheetHeader>
              <SheetTitle>Request time off</SheetTitle>
              <SheetDescription>
                {load.status === 'error'
                  ? 'Time Off did not answer.'
                  : 'Loading the types and your balances.'}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {load.status === 'error' ? (
                <Alert
                  tone="danger"
                  title="Could not load the request panel"
                  actions={
                    load.retry === undefined ? undefined : (
                      <Button size="sm" onClick={load.retry}>
                        Try again
                      </Button>
                    )
                  }
                >
                  {load.message}
                </Alert>
              ) : (
                <PanelSkeleton />
              )}
            </SheetBody>
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------------- panel -- */

/** The panel's columns at a desk; one column in a narrower panel. */
const columns =
  '@container/panel grid gap-6 @min-[44rem]/panel:grid-cols-[18rem_minmax(0,1fr)] @min-[44rem]/panel:items-start';

function Panel({
  data,
  onAsk,
  onSend,
  onNavigate,
}: {
  readonly data: RequestData;
} & Omit<RequestProps, 'load'>): JSX.Element {
  const touch = useCoarsePointer();
  const { asked, preview } = data;
  const type = data.leaveTypes.find((t) => t.key === asked.type) ?? null;
  const step: Step = asked.step ?? (type === null ? 'type' : 'dates');
  /** Under a finger, only this step's part; at a desk, every part. */
  const shown = (s: Step): string | undefined => (step === s ? undefined : 'touch:hidden');
  const ask = (patch: Ask, mode: 'push' | 'replace' = 'replace'): void => {
    onAsk?.(patch, mode);
  };

  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [sending, start] = useTransition();
  const ready = type !== null && preview !== null && asked.from !== null && asked.to !== null;
  const refused = preview !== null && (preview.blocked || preview.negative.kind === 'refused');
  const send = (): void => {
    if (!ready || onSend === undefined) return;
    setFailed(null);
    const span = {
      from: asked.from,
      to: asked.to,
      startsHalfDay: false,
      endsHalfDay: asked.half,
    };
    const trimmed = note.trim();
    start(async () => {
      const sent = await onSend({
        leaveTypeKey: type.key,
        span,
        note: trimmed === '' ? null : trimmed,
      });
      if (sent.ok) onNavigate?.(`/time-off/requests/${sent.requestId}`);
      else setFailed(sent.message);
    });
  };
  const sendLabel = sendTo(preview);

  return (
    <SheetContent
      size="xl"
      // Past the type, a phone's steps are the whole screen (MT6, MT7).
      className={step === 'type' ? undefined : 'touch:h-full touch:max-h-full touch:rounded-none'}
    >
      <SheetHeader>
        {step === 'type' ? null : (
          <AppBarBack
            className="hidden touch:inline-flex"
            onClick={() => {
              ask({ step: step === 'review' ? 'dates' : 'type' });
            }}
          >
            {step === 'review' ? 'Dates' : 'Type'}
          </AppBarBack>
        )}
        <SheetTitle>Request time off</SheetTitle>
        <SheetDescription>
          {preview?.approver == null
            ? 'Choose a type and the dates. Nothing is sent until you send it.'
            : `${preview.approver.displayName} approves.`}
        </SheetDescription>
      </SheetHeader>
      <SheetBody>
        <div className={columns}>
          <TypePicker
            data={data}
            className={shown('type')}
            onPick={(key) => {
              ask({ type: key, step: touch ? 'dates' : null }, touch ? 'push' : 'replace');
            }}
          />
          <div className="flex min-w-0 flex-col gap-5">
            <DatePicker data={data} className={shown('dates')} ask={ask} />
            <div className={`flex flex-col gap-4 ${shown('review') ?? ''}`}>
              {data.problem === null ? null : (
                <Alert tone="danger" title="Those dates cannot be asked for">
                  {data.problem}
                </Alert>
              )}
              {preview === null || type === null ? (
                <p className="text-sm text-fg-muted touch:hidden">
                  {type === null
                    ? 'Choose a type, then the dates, to see what they cost.'
                    : 'Choose the dates to see what they cost.'}
                </p>
              ) : (
                <Consequences
                  data={data}
                  preview={preview}
                  type={type}
                  ask={ask}
                  note={note}
                  onNote={setNote}
                />
              )}
              {failed === null ? null : (
                <Alert tone="danger" title="The request was not sent">
                  {failed}
                </Alert>
              )}
            </div>
          </div>
        </div>
      </SheetBody>
      <SheetFooter className={step === 'type' ? 'touch:hidden' : undefined}>
        {/* At a desk: leave, or send. */}
        <Button className="touch:hidden" onClick={() => onNavigate?.(CLOSE)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          startIcon={<icons.send aria-hidden />}
          className={step === 'review' ? undefined : 'touch:hidden'}
          disabled={!ready || refused}
          loading={sending}
          onClick={send}
        >
          {sendLabel}
        </Button>
        {/* Under a finger, on the dates: what they cost, and on to the review (MT6). */}
        {step === 'dates' ? (
          <div className="hidden items-center gap-3 touch:flex">
            <p className="min-w-0 flex-1">
              <span className="block truncate text-md font-bold">
                {asked.from === null || asked.to === null
                  ? 'No dates yet'
                  : spanLabel(asked.from, asked.to)}
              </span>
              <span className="block truncate text-sm text-fg-muted">
                {preview === null
                  ? 'Pick the first and last day'
                  : [
                      days(preview.span.workingDays),
                      preview.balance === null
                        ? null
                        : `${amount(preview.balance.after)} left after`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </span>
            </p>
            <Button
              variant="primary"
              endIcon={<icons.forward aria-hidden />}
              disabled={preview === null}
              onClick={() => {
                ask({ step: 'review' }, 'push');
              }}
            >
              Next
            </Button>
          </div>
        ) : null}
      </SheetFooter>
    </SheetContent>
  );
}

/** "Send to Marco", "Send to Marco and HR", "Send to HR", or "Send" when nobody approves it. */
function sendTo(preview: RequestData['preview']): string {
  if (preview === null) return 'Send request';
  const names = preview.approvers.map((role) =>
    role === 'manager' && preview.approver !== null
      ? (preview.approver.displayName.split(' ')[0] ?? preview.approver.displayName)
      : role === 'hr'
        ? 'HR'
        : 'your manager',
  );
  return names.length === 0 ? 'Send' : `Send to ${names.join(' and ')}`;
}

/* --------------------------------------------------------------- type -- */

function TypePicker({
  data,
  className,
  onPick,
}: {
  readonly data: RequestData;
  readonly className: string | undefined;
  readonly onPick: (key: string) => void;
}): JSX.Element {
  const planned = data.leaveTypes.filter((t) => t.category === 'parental_leave');
  const asked = data.leaveTypes.filter((t) => t.category !== 'parental_leave');
  return (
    <section aria-labelledby="request-type" className={`flex flex-col gap-2 ${className ?? ''}`}>
      <h3 id="request-type" className="text-sm font-semibold text-fg-muted">
        Type
      </h3>
      <RadioGroup
        aria-labelledby="request-type"
        value={data.asked.type ?? ''}
        onValueChange={onPick}
      >
        {asked.map((t) => (
          <RadioCard key={t.key} value={t.key} icon={leaveIcon(t.icon)} description={leftOf(t)}>
            {t.name}
          </RadioCard>
        ))}
      </RadioGroup>
      {planned.length === 0 ? null : (
        <List>
          <ListItem
            asChild
            icon={<icons.parental />}
            iconTone="neutral"
            description="Opens the planner"
            chevron
          >
            <a href="/time-off/parental/plan">Parental leave</a>
          </ListItem>
        </List>
      )}
    </section>
  );
}

function leftOf(t: RequestData['leaveTypes'][number]): string {
  if (t.left === null)
    return t.category === 'sick_leave'
      ? 'Paid · tell your manager today'
      : 'Not taken from a balance';
  return t.unit === 'hour' ? `${amount(t.left)}h banked` : `${days(t.left)} left`;
}

/* -------------------------------------------------------------- dates -- */

function DatePicker({
  data,
  className,
  ask,
}: {
  readonly data: RequestData;
  readonly className: string | undefined;
  readonly ask: (patch: Ask, mode?: 'push' | 'replace') => void;
}): JSX.Element {
  const { asked } = data;
  // A range half chosen is the screen's until its last day is; then it is asked.
  const [draft, setDraft] = useState<DateRange | null>(null);
  const selected: DateRange = draft ?? { start: asked.from, end: asked.to };
  const markers: Record<string, CalendarMarker[]> = {};
  const styles: Record<string, CalendarDayStyle> = {};
  const me = data.overview?.member?.personId;
  for (const e of data.team?.entries ?? []) {
    if (e.personId === me) continue;
    const name = data.team?.people.find((p) => p.personId === e.personId)?.displayName ?? 'Someone';
    const tone = chartTone(data.leaveTypes.find((t) => t.key === e.leaveTypeKey)?.colorToken);
    for (let d = e.span.from; d <= e.span.to; d = addDays(d, 1)) {
      (markers[d] ??= []).push({ tone, label: `${name} off` });
    }
  }
  for (const h of data.holidays) styles[h.date] = { appearance: 'struck', label: h.name };
  const short = [
    ...(data.team?.coverage ?? []).filter((c) => c.below),
    ...(data.preview?.belowMinimum ?? []),
  ];
  for (const c of short) {
    styles[c.date] = {
      appearance: 'danger',
      label: `${String(c.in)} of ${String(c.of)} in, below the team minimum`,
    };
  }
  return (
    <section aria-label="Dates" className={`flex flex-col gap-3 ${className ?? ''}`}>
      <Calendar
        mode="range"
        label="Dates off"
        today={data.today}
        month={`${asked.month}-01`}
        onMonthChange={(month) => {
          ask({ month: month.slice(0, 7) });
        }}
        selected={selected}
        onSelect={(range) => {
          if (range.start !== null && range.end !== null) {
            setDraft(null);
            ask({ from: range.start, to: range.end });
          } else {
            setDraft(range);
          }
        }}
        markers={markers}
        dayStyles={styles}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          aria-label="Length"
          value={asked.half ? 'half' : 'full'}
          onValueChange={(v) => {
            ask({ half: v === 'half' ? '1' : null });
          }}
        >
          <SegmentedControlItem value="full">Full days</SegmentedControlItem>
          <SegmentedControlItem value="half">Half day</SegmentedControlItem>
        </SegmentedControl>
        <p className="text-xs text-fg-muted">
          Dots are teammates who are off; struck days are holidays.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- consequences -- */

function Consequences({
  data,
  preview,
  type,
  ask,
  note,
  onNote,
}: {
  readonly data: RequestData;
  readonly preview: NonNullable<RequestData['preview']>;
  readonly type: RequestData['leaveTypes'][number];
  readonly ask: (patch: Ask, mode?: 'push' | 'replace') => void;
  readonly note: string;
  readonly onNote: (note: string) => void;
}): JSX.Element {
  const { span } = preview;
  const approver = preview.approver?.displayName.split(' ')[0] ?? null;
  const others = whoElse(data, span);
  return (
    <>
      <div className="grid gap-3 @min-[30rem]/panel:grid-cols-2">
        <Stat
          inset
          label="You’ll be off"
          icon={leaveIcon(type.icon)}
          value={longSpan(span.from, span.to)}
          description={`${type.name} · ${days(span.workingDays)} · ${days(preview.daysAway.days)} away`}
        />
        {preview.balance === null ? null : (
          <Stat
            inset
            label={`${type.name} left`}
            from={amount(preview.balance.before)}
            value={amount(preview.balance.after).replace(/^-/, '−')}
            unit={type.unit === 'hour' ? 'hours' : 'days'}
          />
        )}
      </div>
      {preview.negative.kind === 'fits' ? null : (
        <BelowZero preview={preview} approver={approver} ask={ask} />
      )}
      {preview.belowMinimum.map((c) => (
        <Alert
          key={c.date}
          tone={preview.blocked ? 'danger' : 'warning'}
          title={`${shortDate(c.date)}: only ${String(c.in)} of ${String(c.of)} would be in`}
        >
          {`Your team asks for at least ${String(c.required)}. `}
          {offOn(data, c.date)}
          {preview.blocked
            ? 'Your team does not take requests below its minimum, so pick other dates.'
            : approver === null
              ? 'It can still be approved.'
              : `${approver} can still approve it.`}
        </Alert>
      ))}
      {others.length === 0 ? null : (
        <section aria-labelledby="request-others" className="flex flex-col gap-2">
          <h3 id="request-others" className="text-sm font-semibold text-fg-muted">
            Who else is off
          </h3>
          <List>
            {others.map((o) => (
              <ListItem
                key={`${o.personId}${o.span.from}`}
                leading={<Avatar name={o.name} />}
                description={spanLabel(o.span.from, o.span.to)}
                trailing={<Badge size="sm">{o.type ?? 'Off'}</Badge>}
              >
                {o.name}
              </ListItem>
            ))}
          </List>
        </section>
      )}
      {preview.approvers.length === 0 ? null : (
        <Field>
          <FieldLabel>
            {approver === null ? 'Note (optional)' : `Note for ${approver} (optional)`}
          </FieldLabel>
          <FieldControl>
            <Textarea
              value={note}
              rows={2}
              placeholder={`Anything ${approver ?? 'your approver'} should know`}
              onChange={(e) => {
                onNote(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
      )}
    </>
  );
}

/** Teammates off at some point in `span`, from the team's month. */
function whoElse(
  data: RequestData,
  span: Span,
): { personId: string; name: string; type: string | null; span: Span }[] {
  const me = data.overview?.member?.personId;
  return (data.team?.entries ?? [])
    .filter((e) => e.personId !== me && e.span.from <= span.to && e.span.to >= span.from)
    .map((e) => ({
      personId: e.personId,
      name: data.team?.people.find((p) => p.personId === e.personId)?.displayName ?? 'Someone',
      type: data.leaveTypes.find((t) => t.key === e.leaveTypeKey)?.name ?? null,
      span: e.span,
    }));
}

/** "Omar and Yuki are already off that day. " */
function offOn(data: RequestData, date: string): string {
  const names = whoElse(data, {
    from: date,
    to: date,
    startsHalfDay: false,
    endsHalfDay: false,
  }).map((o) => o.name.split(' ')[0] ?? o.name);
  if (names.length === 0) return '';
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${String(names.at(-1))}`;
  return `${String(list)} ${names.length === 1 ? 'is' : 'are'} already off that day. `;
}

/* ---------------------------------------------------------- below zero -- */

/**
 * T5, MT9: a request that crosses zero is a choice, not an error (PRD §7.4).
 * Borrowing is what sending does within the limit; shortening asks for the
 * dates that fit. Phase 1 shows days, never money: Time Off knows no pay.
 */
function BelowZero({
  preview,
  approver,
  ask,
}: {
  readonly preview: NonNullable<RequestData['preview']>;
  readonly approver: string | null;
  readonly ask: (patch: Ask, mode?: 'push' | 'replace') => void;
}): JSX.Element {
  const { negative, span } = preview;
  const below = preview.balance === null ? '' : amount(preview.balance.after).replace(/^-/, '');
  const nextYear = String(Number(span.from.slice(0, 4)) + 1);
  const who = negative.approvers
    .map((r) => (r === 'manager' ? (approver ?? 'Your manager') : 'HR'))
    .join(' and ');
  const choices: ReactNode[] = [];
  if (negative.kind === 'borrow') {
    choices.push(
      <RadioCard
        key="borrow"
        value="borrow"
        badge={
          <Badge size="sm" tone="accent">
            Suggested
          </Badge>
        }
        description={`You keep all ${amount(span.workingDays)} days as paid time off.`}
        impact={`${nextYear} starts at ${amount(negative.nextYearStartsAt ?? '0')}`}
      >
        {`Borrow ${amount(negative.days ?? '0')} days from ${nextYear}`}
      </RadioCard>,
    );
  }
  if (negative.unpaid !== null) {
    choices.push(
      <RadioCard
        key="unpaid"
        value="unpaid"
        disabled
        description="Not offered here yet: Time Off cannot split one request into paid and unpaid days. Ask HR."
      >
        {`Make ${amount(negative.unpaid.days)} days unpaid`}
      </RadioCard>,
    );
  }
  if (negative.shorten !== null) {
    const { shorten } = negative;
    choices.push(
      <RadioCard
        key="shorten"
        value="shorten"
        description={`${days(shorten.days)} fits your balance.`}
        impact="Nothing borrowed"
      >
        {`Shorten to ${spanLabel(span.from, shorten.to)}${shorten.endsHalfDay ? ', half the last day' : ''}`}
      </RadioCard>,
    );
  }
  return (
    <>
      {negative.kind === 'borrow' ? (
        <Alert tone="warning" title={`This takes you ${below} days below zero`}>
          {`You can borrow up to the company’s limit from next year’s allowance. ${who} need to approve it.`}
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={`This goes past the ${amount(negative.limit ?? '0')} days you can go below zero`}
        >
          Shorten it to dates that fit, or ask HR.
        </Alert>
      )}
      {negative.kind === 'borrow' ? (
        <section aria-labelledby="request-borrow" className="flex flex-col gap-2">
          <h3 id="request-borrow" className="text-sm font-semibold text-fg-muted">
            What borrowing means
          </h3>
          <List>
            <ListItem
              icon={<icons.calendar />}
              iconTone="neutral"
              description={`${amount(negative.days ?? '0')} of next year’s days are used now.`}
            >
              {`Your ${nextYear} allowance starts at ${amount(negative.nextYearStartsAt ?? '0')}`}
            </ListItem>
            <ListItem
              icon={<icons.payroll />}
              iconTone="neutral"
              description={`The ${amount(negative.days ?? '0')} days come out of your final pay.`}
            >
              If you leave before you’ve earned them back
            </ListItem>
            <ListItem
              icon={<icons.approve />}
              iconTone="neutral"
              description={negative.approvers.length > 1 ? `${who}, in that order.` : who}
            >
              {negative.approvers.length > 1 ? 'Two approvals' : 'One approval'}
            </ListItem>
          </List>
        </section>
      ) : null}
      {choices.length === 0 ? null : (
        <section aria-labelledby="request-instead" className="flex flex-col gap-2">
          <h3 id="request-instead" className="text-sm font-semibold text-fg-muted">
            {negative.kind === 'borrow' ? 'Or instead' : 'What you can do'}
          </h3>
          <RadioGroup
            aria-labelledby="request-instead"
            value={negative.kind === 'borrow' ? 'borrow' : ''}
            onValueChange={(v) => {
              // Shortening is asking for the dates that fit: the preview follows.
              if (v === 'shorten' && negative.shorten !== null) {
                ask({ to: negative.shorten.to, half: negative.shorten.endsHalfDay ? '1' : null });
              }
            }}
          >
            {choices}
          </RadioGroup>
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** The panel while it loads, in its shape: the types, the month, the two figures. */
function PanelSkeleton(): JSX.Element {
  return (
    <div role="status" className={columns}>
      <span className="sr-only">Loading the request panel</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-12" />
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-16 rounded-md" />
        ))}
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-80 rounded-lg" />
        <div className="grid gap-3 @min-[30rem]/panel:grid-cols-2">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
