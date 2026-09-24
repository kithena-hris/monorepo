import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as z from 'zod';
import type { Result } from '@kithena/domain-kit';

import { LEAVING_REASONS } from '../domain/person/person.js';
import type { Asking, PersonAccess, PersonView } from '../application/person/person-access.js';

/**
 * The §8.1 moves a transport offers (PEO-108), described once for REST, its
 * OpenAPI document and GraphQL.
 *
 * Each is a POST to `/v1/people/{id}/<path>` answering with the person after,
 * and a GraphQL mutation of the same name. The body schema here is what both
 * transports parse against, so neither accepts a shape the other refuses.
 * Who may, and what each raises, is `PersonAccess`'s to decide.
 */

export const LeavingReasonBody = z
  .enum(LEAVING_REASONS)
  .describe('resigned: the person gave notice. dismissed or end_of_contract: the employer did.');

export const GiveNoticeBody = z.strictObject({
  lastWorkingDay: z.iso.date().describe('On the person’s own calendar.'),
  reason: LeavingReasonBody.optional().describe('Defaults to resigned.'),
});

export const TerminateBody = z.strictObject({
  lastWorkingDay: z.iso
    .date()
    .describe('Must have begun on the person’s calendar; until then they are on notice.'),
  reason: LeavingReasonBody,
  /** HR's own words, confidential; published as `terminated.reason`. */
  note: z.string().max(500).nullable().optional(),
  eligibleForRehire: z.boolean().nullable().optional(),
  endAccessNow: z
    .boolean()
    .optional()
    .describe(
      'End their access now, for a dismissal for cause. Otherwise it ends at the end of the last working day on their calendar.',
    ),
});

export const RehireBody = z.strictObject({
  startDate: z.iso.date().describe('The new employment’s first day, on the person’s calendar.'),
  legalEntityId: z.uuid().optional().describe('The legal entity they rejoin; their last one when absent.'),
  overrideReason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .nullable()
    .optional()
    .describe('Required to rehire somebody marked not eligible for rehire; kept on the new period.'),
});

const nullableId = z.uuid().nullable().optional();

/** Where a person sits (PEO-123). An absent field is not changed; null clears it. */
export const PlacementBody = z
  .strictObject({
    legalEntityId: nullableId.describe(
      'The employer of record. A different one is a transfer: a new employment period from effectiveFrom.',
    ),
    locationId: nullableId.describe('The work location. One in another legal entity moves the entity with it.'),
    orgUnitId: nullableId,
    costCentre: z.string().trim().min(1).max(100).nullable().optional(),
    effectiveFrom: z.iso
      .date()
      .optional()
      .describe('On the person’s new calendar; today there when absent, never later.'),
  })
  .refine(
    (b) =>
      b.legalEntityId !== undefined ||
      b.locationId !== undefined ||
      b.orgUnitId !== undefined ||
      b.costCentre !== undefined,
    { message: 'Name at least one of legalEntityId, locationId, orgUnitId or costCentre' },
  );

/** One employment on a person (PEO-110), as `GET /v1/people/{id}/employment-periods` answers. */
export const EmploymentPeriodBody = z.object({
  period: z.int().min(1),
  legalEntityId: z.uuid().nullable(),
  startedOn: z.iso.date(),
  lastWorkingDay: z.iso.date().nullable(),
  leavingReason: LeavingReasonBody.nullable(),
  eligibleForRehire: z.boolean().nullable(),
  noticeFrom: z.enum(['active', 'on_leave']).nullable(),
  rehireOverrideReason: z.string().nullable(),
});
export const EmploymentPeriodsBody = z.object({ items: z.array(EmploymentPeriodBody) });

export const NoBody = z.strictObject({});

type On = Asking & { readonly personId: string };

export interface LifecycleAction {
  /** The path segment under `/v1/people/{id}/`. */
  readonly path: string;
  /** The GraphQL mutation, and the OpenAPI component for its body. */
  readonly name: string;
  readonly summary: string;
  readonly body: z.ZodType;
  /** `input` is what `body` parsed. */
  run(
    access: PersonAccess,
    tx: PostgresJsDatabase,
    on: On,
    input: unknown,
  ): Promise<Result<PersonView>>;
}

function action<T>(spec: {
  readonly path: string;
  readonly name: string;
  readonly summary: string;
  readonly body: z.ZodType<T>;
  run(access: PersonAccess, tx: PostgresJsDatabase, on: On, input: T): Promise<Result<PersonView>>;
}): LifecycleAction {
  return { ...spec, run: (access, tx, on, input) => spec.run(access, tx, on, input as T) };
}

export const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  action({
    path: 'notice',
    name: 'giveNotice',
    summary: 'Put an active or on-leave person on notice until a last working day; HR only',
    body: GiveNoticeBody,
    run: (access, tx, on, input) =>
      access.giveNotice(tx, {
        ...on,
        lastWorkingDay: input.lastWorkingDay,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
  }),
  action({
    path: 'notice/withdraw',
    name: 'withdrawNotice',
    summary:
      'Withdraw a person’s notice before their last working day ends on their calendar; back to active or on leave; HR only',
    body: NoBody,
    run: (access, tx, on) => access.withdrawNotice(tx, on),
  }),
  action({
    path: 'termination',
    name: 'terminatePerson',
    summary: 'End the employment once its last working day has come; HR only',
    body: TerminateBody,
    run: (access, tx, on, input) =>
      access.terminate(tx, {
        ...on,
        lastWorkingDay: input.lastWorkingDay,
        reason: input.reason,
        note: input.note ?? null,
        eligibleForRehire: input.eligibleForRehire ?? null,
        ...(input.endAccessNow === undefined ? {} : { endAccessNow: input.endAccessNow }),
      }),
  }),
  action({
    path: 'access/end',
    name: 'endPersonAccess',
    summary:
      'End a terminated person’s access now rather than at the end of their last working day; HR only',
    body: NoBody,
    run: (access, tx, on) => access.endAccess(tx, on),
  }),
  action({
    path: 'rehire',
    name: 'rehirePerson',
    summary:
      'Hire a leaver again: a new employment period on the same record, pre-hire until it starts; HR only',
    body: RehireBody,
    run: (access, tx, on, input) =>
      access.rehire(tx, {
        ...on,
        startDate: input.startDate,
        ...(input.legalEntityId === undefined ? {} : { legalEntityId: input.legalEntityId }),
        overrideReason: input.overrideReason ?? null,
      }),
  }),
  action({
    path: 'placement',
    name: 'placePerson',
    summary:
      'Place a person at a legal entity, work location, org unit or cost centre from a date; a new entity is a transfer; HR only',
    body: PlacementBody,
    run: (access, tx, on, input) =>
      access.place(tx, {
        ...on,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      }),
  }),
  action({
    path: 'leave/start',
    name: 'startLeave',
    summary: 'An active person goes on leave from today, on their calendar; HR only',
    body: NoBody,
    run: (access, tx, on) => access.startLeave(tx, on),
  }),
  action({
    path: 'leave/end',
    name: 'endLeave',
    summary: 'A person on leave is back from today, on their calendar; HR only',
    body: NoBody,
    run: (access, tx, on) => access.endLeave(tx, on),
  }),
  action({
    path: 'discard',
    name: 'discardPerson',
    summary: 'Withdraw a provisional record that was never a person; HR only',
    body: NoBody,
    run: (access, tx, on) => access.discard(tx, on),
  }),
];
