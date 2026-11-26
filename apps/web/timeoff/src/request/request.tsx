import {
  Alert,
  AppBarBack,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Calendar,
  type CalendarDayStyle,
  type CalendarMarker,
  type DateRange,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  formatList,
  icons,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Stat,
  Textarea,
  useCoarsePointer,
} from '@reach/ui';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import type { Loadable } from '../load';
import { Overview, OverviewSkeleton, type OverviewData } from '../overview/overview';
import { addDays, amount, chartTone, days, leaveIcon, shortDate, spanLabel } from '../words';
import { t as tr } from '../i18n';

/**
 * Requesting time off (T3, T5, MT5–MT7, MT9): one panel over the overview,
 * three parts — the type with its balance, the dates on a month with
 * teammates' days off as dots and holidays struck through, and what it
 * costs: working days, days away, the balance before and after, a team
 * minimum it breaks, and, below zero, the choice to borrow, go unpaid or
 * shorten (PRD §7.4, §8.2).
 *
 * Nothing here computes a number. What is asked (type, dates, half day, the
 * month on show and a phone's step) is noted in the address (`onAsk`), and
 * what it costs is Time Off's answer: read without the page when the host can
 * (`onRead`) and kept, so an answer already had is drawn at once; otherwise
 * the page's own next answer. Sending is the host's (`onSend`).
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

/** What the same dates cost as one type: Time Off's preview, or why it refuses them. */
type Cost = Pick<RequestData, 'preview' | 'problem'>;
/** A month's team and holidays. */
type Month = Pick<RequestData, 'team' | 'holidays'>;

