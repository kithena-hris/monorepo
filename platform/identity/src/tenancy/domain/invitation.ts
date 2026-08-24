import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

/**
 * Inviting somebody to a company they are about to work for.
 *
 * Pure, which is what makes it the same answer on every transport. The
 * back-office calls this today; a SCIM push and an HR-driven "resend
 * invitation" button are the next two callers, and none of them should be able
 * to reach a different conclusion about whether a terminated employee may be
 * handed a fresh enrolment link.
 */

/**
 * Why an invitation was refused, as separate failures.
 *
 * Separate because the operator does something different about each: an
 * enrolled account needs recovery rather than an invitation, a suspended one
 * needs the suspension lifted first, and a terminated one needs a new
 * employment record. One `CANNOT_INVITE` would collapse three different next
 * steps into a shrug.
 */
export const AlreadyEnrolled = failure(
  'ALREADY_ENROLLED',
  'That person has already set up their account. Use recovery instead.',
  ['email'],
);
export const AccountSuspended = failure(
  'ACCOUNT_SUSPENDED',
  'That account is suspended. Lift the suspension before inviting again.',
  ['email'],
);
export const AccountTerminated = failure(
  'ACCOUNT_TERMINATED',
  'That account belongs to a former employee and cannot be invited.',
  ['email'],
);
export const AccountUnknownState = failure(
  'ACCOUNT_STATE_UNKNOWN',
  'That account is in a state that cannot be invited',
  ['email'],
);

/**
 * Whether an account in this state may be issued an enrolment link.
 *
 * A pre-flight, not the authority. `Account.invite` is the authority — it is
 * the aggregate's own state machine and it refuses the same set. This exists
 * because the operator needs a reason they can act on, and "INVALID_TRANSITION"
 * is not one: an enrolled account needs recovery, a suspended one needs the
 * suspension lifted, and a terminated one needs a new employment record. Same
 * arrangement as `checkProvisionable` sitting in front of the unique index.
 *
 * Takes a `string` rather than the account slice's `AccountStatus`, and that is
 * the boundary doing its job rather than laziness: `no-cross-slice-imports`
 * forbids tenancy from importing `account/domain`, and re-declaring the union
 * here would be a copy that drifts silently the day a sixth state is added.
 *
 * Refusing an unrecognised state is the safe direction, and it is what makes
 * the copy unnecessary. A state this function has never heard of is a state
 * whose rules it does not know, and handing out a credential-bootstrapping link
 * on that basis is the one mistake worth being paranoid about.
 */
export function mayInvite(status: string): Result<void> {
  switch (status) {
    // Commissioned, or invited before and never taken up. Re-issuing is the
    // ordinary case: the previous link is invalidated by the issue itself.
    case 'provisioned':
    case 'invited':
      return ok(undefined);
    case 'active':
      return err(AlreadyEnrolled);
    case 'suspended':
      return err(AccountSuspended);
    case 'terminated':
      return err(AccountTerminated);
    default:
      return err(AccountUnknownState);
  }
}

/** The address as it is stored and matched. Lower case, because people type it. */
export function normaliseWorkEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const LinkUnbuildable = failure(
  'ENROLMENT_LINK_UNBUILDABLE',
  'The enrolment link could not be built',
);

export interface EnrolmentLinkInput {
  /** Where enrolment happens. Always the auth origin, never a tenant host. */
  readonly authOrigin: string;
  readonly slug: string;
  readonly identityId: string;
  readonly token: string;
  readonly workEmail: string;
}

/**
 * The link a person is sent.
 *
 * Four parameters, and the page reads all four —
 * `apps/auth/shell/src/routes/enrol/page.tsx` is the other half of this
 * contract, so changing a name here breaks a screen that will not fail to
 * compile.
 *
 * `name` is the work email, and it is the answer to the second half of the
 * brief: the enrolment page shows it before the device prompt appears. That
 * matters more than it looks. One device holds passkeys for several accounts —
 * a contractor at three customers, someone testing two environments — and the
 * system prompt only shows what it was told at registration. Saying it on the
 * page as well means the choice is made before the prompt, not guessed at
 * inside it.
 *
 * `tenant` is the slug rather than the uuid, for the same reason the seed
 * script uses one: it is what the hostname will carry in production, so a link
 * built today survives the move to tenant subdomains.
 *
 * Built with `URL` rather than string concatenation, so every value is
 * percent-encoded — an address with a `+` in it is a different address once a
 * query string has decoded it.
 */
