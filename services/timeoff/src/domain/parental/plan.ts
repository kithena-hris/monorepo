import * as z from 'zod';
import {
  AggregateRoot,
  err,
  failure,
  ok,
  type DomainFailure,
  type Result,
} from '@kithena/domain-kit';
import {
  ParentalPlanApproved,
  ParentalPlanSubmitted,
  type CalendarDate,
  type LeaveTypeKey,
  type PersonId,
  type TenantId,
} from '@kithena/contracts';

import { workingDays, type WorkCalendar } from '../calendar/working-days.js';
import { envelope, type EventContext } from '../context.js';
import { addDays, daysBetween } from '../days.js';
import {
  parentalEntitlement,
  type EntitlementAnswers,
  type ParentalEntitlement,
} from './entitlement.js';

/**
 * A parental leave plan (PRD §12.2, T9): blocks laid out around the law's
 * fixed and flexible parts, checked against the entitlement as they move.
 *
 * ```
 * draft ──▶ submitted ──▶ approved
 * ```
 *
 * A draft is private (§12.4) and raises nothing; the rules are checked on
 * every read so the timeline can show them while a block is dragged, and
 * enforced on submit and again on approval, which is HR's rules check (T11).
 * Weeks are calendar weeks, seven days, as the law counts them.
 */

export const ParentalPlanId = z.uuid().brand<'ParentalPlanId'>();
export type ParentalPlanId = z.infer<typeof ParentalPlanId>;

/** Throws: a malformed id is a bug in whatever built it. */
export const parentalPlanId = (value: string): ParentalPlanId => ParentalPlanId.parse(value);

/** Statutory weeks (mandatory, flexible, later), vacation earned while away, the company's weeks. */
export type BlockKind = 'mandatory' | 'flexible' | 'vacation' | 'company' | 'later';

export interface PlanBlock {
  readonly kind: BlockKind;
  readonly leaveTypeKey: LeaveTypeKey;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

export interface NoticeReminder {
  readonly blockFrom: CalendarDate;
  readonly remindOn: CalendarDate;
}

export type PlanStatus = 'draft' | 'submitted' | 'approved';

const length = (b: PlanBlock): number => daysBetween(b.from, b.to);
const totalDays = (blocks: readonly PlanBlock[], kind: BlockKind): number =>
  blocks.filter((b) => b.kind === kind).reduce((n, b) => n + length(b), 0);

/** Every rule the plan breaks, in a fixed order; none means it can be sent. */
export function checkPlan(
  e: ParentalEntitlement,
  childDate: CalendarDate,
  blocks: readonly PlanBlock[],
): DomainFailure[] {
  const problems: DomainFailure[] = [];
  const add = (code: string, message: string) => {
    if (!problems.some((p) => p.code === code)) problems.push(failure(code, message, ['blocks']));
  };
  const sorted = blocks.toSorted((a, b) => a.from.localeCompare(b.from));

  if (sorted.some((b) => b.to < b.from))
    add('INVALID_PERIOD', 'A block cannot end before it starts');

  const mandatory = sorted.filter((b) => b.kind === 'mandatory');
  const [first] = mandatory;
  if (
    mandatory.length !== 1 ||
    first?.from !== childDate ||
    length(first) !== e.mandatoryWeeks * 7
  ) {
    add(
      'MANDATORY_AT_BIRTH',
      `The ${String(e.mandatoryWeeks)} mandatory weeks run full time from the birth`,
    );
  }

  for (const b of sorted) {
    const statutory = b.kind === 'flexible' || b.kind === 'later';
    if (statutory && length(b) % 7 !== 0)
      add('WHOLE_WEEKS', 'Flexible weeks are taken in whole weeks');
    if (statutory && b.from < e.startsFrom)
      add('TOO_EARLY', 'These weeks cannot start before the birth');
    if (b.kind === 'flexible' && b.to >= e.flexibleBefore)
      add('FLEXIBLE_DEADLINE', `Flexible weeks end before ${e.flexibleBefore}`);
    if (b.kind === 'later' && b.to >= e.laterBefore)
      add('LATER_DEADLINE', `Weeks kept for later end before ${e.laterBefore}`);
  }

  if (
    totalDays(sorted, 'flexible') > e.flexibleWeeks * 7 ||
    totalDays(sorted, 'later') > e.laterWeeks * 7 ||
    totalDays(sorted, 'company') > e.companyWeeks * 7
  ) {
    add('OVER_ENTITLEMENT', 'The plan uses more weeks than the entitlement');
  }

  if (sorted.some((b, i) => i > 0 && b.from <= (sorted[i - 1]?.to ?? b.from)))
    add('OVERLAP', 'Two blocks overlap');

  return problems;
}

export class ParentalPlan extends AggregateRoot<ParentalPlanId> {
  readonly #tenantId: TenantId;
  readonly #personId: PersonId;
  readonly #calendar: WorkCalendar;
  /** Null when adopting or fostering: there is no pregnancy to speak of. */
  readonly #dueDate: CalendarDate | null;
  #answers: EntitlementAnswers;
  #entitlement: ParentalEntitlement;
  #blocks: readonly PlanBlock[];
  #status: PlanStatus = 'draft';

