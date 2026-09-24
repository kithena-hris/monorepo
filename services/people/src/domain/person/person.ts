import {
  AggregateRoot,
  err,
  failure,
  localDate,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { TenantId, type Actor, type ChangedAttribute } from '@kithena/contracts';

import { dayEnd } from '../org/calendar.js';
import { record, type HistoryEntry } from './history.js';

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
  /**
   * When access ended with this employment (PEO-109): the instant
   * `access_ended` said. Null while it has not; absent reads as null.
   */
  readonly accessEndedAt?: string | null;
  /**
   * The current employment period's own facts (PEO-110); its dates are
   * `hireDate` and `lastWorkingDay`. Absent reads as period 1 for a hired
   * record, none for one never hired — a record from before periods existed.
   */
  readonly employment?: CurrentEmployment | null;
}

/**
 * One employment period, as far as the state machine needs it: one person,
 * many employments, each a period on the same record (PEO-110).
 */
export interface CurrentEmployment {
  /** 1 for the first employment, 2 for the first rehire, and so on. */
  readonly period: number;
  readonly legalEntityId: string | null;
  readonly leavingReason: LeavingReason | null;
  /** HR's judgement at termination; null is "not said", which a rehire reads as not refused. */
  readonly eligibleForRehire: boolean | null;
  /** The status notice was given from, so withdrawing it returns there. */
  readonly noticeFrom: 'active' | 'on_leave' | null;
  /** Why HR rehired somebody marked not eligible, when it did. */
  readonly rehireOverrideReason: string | null;
  /**
   * The period's first day (PEO-123): the hire or rehire date, or the day a
   * transfer opened it. Absent reads as the record's hire date.
   */
  readonly startedOn?: string | null;
}

