import {
  Alert,
  Badge,
  Button,
  Calendar,
  Card,
  type DateRange,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  formatList,
  icons,
  List,
  ListItem,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  Skeleton,
  Stat,
  Timeline,
  TimelineItem,
  type TimelineItemProps,
} from '@reach/ui';
import { useState, useTransition, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  addDays,
  amount,
  days,
  leaveIcon,
  longSpan,
  nextWorkingDay,
  shortDate,
  spanLabel,
  statusOf,
} from '../words';
import { t } from '../i18n';

/**
 * My requests and the timeline (T6, T7, MT10): the caller's requests,
 * upcoming, past or cancelled (each tab its own address), and one of them
 * with what happened to it — sent, who approved it or who it waits on, a
 * change waiting, and what it does to pay (PRD §8.3, §8.4).
 *
 * At a desk the list and the request sit side by side: on a tab, its first
 * request; at `/time-off/requests/:id`, that one. Under 40rem of its own
 * width a tab is the list and a request's address is the request (MT10).
 *
 * From the request: take one of the dates a manager suggested in one tap,
 * or keep your own; and change or cancel it (T7). Moving the dates asks
 * again and keeps the old ones booked until then; shortening and cancelling
 * give time back, so they are approved at once. Every write is the host's.
 */

type Tab = 'upcoming' | 'past' | 'cancelled';

interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

export interface RequestItem {
  readonly requestId: string;
  /** Whose it is: on one request's own answer, not on the lists'. */
  readonly personId?: string;
  readonly displayName: string;
  readonly leaveTypeKey: string;
  readonly leaveTypeName: string;
  readonly category: string;
  readonly status: string;
  readonly span: Span;
  readonly workingDays: string;
  readonly requestedAt: string;
  readonly waitingOn: string | null;
}

export interface RequestDetailData {
  readonly request: RequestItem;
  readonly note: string | null;
  readonly pendingChange: Span | null;
  readonly proposals: readonly {
    readonly index: number;
    readonly spans: readonly { readonly from: string; readonly to: string }[];
    readonly workingDays: string;
  }[];
  /** What the approver wrote with the dates they suggested (TOF-099b). */
  readonly proposalMessage?: string | null;
  /** Who approves, in order: `manager`, `hr`. */
  readonly chain: readonly string[];
  /** The step it waits on, or the last one decided. */
  readonly step: number;
  readonly escalated: boolean;
  readonly mine: boolean;
  readonly canChange: boolean;
  readonly canCancel: boolean;
  readonly canAnswer: boolean;
  /** A note is attached; what it says only its member and HR may see. */
  readonly notePresent?: boolean;
  /** Its leave type asks for a note it does not have yet: told only to its member and HR. */
  readonly noteNeeded?: boolean;
}

