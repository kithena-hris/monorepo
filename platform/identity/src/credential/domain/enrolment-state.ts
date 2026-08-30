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
   * The link is judged before the account, and that ordering is the whole of
   * this function.
   *
   * It used to be the other way round: an `active` account meant
   * `already_enrolled`, full stop. That was right while the only way to hold a
   * live link was to be waiting for a first enrolment — and it became wrong the
   * moment recovery existed, because a recovery link is *always* issued to an
   * active account. The page then told somebody who had just asked for a new
   * passkey that they already had one, and offered to send them to a sign-in
   * they could not complete.
   *
   * So: a live link is usable, whoever it belongs to. `already_enrolled` is
   * what is left when there is no usable link and the account is nonetheless
   * signed-in-able.
   */
  const spent = row.consumedAt !== null;
  // `<=`: a link good *until* an instant is not good at it.
  const expired = Date.parse(row.expiresAt) <= now.getTime();
  const live = !spent && !expired;

  // States enrolment does not apply to at all. `provisioned` means no
  // invitation was ever issued; suspended and terminated are their HR team's to
  // resolve, and a link is not the way through either.
  if (row.accountStatus !== 'active' && row.accountStatus !== 'invited') return 'unknown';

  if (live) return 'usable';

  /*
   * No usable link. If they can already sign in, say so — that is the ordinary
   * case of somebody returning to a bookmark, and telling them to ask for a
   * replacement would be true about the link and useless about them.
   */
  if (row.accountStatus === 'active') return 'already_enrolled';

  return spent ? 'spent' : 'expired';
}