/** A period as the repository writes it: the facts, and the dates from the record. */
export interface EmploymentPeriodRow extends CurrentEmployment {
  readonly startedOn: string;
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
  | 'corrected'
  | 'rehired'
  | 'notice_withdrawn';

/** Why employment is ending: the `status_changed` reasons notice and termination may carry. */
export type LeavingReason = Extract<StatusReason, 'resigned' | 'dismissed' | 'end_of_contract'>;
export const LEAVING_REASONS = [
  'resigned',
  'dismissed',
  'end_of_contract',
] as const satisfies readonly LeavingReason[];

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

/** The calendar day before a calendar date. Arithmetic on the date, never on a clock. */
function dayBefore(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const InvalidTransition = (from: PersonState, action: string) =>
  failure('INVALID_TRANSITION', `A record that is ${from} cannot be ${action}`);

export class Person extends AggregateRoot<string> {
  #status: PersonState;
  #hireDate: string | null;
  #lastWorkingDay: string | null;
  #accessEndedAt: string | null;
  #employment: CurrentEmployment | null;
  /** Whether the current period's row needs writing: drained by the repository. */
  #periodChanged = false;
  /** The period a transfer closed (PEO-123), until the repository writes it. */
  #closedPeriod: EmploymentPeriodRow | null = null;
  readonly #tenantId: TenantId;
  readonly #identityAccountId: string | null;
  /** Lifecycle dates as history rows, drained by the repository with the events. */
  #history: readonly HistoryEntry[] = [];
  #lastEventId: string | null = null;

  private constructor(snapshot: PersonSnapshot) {
    super(snapshot.id);
    this.#status = snapshot.status;
    this.#hireDate = snapshot.hireDate;
    this.#lastWorkingDay = snapshot.lastWorkingDay;
    this.#accessEndedAt = snapshot.accessEndedAt ?? null;
    this.#employment =
      snapshot.employment ??
      (snapshot.hireDate === null
        ? null
        : {
            period: 1,
            legalEntityId: null,
            leavingReason: null,
            eligibleForRehire: null,
            noticeFrom: null,
            rehireOverrideReason: null,
          });
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
      accessEndedAt: this.#accessEndedAt,
      employment: this.#employment,
    };
  }

  /**
   * The current period's row, when a move changed it since the last drain
   * (PEO-110); null otherwise. The repository writes it with the record.
   */
  drainPeriod(): EmploymentPeriodRow | null {
    const employment = this.#employment;
    if (!this.#periodChanged || employment === null || this.#hireDate === null) return null;
    this.#periodChanged = false;
    return {
      ...employment,
      startedOn: employment.startedOn ?? this.#hireDate,
      lastWorkingDay: this.#lastWorkingDay,
    };
  }

  /** The period a transfer closed since the last drain (PEO-123); written before the current one. */
  drainClosedPeriod(): EmploymentPeriodRow | null {
    const closed = this.#closedPeriod;
    this.#closedPeriod = null;
    return closed;
  }

  #period(change: Partial<CurrentEmployment>): void {
    if (this.#employment === null) return;
    this.#employment = { ...this.#employment, ...change };
    this.#periodChanged = true;
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

  get accessEndedAt(): string | null {
    return this.#accessEndedAt;
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
  hire(hireDate: string, facts: HireFacts, ctx: EventContext, timeZone: string): Result<void> {
    if (this.#status !== 'provisional') return err(InvalidTransition(this.#status, 'hired'));

    this.#openPeriod(hireDate, facts, null);
    const started = hireDate <= ctx.clock.date(timeZone);
    const moved = this.#moveTo(started ? 'active' : 'pre_hire', 'hired', ctx);
    if (!moved.ok) return moved;

    this.#raiseHired(hireDate, facts, started, ctx);
    this.#recordDate('hire_date', hireDate, ctx);
    return ok(undefined);
  }

  /**
   * A leaver hired again (PEO-110): a new employment period on the same
   * record — one person, many employments — rather than a second person.
   *
   * From `terminated` only, starting after the last working day. Somebody HR
   * marked not eligible for rehire is refused unless HR gives a reason, which
   * the new period keeps. Pre-hire until the start date has begun on their
   * calendar, active from it; the new period's history is a `hire_date` row
   * and a null `last_working_day` row from the start, so an "as of" read in
   * it has no end date and one in the old period still has the old one.
   *
   * Raises `status_changed` (reason `rehired`) and `hired` for the new period,
   * both effective from the start. Access ended with the old employment comes
   * back when the new one starts: here if it already has, else `start`.
   */
  rehire(
    startDate: string,
    facts: HireFacts,
    ctx: EventContext,
    timeZone: string,
    overrideReason: string | null = null,
  ): Result<void> {
    if (this.#status !== 'terminated') return err(InvalidTransition(this.#status, 'rehired'));
    const barred = this.#employment?.eligibleForRehire === false;
    const override = overrideReason?.trim() ?? '';
    if (barred && override === '') {
      return err(
        failure(
          'NOT_ELIGIBLE_FOR_REHIRE',
          'This person was marked not eligible for rehire; HR may override it with a reason',
          ['overrideReason'],
        ),
      );
    }
    if (this.#lastWorkingDay !== null && startDate <= this.#lastWorkingDay) {
      return err(
        failure(
          'REHIRE_BEFORE_LAST_DAY',
          `A rehire starts after the last working day of ${this.#lastWorkingDay}`,
          ['startDate'],
        ),
      );
    }

    this.#openPeriod(startDate, facts, barred ? override : null);
    this.#lastWorkingDay = null;
    const started = startDate <= ctx.clock.date(timeZone);
    this.#moveTo(started ? 'active' : 'pre_hire', 'rehired', ctx, startDate);
    this.#raiseHired(startDate, facts, started, ctx);
    this.#recordDate('hire_date', startDate, ctx);
    this.#recordRow('last_working_day', null, startDate, ctx);
    if (barred) {
      // HR overrode a "not eligible" judgement: its own audit event, beside
      // the reason kept on the period. Who is the envelope's actor.
      this.#raise(
        'people.person.rehire_override',
        { personId: this.id, period: this.#employment?.period ?? 1, reason: override },
        ctx,
        startDate,
      );
    }
    if (started) this.#restoreAccess(ctx, startDate);
    return ok(undefined);
  }

  #openPeriod(hireDate: string, facts: HireFacts, overrideReason: string | null): void {
    this.#hireDate = hireDate;
    this.#employment = {
      period: (this.#employment?.period ?? 0) + 1,
      legalEntityId: facts.legalEntityId,
      leavingReason: null,
      eligibleForRehire: null,
      noticeFrom: null,
      rehireOverrideReason: overrideReason,
      startedOn: hireDate,
    };
    this.#periodChanged = true;
  }

  #raiseHired(hireDate: string, facts: HireFacts, started: boolean, ctx: EventContext): void {
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
  }

  /** Access ended with an earlier employment comes back with this one (PEO-110). */
  #restoreAccess(
    ctx: EventContext,
    effectiveFrom: string,
    reason: 'rehired' | 'last_working_day_corrected' = 'rehired',
  ): void {
    if (this.#accessEndedAt === null) return;
    this.#accessEndedAt = null;
    this.#raise(
      'people.person.access_restored',
      {
        personId: this.id,
        identityAccountId: this.#identityAccountId,
        restoredAt: ctx.clock.instant(),
        reason,
      },
      ctx,
      effectiveFrom,
    );
  }

  /**
   * Their first day arrived — on their own calendar (§6.8), which is why the
   * zone is asked for: at noon UTC on the 30th the 1st has begun in Auckland
   * and not in Los Angeles. Effective from the start date, not from whenever
   * the scheduler got round to it.
   */
  start(ctx: EventContext, timeZone: string): Result<void> {
    if (this.#status !== 'pre_hire') return err(InvalidTransition(this.#status, 'started'));
    const hireDate = this.#hireDate;
    if (hireDate === null || hireDate > ctx.clock.date(timeZone)) {
      return err(
        failure('NOT_STARTED_YET', `The start date ${String(hireDate)} has not arrived`, [
          'hireDate',
        ]),
      );
    }
    const moved = this.#moveTo('active', 'started', ctx, hireDate);
    // A rehire that had not started yet gets its access back today (PEO-110).
    this.#restoreAccess(ctx, hireDate);
    return moved;
  }

  /** Leave began today on the person's own calendar (§8.5), which is what it is effective from. */
  startLeave(ctx: EventContext, timeZone: string): Result<void> {
    if (this.#status !== 'active') return err(InvalidTransition(this.#status, 'put on leave'));
    return this.#moveTo('on_leave', 'leave_started', ctx, ctx.clock.date(timeZone));
  }

  endLeave(ctx: EventContext, timeZone: string): Result<void> {
    if (this.#status !== 'on_leave') return err(InvalidTransition(this.#status, 'brought back'));
    return this.#moveTo('active', 'leave_ended', ctx, ctx.clock.date(timeZone));
  }

  /**
   * Notice was given, from either side: `resigned` by the person, `dismissed`
   * or `end_of_contract` by the employer. Effective from the day it was given,
   * on the person's calendar.
   *
   * Reachable from `on_leave` as well as `active`: somebody resigns while on
   * parental leave, and requiring them to come back first would be a fiction
   * the record has to carry afterwards.
   */
  giveNotice(
    lastWorkingDay: string,
    ctx: EventContext,
    timeZone: string,
    reason: LeavingReason = 'resigned',
  ): Result<void> {
    if (this.#status !== 'active' && this.#status !== 'on_leave') {
      return err(InvalidTransition(this.#status, 'put on notice'));
    }

    const ordered = this.#checkLastDay(lastWorkingDay);
    if (!ordered.ok) return ordered;

    this.#lastWorkingDay = lastWorkingDay;
    this.#period({ noticeFrom: this.#status });
    const moved = this.#moveTo('notice', reason, ctx, ctx.clock.date(timeZone));
    this.#recordDate('last_working_day', lastWorkingDay, ctx);
    return moved;
  }

  /**
   * Notice withdrawn (PEO-111): the person stays. Back to the status they
   * gave notice from — active, or on leave — dated today on their calendar,
   * with `status_changed` for reason `notice_withdrawn`.
   *
   * Only until the last working day has ended on their calendar; after that
   * the employment has run its course and the answer is termination or a
   * rehire. The notice's `last_working_day` row is superseded by a null one
   * from the date it was effective (§8.5), so an "as of" read after it no
   * longer shows an end, and with no last working day nothing is left for
   * access to end on.
   */
  withdrawNotice(
    ctx: EventContext,
    timeZone: string,
    /** The standing `last_working_day` history row, when there is one to supersede. */
    lastDayRow: { readonly id: string; readonly effectiveFrom: string } | null,
  ): Result<void> {
    if (this.#status !== 'notice') {
      return err(InvalidTransition(this.#status, 'have notice withdrawn'));
    }
    const today = ctx.clock.date(timeZone);
    const lastDay = this.#lastWorkingDay;
    if (lastDay !== null && today > lastDay) {
      return err(
        failure(
          'LAST_DAY_ENDED',
          `The last working day ${lastDay} has ended; terminate, or rehire later`,
          ['lastWorkingDay'],
        ),
      );
    }

    const back = this.#employment?.noticeFrom ?? 'active';
    this.#lastWorkingDay = null;
    this.#period({ noticeFrom: null, leavingReason: null });
    const moved = this.#moveTo(back, 'notice_withdrawn', ctx, today);
    if (lastDayRow !== null) {
      this.#history = [
        ...this.#history,
        {
          id: ctx.newEventId(),
          attributeKey: 'last_working_day',
          value: null,
          effectiveFrom: lastDayRow.effectiveFrom,
          recordedAt: ctx.clock.instant(),
          actor: ctx.actor,
          supersedes: lastDayRow.id,
          eventId: this.#lastEventId,
        },
      ];
    }
    return moved;
  }

  /**
   * Employment ended. Terminal, and reachable from every live state.
   *
   * Somebody hired who never started still has a record and it still has to be
   * closed; requiring `active` first would leave those open forever.
   *
   * **Only once the last working day has come**, on the person's own calendar:
   * a termination is HR confirming an end (§8.1), and somebody whose last day
   * is still ahead is on notice, still working and still on the headcount. A
   * pre-hire is the exception — they never started, so there is no working day
   * behind them to name, and their record closes on the start date that never
   * came.
   *
   * Raises `status_changed` with the typed reason a report counts, then
   * `terminated` with HR's free-text note, both effective from the last day.
   */
  terminate(
    lastWorkingDay: string,
    ctx: EventContext,
    timeZone: string,
    detail: {
      readonly reason: LeavingReason;
      readonly note?: string | null;
      readonly eligibleForRehire?: boolean | null;
    },
  ): Result<void> {
    if (this.#status === 'terminated' || this.#status === 'discarded' || this.#status === 'provisional') {
      return err(InvalidTransition(this.#status, 'terminated'));
    }

    const ordered = this.#checkLastDay(lastWorkingDay);
    if (!ordered.ok) return ordered;

    if (this.#status !== 'pre_hire' && lastWorkingDay > ctx.clock.date(timeZone)) {
      return err(
        failure(
          'LAST_DAY_NOT_REACHED',
          `The last working day ${lastWorkingDay} has not come yet; give notice until then`,
          ['lastWorkingDay'],
        ),
      );
    }

    const moves = this.#lastWorkingDay !== lastWorkingDay;
    this.#lastWorkingDay = lastWorkingDay;
    this.#period({
      leavingReason: detail.reason,
      eligibleForRehire: detail.eligibleForRehire ?? null,
    });
    this.#moveTo('terminated', detail.reason, ctx, lastWorkingDay);
    this.#raise(
      'people.person.terminated',
      {
        personId: this.id,
        lastWorkingDay,
        reason: detail.note ?? null,
        eligibleForRehire: detail.eligibleForRehire ?? null,
      },
      ctx,
      lastWorkingDay,
    );
    // Notice already recorded this date; a termination that moves it records the new one.
    if (moves) this.#recordDate('last_working_day', lastWorkingDay, ctx);
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
   * Access ends with employment (PEO-109): raise `access_ended`, once per
   * leaving, for identity to suspend the account on.
   *
   * - `day_ended` — the hourly job, once the last working day has ended on
   *   the person's own calendar: Auckland's 30th at 11:00 UTC on the 30th,
   *   Los Angeles's at 07:00 UTC on the 1st. `endedAt` is that midnight, not
   *   whenever the job ran, and the envelope is effective from the first day
   *   without access.
   * - `now` — HR ending it at once, for a dismissal for cause. Effective
   *   today, from this instant.
   *
   * `day_ended` applies on notice as well as terminated: confirming the
   * termination is HR's paperwork, ending access is security, and a last
   * working day that has ended is the end of access whether or not HR has
   * got round to the termination (the `confirm_termination` row still asks
   * them to). `now` is for a terminated record only: before the last day
   * ends, somebody on notice is still working. Raised for somebody with no
   * account too — "access ended" is a fact about the employment, and a
   * consumer other than identity may act on it — with a null account for
   * identity to ignore.
   */
  endAccess(ctx: EventContext, timeZone: string, when: 'day_ended' | 'now'): Result<void> {
    const leaving =
      this.#status === 'terminated' || (when === 'day_ended' && this.#status === 'notice');
    if (!leaving) {
      return err(InvalidTransition(this.#status, 'have access ended'));
    }
    if (this.#accessEndedAt !== null) {
      return err(failure('ACCESS_ALREADY_ENDED', `Access already ended at ${this.#accessEndedAt}`));
    }

    let endedAt: string;
    if (when === 'now') {
      endedAt = ctx.clock.instant();
    } else {
      const lastDay = this.#lastWorkingDay;
      if (lastDay === null || ctx.clock.date(timeZone) <= lastDay) {
        return err(
          failure('LAST_DAY_NOT_ENDED', `The last working day ${String(lastDay)} has not ended`, [
            'lastWorkingDay',
          ]),
        );
      }
      endedAt = dayEnd(lastDay, timeZone);
    }

    this.#accessEndedAt = endedAt;
    this.#raise(
      'people.person.access_ended',
      {
        personId: this.id,
        identityAccountId: this.#identityAccountId,
        lastWorkingDay: this.#lastWorkingDay,
        endedAt,
        trigger: when === 'now' ? 'ended_by_hr' : 'last_working_day_ended',
      },
      ctx,
      localDate(endedAt, timeZone),
    );
    return ok(undefined);
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
   * Values recorded earlier with a future `effectiveFrom` came into force
   * today, on the person's own calendar (PEO-124, §8.5).
   *
   * The write that recorded them raised `profile_updated` then, dated ahead,
   * so a consumer could see the change was scheduled; this is the day it
   * holds, and the projection has just moved to it. Same payload rules as
   * `profile_updated` (§10.3). Refused on a tombstone, like an edit.
   */
  attributesInForce(
    changed: readonly ChangedAttribute[],
    schemaVersion: number,
    ctx: EventContext,
    effectiveFrom: string,
  ): Result<void> {
    if (this.#status === 'terminated' || this.#status === 'discarded') {
      return err(InvalidTransition(this.#status, 'changed'));
    }
    if (changed.length === 0) {
      return err(failure('NOTHING_CHANGED', 'Nothing came into force'));
    }
    this.#raise(
      'people.person.attribute_effective',
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
   * started, so the correction re-reads which one the record is, both ways,
   * with `status_changed` for reason `corrected`:
   *
   * - a pre-hire whose corrected start has arrived is started, from that date;
   * - an active record whose corrected start is still to come never started,
   *   and returns to `pre_hire` from the start date the correction supersedes —
   *   the day it wrongly became active (§8.5).
   *
   * `ctx.causationId` should be the `attribute_corrected` event, which carries
   * `supersedes`; `status_changed` has no field of its own for it. Nothing
   * else moves: on leave or on notice stays put, and a correction does not
   * re-run the hire.
   */
  correctHireDate(hireDate: string, ctx: EventContext, timeZone: string): Result<void> {
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
    const superseded = this.#hireDate;
    this.#hireDate = hireDate;
    // The period that began on the corrected date moves with it; one a
    // transfer opened keeps its own start (PEO-123).
    const began = this.#employment?.startedOn ?? superseded;
    this.#period(began === superseded ? { startedOn: hireDate } : {});
    const today = ctx.clock.date(timeZone);
    if (this.#status === 'pre_hire' && hireDate <= today) {
      return this.#moveTo('active', 'corrected', ctx, hireDate);
    }
    if (this.#status === 'active' && hireDate > today) {
      return this.#moveTo('pre_hire', 'corrected', ctx, superseded ?? hireDate);
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
   * that has ended terminates nobody. The record stays on notice and HR is
   * asked to confirm the termination — a row in HR's grid, read off the
   * status and this date, so it clears itself when HR terminates or corrects
   * the date forward. A record with no last working day has none to correct;
   * giving one is `giveNotice`.
   *
   * **Access follows the corrected date (PEO-111).** Somebody on notice whose
   * access the job ended at the end of the old last day, corrected to a day
   * that has not ended on their calendar, is still working: `access_restored`
   * (reason `last_working_day_corrected`), in the correction's transaction,
   * and the job ends it again when the new day ends. A corrected day that has
   * already ended leaves it ended; a terminated record keeps it ended.
   */
  correctLastWorkingDay(
    lastWorkingDay: string,
    ctx?: EventContext,
    timeZone?: string,
  ): Result<void> {
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
    this.#period({});
    if (
      ctx !== undefined &&
      timeZone !== undefined &&
      this.#status === 'notice' &&
      ctx.clock.date(timeZone) <= lastWorkingDay
    ) {
      this.#restoreAccess(ctx, ctx.clock.date(timeZone), 'last_working_day_corrected');
    }
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

  /**
   * The reporting line moved. Returns whether it raised.
   *
   * Its own event because `profile_updated` names keys and never values, and
   * OpenFGA's reporting-line tuple is rewritten from this one (PEO-092): the
   * old chain loses the person the moment the new one gains them.
   */
  moveManager(
    previous: string | null,
    next: string | null,
    ctx: EventContext,
    effectiveFrom: string | null,
  ): boolean {
    if (previous === next) return false;
    this.#raise(
      'people.person.manager_changed',
      { personId: this.id, previousManagerId: previous, managerId: next },
      ctx,
      effectiveFrom,
    );
    return true;
  }

  /**
   * The person's legal entity changed, effective on a date (PEO-123, §8.5).
   *
   * **A move between legal entities is a transfer**: the employer of record
   * changed, so the current employment period ends the day before and a new
   * one opens on the date, in the new entity, with continuous service — the
   * hire date, the status and access are the employment's and stay as they
   * are, and no leaving reason is written on the period that closed. A
   * location or org change inside the entity is not a period change at all.
   *
   * Nothing to leave, and the period itself moves instead: a pre-hire who has
   * not started, somebody with no entity yet, or a date on or before the
   * current period's first day (a correction of where it began). Refused on
   * notice, where the employment is ending rather than moving, and for a
   * leaver, whose next employment is a rehire. Raises nothing itself: the
   * caller raises `org_changed`, which names the new entity.
   *
   * `previous` is the entity the record held before this write: a period
   * from before periods existed has none of its own and is read as that one.
   */
  place(
    legalEntityId: string | null,
    effectiveFrom: string,
    previous: string | null = null,
  ): Result<'transferred' | 'placed' | 'unchanged'> {
    if (this.#status === 'terminated' || this.#status === 'discarded') {
      return err(InvalidTransition(this.#status, 'placed'));
    }
    const period = this.#employment;
    if (period === null) return ok('unchanged');
    const current = { ...period, legalEntityId: period.legalEntityId ?? previous };
    if (current.legalEntityId === legalEntityId) return ok('unchanged');
    const began = current.startedOn ?? this.#hireDate;
    if (
      current.legalEntityId === null ||
      legalEntityId === null ||
      this.#status === 'pre_hire' ||
      began === null ||
      effectiveFrom <= began
    ) {
      this.#period({ legalEntityId });
      return ok('placed');
    }
    if (this.#status === 'notice') {
      return err(
        failure(
          'TRANSFER_ON_NOTICE',
          'Somebody on notice is leaving, not moving; withdraw the notice to transfer them',
          ['legalEntityId'],
        ),
      );
    }
    this.#closedPeriod = { ...current, startedOn: began, lastWorkingDay: dayBefore(effectiveFrom) };
    this.#employment = {
      period: current.period + 1,
      legalEntityId,
      leavingReason: null,
      eligibleForRehire: null,
      noticeFrom: null,
      rehireOverrideReason: null,
      startedOn: effectiveFrom,
    };
    this.#periodChanged = true;
    return ok('transferred');
  }

  /** Where the person sits moved: org unit, cost centre, legal entity or location. */
  moveOrg(
    org: {
      readonly orgUnitId: string | null;
      readonly costCentre: string | null;
      readonly legalEntityId: string | null;
      readonly locationId: string | null;
    },
    ctx: EventContext,
    effectiveFrom: string | null,
  ): void {
    this.#raise('people.person.org_changed', { personId: this.id, ...org }, ctx, effectiveFrom);
  }

  /**
   * The lifecycle dates written since the last drain, as history rows.
   *
   * A correction supersedes a history row, so a hire date or a last working
   * day with no row could never be corrected. The repository writes these in
   * the same transaction as the row and its events, like `drainEvents`.
   */
  drainHistory(): readonly HistoryEntry[] {
    const drained = this.#history;
    this.#history = [];
    return drained;
  }

  /** A dated row for a lifecycle date, effective on the date itself, tied to the event just raised. */
  #recordDate(attributeKey: string, value: string, ctx: EventContext): void {
    this.#recordRow(attributeKey, value, value, ctx);
  }

  #recordRow(
    attributeKey: string,
    value: string | null,
    effectiveFrom: string,
    ctx: EventContext,
  ): void {
    this.#history = record(this.#history, {
      id: ctx.newEventId(),
      attributeKey,
      value,
      effectiveFrom,
      recordedAt: ctx.clock.instant(),
      actor: ctx.actor,
      eventId: this.#lastEventId,
    });
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

  #moveTo(
    next: PersonState,
    reason: StatusReason,
    ctx: EventContext,
    // A status change takes effect on the date the employment says, not on
    // the day somebody typed it. `hireDate` is the one that matters for a
    // hire, a correction passes its own, and everything else takes effect
    // when recorded.
    effectiveFrom: string | null = reason === 'hired' ? this.#hireDate : null,
  ): Result<void> {
    const previous = this.#status;
    this.#status = next;
    this.#raise(
      'people.person.status_changed',
      { personId: this.id, previous, next, reason },
      ctx,
      effectiveFrom,
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
    this.#lastEventId = event.eventId;
  }
}
