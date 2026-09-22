import {
  AggregateRoot,
  err,
  failure,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { TenantId, type Actor } from '@kithena/contracts';

/**
 * One employment record, and the states it may be in.
 *
 * The lifecycle starts before employment does and outlives it. A
 * `provisional` record is an identity account with nobody's details attached
 * — created the moment HR provisions somebody, before anyone has typed a name
 * — and `terminated` is a tombstone that stays: employment records outlive
 * employment, and an aggregate headcount for 2019 must not change because
 * somebody left in 2026.
 *
 * `discarded` is the one state a hard delete may follow, and it is reachable
 * from `provisional` alone. That asymmetry is the whole rule: an account
 * provisioned by mistake on a Tuesday holds nobody's history, and every other
 * state does.
 */

export type PersonState =
  | 'provisional'
  | 'pre_hire'
  | 'active'
  | 'on_leave'
  | 'notice'
  | 'terminated'
  | 'discarded';

export interface PersonSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly status: PersonState;
  /** The identity account this record belongs to, when there is one. */
  readonly identityAccountId: string | null;
  readonly hireDate: string | null;
  readonly lastWorkingDay: string | null;
}

/**
 * What a transition needs from outside itself, passed in rather than reached
 * for.
 *
 * `CLAUDE.md` bans `new Date()` in domain code because effective-dated logic
 * is untestable otherwise, and event ids are the same problem wearing a
 * different hat: a domain that generates its own is a domain whose output
 * cannot be asserted on without stubbing a global.
 */
export interface EventContext {
  readonly clock: Clock;
  readonly newEventId: () => string;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
}

/** Why a record moved. A closed set, because a report counts these. */
type StatusReason =
  | 'hired'
  | 'started'
  | 'leave_started'
  | 'leave_ended'
  | 'resigned'
  | 'dismissed'
  | 'end_of_contract'
  | 'discarded'
  | 'corrected';

const InvalidTransition = (from: PersonState, action: string) =>
  failure('INVALID_TRANSITION', `A record that is ${from} cannot be ${action}`);

export class Person extends AggregateRoot<string> {
  #status: PersonState;
  #hireDate: string | null;
  #lastWorkingDay: string | null;
  readonly #tenantId: TenantId;
  readonly #identityAccountId: string | null;

  private constructor(snapshot: PersonSnapshot) {
    super(snapshot.id);
    this.#status = snapshot.status;
    this.#hireDate = snapshot.hireDate;
    this.#lastWorkingDay = snapshot.lastWorkingDay;
    // Parsed, not asserted: a brand should mean "this was checked" rather than
    // "somebody said so", and a malformed tenant id reaching the domain is a
    // bug — which is the one thing worth throwing for.
    this.#tenantId = TenantId.parse(snapshot.tenantId);
    this.#identityAccountId = snapshot.identityAccountId;
  }

  static rehydrate(snapshot: PersonSnapshot): Person {
    return new Person(snapshot);
  }

  get status(): PersonState {
    return this.#status;
  }

  get hireDate(): string | null {
    return this.#hireDate;
  }

  /**
   * The last working day, once notice has been given or employment has ended.
   *
   * Read by the repository writing the row and by the retention job, which
   * counts its schedule from here rather than from the day the record was
   * last touched — a leaver's file is kept for so many months after the
   * employment ended, not after somebody last opened it.
   */
  get lastWorkingDay(): string | null {
    return this.#lastWorkingDay;
  }

  get identityAccountId(): string | null {
    return this.#identityAccountId;
  }

  /**
   * Whether a hard delete is permitted.
   *
   * Only ever true for a discarded record, and `archived`/`terminated` are
   * deliberately not included: a retention job anonymises those on a schedule
   * per classification, which is a different operation with a different audit
   * trail.
   */
  get deletable(): boolean {
    return this.#status === 'discarded';
  }

