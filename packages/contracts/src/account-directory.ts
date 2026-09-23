import * as z from 'zod';

import { asContact, asIdentity, asInternal, policy } from './classification.js';
import { AccountId } from './events/identity.js';
import { CalendarDate } from './primitives.js';

/**
 * One page of a tenant's accounts: `GET /api/internal/tenants/<id>/accounts`.
 *
 * Identity serves it and People's reconciliation (§8.2, "People is bought
 * later") reads it. Defined here, once, because the two are separate processes
 * that may not import each other: the endpoint serialises to this and the
 * client parses with it, so neither side can drift without the other's tests
 * failing.
 *
 * Only what provisioning a person needs. No mobile number, no status, no
 * identity id: reconciliation creates a provisional record holding the
 * account, the work email, the time zone, the start date and — once enrolment
 * captured one — the name. Anything else here would be a copy of a personal
 * fact with no reader.
 */
export const DirectoryAccount = z.object({
  accountId: AccountId,
  workEmail: z.email().register(policy, asContact()),
  timeZone: z.string().min(1).register(policy, asInternal()),
  employmentStart: CalendarDate,
  /** Present once the person has enrolled and identity captured it. Both halves or none. */
  name: z
    .object({
      given: z.string().min(1).register(policy, asIdentity()),
      family: z.string().min(1).register(policy, asIdentity()),
      preferred: z.string().nullable().register(policy, asIdentity()),
    })
    .nullable(),
});
export type DirectoryAccount = z.infer<typeof DirectoryAccount>;

export const AccountsPage = z.object({
  accounts: z.array(DirectoryAccount),
  /** The last account id on this page, when there may be more; `?cursor=` it back. */
  nextCursor: z.string().nullable().register(policy, asInternal()),
});
export type AccountsPage = z.infer<typeof AccountsPage>;
