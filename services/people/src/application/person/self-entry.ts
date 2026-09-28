import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { PersonAccess } from './person-access.js';
import type { PersonReader } from './ports.js';

/**
 * Values a person entered about themselves somewhere else — identity's
 * sign-up and recovery page — written as their own entry.
 *
 * Through `PersonAccess.update` with the person as the viewer, so every rule
 * a profile edit meets applies here too, and none is restated: ownership (an
 * employee writes only what they own), mirror mode (an attribute an upstream
 * system owns is refused with its owner named, PEO-073), approvals (a field
 * that requires one is held as a pending change, never applied, PEO-077),
 * validation against the schema in force, effective dating (today on their
 * calendar) and the audit trail (a history row and `profile_updated`, the
 * actor being the person's own account).
 *
 * Only what differs from the record is written, so a form that echoed back
 * the name on file changes nothing and records nothing.
 */
export type EnterAsSelf = (
  tx: PostgresJsDatabase,
  entry: {
    readonly tenantId: string;
    readonly accountId: string;
    readonly correlationId: string;
    readonly values: Readonly<Record<string, unknown>>;
  },
) => Promise<SelfEntryOutcome>;

export type SelfEntryOutcome =
  /** Written, or held for approval, or both. */
  | { readonly kind: 'entered'; readonly held: readonly string[] }
  /** Everything already said so. */
  | { readonly kind: 'unchanged' }
  /** No person for this account yet, or no schema published: nothing to write through. */
  | { readonly kind: 'not_ready' }
  /** A rule refused it; the code says which. Nothing was written. */
  | { readonly kind: 'refused'; readonly code: string };

export function enterAsSelf(access: PersonAccess, reader: PersonReader): EnterAsSelf {
  return async (tx, entry) => {
    const personId = await reader.personOf(tx, entry.tenantId, entry.accountId);
    if (personId === null) return { kind: 'not_ready' };

    const asking = {
      tenantId: entry.tenantId,
      correlationId: entry.correlationId,
      viewer: { accountId: entry.accountId, roles: new Set<string>() },
      personId,
    };
    const current = await access.read(tx, asking);
    if (!current.ok) {
      return current.error.code === 'SCHEMA_NOT_PUBLISHED'
        ? { kind: 'not_ready' }
        : { kind: 'refused', code: current.error.code };
    }

    const changes = Object.fromEntries(
      Object.entries(entry.values).filter(
        ([key, value]) => (current.value.attributes[key] ?? null) !== value,
      ),
    );
    if (Object.keys(changes).length === 0) return { kind: 'unchanged' };

    const written = await access.update(tx, { ...asking, changes });
    if (!written.ok) {
      return written.error.code === 'SCHEMA_NOT_PUBLISHED'
        ? { kind: 'not_ready' }
        : { kind: 'refused', code: written.error.code };
    }
    return { kind: 'entered', held: (written.value.held ?? []).map((h) => h.attributeKey) };
  };
}
