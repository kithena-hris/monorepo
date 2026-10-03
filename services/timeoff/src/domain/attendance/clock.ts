import {
  AggregateRoot,
  err,
  failure,
  localDate,
  ok,
  type Clock,
  type Result,
} from '@kithena/domain-kit';
import {
  AttendanceCorrected,
  AttendancePunched,
  type Actor,
  type AttendanceWorkModel,
  type CalendarDate,
  type ClockState,
  type Instant,
  type PersonId,
  type PunchInput,
  type PunchKind,
  type PunchSource,
  type TenantId,
} from '@kithena/contracts';

/**
 * One clock, whichever source punched it (PRD §11.1, §11.2).
 *
 * The clock is not stored: it is read from the punches. A badge at 08:52 and a
 * web clock-out at 17:30 are two rows in one list, so there is nothing for the
 * badge reader and the top bar to disagree about.
 *
 * **A correction is a new punch carrying `supersedes`, never an edit** (§11.4).
 * The superseded punch stays, because the Spanish record has to show what was
 * punched as well as what was agreed afterwards.
 */

export interface Punch {
  /**
   * A UUIDv7 minted by the application, and also the id of the event the
   * punch raises: one punch is one event, so a correction's `supersedes`
   * names both.
   */
  readonly id: string;
  /** When it happened. A kiosk replaying offline punches sets this itself. */
  readonly at: Instant;
  /** When we were told. */
  readonly recordedAt: Instant;
  readonly kind: PunchKind;
  readonly source: PunchSource;
  readonly workModel: AttendanceWorkModel;
  readonly deviceId: string | null;
  readonly insideOfficeArea: boolean | null;
  /** The punch this one replaces; `null` for a punch, or for one that was never made. */
  readonly supersedes: string | null;
  readonly reason: string | null;
}

/** From a clock-in to its clock-out. Belongs to the day it started. */
export interface Shift {
  readonly date: CalendarDate;
  readonly in: Punch;
  readonly breaks: readonly { readonly start: Punch; readonly end: Punch | null }[];
  /** `null` while running, or when nobody clocked out. */
  readonly out: Punch | null;
}

/** The punches that still stand, in the order they happened. */
export function standing(punches: readonly Punch[]): Punch[] {
  const superseded = new Set(punches.map((p) => p.supersedes).filter((s) => s !== null));
  return punches
    .filter((p) => !superseded.has(p.id))
    .toSorted((a, b) => ms(a.at) - ms(b.at) || ms(a.recordedAt) - ms(b.recordedAt));
}

/**
 * The shifts the standing punches make, or the first impossible transition.
 *
 * A clock-in while still clocked in is refused on the same day and starts a
 * new shift on a later one: Wednesday's forgotten clock-out must not turn
 * Adam away at the door on Thursday. Wednesday stays open until corrected.
 */
export function shiftsOf(punches: readonly Punch[], timeZone: string): Result<Shift[]> {
  const shifts: Shift[] = [];
  let open: {
    date: CalendarDate;
    in: Punch;
    breaks: { start: Punch; end: Punch | null }[];
  } | null = null;
  const close = (out: Punch | null) => {
    if (open) shifts.push({ ...open, out });
    open = null;
  };

  for (const p of standing(punches)) {
    const date = localDate(p.at, timeZone);
    const onBreak = open?.breaks.at(-1)?.end === null;
    switch (p.kind) {
      case 'in':
        if (open && open.date >= date) return refuse('ALREADY_CLOCKED_IN', 'Already clocked in', p);
        close(null);
        open = { date, in: p, breaks: [] };
        break;
      case 'break_start':
        if (!open) return refuse('NOT_CLOCKED_IN', 'Not clocked in', p);
        if (onBreak) return refuse('ALREADY_ON_BREAK', 'Already on a break', p);
        open.breaks.push({ start: p, end: null });
        break;
      case 'break_end': {
        const current = open?.breaks.at(-1);
        if (!current || current.end !== null) return refuse('NOT_ON_BREAK', 'Not on a break', p);
        current.end = p;
        break;
      }
      case 'out': {
        if (!open) return refuse('NOT_CLOCKED_IN', 'Not clocked in', p);
        // Leaving during a break ends the break at the door.
        const current = open.breaks.at(-1);
        if (current && current.end === null) current.end = p;
        close(p);
        break;
      }
    }
  }
  close(null);
  return ok(shifts);
}

export function stateOf(shifts: readonly Shift[]): ClockState {
  const last = shifts.at(-1);
  if (!last || last.out) return 'out';
  return last.breaks.at(-1)?.end === null ? 'on_break' : 'in';
}

/** One person's clock: every punch they made and every correction to one. */
export class AttendanceClock extends AggregateRoot<PersonId> {
  readonly #tenantId: TenantId;
  readonly #timeZone: string;
  #punches: readonly Punch[];
  #shifts: readonly Shift[];

  private constructor(
    tenantId: TenantId,
    personId: PersonId,
    timeZone: string,
    punches: readonly Punch[],
    shifts: readonly Shift[],
  ) {
    super(personId);
    this.#tenantId = tenantId;
    this.#timeZone = timeZone;
    this.#punches = punches;
    this.#shifts = shifts;
  }

