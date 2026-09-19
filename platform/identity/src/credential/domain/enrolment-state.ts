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
  /**
   * Why the link was issued.
   *
   * `'invitation'` is the first one, gated by a second channel. `'recovery'` is
   * a replacement asked for with an email address alone.
   *
   * A `string` rather than a union, deliberately: the column is `text` with a
   * CHECK so the database can gain a third purpose without a type migration,
   * and a value this build has never heard of is treated as the stricter kind
   * rather than cast into a shape that lets it through.
   */
  readonly purpose: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly accountStatus: string;
}

export function enrolmentState(row: EnrolmentRow | null, now: Date): EnrolmentState {
  if (row === null) return 'unknown';

  // States enrolment does not apply to at all, whatever the link says.
  // `provisioned` means no invitation was ever issued; suspended and terminated
  // are their HR team's to resolve, and a link is not the way through either.
  if (row.accountStatus !== 'active' && row.accountStatus !== 'invited') return 'unknown';

  const spent = row.consumedAt !== null;
  // `<=`: a link good *until* an instant is not good at it.
  const expired = Date.parse(row.expiresAt) <= now.getTime();
  const live = !spent && !expired;

  /*
   * A live recovery link means setting up a passkey, and nothing about the
   * account changes that.
   *
   * This used to be inferred — first from the account's status, then from the
   * link's liveness — and both readings were proxies for the question actually
   * being asked. A recovery link is *always* issued to an active account, so
   * reading `active` as "you already have a passkey" blocked the flow the email
   * had just started and offered a sign-in the person could not complete, the
   * passkey being the thing they lost.
   *
   * The link now says why it exists, so neither this function nor the next
   * reader has to reconstruct it.
   */
  if (live && row.purpose === 'recovery') return 'usable';

  // An invitation is only usable while the account is still waiting for one.
  // An unrecognised purpose lands here too: the stricter of the two, so a
  // future third kind cannot become a way past this by being unknown.
  if (live && row.accountStatus === 'invited') return 'usable';

  /*
   * No usable link. Somebody who can already sign in is told so — the
   * bookmark case — and the page offers them a fresh link if the passkey is
   * genuinely gone.
   */
  if (row.accountStatus === 'active') return 'already_enrolled';

  return spent ? 'spent' : 'expired';
}