export interface RequestProps {
  readonly load: Loadable<RequestData>;
  /** Put a change in the address. `push` is a step Back undoes. */
  readonly onAsk?: ((patch: Ask, mode: 'push' | 'replace') => void) | undefined;
  /**
   * Time Off's answer to what is asked, without the page: the address's
   * query, and the other types to answer for the same dates. Without it the
   * host answers `onAsk` with the page again.
   */
  readonly onRead?:
    | ((
        asked: Readonly<Record<string, string>>,
        also: readonly string[],
      ) => Promise<{
        readonly answer:
          | { readonly status: 'ready'; readonly data: unknown }
          | { readonly status: 'error'; readonly message: string };
        readonly others: Readonly<Record<string, Cost>>;
      }>)
    | undefined;
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

/*
 * Held by a page that already is a modal with a title and a close of its own
 * (Home's, which marks the frame `data-roomy`): the panel then fills it, edge
 * to edge, with its footer at the modal's foot, not a dialog inside a modal.
 */
const never = (): (() => void) => () => undefined;
const useRoomy = (): boolean =>
  useSyncExternalStore(
    never,
    () => window.frameElement?.hasAttribute('data-roomy') === true,
    () => false,
  );
const FILLS = 'h-full max-h-none w-full max-w-none rounded-none shadow-none';

export function RequestTimeOff({
  load,
  onAsk,
  onRead,
  onSend,
  onNavigate,
}: RequestProps): JSX.Element {
  const close = (): void => {
    onNavigate?.(CLOSE);
  };
  // The overview behind the panel at a desk: its shape while the page is on
  // its way, and nothing once Time Off answered without one (the panel says
  // why), never a placeholder that waits for what is not coming.
  const behind =
    load.status === 'loading' ? (
      <OverviewSkeleton />
    ) : load.status === 'ready' && load.data.overview !== null ? (
      <Overview load={{ status: 'ready', data: load.data.overview }} />
    ) : null;
  return (
    <>
      {behind}
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {load.status === 'ready' ? (
          <Panel
            data={load.data}
            onAsk={onAsk}
            onRead={onRead}
            onSend={onSend}
            onNavigate={onNavigate}
          />
        ) : (
          <DialogContent className={WIDE} sheetOnTouch>
            <DialogHeader>
              <DialogTitle>
                {tr('request.request.request_time_off', 'Request time off')}
              </DialogTitle>
              <DialogDescription>
                {load.status === 'error'
                  ? load.refused === true
                    ? tr(
                        'request.request.there_is_nothing_to_request_from',
                        'There is nothing to request from yet.',
                      )
                    : tr('request.request.time_off_did_not_answer', 'Time Off did not answer.')
                  : tr(
                      'request.request.loading_the_types_and_your_balances',
                      'Loading the types and your balances.',
                    )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              {load.status === 'error' && load.refused === true ? (
                <Alert
                  tone="info"
                  title={tr(
                    'request.request.you_cant_request_time_off_yet',
                    'You can’t request time off yet',
                  )}
                >
                  {load.message}
                </Alert>
              ) : load.status === 'error' ? (
                <Alert
                  tone="danger"
                  title={tr(
                    'request.request.could_not_load_the_request_panel',
                    'Could not load the request panel',
                  )}
                  actions={
                    load.retry === undefined ? undefined : (
                      <Button size="sm" onClick={load.retry}>
                        {tr('request.request.try_again', 'Try again')}
                      </Button>
                    )
                  }
                >
                  {load.message}
                </Alert>
              ) : (
                <PanelSkeleton />
              )}
            </DialogBody>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------- panel -- */

/**
 * The panel's columns at a desk, the types beside the dates; one column in a
 * narrower panel. Read from a wrapper: a container query never applies to
 * the element that is the container.
 */
const columns =
  'grid gap-6 @min-[44rem]/panel:grid-cols-[17rem_minmax(0,1fr)] @min-[44rem]/panel:items-start';

type Asked = RequestData['asked'];

/** The dates as one type, as the key their cost is kept under; null until all three are chosen. */
const costKey = (a: Asked): string | null =>
  a.type === null || a.from === null || a.to === null
    ? null
    : [a.type, a.from, a.to, a.half ? 'half' : 'full'].join('|');

const NO_COST: Cost = { preview: null, problem: null };

/** What the panel holds of one page: what is asked now, and every answer had since. */
interface Held {
  readonly of: RequestData;
  readonly asked: Asked;
  readonly costs: ReadonlyMap<string, Cost>;
  readonly months: ReadonlyMap<string, Month>;
  /** The cost last drawn: stays, dimmed, while the next is on its way. */
  readonly last: Cost;
  /** An ask Time Off did not answer; asking it again reads again. */
  readonly failed: { readonly key: string; readonly message: string } | null;
}

function hold(of: RequestData): Held {
  const key = costKey(of.asked);
  const cost = { preview: of.preview, problem: of.problem };
  return {
    of,
    asked: of.asked,
    costs: new Map(key === null ? [] : [[key, cost]]),
    months: new Map([[of.asked.month, { team: of.team, holidays: of.holidays }]]),
    last: cost,
    failed: null,
  };
}

/** What the address asks, as the host reads it (`requestPanel`): for Back, which only moves the address. */
function askedIn(search: string, today: string): Asked {
  const q = new URLSearchParams(search);
  const from = q.get('from');
  const step = q.get('step');
  return {
    type: q.get('type'),
    from,
    to: q.get('to') ?? from,
    half: q.get('half') === '1',
    step: step === 'type' || step === 'dates' || step === 'review' ? step : null,
    month: q.get('month') ?? (from ?? today).slice(0, 7),
  };
}

function Panel({
  data: answered,
  onAsk,
  onRead,
  onSend,
  onNavigate,
}: {
  readonly data: RequestData;
} & Omit<RequestProps, 'load'>): JSX.Element {
  const touch = useCoarsePointer();
  const roomy = useRoomy() && !touch;
  /*
   * What is chosen shows at once, and so does what it costs when Time Off
   * has said so before: every answer is kept under what was asked. Choosing
   * the dates brings each other type's cost with it, so changing the type
   * afterwards asks nobody; a type with no dates costs nothing to say.
   */
  const [state, setState] = useState(() => hold(answered));
  // The page itself answered again (opened anew, or a host without `onRead`): that is what is held.
  if (state.of !== answered) setState(hold(answered));
  const held = state.of === answered ? state : hold(answered);
  const { asked } = held;
  const key = costKey(asked);
  const had =
    key === null
      ? NO_COST
      : (held.costs.get(key) ??
        (held.failed?.key === key ? { preview: null, problem: held.failed.message } : undefined));
  const waiting = had === undefined;
  const data: RequestData = {
    ...answered,
    asked,
    ...(had ?? held.last),
    ...held.months.get(asked.month),
  };
  const { preview } = data;
  const type = data.leaveTypes.find((t) => t.key === asked.type) ?? null;
  const step: Step = asked.step ?? (type === null ? 'type' : 'dates');
  /** Under a finger, only this step's part; at a desk, every part. */
  const shown = (s: Step): string | undefined => (step === s ? undefined : 'touch:hidden');

  // One read at a time, and after it the latest one wanted: the browser sends
  // them in turn, so a month flicked past is never waited for.
  const flying = useRef(false);
  const wanted = useRef<Asked | null>(null);
  const read = (to: Asked): void => {
    if (onRead === undefined) return;
    const k = costKey(to);
    if ((k === null || held.costs.has(k)) && held.months.has(to.month)) return;
    wanted.current = to;
    if (flying.current) return;
    flying.current = true;
    const others =
      k === null
        ? []
        : answered.leaveTypes
            .filter((t) => t.key !== to.type && t.category !== 'parental_leave')
            .filter((t) => !held.costs.has(costKey({ ...to, type: t.key }) ?? ''))
            .map((t) => t.key);
    const search = {
      ...(to.type === null ? {} : { type: to.type }),
      ...(to.from === null ? {} : { from: to.from }),
      ...(to.to === null ? {} : { to: to.to }),
      ...(to.half ? { half: '1' } : {}),
      month: to.month,
    };
    const fail = (message: string): void => {
      if (k !== null) setState((was) => ({ ...was, failed: { key: k, message } }));
    };
    onRead(search, others)
      .then((got) => {
        if (got.answer.status !== 'ready') {
          fail(got.answer.message);
          return;
        }
        const answer = got.answer.data as RequestData;
        setState((was) => {
          const costs = new Map(was.costs);
          if (k !== null) costs.set(k, { preview: answer.preview, problem: answer.problem });
          for (const [other, cost] of Object.entries(got.others)) {
            costs.set(costKey({ ...to, type: other }) ?? '', cost);
          }
          const months = new Map(was.months);
          months.set(to.month, { team: answer.team, holidays: answer.holidays });
          return { ...was, costs, months };
        });
      })
      .catch(() => {
        fail(tr('request.request.time_off_did_not_answer', 'Time Off did not answer.'));
      })
      .finally(() => {
        flying.current = false;
        const next = wanted.current;
        if (next !== null && next !== to) read(next);
      });
  };
  const ask = (next: Ask, mode: 'push' | 'replace' = 'replace'): void => {
    if (onAsk === undefined) return;
    const to: Asked = {
      ...asked,
      ...('type' in next ? { type: next.type ?? null } : {}),
      ...('from' in next ? { from: next.from ?? null } : {}),
      ...('to' in next ? { to: next.to ?? null } : {}),
      ...('half' in next ? { half: next.half === '1' } : {}),
      ...(typeof next.month === 'string' ? { month: next.month } : {}),
      ...('step' in next ? { step: (next.step ?? null) as Step | null } : {}),
    };
    setState((was) => ({ ...was, asked: to, last: had ?? was.last, failed: null }));
    onAsk(next, mode);
    read(to);
  };
  // Back (a phone's steps) moves the address and nothing else: what it asks is drawn.
  const follow = useRef(read);
  useEffect(() => {
    follow.current = read;
  });
  useEffect(() => {
    if (onRead === undefined) return;
    const onBack = (): void => {
      const to = askedIn(window.location.search, answered.today);
      setState((was) => ({ ...was, asked: to, failed: null }));
      follow.current(to);
    };
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('popstate', onBack);
    };
  }, [onRead, answered.today]);

  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [sending, start] = useTransition();
  // Sent only once what it costs is of these dates, not of the ones before.
  const ready =
    !waiting && type !== null && preview !== null && asked.from !== null && asked.to !== null;
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
    <DialogContent
      sheetOnTouch
      showCloseButton={!roomy}
      // Past the type, a phone's steps are the whole screen (MT6, MT7).
      className={`${roomy ? FILLS : WIDE} ${step === 'type' ? '' : 'touch:h-full touch:max-h-full touch:rounded-none'}`}
    >
      <DialogHeader>
        {step === 'type' ? null : (
          <AppBarBack
            className="hidden touch:inline-flex"
            onClick={() => {
              ask({ step: step === 'review' ? 'dates' : 'type' });
            }}
          >
            {step === 'review'
              ? tr('request.request.dates', 'Dates')
              : tr('request.request.type', 'Type')}
          </AppBarBack>
        )}
        {/* The modal holding it already says so. */}
        <DialogTitle className={roomy ? 'sr-only' : undefined}>
          {tr('request.request.request_time_off', 'Request time off')}
        </DialogTitle>
        <DialogDescription>
          {preview?.approver == null
            ? tr(
                'request.request.choose_a_type_and_the_dates',
                'Choose a type and the dates. Nothing is sent until you send it.',
              )
            : tr('request.request.approves', '{{displayName}} approves.', {
                displayName: preview.approver.displayName,
              })}
        </DialogDescription>
        <Button
          variant="ghost"
          size="sm"
          className={`self-start ${shown('type') ?? ''}`}
          startIcon={<icons.assistant aria-hidden />}
          asChild
        >
          <a href="/time-off/request/describe">
            {tr('request.request.describe_it_instead', 'Describe it instead')}
          </a>
        </Button>
      </DialogHeader>
      <DialogBody className="@container/panel">
        <div className={columns}>
          <TypePicker
            data={data}
            className={shown('type')}
            onPick={(picked) => {
              ask({ type: picked, step: touch ? 'dates' : null }, touch ? 'push' : 'replace');
            }}
          />
          <div className="flex min-w-0 flex-col gap-5">
            <DatePicker data={data} className={shown('dates')} ask={ask} />
            <div
              // What it costs is of the last answer until the next is in.
              aria-busy={waiting}
              className={`flex flex-col gap-4 transition-opacity ${waiting ? 'opacity-60' : ''} ${shown('review') ?? ''}`}
            >
              {type?.category !== 'sick_leave' ? null : (
                <Alert
                  tone="info"
                  icon={<icons.health aria-hidden />}
                  title={tr(
                    'request.request.sorry_youre_not_feeling_well',
                    'Sorry you’re not feeling well',
                  )}
                >
                  {tr(
                    'request.request.take_the_time_you_need',
                    'Take the time you need to rest and get better. Work can wait; your health comes first.',
                  )}
                </Alert>
              )}
              {data.problem === null ? null : (
                <Alert
                  tone="danger"
                  title={tr(
                    'request.request.those_dates_cannot_be_asked_for',
                    'Those dates cannot be asked for',
                  )}
                >
                  {data.problem}
                </Alert>
              )}
              {preview === null || type === null ? (
                <p className="text-sm text-fg-muted touch:hidden">
                  {type === null
                    ? tr(
                        'request.request.choose_a_type_then_the_dates',
                        'Choose a type, then the dates, to see what they cost.',
                      )
                    : tr(
                        'request.request.choose_the_dates_to_see_what',
                        'Choose the dates to see what they cost.',
                      )}
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
                <Alert
                  tone="danger"
                  title={tr('request.request.the_request_was_not_sent', 'The request was not sent')}
                >
                  {failed}
                </Alert>
              )}
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter
        // Filling a modal, the footer is that modal's: ruled off as its other footers are.
        className={`${roomy ? 'border-t border-border bg-surface' : ''} ${step === 'type' ? 'touch:hidden' : ''}`}
      >
        {/* At a desk: leave, or send. */}
        {/* Filling a modal, that modal's own close is the way out. */}
        <Button className={roomy ? 'hidden' : 'touch:hidden'} onClick={() => onNavigate?.(CLOSE)}>
          {tr('request.request.cancel', 'Cancel')}
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
                  ? tr('request.request.no_dates_yet', 'No dates yet')
                  : spanLabel(asked.from, asked.to)}
              </span>
              <span className="block truncate text-sm text-fg-muted">
                {preview === null
                  ? tr('request.request.pick_the_first_and_last_day', 'Pick the first and last day')
                  : [
                      days(preview.span.workingDays),
                      preview.balance === null
                        ? null
                        : tr('request.request.left_after', '{{after}} left after', {
                            after: amount(preview.balance.after),
                          }),
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
              {tr('request.request.next', 'Next')}
            </Button>
          </div>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}

/** Two columns at a desk, the picker and the dates side by side: wider than a dialog's default. */
const WIDE = 'sm:max-w-4xl';

/** "Send to Marco", "Send to Marco and HR", "Send to HR", or "Send" when nobody approves it. */
function sendTo(preview: RequestData['preview']): string {
  if (preview === null) return tr('request.request.send_request', 'Send request');
  const names = preview.approvers.map((role) =>
    role === 'manager' && preview.approver !== null
      ? (preview.approver.displayName.split(' ')[0] ?? preview.approver.displayName)
      : role === 'hr'
        ? 'HR'
        : tr('request.request.your_manager', 'your manager'),
  );
  return names.length === 0
    ? tr('request.request.send', 'Send')
    : tr('request.request.send_to', 'Send to {{join}}', { join: formatList(names) });
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
        {tr('request.request.type', 'Type')}
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
            description={tr('request.request.opens_the_planner', 'Opens the planner')}
            chevron
          >
            <a href="/time-off/parental/plan">
              {tr('request.request.parental_leave', 'Parental leave')}
            </a>
          </ListItem>
        </List>
      )}
    </section>
  );
}

function leftOf(t: RequestData['leaveTypes'][number]): string {
  if (t.left === null)
    return t.category === 'sick_leave'
      ? tr('request.request.paid_tell_your_manager_today', 'Paid · tell your manager today')
      : tr('request.request.not_taken_from_a_balance', 'Not taken from a balance');
  return t.unit === 'hour'
    ? tr('request.request.h_banked', '{{left}}h banked', { left: amount(t.left) })
    : tr('request.request.left', '{{days}} left', { days: days(t.left) });
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
    const name =
      data.team?.people.find((p) => p.personId === e.personId)?.displayName ??
      tr('request.request.someone', 'Someone');
    const tone = chartTone(data.leaveTypes.find((t) => t.key === e.leaveTypeKey)?.colorToken);
    for (let d = e.span.from; d <= e.span.to; d = addDays(d, 1)) {
      (markers[d] ??= []).push({
        tone,
        label: tr('request.request.name_off', '{{name}} off', { name }),
      });
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
      label: tr(
        'request.request.of_in_below_the_team_minimum',
        '{{in}} of {{of}} in, below the team minimum',
        { in: String(c.in), of: String(c.of) },
      ),
    };
  }
  return (
    <section
      aria-label={tr('request.request.dates', 'Dates')}
      className={`flex flex-col gap-3 ${className ?? ''}`}
    >
      <Calendar
        mode="range"
        label={tr('request.request.dates_off', 'Dates off')}
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
          aria-label={tr('request.request.length', 'Length')}
          value={asked.half ? 'half' : 'full'}
          onValueChange={(v) => {
            ask({ half: v === 'half' ? '1' : null });
          }}
        >
          <SegmentedControlItem value="full">
            {tr('request.request.full_days', 'Full days')}
          </SegmentedControlItem>
          <SegmentedControlItem value="half">
            {tr('request.request.half_day', 'Half day')}
          </SegmentedControlItem>
        </SegmentedControl>
        <p className="text-xs text-fg-muted">
          {tr(
            'request.request.dots_are_teammates_who_are_off',
            'Dots are teammates who are off; struck days are holidays.',
          )}
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
          label={tr('request.request.youll_be_off', 'You’ll be off')}
          icon={leaveIcon(type.icon)}
          // The short span: a figure, not a sentence, so it holds one line in its tile.
          value={spanLabel(span.from, span.to)}
          description={tr('request.request.away', '{{name}} · {{days}} · {{days2}} away', {
            name: type.name,
            days: days(span.workingDays),
            days2: days(preview.daysAway.days),
          })}
        />
        {preview.balance === null ? null : (
          <Stat
            inset
            label={tr('request.request.left_2', '{{name}} left', { name: type.name })}
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
          title={tr(
            'request.request.only_of_would_be_in',
            '{{date}}: only {{in}} of {{of}} would be in',
            { date: shortDate(c.date), in: String(c.in), of: String(c.of) },
          )}
        >
          {tr(
            'request.request.your_team_asks_for_at_least',
            'Your team asks for at least {{required}}.',
            { required: String(c.required) },
          ) + ' '}
          {offOn(data, c.date)}
          {preview.blocked
            ? tr(
                'request.request.your_team_does_not_take_requests',
                'Your team does not take requests below its minimum, so pick other dates.',
              )
            : approver === null
              ? tr('request.request.it_can_still_be_approved', 'It can still be approved.')
              : tr('request.request.can_still_approve_it', '{{approver}} can still approve it.', {
                  approver,
                })}
        </Alert>
      ))}
      <WhoElse others={others} />
      {preview.approvers.length === 0 ? null : (
        <Field>
          <FieldLabel>
            {approver === null
              ? tr('request.request.note_optional', 'Note (optional)')
              : tr('request.request.note_for_optional', 'Note for {{approver}} (optional)', {
                  approver,
                })}
          </FieldLabel>
          <FieldControl>
            <Textarea
              value={note}
              rows={2}
              placeholder={
                approver === null
                  ? tr(
                      'request.request.anything_your_approver_should_know',
                      'Anything your approver should know',
                    )
                  : tr('request.request.anything_should_know', 'Anything {{value}} should know', {
                      value: approver,
                    })
              }
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

/** How many teammates the list names before it folds the rest. */
const NAMED = 5;

/**
 * Who else is off in these dates: the first five, each once with their days,
 * and the rest folded into one row of faces until they are asked for, so a
 * busy week never pushes the note and the send out of sight.
 */
function WhoElse({ others }: { readonly others: ReturnType<typeof whoElse> }): JSX.Element | null {
  const [all, setAll] = useState(false);
  if (others.length === 0) return null;
  const named = all ? others : others.slice(0, NAMED);
  const rest = others.slice(named.length);
  return (
    <section aria-labelledby="request-others" className="flex flex-col gap-2">
      <h3 id="request-others" className="text-sm font-semibold text-fg-muted">
        {tr('request.request.who_else_is_off', 'Who else is off')}
        {others.length > NAMED ? ` · ${String(others.length)}` : null}
      </h3>
      <List>
        {named.map((o) => (
          <ListItem
            key={o.personId}
            leading={<Avatar name={o.name} />}
            description={o.spans.map((s) => spanLabel(s.from, s.to)).join(', ')}
            trailing={<Badge size="sm">{o.type ?? tr('request.request.off', 'Off')}</Badge>}
          >
            {o.name}
          </ListItem>
        ))}
      </List>
      {others.length <= NAMED ? null : (
        <div className="flex items-center justify-between gap-3">
          {rest.length === 0 ? (
            <span />
          ) : (
            <AvatarGroup size="sm" max={NAMED} total={rest.length}>
              {rest.slice(0, NAMED).map((o) => (
                <Avatar key={o.personId} name={o.name} size="sm" />
              ))}
            </AvatarGroup>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={all}
            onClick={() => {
              setAll(!all);
            }}
          >
            {all
              ? tr('request.request.show_fewer', 'Show fewer')
              : tr('request.request.show_all', 'Show all {{count}}', {
                  count: String(others.length),
                })}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Teammates off at some point in `span`, from the team's month: each once, the earliest first. */
function whoElse(
  data: RequestData,
  span: Span,
): { personId: string; name: string; type: string | null; spans: Span[] }[] {
  const me = data.overview?.member?.personId;
  const byPerson = new Map<string, { type: string | null; spans: Span[] }>();
  for (const e of data.team?.entries ?? []) {
    if (e.personId === me || e.span.from > span.to || e.span.to < span.from) continue;
    const one = byPerson.get(e.personId) ?? {
      type: data.leaveTypes.find((t) => t.key === e.leaveTypeKey)?.name ?? null,
      spans: [],
    };
    one.spans.push(e.span);
    byPerson.set(e.personId, one);
  }
  return [...byPerson]
    .map(([personId, one]) => ({
      personId,
      name: data.team?.people.find((p) => p.personId === personId)?.displayName ?? 'Someone',
      type: one.type,
      spans: one.spans.toSorted((x, y) => (x.from < y.from ? -1 : 1)),
    }))
    .toSorted((x, y) => ((x.spans[0]?.from ?? '') < (y.spans[0]?.from ?? '') ? -1 : 1));
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
    names.length === 1
      ? names[0]
      : tr('request.request.and', '{{join}} and {{at}}', {
          join: names.slice(0, -1).join(', '),
          at: String(names.at(-1)),
        });
  return (
    tr(
      'request.request.already_off_that_day',
      { one: '{{list}} is already off that day.', other: '{{list}} are already off that day.' },
      { count: names.length, list: String(list) },
    ) + ' '
  );
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
  const who = formatList(
    negative.approvers.map((r) =>
      r === 'manager' ? (approver ?? tr('request.request.your_manager_2', 'Your manager')) : 'HR',
    ),
  );
  const choices: ReactNode[] = [];
  if (negative.kind === 'borrow') {
    choices.push(
      <RadioCard
        key="borrow"
        value="borrow"
        badge={
          <Badge size="sm" tone="accent">
            {tr('request.request.suggested', 'Suggested')}
          </Badge>
        }
        description={tr(
          'request.request.you_keep_all_days_as_paid',
          'You keep all {{workingDays}} days as paid time off.',
          { workingDays: amount(span.workingDays) },
        )}
        impact={`${nextYear} starts at ${amount(negative.nextYearStartsAt ?? '0')}`}
      >
        {tr('request.request.borrow_days_from', 'Borrow {{amount}} days from {{nextYear}}', {
          amount: amount(negative.days ?? '0'),
          nextYear,
        })}
      </RadioCard>,
    );
  }
  if (negative.unpaid !== null) {
    choices.push(
      <RadioCard
        key="unpaid"
        value="unpaid"
        disabled
        description={tr(
          'request.request.not_offered_here_yet_time_off',
          'Not offered here yet: Time Off cannot split one request into paid and unpaid days. Ask HR.',
        )}
      >
        {tr('request.request.make_days_unpaid', 'Make {{amount}} days unpaid', {
          amount: amount(negative.unpaid.days),
        })}
      </RadioCard>,
    );
  }
  if (negative.shorten !== null) {
    const { shorten } = negative;
    choices.push(
      <RadioCard
        key="shorten"
        value="shorten"
        description={tr('request.request.fits_your_balance', '{{days}} fits your balance.', {
          days: days(shorten.days),
        })}
        impact={tr('request.request.nothing_borrowed', 'Nothing borrowed')}
      >
        {shorten.endsHalfDay
          ? tr('request.request.shorten_to_half', 'Shorten to {{spanLabel}}, half the last day', {
              spanLabel: spanLabel(span.from, shorten.to),
            })
          : tr('request.request.shorten_to_span', 'Shorten to {{spanLabel}}', {
              spanLabel: spanLabel(span.from, shorten.to),
            })}
      </RadioCard>,
    );
  }
  return (
    <>
      {negative.kind === 'borrow' ? (
        <Alert
          tone="warning"
          title={tr(
            'request.request.this_takes_you_days_below_zero',
            'This takes you {{below}} days below zero',
            { below },
          )}
        >
          {tr(
            'request.request.you_can_borrow_up_to_the',
            'You can borrow up to the company’s limit from next year’s allowance. {{who}} need to approve it.',
            { who },
          )}
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={tr(
            'request.request.this_goes_past_the_days_you',
            'This goes past the {{amount}} days you can go below zero',
            { amount: amount(negative.limit ?? '0') },
          )}
        >
          {tr(
            'request.request.shorten_it_to_dates_that_fit',
            'Shorten it to dates that fit, or ask HR.',
          )}
        </Alert>
      )}
      {negative.kind === 'borrow' ? (
        <section aria-labelledby="request-borrow" className="flex flex-col gap-2">
          <h3 id="request-borrow" className="text-sm font-semibold text-fg-muted">
            {tr('request.request.what_borrowing_means', 'What borrowing means')}
          </h3>
          <List>
            <ListItem
              icon={<icons.calendar />}
              iconTone="neutral"
              description={tr(
                'request.request.of_next_years_days_are_used',
                '{{amount}} of next year’s days are used now.',
                { amount: amount(negative.days ?? '0') },
              )}
            >
              {tr(
                'request.request.your_allowance_starts_at',
                'Your {{nextYear}} allowance starts at {{amount}}',
                { nextYear, amount: amount(negative.nextYearStartsAt ?? '0') },
              )}
            </ListItem>
            <ListItem
              icon={<icons.payroll />}
              iconTone="neutral"
              description={tr(
                'request.request.the_days_come_out_of_your',
                'The {{amount}} days come out of your final pay.',
                { amount: amount(negative.days ?? '0') },
              )}
            >
              {tr(
                'request.request.if_you_leave_before_youve_earned',
                'If you leave before you’ve earned them back',
              )}
            </ListItem>
            <ListItem
              icon={<icons.approve />}
              iconTone="neutral"
              description={
                negative.approvers.length > 1
                  ? tr('request.request.in_that_order', '{{who}}, in that order.', { who })
                  : who
              }
            >
              {negative.approvers.length > 1
                ? tr('request.request.two_approvals', 'Two approvals')
                : tr('request.request.one_approval', 'One approval')}
            </ListItem>
          </List>
        </section>
      ) : null}
      {choices.length === 0 ? null : (
        <section aria-labelledby="request-instead" className="flex flex-col gap-2">
          <h3 id="request-instead" className="text-sm font-semibold text-fg-muted">
            {negative.kind === 'borrow'
              ? tr('request.request.or_instead', 'Or instead')
              : tr('request.request.what_you_can_do', 'What you can do')}
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
      <span className="sr-only">
        {tr('request.request.loading_the_request_panel', 'Loading the request panel')}
      </span>
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
