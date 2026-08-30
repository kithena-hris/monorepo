import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { PostalAddress, ThemeId, checkAddress } from '@kithena/contracts';

import { imageIsOurs, type ImageHostPolicy } from './image-host.js';
import { DisplayNameMissing, ImageNotOurs, ThemeUnknown } from './provision.js';

/**
 * Changing what we hold about a company that already exists.
 *
 * Separate from `ProvisionRequest` rather than a partial of it, because the two
 * differ in the field that matters: **there is no slug here.** The label is the
 * hostname people sign in on, it is baked into every enrolment link already
 * sent, and the authorization request's redirect URI is validated against it.
 * Renaming it is a migration with a redirect and a grace period, not a text
 * input on an edit form, and the way to keep it from becoming one by accident
 * is for the request to have nowhere to put it.
 *
 * The admin list is absent for a different reason: accounts are created and
 * revoked through their own operations, which raise their own events. An edit
 * form that also silently replaced the set of administrators would be a way to
 * lock a company out with no record of having done it.
 */
export interface AmendRequest {
  readonly displayName: string;
  readonly themeId: string;
  readonly logoUrl: string | null;
  readonly coverImageUrl: string | null;
  /** Whether the mark may appear on a page nobody has authenticated to. */
  readonly brandingPublic: boolean;
  readonly address: PostalAddress;
}

/**
 * Whether this change may be written.
 *
 * Every rule `checkProvisionable` applies to the fields that survive into an
 * edit is applied again here, deliberately and by sharing the same predicates
 * rather than restating them. A validation that runs once at creation is a
 * validation an edit form is free to walk straight past, and the blob-host rule
 * in particular exists to stop a login page rendering an image somebody else
 * controls — a rule worth nothing if it only holds on day one.
 */
export function checkAmendable(
  request: AmendRequest,
  images: ImageHostPolicy,
): Result<AmendRequest> {
  const displayName = request.displayName.trim();
  if (displayName === '') return err(DisplayNameMissing);

  if (!ThemeId.safeParse(request.themeId).success) return err(ThemeUnknown);

  if (!imageIsOurs(request.logoUrl, images) || !imageIsOurs(request.coverImageUrl, images)) {
    return err(ImageNotOurs);
  }

  const shape = PostalAddress.safeParse(request.address);
  if (!shape.success) {
    const field = shape.error.issues[0]?.path.join('.') ?? 'address';
    return err(
      failure('ADDRESS_INVALID', shape.error.issues[0]?.message ?? 'That address is not usable', [
        `address.${field}`,
      ]),
    );
  }

  const problems = checkAddress(shape.data);
  const first = problems[0];
  if (first) {
    return err(failure('ADDRESS_INVALID', first.message, [`address.${first.field}`]));
  }

  return ok({ ...request, displayName, address: shape.data });
}