  /**
   * Somebody was hired, effective on a date.
   *
   * A hire already in the past lands on `active` directly. Making an admin
   * perform two transitions to enter a person who started last month is a
   * data-entry ritual, and the intermediate state would be false the moment it
   * was written.
   */
  hire(hireDate: string, ctx: EventContext, timeZone = 'Etc/UTC'): Result<void> {
    if (this.#status !== 'provisional') return err(InvalidTransition(this.#status, 'hired'));

    this.#hireDate = hireDate;
    const started = hireDate <= ctx.clock.date(timeZone);
    return this.#moveTo(started ? 'active' : 'pre_hire', 'hired', ctx);
  }

  /** Their first day arrived. */
  start(ctx: EventContext): Result<void> {
    if (this.#status !== 'pre_hire') return err(InvalidTransition(this.#status, 'started'));
    return this.#moveTo('active', 'started', ctx);
  }

  startLeave(ctx: EventContext): Result<void> {
    if (this.#status !== 'active') return err(InvalidTransition(this.#status, 'put on leave'));
    return this.#moveTo('on_leave', 'leave_started', ctx);
  }

  endLeave(ctx: EventContext): Result<void> {
    if (this.#status !== 'on_leave') return err(InvalidTransition(this.#status, 'brought back'));
    return this.#moveTo('active', 'leave_ended', ctx);
  }

  /**
   * Notice was given, from either side.
   *
   * Reachable from `on_leave` as well as `active`: somebody resigns while on
   * parental leave, and requiring them to come back first would be a fiction
   * the record has to carry afterwards.
   */
  giveNotice(lastWorkingDay: string, ctx: EventContext): Result<void> {
    if (this.#status !== 'active' && this.#status !== 'on_leave') {
      return err(InvalidTransition(this.#status, 'put on notice'));
    }

    const ordered = this.#checkLastDay(lastWorkingDay);
    if (!ordered.ok) return ordered;

    this.#lastWorkingDay = lastWorkingDay;
    return this.#moveTo('notice', 'resigned', ctx);
  }

  /**
   * Employment ended. Terminal, and reachable from every live state.
   *
   * Somebody hired who never started still has a record and it still has to be
   * closed; requiring `active` first would leave those open forever.
   */
  terminate(
    lastWorkingDay: string,
    ctx: EventContext,
    detail: { reason?: string | null; eligibleForRehire?: boolean | null } = {},
  ): Result<void> {
    if (this.#status === 'terminated' || this.#status === 'discarded' || this.#status === 'provisional') {
      return err(InvalidTransition(this.#status, 'terminated'));
    }

    const ordered = this.#checkLastDay(lastWorkingDay);
    if (!ordered.ok) return ordered;

    this.#lastWorkingDay = lastWorkingDay;
    this.#status = 'terminated';
    this.#raise(
      'people.person.terminated',
      {
        personId: this.id,
        lastWorkingDay,
        reason: detail.reason ?? null,
        eligibleForRehire: detail.eligibleForRehire ?? null,
      },
      ctx,
      lastWorkingDay,
    );
    return ok(undefined);
  }

  /**
   * Withdraw a record nobody ever employed.
   *
   * From `provisional` only. An account created by mistake is a mistake worth
   * erasing; anything past that point is somebody's employment history, and
   * the operation for those is anonymisation on a retention schedule.
   */
  discard(ctx: EventContext): Result<void> {
    if (this.#status !== 'provisional') return err(InvalidTransition(this.#status, 'discarded'));
    return this.#moveTo('discarded', 'discarded', ctx);
  }

  /** A last working day before the hire date describes an employment nobody had. */
  #checkLastDay(lastWorkingDay: string): Result<void> {
    if (this.#hireDate !== null && lastWorkingDay < this.#hireDate) {
      return err(
        failure(
          'LAST_DAY_BEFORE_HIRE',
          `A last working day of ${lastWorkingDay} precedes the hire date of ${this.#hireDate}`,
          ['lastWorkingDay'],
        ),
      );
    }
    return ok(undefined);
  }

  #moveTo(next: PersonState, reason: StatusReason, ctx: EventContext): Result<void> {
    const previous = this.#status;
    this.#status = next;
    this.#raise(
      'people.person.status_changed',
      { personId: this.id, previous, next, reason },
      ctx,
      // A status change takes effect on the date the employment says, not on
      // the day somebody typed it. `hireDate` is the one that matters here;
      // everything else takes effect when recorded.
      reason === 'hired' ? this.#hireDate : null,
    );
    return ok(undefined);
  }

  #raise(
    eventName: string,
    payload: Record<string, unknown>,
    ctx: EventContext,
    effectiveFrom: string | null = null,
  ): void {
    const at = ctx.clock.instant();
    const event: PendingEvent = {
      eventId: ctx.newEventId(),
      eventName,
      eventVersion: 1,
      tenantId: this.#tenantId,
      occurredAt: at,
      effectiveFrom: effectiveFrom as PendingEvent['effectiveFrom'],
      aggregate: { type: 'Person', id: this.id, version: this.version + 1 },
      actor: ctx.actor,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      payload,
    };
    this.raise(event);
  }
}
