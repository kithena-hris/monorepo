import { checkPersonProfile, type PersonProfile } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The profile rule, as this service's `Result`.
 *
 * The rule itself lives in `@kithena/contracts` — one Zod definition parsed by
 * the service that stores these and by the form that collects them, so a
 * client-side check cannot disagree with the server's. This is the adapter
 * between that and the `Result` every other operation here returns; it is
 * deliberately thin, and anything it did beyond mapping a shape would be a
 * second copy of the rule.
 *
 * In `shared/` for the same reason `person-name.ts` is: enrolment asks for this
 * and the account stores it, so it belongs to neither slice.
 */
export type { PersonProfile };

export function checkProfile(input: { timeZone?: unknown; mobile?: unknown }): Result<PersonProfile> {
  const checked = checkPersonProfile(input);
  if (checked.ok) return ok(checked.value);

  return err(
    failure(codeFor(checked.problem.field), checked.problem.message, [checked.problem.field]),
  );
}

function codeFor(field: 'timeZone' | 'mobile'): string {
  return field === 'mobile' ? 'MOBILE_MALFORMED' : 'TIME_ZONE_UNKNOWN';
}
