import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Which account a verified passkey signs into.
 *
 * The passkey answers "who is this human", globally and without reference to
 * any company. This answers the second question — "and which of their jobs is
 * this?" — which used to be answered by the URL, because the sign-in page was
 * per company and carried the tenant in a query string.
 *
 * It is answered here instead so that one address bar can serve everybody. A
 * person types their work address, presents whatever passkey their device
 * offers, and lands at the right company without knowing a hostname. The
 * branded per-company page still works and still names its tenant; that path
 * supplies `tenantId` and no address.
 *
 * Pure, and deliberately so: this is the rule about which account is *allowed*
 * to be chosen, and it belongs where it can be read and tested without a
 * database. The candidate list is passed in because `no-cross-slice-imports`
 * forbids this slice reaching into the account slice — and is right to.
 */
export interface AccountCandidate {
  readonly accountId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** As stored. Compared case-insensitively; see `sameAddress`. */
  readonly workEmail: string;
}

export interface AccountNarrowing {
  /** What the person typed on the generic page, if anything. */
  readonly workEmail?: string | undefined;
  /** The company the branded page named, if it was that page. */
  readonly tenantId?: string | undefined;
}

/**
 * One refusal for everything, matching `signIn`'s.
 *
 * No account here, an address this person does not hold, and an address that
 * somehow matches two employers are one answer to the caller. Distinguishing
 * them would let anybody holding any passkey ask whether a given address works
 * at a given company and get a straight answer, which is the question the whole
 * flow is arranged not to answer.
 */
const Refused = failure('SIGN_IN_FAILED', 'Could not sign in');

/**
 * Addresses match on the same terms the database stores them.
 *
 * `account_live_email_key` is unique on `(tenant_id, lower(work_email))`, so
 * case is not part of an address's identity there and must not be part of it
 * here — otherwise somebody whose address was recorded with a capital letter
 * can never type it correctly.
 */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function chooseAccount(
  candidates: readonly AccountCandidate[],
  narrowing: AccountNarrowing,
): Result<AccountCandidate> {
  const typed = narrowing.workEmail?.trim();

  const matching = candidates.filter((candidate) => {
    if (narrowing.tenantId !== undefined && candidate.tenantId !== narrowing.tenantId) return false;
    if (typed !== undefined && typed !== '' && !sameAddress(candidate.workEmail, typed)) {
      return false;
    }
    return true;
  });

  const only = matching[0];
  if (only === undefined || matching.length > 1) {
    /*
     * More than one is refused rather than guessed at.
     *
     * The unique index is per tenant, so one address at two employers is
     * possible even if it is strange. Picking one would sign somebody into an
     * employer they did not ask for, and the recovery from that is worse than
     * the recovery from this: their company's own sign-in page names its
     * tenant and still works.
     */
    return err(Refused);
  }

  return ok(only);
}
