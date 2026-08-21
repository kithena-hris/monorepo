import * as z from 'zod';
import { AggregateRoot, ok, err, type Result, failure, type Clock } from '@kithena/domain-kit';
import {
  LeaveApproved,
  LeaveRequested,
  type AbsenceKind,
  type CalendarDate,
  type PersonId,
  type TenantId,
} from '@kithena/contracts';

/**
 * The aggregate's identity, derived from its schema the way every primitive in
 * `@kithena/contracts` is.
 *
 * Previously this was a hand-written `string & { __brand }`. Two problems with
 * that: it had no constructor, so every caller asserted its way in and the
 * brand asserted nothing about the value; and its brand shape did not match
 * Zod's, so an id from the contracts layer and an id from here were different
 * types that both claimed to be a `LeaveRequestId`.
 */
export const LeaveRequestId = z.uuid().brand<'LeaveRequestId'>();
export type LeaveRequestId = z.infer<typeof LeaveRequestId>;

/**
 * The only way to make one.
 *
 * Throws rather than returning a `Result`, because a malformed id is not a
 * domain failure a user can act on, it is a bug in whatever built the string.
 * Rules a user *can* violate return `Result`; see `request`.
 */
export function leaveRequestId(value: string): LeaveRequestId {
  return LeaveRequestId.parse(value);
}

interface LeaveRequestProps {
  readonly tenantId: TenantId;
  readonly personId: PersonId;
  readonly kind: AbsenceKind;
  /*
   * Calendar dates, not instants, and branded so they cannot be swapped for
   * one another. A leave request that starts on the 1st starts on the 1st
   * everywhere; giving it a timestamp would make it start on the 31st for
   * anyone west of the tenant.
   */
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

/**
 * Invariants live here, not in a Zod refine. Zod checked that `from` and `to`
 * are dates in the right shape at the boundary. Whether this request overlaps
 * an existing approved one is a domain question that needs the repository,
 * and it is also enforced at the database with a btree_gist exclusion
 * constraint, because application-level checks lose races.
 */
export class LeaveRequest extends AggregateRoot<LeaveRequestId> {
  private readonly props: LeaveRequestProps;

  private constructor(id: LeaveRequestId, props: LeaveRequestProps) {
    super(id);
    this.props = props;
  }

  static request(args: {
    id: LeaveRequestId;
    tenantId: TenantId;
    personId: PersonId;
    kind: AbsenceKind;
    from: CalendarDate;
    to: CalendarDate;
    balanceRemainingDays: number;
    workingDays: number;
    actorUserId: string;
    correlationId: string;
    clock: Clock;
  }): Result<LeaveRequest> {
    if (args.to < args.from) {
      return err(failure('INVALID_PERIOD', 'Leave cannot end before it starts', ['to']));
    }

    // Unpaid leave does not draw down a balance, so the check is conditional.
    if (args.kind === 'annual_leave' && args.workingDays > args.balanceRemainingDays) {
      return err(
        failure(
          'INSUFFICIENT_BALANCE',
          `Request is ${String(args.workingDays)} days against a balance of ${String(args.balanceRemainingDays)}`,
          ['from'],
        ),
      );
    }

    const aggregate = new LeaveRequest(args.id, {
      tenantId: args.tenantId,
      personId: args.personId,
      kind: args.kind,
      from: args.from,
      to: args.to,
      status: 'pending',
    });

    aggregate.raise({
      eventId: crypto.randomUUID(),
      eventName: LeaveRequested.name,
      eventVersion: LeaveRequested.version,
      tenantId: args.tenantId,
      occurredAt: args.clock.instant(),
      // The leave takes effect on its first day, not when it was entered.
      effectiveFrom: args.from,
      aggregate: { type: 'LeaveRequest', id: args.id, version: 1 },
      actor: { kind: 'user', userId: args.actorUserId },
      correlationId: args.correlationId,
      causationId: null,
      payload: {
        requestId: args.id,
        personId: args.personId,
        kind: args.kind,
        from: args.from,
        to: args.to,
        startsHalfDay: false,
        endsHalfDay: false,
        medicalNote: null,
      },
    });

    return ok(aggregate);
  }

  approve(args: {
    approverUserId: string;
    workingDays: number;
    jurisdiction: string;
    correlationId: string;
    clock: Clock;
  }): Result<void> {
    if (this.props.status !== 'pending') {
      return err(failure('ALREADY_DECIDED', `Request is already ${this.props.status}`));
    }
    this.props.status = 'approved';

    this.raise({
      eventId: crypto.randomUUID(),
      eventName: LeaveApproved.name,
      eventVersion: LeaveApproved.version,
      tenantId: this.props.tenantId,
      occurredAt: args.clock.instant(),
      effectiveFrom: this.props.from,
      aggregate: { type: 'LeaveRequest', id: this.id, version: this.version + 1 },
      actor: { kind: 'user', userId: args.approverUserId },
      correlationId: args.correlationId,
      causationId: null,
      payload: {
        requestId: this.id,
        personId: this.props.personId,
        approvedBy: args.approverUserId,
        workingDays: args.workingDays,
        payroll: {
          paid: this.props.kind !== 'unpaid_leave',
          statutory: this.props.kind === 'parental_leave' || this.props.kind === 'sick_leave',
          jurisdiction: args.jurisdiction,
        },
      },
    });

    return ok(undefined);
  }
}