export function enrolmentLink(input: EnrolmentLinkInput): Result<string> {
  let link: URL;
  try {
    link = new URL('/enrol', input.authOrigin);
  } catch {
    return err(LinkUnbuildable);
  }

  link.searchParams.set('identity', input.identityId);
  link.searchParams.set('tenant', input.slug);
  link.searchParams.set('token', input.token);
  link.searchParams.set('name', input.workEmail);

  return ok(link.toString());
}

/* ------------------------------------------------------- employment dates -- */

export const EmploymentStartMalformed = failure(
  'EMPLOYMENT_START_MALFORMED',
  'An employment start date must be a calendar date, as YYYY-MM-DD',
  ['employmentStart'],
);
export const TimeZoneUnknown = failure('TIME_ZONE_UNKNOWN', 'That is not an IANA time zone', [
  'timeZone',
]);
export const EmploymentStartImplausible = failure(
  'EMPLOYMENT_START_IMPLAUSIBLE',
  'An employment start date more than two years out is a typo more often than a plan',
  ['employmentStart'],
);

/** Two years. Long enough for any real forward-dated hire, short enough that a
 *  mistyped year is caught rather than committed. */
const MAX_YEARS_AHEAD = 2;

export interface EmploymentRecord {
  /** `YYYY-MM-DD`. When the person actually starts. */
  readonly employmentStart: string;
  /** IANA. Decides when that date, and the last working day, actually fall. */
  readonly timeZone: string;
}

/**
 * The employment an invitation is against.
 *
 * This matters more than it looks, and it is the reason the invite endpoint
 * takes these at all. `Account.enrol` refuses a passkey before the start date,
 * so an account commissioned with today's date can be enrolled the moment the
 * link arrives — which is correct for somebody starting today and wrong for the
 * hire entered three weeks early, who could then be logging in for three weeks
 * before they are employed. Defaulting the date silently made that gate
 * unreachable; taking it explicitly is what turns it back on.
 *
 * The time zone is not decoration either. A start date is a calendar date, and
 * "has the 1st arrived" has no answer without one — ending or beginning access
 * at UTC midnight logs Californians out mid-afternoon.
 */
export function checkEmployment(
  input: { employmentStart: string | undefined; timeZone: string | undefined },
  clock: Clock,
): Result<EmploymentRecord> {
  /*
   * The zone first, and the order is load bearing rather than tidy.
   *
   * Defaulting the start date means asking the clock what today is *there*, and
   * `Intl` throws a `RangeError` for a zone it does not know. Checking the date
   * first therefore crashed on an unknown zone before it could be refused — a
   * 500 where a 422 belongs, on a value a caller typed. The test that found it
   * is the one asserting the refusal.
   */
  const timeZone = input.timeZone ?? 'Etc/UTC';
  if (!isTimeZone(timeZone)) return err(TimeZoneUnknown);

  // Today in *their* zone. 09:00 UTC is the previous day in Honolulu, and
  // somebody starting "today" there starts on that day — an account dated a day
  // later refuses their passkey for the whole of their first shift.
  const employmentStart = input.employmentStart ?? clock.date(timeZone);
  if (!isCalendarDate(employmentStart)) return err(EmploymentStartMalformed);

  // A date in the past is fine and common: a rehire, a backfilled record, or
  // somebody who started before anyone got round to creating their account.
  // Only the far future is refused, because that is the shape a typo takes —
  // `2036` for `2026` is one keystroke and produces an account nobody can enrol
  // for a decade, which looks exactly like the link being broken.
  const limit = new Date(`${clock.date('Etc/UTC')}T00:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + MAX_YEARS_AHEAD);
  if (new Date(`${employmentStart}T00:00:00Z`) > limit) {
    return err(EmploymentStartImplausible);
  }

  return ok({ employmentStart, timeZone });
}

/** `YYYY-MM-DD`, and a date that exists. `2026-02-30` is neither. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  // Round-tripped, because `Date` rolls `2026-02-30` forward to 2 March
  // rather than refusing it.
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value);
}

/**
 * Whether the runtime recognises this zone.
 *
 * Asked of `Intl` rather than checked against a list, because the list is the
 * IANA database and it changes: zones are added, and a hard-coded copy is a
 * copy that refuses a real employee's real location. `Intl` throws a
 * `RangeError` for an unknown zone, which is the only reliable way to ask.
 */
function isTimeZone(value: string): boolean {
  if (value === '') return false;
  try {
    // Constructed for its side effect, which is throwing. There is no predicate
    // to call: `Intl.supportedValuesOf('timeZone')` exists but returns the
    // canonical list only, so it refuses `Asia/Calcutta` and every other alias
    // a real employee's device reports.
    // oxlint-disable-next-line no-new
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
