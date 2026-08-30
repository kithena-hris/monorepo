/**
 * What an enrolment link is worth, before anybody is asked for a passkey.
 *
 * The enrolment page used to find out by trying: it ran the whole registration
 * ceremony — a real biometric prompt, on a real device — and only then learned
 * the link had been spent. That is a bad way to tell somebody they are already
 * set up, and it is knowable in advance.
 *
 * Being specific here is deliberate and consistent with the rest of that page.
 * Reaching it needs a 256-bit token handed over out of band, so whoever is
 * reading already holds the secret; withholding the reason from them turns a
 * solvable problem into a support call and protects nobody. Sign-in, where the
 * caller has proved nothing, still says one thing to everyone.
 */
export type EnrolmentState =
  /** Live link, account waiting. Show the button. */
  | 'usable'
  /** They have a passkey already. Send them to sign in. */
  | 'already_enrolled'
  /** Presented before and not finished. They need a new link. */
  | 'spent'
  /** Ran out before it was used. They need a new link. */
  | 'expired'
  /** No such link, or an account enrolment does not apply to. */
  | 'unknown';

export interface EnrolmentRow {
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly accountStatus: string;
}

export function enrolmentState(row: EnrolmentRow | null, now: Date): EnrolmentState {
  if (row === null) return 'unknown';

  /*
   * Enrolled is checked first, and outranks every other reason.
   *
   * A link that was used last week and expired yesterday describes somebody
   * who is perfectly able to sign in. Telling them to ask for a replacement
   * would be true about the link and useless about them.
   */
  if (row.accountStatus === 'active') return 'already_enrolled';

  // Anything other than a waiting account is not a state to walk somebody
  // through: suspended and terminated are their HR team's to resolve, and
  // `provisioned` means no invitation was ever issued.
  if (row.accountStatus !== 'invited') return 'unknown';

  if (row.consumedAt !== null) return 'spent';

  // `<=`: a link good *until* an instant is not good at it.
  if (Date.parse(row.expiresAt) <= now.getTime()) return 'expired';

  return 'usable';
}
