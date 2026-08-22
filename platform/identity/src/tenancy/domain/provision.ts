import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  PostalAddress,
  ThemeId,
  TenantSlug,
  checkAddress,
  isReservedSlug,
} from '@kithena/contracts';

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
   * At least one. This asked for two until 2026-08-22, and the reason it did is
   * still true: a company where one person holds the only enrolment link is
   * locked out when that person leaves before their start date, and
   * HR-mediated recovery has no quorum without a second admin. The rule was
   * relaxed on the product owner's explicit instruction.
   * `docs/auth-administration.md` records the trade rather than pretending it
   * was not made.
   */
  readonly admins: readonly string[];
  /** One of `THEME_PRESETS`. Re-points the accent on their login page. */
  readonly themeId: string;
  /** The mark, beside a company name in a list. */
  readonly logoUrl: string | null;
  /** The larger picture, filling half of their login page. */
  readonly coverImageUrl: string | null;
  readonly address: PostalAddress;
}

export const SlugMalformed = failure('SLUG_MALFORMED', 'That is not a usable company name', [
  'slug',
]);
export const SlugReserved = failure('SLUG_RESERVED', 'That name is not available', ['slug']);
export const NeedsAnAdmin = failure(
  'NEEDS_AN_ADMIN',
  'Invite at least one administrator, or nobody can sign in',
  ['admins'],
);
export const DisplayNameMissing = failure('DISPLAY_NAME_MISSING', 'A company needs a name', [
  'displayName',
]);
export const ThemeUnknown = failure('THEME_UNKNOWN', 'That is not one of the available themes', [
  'themeId',
]);
export const ImageNotOurs = failure(
  'IMAGE_NOT_OURS',
  'Images must be uploaded here rather than linked from elsewhere',
  ['logoUrl', 'coverImageUrl'],
);

/**
 * Where an uploaded image is allowed to live.
 *
 * A customer's login page renders these, so an off-site URL is an image
 * somebody else can swap after we have approved it — and the login page is the
 * one screen where a swapped image is a convincing phishing prompt. The
 * uploader writes to Vercel Blob, whose public URLs are all on this host.
 */
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;

function imageIsOurs(url: string | null): boolean {
  return url === null || BLOB_HOST.test(url);
}

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
  const unique = [...new Set(admins)];
  if (unique.length < 1) return err(NeedsAnAdmin);

  if (!ThemeId.safeParse(request.themeId).success) return err(ThemeUnknown);

  if (!imageIsOurs(request.logoUrl) || !imageIsOurs(request.coverImageUrl)) {
    return err(ImageNotOurs);
  }

  const shape = PostalAddress.safeParse(request.address);
  if (!shape.success) {
    // The wizard shows a message under one input, so the field has to survive
    // out of here. `address.city` rather than `city`: the caller has a slug and
    // a display name too, and a bare `city` would be ambiguous the day a
    // request carries a second address.
    const field = shape.error.issues[0]?.path.join('.') ?? 'address';
    return err(
      failure('ADDRESS_INVALID', shape.error.issues[0]?.message ?? 'That address is not usable', [
        `address.${field}`,
      ]),
    );
  }

  // The country-dependent half: whether the postcode fits the country, whether
  // the subdivision is one that country has, and whether the two agree.
  const problems = checkAddress(shape.data);
  if (problems.length > 0) {
    const first = problems[0];
    if (first) {
      return err(failure('ADDRESS_INVALID', first.message, [`address.${first.field}`]));
    }
  }

  return ok({ ...request, admins: unique, address: shape.data });
}
