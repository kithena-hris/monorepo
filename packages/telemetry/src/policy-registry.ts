import type { FieldPolicy } from '@kithena/contracts';
import pino, { type Logger } from 'pino';

import { aiDenyPaths } from './generated/ai-deny.js';
import { redactionPaths } from './generated/redaction.js';
import { CENSOR, redactKeys } from './redact-keys.js';

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
  /**
   * What people call it, in every locale the tenant labelled it in. The AI
   * gateway refuses free text naming a denied field when it cannot check
   * values, and a person writes "religion", not `religion_v2`.
   */
  readonly labels?: readonly string[];
}

interface TenantSet {
  readonly redact: ReadonlySet<string>;
  readonly denyAi: ReadonlySet<string>;
  readonly denyAiNames: readonly string[];
}

/** What the AI gateway checks a prompt against. */
export interface AiDenied {
  /** Static contract paths, matched exactly. */
  readonly paths: ReadonlySet<string>;
  /** This tenant's `aiEligible: false` keys, matched at any depth. */
  readonly keys: ReadonlySet<string>;
  /** Those keys and their labels, for the free-text check when no subject is named. */
  readonly names: readonly string[];
}

export interface PolicyRegistryOptions {
  /** Defaults to the generated set. Overridable so a test can see the union. */
  readonly staticRedaction?: readonly string[];
  readonly staticAiDeny?: readonly string[];
  /**
   * Keys redacted at any depth for a tenant that has not been loaded.
   * Required: there is no safe default.
   */
  readonly unknownTenantRedaction: readonly string[];
}

const KEY = /^[a-z][a-z0-9_]*$/;

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
  /** The static paths, which Pino compiles. The same for every tenant. */
  redactionPaths(tenantId: string): readonly string[];
  /** This tenant's sensitive keys, redacted at any depth. For an unloaded tenant, the fail-closed set. */
  redactionKeys(tenantId: string): ReadonlySet<string>;
  /** Undefined for an unloaded tenant. */
  aiDenied(tenantId: string): AiDenied | undefined;
  /**
   * A logger that redacts this tenant's union: the static paths through
   * Pino, and this tenant's keys at any depth through `redactKeys`, on every
   * line and on the bindings of every child it makes.
   *
   * Cached per tenant, and dropped by `replace`, so a publish takes effect on
   * the next call without a restart and without rebuilding anything per log
   * line.
   */
  loggerFor(base: Logger, tenantId: string): Logger;
}

export function createPolicyRegistry(options: PolicyRegistryOptions): PolicyRegistry {
  const staticRedaction = options.staticRedaction ?? redactionPaths;
  const staticDeny: ReadonlySet<string> = new Set(options.staticAiDeny ?? aiDenyPaths);
  const unknownKeys: ReadonlySet<string> = new Set(options.unknownTenantRedaction);
  const tenants = new Map<string, TenantSet>();
  const loggers = new Map<string, { base: Logger; logger: Logger }>();

  const redactionKeysFor = (tenantId: string): ReadonlySet<string> =>
    tenants.get(tenantId)?.redact ?? unknownKeys;

  return {
    replace(tenantId, fields) {
      const redact = new Set<string>();
      const denyAi = new Set<string>();
      const denyAiNames = new Set<string>();

      for (const field of fields) {
        // Throwing is for bugs, and this is one: the owning module validates
        // keys as slugs, so anything else means that validation was bypassed.
        if (!KEY.test(field.key)) throw new Error(`not an attribute key: ${JSON.stringify(field.key)}`);

        const sensitive =
          field.policy.classification === 'confidential' ||
          field.policy.classification === 'special-category' ||
          field.encrypted === true;
        if (sensitive) redact.add(field.key);
        if (!field.policy.aiEligible) {
          denyAi.add(field.key);
          denyAiNames.add(field.key);
          for (const label of field.labels ?? []) denyAiNames.add(label);
        }
      }

      tenants.set(tenantId, { redact, denyAi, denyAiNames: [...denyAiNames] });
      loggers.delete(tenantId);
    },

    isLoaded: (tenantId) => tenants.has(tenantId),

    redactionPaths: () => staticRedaction,

    redactionKeys: redactionKeysFor,

    aiDenied(tenantId) {
      const tenant = tenants.get(tenantId);
      return tenant ? { paths: staticDeny, keys: tenant.denyAi, names: tenant.denyAiNames } : undefined;
    },

    loggerFor(base, tenantId) {
      const cached = loggers.get(tenantId);
      if (cached?.base === base) return cached.logger;

      const logger = redactingChild(base, tenantId, staticRedaction, redactionKeysFor(tenantId));
      // Only a loaded tenant is cached. An unloaded one is asked again next
      // time, so the fail-closed set gives way the moment its load lands.
      if (tenants.has(tenantId)) loggers.set(tenantId, { base, logger });
      return logger;
    },
  };
}

/**
 * A child of `base` that redacts `keys` at any depth, on every line.
 *
 * Pino calls `formatters.log` on each merge object before it serializes, so
 * that is where the walk goes; it composes with whatever `base` already does
 * there (trace ids), and Pino's own path redaction still runs on the result
 * for the static set, set on the child so it holds whatever `base` was built
 * with.
 *
 * Child bindings are serialized once, when the child is made, and Pino never
 * shows them to `formatters.log`. So `child` is wrapped here, and because Pino
 * builds a child with `Object.create(parent)`, every descendant inherits the
 * wrapper. A descendant that brings its own `formatters.log` keeps it, with
 * the walk run after it.
 */
function redactingChild(
  base: Logger,
  tenantId: string,
  paths: readonly string[],
  keys: ReadonlySet<string>,
): Logger {
  const scrub = <T>(object: T): T => redactKeys(object, keys);
  // Pino keeps formatters behind a symbol it exports for exactly this.
  const inherited = Reflect.get(base, pino.symbols.formattersSym) as
    | { log?: (o: object) => object }
    | undefined;
  const baseLog = inherited?.log ?? ((o: object) => o);

  const logger = base.child(
    { tenantId },
    {
      redact: { paths: [...paths], censor: CENSOR },
      formatters: { log: (o) => baseLog(scrub(o)) },
    },
  );
  // Unbound on purpose: it is called with each descendant as `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const makeChild = logger.child;

  logger.child = function child(this: Logger, bindings, options) {
    const own = options?.formatters?.log;
    const wrapped = own
      ? { ...options, formatters: { ...options.formatters, log: (o: object) => scrub(own(o)) } }
      : options;
    return makeChild.call(this, scrub(bindings), wrapped);
  } as Logger['child'];
  return logger;
}

/**
 * The process's registry.
 *
 * `custom` is where a tenant-defined value lives on a person row, so a tenant
 * nobody has loaded yet has that whole bag redacted rather than none of it.
 */
export const tenantPolicies: PolicyRegistry = createPolicyRegistry({
  unknownTenantRedaction: ['custom'],
});
