import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { requestable, REQUEST_AGAIN_AFTER_MS } from '../../domain/person/detail-request.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ScreenDeps } from './record.js';

export type { DetailRequest, DetailRequestStore } from './record.js';

/**
 * "Ask them for it": HR or a manager asks somebody for an empty detail of
 * theirs, from the button beside it on their profile.
 *
 * Recorded, one row per person and field in `people.detail_request`, so the
 * profile can say it was asked for and the person sees what they were asked
 * for; then the person is emailed, after the commit, through the reminder's
 * notice. Pressing it again within a day records it and sends nothing, so a
 * button pressed twice is not two emails.
 */

export async function requestDetails(
  deps: ScreenDeps,
  asking: Asking,
  personId: string,
  keys: readonly string[],
): Promise<Result<{ readonly asked: readonly string[]; readonly emailed: boolean }>> {
  const requests = deps.requests;
  if (requests === undefined) {
    return err(failure('UNAVAILABLE', 'Asking for details is not available here'));
  }
  const unique = [...new Set(keys)];
  const recorded = await run(deps.service, asking.tenantId, async (tx) => {
    // Somebody the viewer may not read is not found, as everywhere else.
    const read = await deps.service.access.read(tx, { ...asking, personId });
    if (!read.ok) return read;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, personId);
    const allowed = requestable(version.document.attributes, unique, relations);
    if (!allowed.ok) return allowed;
    const email = read.value.attributes['work_email'];
    const now = deps.clock.now();
    const fresh = await requests.store.record(tx, {
      tenantId: asking.tenantId,
      personId,
      keys: unique,
      requestedBy: asking.viewer.accountId,
      requestedAt: now.toISOString(),
      resendBefore: new Date(now.getTime() - REQUEST_AGAIN_AFTER_MS).toISOString(),
    });
    const company =
      fresh.length === 0 || requests.company === undefined
        ? null
        : await requests.company(tx, asking.tenantId);
    return ok({ fresh, company, email: typeof email === 'string' ? email : null, now });
  });
  if (!recorded.ok) return recorded;

  const { fresh, company, email, now } = recorded.value;
  let emailed = false;
  if (requests.mailer !== undefined && company !== null && email !== null && fresh.length > 0) {
    // After the commit: a lost email loses the nudge, never the request.
    emailed = await requests.mailer
      .send(asking.tenantId, company, { personId, workEmail: email, keys: fresh, remindedAt: now })
      .then(
        () => true,
        () => false,
      );
  }
  return ok({ asked: unique, emailed });
}
