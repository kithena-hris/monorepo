import * as z from 'zod';
import { AggregateRoot, err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  LeaveApproved,
  LeaveCancelled,
  LeaveChanged,
  LeaveCounterProposed,
  LeaveRejected,
  LeaveRequested,
  type CalendarDate,
  type DayAmount,
  type LeaveTypeDefinition,
  type PersonId,
  type RequestStatus,
  type TenantId,
} from '@kithena/contracts';

import { entry, type LedgerEntry } from '../balance/ledger.js';
import type { NegativeVerdict } from '../balance/negative.js';
import { envelope, today, type EventContext } from '../context.js';
import { addDays, amount, days } from '../days.js';

/**
 * A leave request and its whole lifecycle (PRD §8.1, §8.4, §8.5).
 *
 * ```
 * pending ──▶ approved ──▶ taken
 *    │           ├──▶ change_pending ──▶ approved (new dates | old dates kept)
 *    │           └──▶ cancelled
 *    ├──▶ declined
 *    ├──▶ counter_proposed ──▶ approved (accepted) | pending (own dates kept)
 *    └──▶ withdrawn
 * ```
 *
 * Every transition raises its event and returns the ledger entries it
 * implies; the caller appends them in the same transaction as the events.
 * Going below zero is not refused here: `request` takes the verdict
 * `goingBelowZero` reached and refuses only a request beyond the limit.
 *
 * Approval is one step. A manager-then-HR chain is the application walking
 * the chain `resolveApprovers` returns and calling `approve` at its end.
 */

export const LeaveRequestId = z.uuid().brand<'LeaveRequestId'>();
export type LeaveRequestId = z.infer<typeof LeaveRequestId>;

/** Throws: a malformed id is a bug in whatever built it, not a user's mistake. */
export const leaveRequestId = (value: string): LeaveRequestId => LeaveRequestId.parse(value);

/** What the request needs to know about its leave type. */
export type RequestLeaveType = Pick<LeaveTypeDefinition, 'key' | 'category' | 'tracked' | 'paid' | 'unit'>;

/** Dates, half days and their cost in working days (§7.3, computed by the caller). */
export interface Span {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
  readonly workingDays: DayAmount;
}

type Entries = Result<readonly LedgerEntry[]>;

const refuse = (status: RequestStatus, action: string) =>
  err(failure('INVALID_TRANSITION', `A ${status.replace('_', ' ')} request cannot be ${action}`));

export class LeaveRequest extends AggregateRoot<LeaveRequestId> {
  readonly #tenantId: TenantId;
  readonly #personId: PersonId;
  readonly #leaveType: RequestLeaveType;
  readonly #belowZero: boolean;
  /** Special-category health data (§8.5). Read by the member's and HR's view only. */
  readonly #sickNoteFileId: string | null;
  #status: RequestStatus = 'pending';
  #span: Span;
  #proposals: readonly Span[] = [];
  #pendingChange: Span | null = null;
  /** The event that set the current dates, which a change supersedes. */
  #datesEventId = '';

  private constructor(
    id: LeaveRequestId,
    props: { tenantId: TenantId; personId: PersonId; leaveType: RequestLeaveType; span: Span; belowZero: boolean; sickNoteFileId: string | null },
  ) {
    super(id);
    this.#tenantId = props.tenantId;
    this.#personId = props.personId;
    this.#leaveType = props.leaveType;
    this.#span = props.span;
    this.#belowZero = props.belowZero;
    this.#sickNoteFileId = props.sickNoteFileId;
  }