  private constructor(
    id: ParentalPlanId,
    props: {
      tenantId: TenantId;
      personId: PersonId;
      answers: EntitlementAnswers;
      calendar: WorkCalendar;
      blocks: readonly PlanBlock[];
    },
  ) {
    super(id);
    this.#tenantId = props.tenantId;
    this.#personId = props.personId;
    this.#calendar = props.calendar;
    this.#answers = props.answers;
    this.#entitlement = parentalEntitlement(props.answers);
    this.#dueDate = props.answers.role === 'adopting' ? null : props.answers.childDate;
    this.#blocks = props.blocks;
  }

  static draft(args: {
    id: ParentalPlanId;
    tenantId: TenantId;
    personId: PersonId;
    answers: EntitlementAnswers;
    /** The member's working week and holidays, for the working days each block costs. */
    calendar: WorkCalendar;
    blocks: readonly PlanBlock[];
  }): ParentalPlan {
    return new ParentalPlan(args.id, args);
  }

  get status(): PlanStatus {
    return this.#status;
  }
  get entitlement(): ParentalEntitlement {
    return this.#entitlement;
  }
  get blocks(): readonly PlanBlock[] {
    return this.#blocks;
  }

  /** Later weeks not booked yet: "kept for later" on the timeline. */
  get keptWeeks(): number {
    return this.#entitlement.laterWeeks - totalDays(this.#blocks, 'later') / 7;
  }

  /** One per flexible block, `noticeDays` before it starts. */
  get reminders(): readonly NoticeReminder[] {
    return this.#blocks
      .filter((b) => b.kind === 'flexible')
      .toSorted((a, b) => a.from.localeCompare(b.from))
      .map((b) => ({
        blockFrom: b.from,
        remindOn: addDays(b.from, -this.#entitlement.noticeDays),
      }));
  }

  check(): DomainFailure[] {
    return checkPlan(this.#entitlement, this.#answers.childDate, this.#blocks);
  }

  /**
   * The baby arrived (§12.4): the deadlines are counted from the birth, and
   * the mandatory weeks move to it with every block running on from them
   * without a gap. Blocks further out stay where the parent put them.
   */
  recordBirth(birth: CalendarDate): void {
    const shift = daysBetween(this.#answers.childDate, birth) - 1;
    const sorted = this.#blocks.toSorted((a, b) => a.from.localeCompare(b.from));
    const moving = new Set<PlanBlock>();
    for (const b of sorted) {
      const last = [...moving].at(-1);
      if (b.kind === 'mandatory' || (last !== undefined && b.from === addDays(last.to, 1)))
        moving.add(b);
    }
    this.#blocks = this.#blocks.map((b) =>
      moving.has(b) ? { ...b, from: addDays(b.from, shift), to: addDays(b.to, shift) } : b,
    );
    this.#answers = { ...this.#answers, childDate: birth };
    this.#entitlement = parentalEntitlement(this.#answers);
  }

  /** Sent to HR and the manager (T10). */
  submit(ctx: EventContext): Result<void> {
    if (this.#status !== 'draft') return this.#refuse('submitted');
    const [problem] = this.check();
    if (problem) return err(problem);
    this.#status = 'submitted';
    this.#raise(ctx, ParentalPlanSubmitted, {
      planId: this.id,
      personId: this.#personId,
      dueDate: this.#dueDate,
      blocks: this.#payloadBlocks(),
    });
    return ok(undefined);
  }

  /** HR approves after the rules check (T11), which runs again here. */
  approve(approvedBy: string, ctx: EventContext): Result<void> {
    if (this.#status !== 'submitted') return this.#refuse('approved');
    const [problem] = this.check();
    if (problem) return err(problem);
    this.#status = 'approved';
    this.#raise(ctx, ParentalPlanApproved, {
      planId: this.id,
      personId: this.#personId,
      approvedBy,
      blocks: this.#payloadBlocks(),
    });
    return ok(undefined);
  }

  #refuse(action: string): Result<never> {
    return err(failure('INVALID_TRANSITION', `A ${this.#status} plan cannot be ${action}`));
  }

  #payloadBlocks() {
    return this.#blocks
      .toSorted((a, b) => a.from.localeCompare(b.from))
      .map((b) => ({
        leaveTypeKey: b.leaveTypeKey,
        from: b.from,
        to: b.to,
        workingDays: workingDays(
          { from: b.from, to: b.to, startsHalfDay: false, endsHalfDay: false },
          this.#calendar,
        ),
      }));
  }

  #raise(
    ctx: EventContext,
    event: { name: string; version: number; payload: z.ZodType },
    payload: unknown,
  ): void {
    const from = this.#blocks.map((b) => b.from).toSorted()[0] ?? null;
    this.raise(
      envelope(ctx, {
        tenantId: this.#tenantId,
        eventName: event.name,
        eventVersion: event.version,
        effectiveFrom: from,
        aggregate: { type: 'ParentalPlan', id: this.id, version: this.version + 1 },
        payload: event.payload.parse(payload),
      }),
    );
  }
}
