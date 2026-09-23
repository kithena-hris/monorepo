import {
  AggregateRoot,
  err,
  failure,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { TenantId, type Actor, type ChangedAttribute } from '@kithena/contracts';

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

/** What identity caches about a person, as `identity_facts_changed` carries it. */
export interface IdentityFacts {
  readonly name: { readonly given: string; readonly family: string; readonly preferred: string | null } | null;
  readonly employmentStart: string | null;
}

/** The attribute keys whose change identity has to hear about. */
export const IDENTITY_FACT_KEYS: ReadonlySet<string> = new Set([
  'given_name',
  'family_name',
  'preferred_name',
  'hire_date',
]);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * The facts, read off a record's values.
 *
 * A name is both halves or none: identity's row refuses one without the other,
 * and a consumer stuck on a check constraint stalls every event behind it.
 */
export function identityFactsOf(values: Readonly<Record<string, unknown>>): IdentityFacts {
  const given = text(values['given_name']);
  const family = text(values['family_name']);
  return {
    name:
      given !== null && family !== null
        ? { given, family, preferred: text(values['preferred_name']) }
        : null,
    employmentStart: text(values['hire_date']),
  };
}

/**
 * What `people.person.hired` carries beyond the aggregate's own columns.
 *
 * `legalEntityId` may be null: a tenant whose published schema has no legal
 * entity attribute has nothing to put there, and the import does not demand
 * one it does not define.
 */
export interface HireFacts {
  readonly legalEntityId: string | null;
  readonly name: { readonly given: string; readonly family: string; readonly preferred: string | null };
  readonly workEmail: string;
  readonly managerId: string | null;
  readonly orgUnitId: string | null;
  readonly schemaVersion: number;
  readonly sourceOfRecord: 'own' | 'external';
}

/**
 * The hire's facts, read off a record's values, or which ones are missing.
 *
 * §14.4: a person with no legal name or work email is a record nobody can
 * find, match or invite, so a hire without them is refused rather than
 * published half-empty. `sourceOfRecord` is `own` because a hire through
 * People is People's own record; a mirrored one arrives as
 * `synced_from_external` instead.
 */
export function hireFactsOf(
  values: Readonly<Record<string, unknown>>,
  legalEntityId: string | null,
  schemaVersion: number,
): Result<HireFacts> {
  const given = text(values['given_name']);
  const family = text(values['family_name']);
  const workEmail = text(values['work_email']);
  if (given === null || family === null || workEmail === null) {
    const missing = [
      ...(given === null ? ['given_name'] : []),
      ...(family === null ? ['family_name'] : []),
      ...(workEmail === null ? ['work_email'] : []),
    ];
    return err(failure('HIRE_INCOMPLETE', `A hire needs ${missing.join(', ')}`, missing));
  }
  return ok({
    legalEntityId,
    name: { given, family, preferred: text(values['preferred_name']) },
    workEmail,
    managerId: text(values['manager_id']),
    orgUnitId: text(values['org_unit_id']),
    schemaVersion,
    sourceOfRecord: 'own',
  });
}

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

  /**
   * The row this aggregate describes, for a repository writing it.
   *
   * Only the columns the state machine owns. Everything else a write may set
   * arrives as `PersonFields` from the application layer, which is what stops
   * a caller putting a record into a state no transition allows.
   */
  get snapshot(): PersonSnapshot {
    return {
      id: this.id,
      tenantId: this.#tenantId,
      status: this.#status,
      identityAccountId: this.#identityAccountId,
      hireDate: this.#hireDate,
      lastWorkingDay: this.#lastWorkingDay,
    };
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
  hire(hireDate: string, facts: HireFacts, ctx: EventContext, timeZone = 'Etc/UTC'): Result<void> {
    if (this.#status !== 'provisional') return err(InvalidTransition(this.#status, 'hired'));

    this.#hireDate = hireDate;
    const started = hireDate <= ctx.clock.date(timeZone);
    const moved = this.#moveTo(started ? 'active' : 'pre_hire', 'hired', ctx);
    if (!moved.ok) return moved;

    this.#raise(
      'people.person.hired',
      {
        personId: this.id,
        identityAccountId: this.#identityAccountId,
        legalEntityId: facts.legalEntityId,
        name: facts.name,
        workEmail: facts.workEmail,
        employment: { from: hireDate, to: null },
        status: started ? 'active' : 'pending',
        managerId: facts.managerId,
        orgUnitId: facts.orgUnitId,
        schemaVersion: facts.schemaVersion,
        sourceOfRecord: facts.sourceOfRecord,
      },
      ctx,
      hireDate,
    );
    return ok(undefined);
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

  /**
   * One or more attributes changed.
   *
   * A terminated record is a tombstone and a discarded one is withdrawn;
   * neither is edited back into life. Corrections are the path for fixing a
   * tombstone, and they are a different method.
   */
  updateProfile(
    changed: readonly ChangedAttribute[],
    schemaVersion: number,
    ctx: EventContext,
    effectiveFrom: string | null,
  ): Result<void> {
    if (this.#status === 'terminated' || this.#status === 'discarded') {
      return err(InvalidTransition(this.#status, 'edited'));
    }
    if (changed.length === 0) {
      return err(failure('NOTHING_CHANGED', 'An update has to change at least one attribute'));
    }

    this.#raise(
      'people.person.profile_updated',
      { personId: this.id, identityAccountId: this.#identityAccountId, changed, schemaVersion },
      ctx,
      effectiveFrom,
    );
    return ok(undefined);
  }

  /**
   * A fact recorded wrongly, corrected. Carries `supersedes`, never an update.
   *
   * Allowed on a terminated record, because a tombstone that is wrong is still
   * read by an auditor. Refused on a discarded one, which holds nothing.
   */
  correctAttribute(
    attribute: ChangedAttribute,
    supersedes: string,
    reason: string | null,
    ctx: EventContext,
    effectiveFrom: string,
  ): Result<void> {
    if (this.#status === 'discarded') return err(InvalidTransition(this.#status, 'corrected'));

    this.#raise(
      'people.person.attribute_corrected',
      { personId: this.id, attribute, supersedes, reason },
      ctx,
      effectiveFrom,
    );
    return ok(undefined);
  }

  /**
   * The hire date was recorded wrongly. The caller raises `attribute_corrected`.
   *
   * Here rather than projected like any attribute, because `hireDate` is the
   * aggregate's: a correction written into `custom` would leave the column —
   * and every reader of it — on the wrong date.
   *
   * §8.1 defines `pre_hire` as a start date in the future and `active` as
   * started, so a pre-hire whose corrected date has arrived is started, and
   * says so with `status_changed` for reason `corrected`. Nothing else moves:
   * §8.1 has no edge from `active` back to `pre_hire`, and a correction does
   * not re-run the hire.
   */
  correctHireDate(hireDate: string, ctx: EventContext, timeZone = 'Etc/UTC'): Result<void> {
    if (this.#status === 'discarded') return err(InvalidTransition(this.#status, 'corrected'));
    if (this.#lastWorkingDay !== null && this.#lastWorkingDay < hireDate) {
      return err(
        failure(
          'LAST_DAY_BEFORE_HIRE',
          `A hire date of ${hireDate} follows the last working day of ${this.#lastWorkingDay}`,
          ['hireDate'],
        ),
      );
    }
    this.#hireDate = hireDate;
    if (this.#status === 'pre_hire' && hireDate <= ctx.clock.date(timeZone)) {
      return this.#moveTo('active', 'corrected', ctx);
    }
    return ok(undefined);
  }

  /**
   * The last working day was recorded wrongly. The caller raises
   * `attribute_corrected`.
   *
   * The aggregate's column, for the same reason as `hireDate`. The status is
   * left alone: §8.1 ends employment by an explicit transition to
   * `terminated`, not by a date passing, so correcting a notice period to one
   * that has ended terminates nobody. A record with no last working day has
   * none to correct; giving one is `giveNotice`.
   */
  correctLastWorkingDay(lastWorkingDay: string): Result<void> {
    if (this.#status === 'discarded') return err(InvalidTransition(this.#status, 'corrected'));
    if (this.#lastWorkingDay === null) {
      return err(
        failure(
          'NO_LAST_WORKING_DAY',
          'This record has no last working day to correct; notice is given, not corrected',
          ['lastWorkingDay'],
        ),
      );
    }
    const ordered = this.#checkLastDay(lastWorkingDay);
    if (!ordered.ok) return ordered;
    this.#lastWorkingDay = lastWorkingDay;
    return ok(undefined);
  }

  /**
   * Tell identity the current name and start date, when it holds a copy.
   *
   * §5: People is the source of record for both once a person exists, and
   * identity caches them for the WebAuthn prompt and the enrolment gate. Only a
   * linked person has a copy to correct, so an unlinked one raises nothing —
   * and neither does a call with nothing to say. Returns whether it raised.
   */
  shareIdentityFacts(
    facts: IdentityFacts,
    ctx: EventContext,
    effectiveFrom: string | null,
  ): boolean {
    if (this.#identityAccountId === null) return false;
    if (facts.name === null && facts.employmentStart === null) return false;

    this.#raise(
      'people.person.identity_facts_changed',
      {
        personId: this.id,
        identityAccountId: this.#identityAccountId,
        name: facts.name,
        employmentStart: facts.employmentStart,
      },
      ctx,
      effectiveFrom,
    );
    return true;
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
      // the day somebody typed it. `hireDate` is the one that matters here —
      // for a hire, and for a correction that started somebody — and
      // everything else takes effect when recorded.
      reason === 'hired' || reason === 'corrected' ? this.#hireDate : null,
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
