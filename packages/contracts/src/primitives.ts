import * as z from 'zod';
import { policy, asFinancial, asInternal, asPublic } from './classification.js';

/** Calendar date. Hire dates are not instants. A person hired on the 1st in
 *  Barcelona was not hired on the 31st in Los Angeles. */
export const CalendarDate = z.iso.date().brand<'CalendarDate'>().register(policy, asInternal());
export type CalendarDate = z.infer<typeof CalendarDate>;

export const Instant = z.iso
  .datetime({ offset: true })
  .brand<'Instant'>()
  .register(policy, asInternal());
export type Instant = z.infer<typeof Instant>;

export const TenantId = z.uuid().brand<'TenantId'>().register(policy, asPublic());
export type TenantId = z.infer<typeof TenantId>;

export const PersonId = z.uuid().brand<'PersonId'>().register(policy, asPublic());
export type PersonId = z.infer<typeof PersonId>;

export const LegalEntityId = z.uuid().brand<'LegalEntityId'>().register(policy, asPublic());
export type LegalEntityId = z.infer<typeof LegalEntityId>;

/** Money in minor units. Never a float, anywhere, ever. */
export const Money = z.object({
  amountMinor: z.int().register(policy, asFinancial()),
  currency: z.string().length(3).register(policy, asPublic()),
});
export type Money = z.infer<typeof Money>;

/** Half-open period [from, to). `to: null` means open-ended. */
export const Period = z
  .object({ from: CalendarDate, to: CalendarDate.nullable() })
  .refine((p) => p.to === null || p.from <= p.to, {
    message: 'Period end must not precede its start',
  });
export type Period = z.infer<typeof Period>;
