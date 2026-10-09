import { sql } from 'drizzle-orm';

import type { InboxNotifier } from '../application/inbox/notify.js';
import type { OrgStore } from '../application/org/org.js';
import type { PeopleService } from '../application/person/service.js';
import { logger } from '@kithena/telemetry';
import { tenantCompanies } from './tenant-origin.js';

/**
 * The Inbox's email, through messaging's notice endpoint with People's token
 * (`MESSAGING_URL`, `MESSAGING_PEOPLE_TOKEN`), to a company's own origin
 * (`TENANT_APP_BASE`). The recipient's address and account are read here, in
 * their tenant; messaging follows the account's notification settings.
 */
export function inboxNotifierFrom(
  env: NodeJS.ProcessEnv,
  service: Pick<PeopleService, 'inTenant'>,
  org: Pick<OrgStore, 'settings'>,
  base: string | null,
): InboxNotifier | undefined {
  const url = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  if (!url || !token || base === null) {
    logger.info(
      'MESSAGING_URL, MESSAGING_PEOPLE_TOKEN or the tenant app base unset; no Inbox email',
    );
    return undefined;
  }
  const endpoint = new URL('/api/internal/messaging/notice', url).toString();
  const companyOf = tenantCompanies(base, org);
  return {
    async notify(tenantId, to, notice, itemPath, dedupeKey) {
      const found = await service.inTenant(tenantId, async ({ tx }) => {
        const rows = await tx.execute<{ work_email: string | null; account: string | null }>(
          'personId' in to
            ? sql`SELECT work_email, identity_account_id::text AS account FROM people.person
                   WHERE tenant_id = ${tenantId}::uuid AND id = ${to.personId}::uuid`
            : sql`SELECT work_email, identity_account_id::text AS account FROM people.person
                   WHERE tenant_id = ${tenantId}::uuid AND identity_account_id = ${to.accountId}::uuid
                   LIMIT 1`,
        );
        const [row] = [...rows];
        return { row, company: await companyOf(tx, tenantId) };
      });
      const email = found.row?.work_email;
      if (email == null || email === '' || found.company === null) return;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({
          tenantId,
          email,
          ...(found.row?.account == null ? {} : { accountId: found.row.account }),
          url: new URL(itemPath, found.company.origin).toString(),
          companyName: found.company.name,
          dedupeKey,
          notice,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, kind: notice.kind },
          'messaging refused an Inbox notice',
        );
      }
    },
  };
}
