import type { FieldPolicy } from '@kithena/contracts';
import type { Logger } from 'pino';

import { aiDenyPaths } from './generated/ai-deny.js';
import { redactionPaths } from './generated/redaction.js';

/**
 * The runtime half of the classification registry.
 *
 * `just codegen` walks the static Zod registry and emits the redaction paths
 * and the AI deny list. An attribute a customer created on a Tuesday afternoon
 * is not in that walk, and the guarantee the walk makes has to survive it. So
 * every derived artifact here is the **union** of the static generated set and
 * a per-tenant set that the owning module loads at boot and replaces when its
 * schema is published.
 *
 * Per tenant, not merged into one global set. A process serves many tenants,
 * and one tenant's field names are not another's business, even as redaction
 * paths. The union is static ∪ this tenant, never static ∪ every tenant.
 *
 * **An unknown tenant fails closed.** A tenant this registry has not loaded
 * gets `unknownTenantRedaction` on top of the static set, and the AI gateway
 * refuses its prompts outright. Not knowing a tenant's fields is not evidence
 * that it has none.
 */

/** One tenant-defined field, as the owning module's registry classifies it. */
export interface TenantField {
  /** A slug, `^[a-z][a-z0-9_]*$`. Anything else is a bug upstream. */
  readonly key: string;
  readonly policy: FieldPolicy;
  /** An encrypted value is redacted whatever its classification says. */
  readonly encrypted?: boolean;
}

interface TenantSet {
  readonly redact: readonly string[];
  readonly denyAi: ReadonlySet<string>;
}

export interface PolicyRegistryOptions {
  /** Defaults to the generated set. Overridable so a test can see the union. */
  readonly staticRedaction?: readonly string[];
  readonly staticAiDeny?: readonly string[];
  /** Redacted for a tenant that has not been loaded. Required: there is no safe default. */
  readonly unknownTenantRedaction: readonly string[];
}

const KEY = /^[a-z][a-z0-9_]*$/;

/**
 * The paths that catch `key` wherever a log line nests it, four levels deep.
 *
 * A log object is not a fixed shape — `{ custom: { religion } }`,
 * `{ person: { custom: { religion } } }`, `{ changes: [{ religion }] }` — and
 * Pino's redaction has no recursive wildcard. Four levels is every shape this
 * codebase logs; over-redacting a same-named key elsewhere is the cheap side
 * of that trade.
 *
 * `ponytail: fixed depth. A value logged five levels down is not caught; move
 * to a serializer walk if a caller ever nests that far.`
 */
function anywhere(key: string): readonly string[] {
  return [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`];
}

export interface PolicyRegistry {
  /**
   * Replace everything known about one tenant, atomically.
   *
   * Called at boot and on `people.schema.published`. Replace rather than
   * merge: a field whose classification was loosened must stop being treated
   * as the old one, and a merge would keep it forever.
   */
  replace(tenantId: string, fields: readonly TenantField[]): void;
  isLoaded(tenantId: string): boolean;
  /** Static ∪ this tenant. For an unloaded tenant, static ∪ the fail-closed set. */
  redactionPaths(tenantId: string): readonly string[];
  /** Static deny paths, and this tenant's denied keys. Undefined for an unloaded tenant. */
  aiDenied(tenantId: string): { readonly paths: ReadonlySet<string>; readonly keys: ReadonlySet<string> } | undefined;
  /**
   * A logger that redacts this tenant's union.
   *
   * Cached per tenant, and dropped by `replace`, so a publish takes effect on
   * the next call without a restart and without recompiling redaction per log
   * line.
   */
  loggerFor(base: Logger, tenantId: string): Logger;
}

export function createPolicyRegistry(options: PolicyRegistryOptions): PolicyRegistry {
  const staticRedaction = options.staticRedaction ?? redactionPaths;
  const staticDeny: ReadonlySet<string> = new Set(options.staticAiDeny ?? aiDenyPaths);
  const tenants = new Map<string, TenantSet>();
  const loggers = new Map<string, { base: Logger; logger: Logger }>();

  function redactionPathsFor(tenantId: string): readonly string[] {
    const tenant = tenants.get(tenantId);
    const extra = tenant ? tenant.redact : options.unknownTenantRedaction;
    return [...new Set([...staticRedaction, ...extra])];
  }

  return {
    replace(tenantId, fields) {
      const redact: string[] = [];
      const denyAi = new Set<string>();

      for (const field of fields) {
        // Throwing is for bugs, and this is one: a key that is not a slug
        // would be compiled into a redaction path, and a malformed path makes
        // Pino throw on every log line for this tenant.
        if (!KEY.test(field.key)) throw new Error(`not an attribute key: ${JSON.stringify(field.key)}`);

        const sensitive =
          field.policy.classification === 'confidential' ||
          field.policy.classification === 'special-category' ||
          field.encrypted === true;
        if (sensitive) redact.push(...anywhere(field.key));
        if (!field.policy.aiEligible) denyAi.add(field.key);
      }

      tenants.set(tenantId, { redact, denyAi });
      loggers.delete(tenantId);
    },

    isLoaded: (tenantId) => tenants.has(tenantId),

    redactionPaths: redactionPathsFor,

    aiDenied(tenantId) {
      const tenant = tenants.get(tenantId);
      return tenant ? { paths: staticDeny, keys: tenant.denyAi } : undefined;
    },

    loggerFor(base, tenantId) {
      const cached = loggers.get(tenantId);
      if (cached?.base === base) return cached.logger;

      const logger = base.child(
        { tenantId },
        { redact: { paths: [...redactionPathsFor(tenantId)], censor: '[redacted]' } },
      );
      // Only a loaded tenant is cached. An unloaded one is asked again next
      // time, so the fail-closed set gives way the moment its load lands.
      if (tenants.has(tenantId)) loggers.set(tenantId, { base, logger });
      return logger;
    },
  };
}

/**
 * The process's registry.
 *
 * `custom` is where a tenant-defined value lives on a person row, so a tenant
 * nobody has loaded yet has that whole bag redacted rather than none of it.
 */
export const tenantPolicies: PolicyRegistry = createPolicyRegistry({
  unknownTenantRedaction: anywhere('custom'),
});
