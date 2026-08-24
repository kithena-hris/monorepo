import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { DeliveryLog, DeliveryStatus } from '../application/delivery-log.js';
import { delivery } from './delivery-table.js';

/**
 * The delivery log, in Postgres.
 *
 * Both methods run inside a tenant-scoped transaction, because
 * `messaging.delivery` carries row-level security with FORCE and
 * `svc_messaging` does not bypass it. Written on a bare connection the insert
 * is refused with 42501; read on one it returns nothing at all, which is a
 * wrong answer rather than an error and therefore the worse of the two.
 */
export function drizzleDeliveryLog(
  inTenantTransaction: <T>(
    tenantId: string,
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ) => Promise<T>,
  /**
   * Finding the tenant a provider's message belonged to.
   *
   * A webhook arrives with a message id and no tenant, because the provider has
   * never heard of our tenants — so the lookup has to cross every one of them,
   * which is exactly what the policy forbids. `messaging.delivery_tenant_of` is
   * a SECURITY DEFINER function scoped to that one question; see the migration
   * for why it is shaped the way it is. Supplied here rather than reached for,
   * so this adapter has one way in.
   */
  tenantOfMessage: (provider: string, messageId: string) => Promise<string | null>,
): DeliveryLog {
  return {
    async record(input) {
      return inTenantTransaction(input.tenantId, async (tx) => {
        const [row] = await tx
          .insert(delivery)
          .values({
            id: sql`gen_random_uuid()`,
            tenantId: input.tenantId,
            kind: input.kind,
            toEmail: input.to,
            provider: input.provider,
            providerMessageId: input.providerMessageId,
            status: input.status,
            reason: input.reason,
            createdAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .returning({ id: delivery.id });

        return row?.id ?? null;
      });
    },

    async settle(input) {
      const tenantId = await tenantOfMessage(input.provider, input.providerMessageId);
      // Not an error. A provider replays events, and one naming a message from
      // before this table existed is a fact about our history rather than a
      // failure — and one naming a message that was never ours is a webhook
      // pointed at the wrong deployment, which is also not ours to fix.
      if (tenantId === null) return false;

      return inTenantTransaction(tenantId, async (tx) => {
        /*
         * `status <> 'delivered'` is what stops an event going backwards.
         *
         * Providers do not guarantee order. A `delivered` arriving after a
         * `delivery_delayed` is the normal case, and applying them in the order
         * they land would leave a message that reached the mailbox recorded as
         * still in trouble. Terminal-and-good wins; a bounce after a delivery
         * cannot happen for the same message.
         */
        const updated = await tx.execute(sql`
          UPDATE messaging.delivery
             SET status = ${input.status},
                 reason = ${input.reason},
                 updated_at = now()
           WHERE provider = ${input.provider}
             AND provider_message_id = ${input.providerMessageId}
             AND status <> 'delivered'
          RETURNING id
        `);

        return [...updated].length > 0;
      });
    },
  };
}

/** The statuses a provider event maps onto. Exported for the route that maps them. */
export const TERMINAL: readonly DeliveryStatus[] = ['delivered', 'bounced', 'complained'];
