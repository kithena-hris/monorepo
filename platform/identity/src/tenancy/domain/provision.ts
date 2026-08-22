import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { isReservedSlug, TenantSlug } from '@kithena/contracts';

/**
 * Bringing a customer into existence.
 *
 * The rules are few and each one is load-bearing, so they live here rather than
 * in whichever screen happens to call them — the back-office is one caller and
 * a provisioning API for a reseller would be another.
 */
export interface ProvisionRequest {
  readonly slug: string;
  readonly displayName: string;
  /**
   * The people who will hold the first admin accounts.
   *
   * Plural, and not by accident. A company where one person holds the only
   * enrolment link is a company locked out when that person leaves before their
   * start date — and the second admin has to exist anyway, or the
   * last-two-admins rule has nothing to protect and HR-mediated recovery has no
   * quorum. Asking for them at the outset makes that the default rather than a
   * checklist item somebody completes later.
   */
  readonly admins: readonly string[];
  readonly accentColor: string | null;
}

export const SlugMalformed = failure('SLUG_MALFORMED', 'That is not a usable company name', [
  'slug',
]);
export const SlugReserved = failure('SLUG_RESERVED', 'That name is not available', ['slug']);
export const NeedsTwoAdmins = failure(
  'NEEDS_TWO_ADMINS',
  'Invite at least two administrators, so neither is the only way in',
  ['admins'],
);
export const DisplayNameMissing = failure('DISPLAY_NAME_MISSING', 'A company needs a name', [
  'displayName',
]);

/**
 * Whether this company may be created, before anything is written.
 *
 * Availability of the label is not decided here — that is a unique index, and
 * asking the database first would be a check-then-act with a gap in the middle.
 * What is decided here is everything that can be known without a query.
 */
export function checkProvisionable(request: ProvisionRequest): Result<ProvisionRequest> {
  if (request.displayName.trim() === '') return err(DisplayNameMissing);

  if (!TenantSlug.safeParse(request.slug).success) return err(SlugMalformed);

  // Reserved separately from malformed, because the two are different things to
  // be told: one is "that cannot be a hostname", the other "that one is ours".
  if (isReservedSlug(request.slug)) return err(SlugReserved);

  const admins = request.admins.map((a) => a.trim().toLowerCase()).filter((a) => a !== '');
  if (new Set(admins).size < 2) return err(NeedsTwoAdmins);

  return ok({ ...request, admins: [...new Set(admins)] });
}
