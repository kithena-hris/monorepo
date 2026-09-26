import { err, failure, isTimeZone, ok, type Result } from '@kithena/domain-kit';
import { imageIsOurs, type ImageHostPolicy } from './image-host.js';
import { checkEntitlements } from './entitlements.js';
import { AdministratorRequired, ModuleNotEnabled } from './administrators.js';
import {
  ADMINISTERED_MODULES,
  type ModuleEntitlement,
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
  /**
   * The company's IANA zone: the default every "today" falls back to, and its
   * first administrators' zone. People takes it, with the address's country,
   * as the first legal entity (PEO-099). Absent means UTC.
   */
  readonly timeZone?: string;
  /**
   * The modules the company bought (PEO-114). Absent: none recorded, so it
   * has the deployment's list until somebody records one.
   */
  readonly entitlements?: readonly string[];
  /**
   * Who administers each administered module switched on here, by the email
   * of one or more of `admins` (PEO-112). Required for each such module:
   * nobody is a module's administrator because they were invited first.
   */
  readonly administrators?: Readonly<Record<string, string | readonly string[]>>;
  /** The back-office operator creating the company. */
  readonly namedBy?: string | null;
}

/** What `checkProvisionable` hands on: the zone and the modules decided. */
export type CheckedProvision = Omit<ProvisionRequest, 'entitlements' | 'administrators'> & {
  readonly timeZone: string;
  readonly entitlements: readonly ModuleEntitlement[] | null;
  /** Module → an administrator's email, one of `admins`; a module may appear more than once. */
  readonly administrators: readonly { entitlement: ModuleEntitlement; email: string }[];
};

export const TimeZoneUnknown = failure('TIME_ZONE_UNKNOWN', 'That is not a time zone', [
  'timeZone',
]);

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
 * Whether this company may be created, before anything is written.
 *
 * Availability of the label is not decided here — that is a unique index, and
 * asking the database first would be a check-then-act with a gap in the middle.
 * What is decided here is everything that can be known without a query.
 */
export function checkProvisionable(
  request: ProvisionRequest,
  images: ImageHostPolicy,
): Result<CheckedProvision> {
  if (request.displayName.trim() === '') return err(DisplayNameMissing);

  const timeZone = request.timeZone ?? 'Etc/UTC';
  if (!isTimeZone(timeZone)) return err(TimeZoneUnknown);

  if (!TenantSlug.safeParse(request.slug).success) return err(SlugMalformed);

  // Reserved separately from malformed, because the two are different things to
  // be told: one is "that cannot be a hostname", the other "that one is ours".
  if (isReservedSlug(request.slug)) return err(SlugReserved);

  const admins = request.admins.map((a) => a.trim().toLowerCase()).filter((a) => a !== '');
  const unique = [...new Set(admins)];
  if (unique.length < 1) return err(NeedsAnAdmin);

  if (!ThemeId.safeParse(request.themeId).success) return err(ThemeUnknown);

  if (!imageIsOurs(request.logoUrl, images) || !imageIsOurs(request.coverImageUrl, images)) {
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

  let entitlements: ModuleEntitlement[] | null = null;
  if (request.entitlements !== undefined) {
    const modules = checkEntitlements(request.entitlements);
    if (!modules.ok) return modules;
    entitlements = modules.value;
  }

  const administrators: { entitlement: ModuleEntitlement; email: string }[] = [];
  const asked = request.administrators ?? {};
  for (const module of Object.keys(asked)) {
    if (!(entitlements ?? []).some((e) => e === module)) return err(ModuleNotEnabled(module));
  }
  for (const entitlement of entitlements ?? []) {
    if (!ADMINISTERED_MODULES.includes(entitlement)) continue;
    const given = asked[entitlement] ?? [];
    const emails = [
      ...new Set((typeof given === 'string' ? [given] : given).map((e) => e.trim().toLowerCase())),
    ];
    if (emails.length === 0 || emails.some((email) => !unique.includes(email))) {
      return err(AdministratorRequired(entitlement));
    }
    for (const email of emails) administrators.push({ entitlement, email });
  }

  return ok({
    ...request,
    admins: unique,
    address: shape.data,
    timeZone,
    entitlements,
    administrators,
  });
}
