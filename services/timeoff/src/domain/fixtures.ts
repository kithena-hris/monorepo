import { fixedClock } from '@kithena/domain-kit';
import { CalendarDate, PersonId, TenantId } from '@kithena/contracts';

import type { EventContext } from './context.js';

/**
 * Shared test fixtures for the domain's tests, parsed through the real
 * schemas so a typo fails at the line that wrote it.
 */

export const TENANT = TenantId.parse('11111111-1111-7111-8111-111111111111');
export const ADAM = PersonId.parse('22222222-2222-7222-8222-222222222222');
export const MARCO = PersonId.parse('33333333-3333-7333-8333-333333333333');
export const OMAR = PersonId.parse('44444444-4444-7444-8444-444444444444');
export const NORA = PersonId.parse('55555555-5555-7555-8555-555555555555');

export const date = (value: string): CalendarDate => CalendarDate.parse(value);

/** Deterministic ids and a fixed clock, so an assertion never depends on entropy. */
export function context(at = '2026-10-01T09:00:00.000Z'): EventContext {
  let n = 0;
  return {
    clock: fixedClock(at),
    newId: () => {
      n += 1;
      return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    },
    actor: { kind: 'user', userId: '66666666-6666-7666-8666-666666666666' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
    timeZone: 'Europe/Madrid',
  };
}
