import { err, ok, failure, type Result } from '@kithena/domain-kit';

import { checkAmendable, type AmendRequest } from '../domain/amend.js';
import type { ImageHostPolicy } from '../domain/image-host.js';

export const TenantUnknown = failure('TENANT_UNKNOWN', 'There is no such company', ['id']);

export interface AmendTenantDeps {
  /**
   * Hosts an uploaded image may be served from.
   *
   * Configuration rather than a literal in the rule: the rule is "ours or
   * nothing", and which host is ours is a deployment decision. See
   * `ImageHostPolicy`.
   */
  readonly images: ImageHostPolicy;
  /**
   * Writes the change and reports whether there was a row to change.
   *
   * `false` rather than a throw for a missing company: an operator following a
   * stale link is an ordinary outcome with an ordinary answer, and it should
   * not arrive here as an exception the route has to unpick.
   */
  readonly write: (tenantId: string, change: AmendRequest) => Promise<boolean>;
}

export type AmendTenant = (
  tenantId: string,
  request: AmendRequest,
) => Promise<Result<AmendRequest>>;

/**
 * Editing a company, checked before it is written.
 *
 * Thin on purpose. Everything that can be decided without the database is
 * decided in `checkAmendable`, and the one thing that cannot — whether the
 * company still exists — is decided by the write itself rather than by a read
 * beforehand. A `SELECT` then an `UPDATE` is a check-then-act with a gap in the
 * middle, and the `UPDATE`'s own row count answers the same question with no
 * gap at all.
 *
 * No event is raised. Nothing downstream consumes a company's postal address or
 * its accent colour, and a `tenant.amended` event with no subscriber is a
 * contract to keep for nobody. When a module needs one, it gets one — with a
 * classification policy per field, like every other event.
 */
export function amendTenant({ write, images }: AmendTenantDeps): AmendTenant {
  return async (tenantId, request) => {
    const checked = checkAmendable(request, images);
    if (!checked.ok) return checked;

    const written = await write(tenantId, checked.value);
    if (!written) return err(TenantUnknown);

    return ok(checked.value);
  };
}
