import { checkPersonName, formatPersonName, type PersonName } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The name rule, as this service's `Result`.
 *
 * The rule itself lives in `@kithena/contracts` — one Zod definition parsed by
 * the service that stores a name and by the form that collects it, so a
 * client-side check cannot disagree with the server's. This is the adapter
 * between that and the `Result` every other operation here returns; it is
 * deliberately thin, and anything it did beyond mapping a shape would be a
 * second copy of the rule.
 *
 * In `shared/` rather than owned by the account slice, and for the same reason
 * `origin.ts` is: enrolment asks for this and the account stores it, so it
 * belongs to neither. `no-cross-slice-imports` said so when it sat under
 * `account/domain` and the credential slice could not reach it.
 */
export type { PersonName };

export function checkName(input: {
  given?: unknown;
  family?: unknown;
  preferred?: unknown;
}): Result<PersonName> {
  const checked = checkPersonName(input);
  if (checked.ok) return ok(checked.value);

  /*
   * The rule that refused, as a code.
   *
   * Derived from the message rather than restated as a second rule table: the
   * messages come from one Zod definition, so a code mapped off them cannot
   * describe a rule that does not exist. The caller shows `message` and points
   * at `path`; the code is for a log and for a test that wants to say which
   * rule it is exercising.
   */
  return err(failure(codeFor(checked.problem.message), checked.problem.message, [
    checked.problem.field,
  ]));
}

export const displayName = formatPersonName;

function codeFor(message: string): string {
  if (message.includes('required')) return 'NAME_REQUIRED';
  if (message.includes('under')) return 'NAME_TOO_LONG';
  return 'NAME_MALFORMED';
}
