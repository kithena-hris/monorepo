import { outboxTable } from '@kithena/db-kit';

/**
 * The `timeoff` schema, as Drizzle sees it. Hand-written, as People's is: the
 * migrations are the source of truth, and the integration tests read through
 * these definitions against the real migrations so the two cannot drift.
 */
export const outbox = outboxTable('timeoff');
