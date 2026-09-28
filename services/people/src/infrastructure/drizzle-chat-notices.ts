import { sql } from 'drizzle-orm';

import type { ChatNoticeStore } from '../application/settings/chat-port.js';

/** `people.chat_notice`: a row is a notice switched on for chat apps. */
export function drizzleChatNotices(): ChatNoticeStore {
  return {
    async enabled(tx, tenantId) {
      const rows = await tx.execute<{ event: string }>(sql`
        SELECT event FROM people.chat_notice WHERE tenant_id = ${tenantId}::uuid`);
      return new Set([...rows].map((r) => r.event));
    },
    async set(tx, tenantId, change) {
      await (change.on
        ? tx.execute(sql`
            INSERT INTO people.chat_notice (tenant_id, event, enabled_by, enabled_at)
            VALUES (${tenantId}::uuid, ${change.event}, ${change.by}::uuid, ${change.at}::timestamptz)
            ON CONFLICT DO NOTHING`)
        : tx.execute(sql`
            DELETE FROM people.chat_notice
             WHERE tenant_id = ${tenantId}::uuid AND event = ${change.event}`));
    },
  };
}