  /**
   * Rebuilt from stored punches. Throws on an impossible sequence, because the
   * only way one gets stored is a bug: every write went through `punch` or
   * `correct`.
   */
  static of(args: {
    tenantId: TenantId;
    personId: PersonId;
    /** The member's work location's zone, which decides what "a day" is. */
    timeZone: string;
    punches: readonly Punch[];
  }): AttendanceClock {
    const shifts = shiftsOf(args.punches, args.timeZone);
    if (!shifts.ok) throw new Error(`Stored punches are impossible: ${shifts.error.message}`);
    return new AttendanceClock(
      args.tenantId,
      args.personId,
      args.timeZone,
      args.punches,
      shifts.value,
    );
  }

  /** Every punch, superseded ones included. */
  get punches(): readonly Punch[] {
    return this.#punches;
  }

  get shifts(): readonly Shift[] {
    return this.#shifts;
  }

  get state(): ClockState {
    return stateOf(this.#shifts);
  }

  punch(args: {
    id: string;
    input: PunchInput;
    actor: Actor;
    correlationId: string;
    clock: Clock;
  }): Result<Punch> {
    const now = args.clock.instant();
    const p: Punch = {
      id: args.id,
      at: args.input.at ?? now,
      recordedAt: now,
      kind: args.input.kind,
      source: args.input.source,
      workModel: args.input.workModel,
      deviceId: args.input.deviceId,
      insideOfficeArea: args.input.insideOfficeArea,
      supersedes: null,
      reason: null,
    };
    const applied = this.#apply(p);
    if (!applied.ok) return applied;

    this.#raise(args, now, p, {
      eventName: AttendancePunched.name,
      eventVersion: AttendancePunched.version,
      payload: {
        punchId: p.id,
        personId: this.id,
        at: p.at,
        kind: p.kind,
        source: p.source,
        workModel: p.workModel,
        deviceId: p.deviceId,
        insideOfficeArea: p.insideOfficeArea,
      },
    });
    return ok(p);
  }

  /**
   * A punch made afterwards: replacing one (`supersedes`), or one that was
   * never made (`supersedes: null`, Wednesday's missing clock-out).
   */
  correct(args: {
    id: string;
    supersedes: string | null;
    at: Instant;
    kind: PunchKind;
    source: PunchSource;
    workModel: AttendanceWorkModel;
    reason: string | null;
    actor: Actor;
    correlationId: string;
    clock: Clock;
  }): Result<Punch> {
    const now = args.clock.instant();
    if (ms(args.at) > ms(now)) {
      return err(failure('IN_THE_FUTURE', 'A correction cannot be later than now', ['at']));
    }
    if (args.supersedes !== null) {
      if (!this.#punches.some((p) => p.id === args.supersedes)) {
        return err(
          failure('SUPERSEDES_UNKNOWN', `No punch called ${args.supersedes}`, ['supersedes']),
        );
      }
      // Two live corrections of one punch are two answers to "when did Adam
      // leave". Correct the correction instead.
      const already = this.#punches.find((p) => p.supersedes === args.supersedes);
      if (already) {
        return err(
          failure(
            'ALREADY_CORRECTED',
            `${args.supersedes} was already corrected by ${already.id}; correct ${already.id} instead`,
            ['supersedes'],
          ),
        );
      }
    }

    const p: Punch = {
      id: args.id,
      at: args.at,
      recordedAt: now,
      kind: args.kind,
      source: args.source,
      workModel: args.workModel,
      deviceId: null,
      insideOfficeArea: null,
      supersedes: args.supersedes,
      reason: args.reason,
    };
    const applied = this.#apply(p);
    if (!applied.ok) return applied;

    this.#raise(args, now, p, {
      eventName: AttendanceCorrected.name,
      eventVersion: AttendanceCorrected.version,
      payload: {
        punchId: p.id,
        personId: this.id,
        supersedes: p.supersedes,
        at: p.at,
        kind: p.kind,
        reason: p.reason,
      },
    });
    return ok(p);
  }

  #apply(p: Punch): Result<void> {
    const punches = [...this.#punches, p];
    const shifts = shiftsOf(punches, this.#timeZone);
    if (!shifts.ok) return shifts;
    this.#punches = punches;
    this.#shifts = shifts.value;
    return ok(undefined);
  }

  #raise(
    args: { actor: Actor; correlationId: string },
    now: Instant,
    p: Punch,
    event: { eventName: string; eventVersion: number; payload: unknown },
  ): void {
    this.raise({
      ...event,
      eventId: p.id,
      tenantId: this.#tenantId,
      occurredAt: now,
      // The day the punch belongs to, not the day it was recorded: a
      // correction made on Thursday changes Wednesday.
      effectiveFrom: localDate(p.at, this.#timeZone),
      aggregate: { type: 'AttendanceClock', id: this.id, version: this.version + 1 },
      actor: args.actor,
      correlationId: args.correlationId,
      causationId: null,
    });
  }
}

export const ms = (instant: string): number => Date.parse(instant);

function refuse(code: string, message: string, p: Punch): Result<never> {
  return err(failure(code, `${message} at ${p.at}`, ['kind']));
}