/** A file kept elsewhere that could be the note, as the host lists it. */
export interface NoteFile {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

export interface RequestsData {
  readonly tab: Tab;
  readonly items: readonly RequestItem[];
  /** The request on show; null when the tab is empty. */
  readonly selected: RequestDetailData | null;
  /** Drawn at the request's own address rather than a tab's. */
  readonly single: boolean;
  readonly today: string;
}

export interface RequestsProps {
  readonly load: Loadable<RequestsData>;
  readonly onCancel?: ((requestId: string) => Promise<Outcome>) | undefined;
  readonly onChange?: ((requestId: string, span: Span) => Promise<Outcome>) | undefined;
  readonly onShorten?: ((requestId: string, to: string) => Promise<Outcome>) | undefined;
  /** Take suggestion `accept`, or keep your own dates with null. */
  readonly onAnswer?: ((requestId: string, accept: number | null) => Promise<Outcome>) | undefined;
  /**
   * Where a missing note comes from, worded by the host ("From Documents"):
   * a file already kept, or one chosen now. Absent: the request says a note
   * is needed and nothing more.
   */
  readonly notes?:
    | {
        readonly label: string;
        /** The person the request is for: the viewer, or whoever HR is acting for. */
        readonly load: (personId: string) => Promise<readonly NoteFile[]>;
        readonly onAttach: (requestId: string, fileId: string) => Promise<Outcome>;
        readonly onUpload: (requestId: string, file: File, personId: string) => Promise<Outcome>;
      }
    | undefined;
}

export function MyRequests(props: RequestsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <RequestsSkeleton />;
  return (
    <div className="@container/requests flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={t('requests.requests.my_requests', 'My requests')} />
      ) : null}
      <Loaded load={load} what={t('requests.requests.your_requests', 'your requests')}>
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

/** The list beside the request at a desk; one or the other below 40rem. */
const body =
  'flex flex-col gap-5 @min-[56rem]/requests:grid @min-[56rem]/requests:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] @min-[56rem]/requests:items-start';

const EMPTY: Record<Tab, string> = {
  get upcoming(): string {
    return t('requests.requests.nothing_booked_ahead', 'Nothing booked ahead.');
  },
  get past(): string {
    return t('requests.requests.no_time_off_taken_yet_this', 'No time off taken yet this year.');
  },
  get cancelled(): string {
    return t('requests.requests.nothing_cancelled', 'Nothing cancelled.');
  },
};

function Ready({ data, ...actions }: { readonly data: RequestsData } & RequestsProps): JSX.Element {
  const { selected, single } = data;
  const title =
    single && selected !== null
      ? t('requests.requests.text', '{{value}}{{leaveTypeName}} · {{spanLabel}}', {
          value: selected.mine ? '' : `${selected.request.displayName} · `,
          leaveTypeName: selected.request.leaveTypeName,
          spanLabel: spanLabel(selected.request.span.from, selected.request.span.to),
        })
      : t('requests.requests.my_requests', 'My requests');
  return (
    <>
      <PageHeader title={title} />
      <div className={body}>
        {single && selected !== null && !selected.mine ? null : (
          <div className={single ? '@max-[40rem]/requests:hidden' : undefined}>
            {data.items.length === 0 ? (
              <p className="text-sm text-fg-muted">{EMPTY[data.tab]}</p>
            ) : (
              <List navigable>
                {data.items.map((r) => {
                  const on = r.requestId === selected?.request.requestId;
                  const status = statusOf(r.status);
                  return (
                    <ListItem
                      key={r.requestId}
                      asChild
                      selected={on}
                      icon={leaveIcon(iconFor(r))}
                      description={t('requests.requests.text_2', '{{spanLabel}} · {{days}}', {
                        spanLabel: spanLabel(r.span.from, r.span.to),
                        days: days(r.workingDays),
                      })}
                      trailing={
                        <Badge size="sm" tone={status.tone} dot>
                          {status.label}
                        </Badge>
                      }
                    >
                      <a
                        href={`/time-off/requests/${r.requestId}`}
                        aria-current={on ? 'page' : undefined}
                      >
                        {r.leaveTypeName}
                      </a>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </div>
        )}
        {selected === null ? null : (
          <div className={single ? undefined : '@max-[40rem]/requests:hidden'}>
            <Detail detail={selected} today={data.today} {...actions} />
          </div>
        )}
      </div>
    </>
  );
}

/** A request carries its category, not its type's icon: the category's, else the generic one. */
const CATEGORY_ICON: Record<string, string> = {
  annual_leave: 'sun',
  sick_leave: 'thermometer',
  parental_leave: 'baby',
};
const iconFor = (r: RequestItem): string | undefined => CATEGORY_ICON[r.category];

/* ------------------------------------------------------------- detail -- */

const ROLE: Record<string, string> = {
  get manager(): string {
    return t('requests.requests.your_manager', 'your manager');
  },
  hr: 'HR',
};
const role = (r: string | undefined): string =>
  ROLE[r ?? ''] ?? t('requests.requests.an_approver', 'an approver');
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function Detail({
  detail,
  today,
  onCancel,
  onChange,
  onShorten,
  onAnswer,
  notes,
}: {
  readonly detail: RequestDetailData;
  readonly today: string;
} & Omit<RequestsProps, 'load'>): JSX.Element {
  const { request } = detail;
  const status = statusOf(request.status);
  const [dialog, setDialog] = useState<Choice | null>(null);
  const label = t('requests.requests.text_3', '{{leaveTypeName}} · {{spanLabel}}', {
    leaveTypeName: request.leaveTypeName,
    spanLabel: spanLabel(request.span.from, request.span.to),
  });
  return (
    <PageSection
      title={label}
      aria-label={label}
      surface
      actions={
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 @min-[28rem]/requests:grid-cols-2">
          <Stat
            inset
            label={t('requests.requests.youre_off', 'You’re off')}
            icon={leaveIcon(iconFor(request))}
            value={longSpan(request.span.from, request.span.to)}
            description={days(request.workingDays)}
          />
          <Stat
            inset
            label={t('requests.requests.back_at_work', 'Back at work')}
            value={shortDate(nextWorkingDay(request.span.to))}
          />
        </div>
        {detail.canAnswer && detail.proposals.length > 0 ? (
          <Suggestions detail={detail} onAnswer={onAnswer} />
        ) : null}
        <Timeline aria-label={t('requests.requests.what_happened', 'What happened')}>
          {steps(detail, today)}
        </Timeline>
        {detail.note === null ? null : (
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">
              {t('requests.requests.your_note', 'Your note:')}{' '}
            </span>
            {detail.note}
          </p>
        )}
        {detail.noteNeeded === true && request.personId !== undefined ? (
          <NoteNeeded requestId={request.requestId} personId={request.personId} notes={notes} />
        ) : detail.notePresent === true ? (
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            <icons.success aria-hidden className="size-4 text-success" />
            {t('requests.requests.a_note_is_attached', 'A note is attached.')}
          </p>
        ) : null}
        {detail.canChange || detail.canCancel ? (
          <div className="flex flex-wrap gap-2 touch:[&>*]:flex-1">
            {detail.canChange ? (
              <Button
                startIcon={<icons.calendar aria-hidden />}
                onClick={() => {
                  setDialog('move');
                }}
              >
                {t('requests.requests.change_dates', 'Change dates')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                setDialog('cancel');
              }}
            >
              {request.status === 'approved'
                ? t('requests.requests.cancel_request', 'Cancel request')
                : t('requests.requests.withdraw_request', 'Withdraw request')}
            </Button>
          </div>
        ) : null}
      </div>
      {dialog === null ? null : (
        <ChangeDialog
          detail={detail}
          today={today}
          initial={dialog}
          onClose={() => {
            setDialog(null);
          }}
          onCancel={onCancel}
          onChange={onChange}
          onShorten={onShorten}
        />
      )}
    </PageSection>
  );
}

/**
 * The timeline, from what Time Off knows: when it was sent, each approver
 * in the chain against the step it is on, a change or suggestion waiting,
 * and what it does to pay. What other tools did (calendar, chat, an
 * out-of-office) joins when integrations are connected (Phase 3).
 */
function steps(detail: RequestDetailData, today: string): ReactNode {
  const { request, chain, step } = detail;
  const s = request.status;
  const out: (TimelineItemProps & { readonly id: string })[] = [
    {
      id: 'sent',
      title: t('requests.requests.sent', 'Sent'),
      tone: 'success',
      icon: <icons.send />,
      timestamp: shortDate(request.requestedAt.slice(0, 10)),
      children: t('requests.requests.you_asked_for', 'You asked for {{spanLabel}}.', {
        spanLabel: spanLabel(request.span.from, request.span.to),
      }),
    },
  ];
  const decided = ['approved', 'taken', 'change_pending'].includes(s) ? chain.length : step;
  chain.forEach((r, i) => {
    const id = `step${String(i)}`;
    if (i < decided) {
      out.push({
        id,
        title: t('requests.requests.approved_by', 'Approved by {{role}}', { role: role(r) }),
        tone: 'success',
        icon: <icons.approve />,
      });
    } else if (i === step && s === 'declined') {
      out.push({
        id,
        title: t('requests.requests.declined_by', 'Declined by {{role}}', { role: role(r) }),
        tone: 'danger',
        icon: <icons.reject />,
        children: t(
          'requests.requests.the_days_went_back_to_your',
          'The days went back to your balance.',
        ),
      });
    } else if (i === step && s === 'pending') {
      out.push({
        id,
        title: t('requests.requests.waiting_for', 'Waiting for {{role}}', { role: role(r) }),
        tone: 'warning',
        status: 'current',
        icon: <icons.pending />,
        children: detail.escalated
          ? t(
              'requests.requests.escalated_nobody_answered_in_time',
              'Escalated: nobody answered in time.',
            )
          : t(
              'requests.requests.the_days_are_booked_while_it',
              'The days are booked while it waits.',
            ),
      });
    } else if (i > step && (s === 'pending' || s === 'counter_proposed')) {
      out.push({
        id,
        title: t('requests.requests.then', 'Then {{role}}', { role: role(r) }),
        status: 'upcoming',
        icon: <icons.approve />,
      });
    }
  });
  if (s === 'counter_proposed') {
    out.push({
      id: 'suggested',
      title: t('requests.requests.suggested_other_dates', '{{capital}} suggested other dates', {
        capital: capital(role(chain[step])),
      }),
      tone: 'info',
      status: 'current',
      icon: <icons.calendar />,
      children: t(
        'requests.requests.take_one_or_keep_yours_and',
        'Take one, or keep yours and it goes back to them.',
      ),
    });
  }
  if (s === 'change_pending' && detail.pendingChange !== null) {
    out.push({
      id: 'change',
      title: t(
        'requests.requests.you_asked_to_move_it_to',
        'You asked to move it to {{spanLabel}}',
        { spanLabel: spanLabel(detail.pendingChange.from, detail.pendingChange.to) },
      ),
      tone: 'warning',
      status: 'current',
      icon: <icons.pending />,
      children: t(
        'requests.requests.your_old_dates_stay_booked_until',
        'Your old dates stay booked until the new ones are approved.',
      ),
    });
  }
  if (s === 'cancelled' || s === 'withdrawn') {
    out.push({
      id: 'cancelled',
      title:
        s === 'withdrawn'
          ? t('requests.requests.withdrawn', 'Withdrawn')
          : t('requests.requests.cancelled', 'Cancelled'),
      icon: <icons.close />,
      children: t(
        'requests.requests.the_days_went_back_to_your',
        'The days went back to your balance.',
      ),
    });
  }
  if (s === 'taken' || (s === 'approved' && request.span.to < today)) {
    out.push({
      id: 'taken',
      title: t('requests.requests.taken', 'Taken'),
      tone: 'success',
      icon: <icons.success />,
    });
  }
  if (request.category === 'annual_leave' && !['declined', 'cancelled', 'withdrawn'].includes(s)) {
    out.push({
      id: 'pay',
      title: t('requests.requests.no_payroll_change', 'No payroll change'),
      status: 'upcoming',
      icon: <icons.payroll />,
      children: t(
        'requests.requests.paid_vacation_so_your_pay_stays',
        'Paid vacation, so your pay stays the same.',
      ),
    });
  }
  return out.map(({ id, ...item }, i) => (
    <TimelineItem key={id} {...item} last={i === out.length - 1} />
  ));
}

/* --------------------------------------------------------- suggestions -- */

/** A manager's other dates, each one tap to take (PRD §9.5), or keep your own. */
function Suggestions({
  detail,
  onAnswer,
}: {
  readonly detail: RequestDetailData;
  readonly onAnswer: RequestsProps['onAnswer'];
}): JSX.Element {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const answer = (accept: number | null): void => {
    if (onAnswer === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await onAnswer(detail.request.requestId, accept);
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  return (
    <Card padded className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">
          {t('requests.requests.suggested_other_dates', '{{capital}} suggested other dates', {
            capital: capital(role(detail.chain[detail.step])),
          })}
        </h3>
        <p className="text-sm text-fg-muted">
          {t(
            'requests.requests.taking_one_approves_it_keeping_yours',
            'Taking one approves it. Keeping yours sends it back.',
          )}
        </p>
      </div>
      {detail.proposalMessage === null || detail.proposalMessage === undefined ? null : (
        <blockquote className="text-sm whitespace-pre-line">{detail.proposalMessage}</blockquote>
      )}
      <div className="flex flex-wrap gap-2 touch:flex-col">
        {detail.proposals.map((p) => {
          const label = formatList(p.spans.map((r) => spanLabel(r.from, r.to)));
          return (
            <Button
              key={p.index}
              variant="primary"
              disabled={pending}
              onClick={() => {
                answer(p.index);
              }}
            >
              {t('requests.requests.take', 'Take {{label}} · {{days}}', {
                label,
                days: days(p.workingDays),
              })}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            answer(null);
          }}
        >
          {t('requests.requests.keep_my_dates', 'Keep my dates')}
        </Button>
      </div>
      {failed === null ? null : (
        <Alert
          tone="danger"
          title={t('requests.requests.that_did_not_go_through', 'That did not go through')}
        >
          {failed}
        </Alert>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- change -- */

type Choice = 'move' | 'shorten' | 'cancel';

/**
 * T7: move, shorten or cancel. Moving and shortening only for an approved
 * request; a request nobody has decided is withdrawn. Then the new dates
 * (a range) or the new last day, and Time Off's answer.
 */
function ChangeDialog({
  detail,
  today,
  initial,
  onClose,
  onCancel,
  onChange,
  onShorten,
}: {
  readonly detail: RequestDetailData;
  readonly today: string;
  readonly initial: Choice;
  readonly onClose: () => void;
} & Pick<RequestsProps, 'onCancel' | 'onChange' | 'onShorten'>): JSX.Element {
  const { request } = detail;
  const { from, to } = request.span;
  const [choice, setChoice] = useState<Choice>(detail.canChange ? initial : 'cancel');
  const [picking, setPicking] = useState(false);
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [last, setLast] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (write: (() => Promise<Outcome>) | undefined): void => {
    if (write === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await write();
      if (outcome.ok) onClose();
      else setFailed(outcome.message);
    });
  };
  const id = request.requestId;
  const n = amount(request.workingDays);
  const label = spanLabel(from, to);
  const approved = request.status === 'approved';
  const proceed = (): void => {
    if (choice === 'cancel') {
      run(onCancel && (() => onCancel(id)));
    } else if (!picking) {
      setPicking(true);
    } else if (choice === 'move' && range.start !== null && range.end !== null) {
      const span = { from: range.start, to: range.end, startsHalfDay: false, endsHalfDay: false };
      run(onChange && (() => onChange(id, span)));
    } else if (choice === 'shorten' && last !== null) {
      run(onShorten && (() => onShorten(id, last)));
    }
  };
  const ready =
    choice === 'cancel' ||
    !picking ||
    (choice === 'move' ? range.start !== null && range.end !== null : last !== null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approved
              ? t('requests.requests.change', 'Change {{label}}', { label })
              : t('requests.requests.withdraw', 'Withdraw {{label}}', { label })}
          </DialogTitle>
          <DialogDescription>
            {approved
              ? t(
                  'requests.requests.its_approved_so_moving_it_goes',
                  'It’s approved, so moving it goes back to your approver. Your balance updates when they say yes.',
                )
              : t(
                  'requests.requests.nobody_has_decided_yet_withdrawing_it',
                  'Nobody has decided yet. Withdrawing it gives the days back at once.',
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {!picking ? (
            <RadioGroup
              aria-label={t('requests.requests.what_to_do', 'What to do')}
              value={choice}
              onValueChange={(v) => {
                setChoice(v as Choice);
              }}
            >
              {detail.canChange ? (
                <>
                  <RadioCard
                    value="move"
                    description={t(
                      'requests.requests.pick_new_dates_the_old_ones',
                      'Pick new dates. The old ones stay booked until the new ones are approved.',
                    )}
                  >
                    {t('requests.requests.move_the_dates', 'Move the dates')}
                  </RadioCard>
                  <RadioCard
                    value="shorten"
                    description={t(
                      'requests.requests.give_back_days_you_dont_need',
                      'Give back days you don’t need. Shortening is approved automatically.',
                    )}
                    impact={t('requests.requests.up_to_back', 'Up to {{days}} back', {
                      days: days(request.workingDays),
                    })}
                  >
                    {t('requests.requests.shorten_it', 'Shorten it')}
                  </RadioCard>
                </>
              ) : null}
              <RadioCard
                value="cancel"
                description={t(
                  'requests.requests.all_back_to_your_balance_straight',
                  {
                    one: 'All {{count}} day goes back to your balance straight away.',
                    other: 'All {{count}} days go back to your balance straight away.',
                  },
                  { count: Number(n) },
                )}
              >
                {approved
                  ? t('requests.requests.cancel_it', 'Cancel it')
                  : t('requests.requests.withdraw_it', 'Withdraw it')}
              </RadioCard>
            </RadioGroup>
          ) : choice === 'move' ? (
            <Calendar
              mode="range"
              label={t('requests.requests.new_dates', 'New dates')}
              today={today}
              month={from}
              min={today}
              selected={range}
              onSelect={setRange}
              highlight={{
                start: from,
                end: to,
                label: t('requests.requests.booked_now', 'Booked now'),
              }}
            />
          ) : (
            <Calendar
              mode="single"
              label={t('requests.requests.new_last_day', 'New last day')}
              today={today}
              month={from}
              min={from > today ? from : today}
              max={addDays(to, -1)}
              selected={last}
              onSelect={setLast}
            />
          )}
          {failed === null ? null : (
            <Alert
              tone="danger"
              title={t('requests.requests.that_did_not_go_through', 'That did not go through')}
            >
              {failed}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('requests.requests.keep_it', 'Keep it')}</Button>
          <Button
            variant={choice === 'cancel' ? 'danger' : 'primary'}
            disabled={!ready}
            loading={pending}
            onClick={proceed}
          >
            {choice === 'cancel'
              ? approved
                ? t('requests.requests.cancel_it', 'Cancel it')
                : t('requests.requests.withdraw_it', 'Withdraw it')
              : !picking
                ? t('requests.requests.continue', 'Continue')
                : choice === 'move'
                  ? t('requests.requests.ask_again', 'Ask again')
                  : t('requests.requests.give_the_days_back', 'Give the days back')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** The page while it loads, in its shape: the list beside the request. */
export function RequestsSkeleton(): JSX.Element {
  return (
    <div className="@container/requests flex flex-col gap-6">
      <PageHeader title={t('requests.requests.my_requests', 'My requests')} />
      <div role="status" className={body}>
        <span className="sr-only">
          {t('requests.requests.loading_your_requests', 'Loading your requests')}
        </span>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((n) => (
            <Skeleton key={n} className="h-16 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-[30rem] rounded-lg @max-[40rem]/requests:hidden" />
      </div>
    </div>
  );
}

/**
 * A request missing its note (Documents J5): a file already kept, offered
 * first so nobody uploads twice, or one chosen now. Whoever decides learns
 * that a note arrived, never what it says.
 */
function NoteNeeded({
  requestId,
  personId,
  notes,
}: {
  readonly requestId: string;
  readonly personId: string;
  readonly notes: RequestsProps['notes'];
}): JSX.Element {
  const [files, setFiles] = useState<readonly NoteFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const attach = (run: () => Promise<Outcome>): void => {
    setError(null);
    start(async () => {
      const done = await run();
      if (!done.ok) setError(done.message);
    });
  };
  return (
    <Alert
      tone="warning"
      title={t('requests.requests.a_note_is_needed', 'A note is needed')}
      icon={<icons.document />}
    >
      <div className="flex flex-col gap-3">
        <p>
          {t(
            'requests.requests.leave_this_long_needs_a_doctors',
            'Leave this long needs a doctor’s note. Only its person and HR see it.',
          )}
        </p>
        {notes === undefined ? null : files === null ? (
          <Button
            size="sm"
            className="self-start"
            onClick={() => {
              void notes.load(personId).then(setFiles);
            }}
          >
            {t('requests.requests.add_note', 'Add note')}
          </Button>
        ) : (
          <>
            {files.length === 0 ? null : (
              <List aria-label={notes.label}>
                {files.map((f) => (
                  <ListItem
                    key={f.id}
                    description={f.detail}
                    trailing={
                      <Button
                        size="sm"
                        variant="primary"
                        loading={pending}
                        onClick={() => {
                          attach(() => notes.onAttach(requestId, f.id));
                        }}
                      >
                        {t('requests.requests.attach', 'Attach')}
                      </Button>
                    }
                  >
                    {f.name}
                  </ListItem>
                ))}
              </List>
            )}
            <Dropzone
              label={t('requests.requests.or_choose_the_note', 'Or choose the note')}
              accept="application/pdf,image/jpeg,image/png,image/webp"
              variant="inline"
              onFiles={(chosen) => {
                const first = chosen[0];
                if (first !== undefined) attach(() => notes.onUpload(requestId, first, personId));
              }}
            />
          </>
        )}
        {error === null ? null : <p className="text-danger-fg">{error}</p>}
      </div>
    </Alert>
  );
}