  static request(
    args: {
      id: LeaveRequestId;
      tenantId: TenantId;
      personId: PersonId;
      leaveType: RequestLeaveType;
      span: Span;
      verdict: NegativeVerdict;
      sickNoteFileId?: string | null;
    },
    ctx: EventContext,
  ): Result<{ request: LeaveRequest; entries: readonly LedgerEntry[] }> {
    if (args.span.to < args.span.from) {
      return err(failure('INVALID_PERIOD', 'Leave cannot end before it starts', ['to']));
    }
    if (args.verdict.kind === 'refused') {
      return err(
        failure('BEYOND_NEGATIVE_LIMIT', `This goes further below zero than the ${args.verdict.limit} days allowed`, ['to']),
      );
    }
    const request = new LeaveRequest(args.id, {
      tenantId: args.tenantId,
      personId: args.personId,
      leaveType: args.leaveType,
      span: args.span,
      belowZero: args.verdict.kind === 'borrow',
      sickNoteFileId: args.sickNoteFileId ?? null,
    });
    request.#datesEventId = request.#raise(ctx, LeaveRequested, args.span.from, {
      requestId: args.id,
      personId: args.personId,
      leaveTypeKey: args.leaveType.key,
      category: args.leaveType.category,
      from: args.span.from,
      to: args.span.to,
      startsHalfDay: args.span.startsHalfDay,
      endsHalfDay: args.span.endsHalfDay,
      workingDays: args.span.workingDays,
      belowZero: request.#belowZero,
      notePresent: request.#sickNoteFileId !== null,
    });
    const entries = request.#book(args.span, ctx);
    if (args.verdict.kind === 'borrow') entries.push(request.#post(ctx, 'borrow', args.verdict.days, today(ctx)));
    return ok({ request, entries });
  }

  get status(): RequestStatus {
    return this.#status;
  }
  get personId(): PersonId {
    return this.#personId;
  }
  get leaveType(): RequestLeaveType {
    return this.#leaveType;
  }
  get span(): Span {
    return this.#span;
  }
  get proposals(): readonly Span[] {
    return this.#proposals;
  }
  get pendingChange(): Span | null {
    return this.#pendingChange;
  }
  get belowZero(): boolean {
    return this.#belowZero;
  }
  get notePresent(): boolean {
    return this.#sickNoteFileId !== null;
  }
  get sickNoteFileId(): string | null {
    return this.#sickNoteFileId;
  }

  approve(args: { by: string; jurisdiction: string }, ctx: EventContext): Entries {
    if (this.#status !== 'pending') return refuse(this.#status, 'approved');
    this.#approved(args.by, args.jurisdiction, ctx);
    return ok([]);
  }

  decline(args: { by: string; reason: string | null }, ctx: EventContext): Entries {
    if (this.#status !== 'pending') return refuse(this.#status, 'declined');
    this.#status = 'declined';
    this.#raise(ctx, LeaveRejected, this.#span.from, {
      requestId: this.id,
      personId: this.#personId,
      rejectedBy: args.by,
      reason: args.reason,
    });
    return ok(this.#release(this.#span.workingDays, ctx));
  }

  /** The member takes it back before anyone decided, or instead of answering a counter-proposal. */
  withdraw(ctx: EventContext): Entries {
    if (this.#status !== 'pending' && this.#status !== 'counter_proposed') return refuse(this.#status, 'withdrawn');
    this.#status = 'withdrawn';
    this.#proposals = [];
    this.#raiseCancelled(this.#span.from, this.#span.workingDays, false, ctx);
    return ok(this.#release(this.#span.workingDays, ctx));
  }

  /** Other dates instead of a decline (§9.5). The asked-for dates stay booked meanwhile. */
  counterPropose(args: { by: string; proposals: readonly Span[] }, ctx: EventContext): Entries {
    if (this.#status !== 'pending') return refuse(this.#status, 'answered with other dates');
    if (args.proposals.length < 1 || args.proposals.length > 3) {
      return err(failure('PROPOSALS', 'Suggest between one and three sets of dates', ['proposals']));
    }
    if (args.proposals.some((p) => p.to < p.from)) {
      return err(failure('INVALID_PERIOD', 'Leave cannot end before it starts', ['proposals']));
    }
    this.#status = 'counter_proposed';
    this.#proposals = args.proposals;
    this.#raise(ctx, LeaveCounterProposed, args.proposals[0]?.from ?? this.#span.from, {
      requestId: this.id,
      personId: this.#personId,
      proposedBy: args.by,
      proposals: args.proposals.map((p) => ({ ...p })),
    });
    return ok([]);
  }

  /** One tap, and approved the moment it is (§9.5). */
  acceptCounter(args: { index: number; approvedBy: string; jurisdiction: string }, ctx: EventContext): Entries {
    if (this.#status !== 'counter_proposed') return refuse(this.#status, 'accepted');
    const chosen = this.#proposals[args.index];
    if (chosen === undefined) return err(failure('UNKNOWN_PROPOSAL', 'That suggestion was not made', ['index']));
    const entries = this.#move(chosen, ctx);
    this.#proposals = [];
    this.#approved(args.approvedBy, args.jurisdiction, ctx);
    return ok(entries);
  }

  /** The member keeps the dates they asked for; back to the approver. */
  keepOwnDates(_ctx: EventContext): Entries {
    if (this.#status !== 'counter_proposed') return refuse(this.#status, 'sent back');
    this.#status = 'pending';
    this.#proposals = [];
    return ok([]);
  }

  /** Move approved dates. The old ones stay booked until the new ones are approved (§8.4). */
  requestChange(args: { span: Span }, _ctx: EventContext): Entries {
    if (this.#status !== 'approved') return refuse(this.#status, 'changed');
    if (args.span.to < args.span.from) return err(failure('INVALID_PERIOD', 'Leave cannot end before it starts', ['to']));
    this.#status = 'change_pending';
    this.#pendingChange = args.span;
    return ok([]);
  }

  approveChange(ctx: EventContext): Entries {
    const change = this.#pendingChange;
    if (this.#status !== 'change_pending' || change === null) return refuse(this.#status, 'changed');
    const entries = this.#move(change, ctx);
    this.#status = 'approved';
    this.#pendingChange = null;
    return ok(entries);
  }

  /** The change is turned down and the approved dates stand. */
  declineChange(_ctx: EventContext): Entries {
    if (this.#status !== 'change_pending') return refuse(this.#status, 'kept as it was');
    this.#status = 'approved';
    this.#pendingChange = null;
    return ok([]);
  }

  /** Give the tail back. Approved automatically, because it only returns time (§8.4). */
  shorten(args: { to: CalendarDate; endsHalfDay: boolean; workingDays: DayAmount }, ctx: EventContext): Entries {
    if (this.#status !== 'approved') return refuse(this.#status, 'shortened');
    const released = days(this.#span.workingDays).minus(args.workingDays);
    if (args.to < this.#span.from || args.to > this.#span.to || released.lte(0)) {
      return err(failure('NOT_SHORTER', 'A shortened request ends earlier and costs less', ['to']));
    }
    const releasedFrom = args.endsHalfDay ? args.to : addDays(args.to, 1);
    if (releasedFrom < today(ctx)) {
      return err(failure('ALREADY_PASSED', 'Days already passed cannot be given back; HR can adjust them', ['to']));
    }
    const oldTo = this.#span.to;
    this.#span = { ...this.#span, to: args.to, endsHalfDay: args.endsHalfDay, workingDays: args.workingDays };
    this.#raise(ctx, LeaveCancelled, releasedFrom, {
      requestId: this.id,
      personId: this.#personId,
      from: releasedFrom,
      to: oldTo,
      releasedDays: amount(released),
      shortened: true,
    });
    return ok(this.#release(amount(released), ctx));
  }

  /** Approved automatically; the days return at once (§8.4). */
  cancel(ctx: EventContext): Entries {
    if (this.#status !== 'approved' && this.#status !== 'change_pending') return refuse(this.#status, 'cancelled');
    if (this.#span.from < today(ctx)) {
      return err(failure('ALREADY_PASSED', 'This leave has started; shorten it instead', ['from']));
    }
    this.#status = 'cancelled';
    this.#pendingChange = null;
    this.#raiseCancelled(this.#span.from, this.#span.workingDays, false, ctx);
    return ok(this.#release(this.#span.workingDays, ctx));
  }

  /**
   * The last day has passed: the booking settles. No event, because nothing
   * outside Time Off learns anything it was not told on approval.
   */
  markTaken(ctx: EventContext): Entries {
    if (this.#status !== 'approved') return refuse(this.#status, 'taken');
    if (this.#span.to >= today(ctx)) return err(failure('NOT_YET_TAKEN', 'The last day has not passed yet'));
    this.#status = 'taken';
    if (!this.#leaveType.tracked) return ok([]);
    const cost = this.#span.workingDays;
    return ok([
      this.#post(ctx, 'release', cost, this.#span.to),
      this.#post(ctx, 'taken', days(cost).neg(), this.#span.to),
    ]);
  }

  /* -------------------------------------------------------------- inner -- */

  #approved(by: string, jurisdiction: string, ctx: EventContext): void {
    this.#status = 'approved';
    this.#raise(ctx, LeaveApproved, this.#span.from, {
      requestId: this.id,
      personId: this.#personId,
      approvedBy: by,
      workingDays: days(this.#span.workingDays).toNumber(),
      payroll: {
        paid: this.#leaveType.paid !== 'unpaid',
        statutory: this.#leaveType.paid === 'statutory',
        jurisdiction,
      },
    });
  }

  /** New dates replace the current ones: a changed event, and the booking moved. */
  #move(to: Span, ctx: EventContext): LedgerEntry[] {
    const old = this.#span;
    this.#span = to;
    this.#datesEventId = this.#raise(ctx, LeaveChanged, to.from, {
      ...to,
      requestId: this.id,
      personId: this.#personId,
      supersedes: this.#datesEventId,
    });
    return [...this.#release(old.workingDays, ctx), ...this.#book(to, ctx)];
  }

  #raiseCancelled(from: CalendarDate, released: DayAmount, shortened: boolean, ctx: EventContext): void {
    this.#raise(ctx, LeaveCancelled, from, {
      requestId: this.id,
      personId: this.#personId,
      from,
      to: this.#span.to,
      releasedDays: released,
      shortened,
    });
  }

  #book(span: Span, ctx: EventContext): LedgerEntry[] {
    return this.#leaveType.tracked ? [this.#post(ctx, 'booking', days(span.workingDays).neg(), today(ctx))] : [];
  }

  #release(value: DayAmount, ctx: EventContext): LedgerEntry[] {
    return this.#leaveType.tracked ? [this.#post(ctx, 'release', value, today(ctx))] : [];
  }

  #post(ctx: EventContext, kind: LedgerEntry['kind'], value: Parameters<typeof amount>[0], effectiveOn: CalendarDate): LedgerEntry {
    return entry(
      {
        personId: this.#personId,
        leaveTypeKey: this.#leaveType.key,
        unit: this.#leaveType.unit,
        kind,
        amount: amount(value),
        effectiveOn,
        requestId: this.id,
      },
      ctx,
    );
  }

  /** Raise one event, its payload parsed by its contract, and return its id. */
  #raise(
    ctx: EventContext,
    event: { name: string; version: number; payload: z.ZodType },
    effectiveFrom: CalendarDate,
    payload: unknown,
  ): string {
    const pending = envelope(ctx, {
      tenantId: this.#tenantId,
      eventName: event.name,
      eventVersion: event.version,
      effectiveFrom,
      aggregate: { type: 'LeaveRequest', id: this.id, version: this.version + 1 },
      payload: event.payload.parse(payload),
    });
    this.raise(pending);
    return pending.eventId;
  }
}
