import {
  allCapabilities,
  RuntimeCatalogue,
  type Capability,
  type CapabilityInput,
  type ModuleKey,
} from '@kithena/contracts';
import { err, ok } from '@kithena/domain-kit';
import { logger as base, type Logger } from '@kithena/telemetry';

import type { Modules, Principal } from '../application/ports.js';
import type { CallOutcome } from '../domain/execute.js';

/**
 * The modules, over their capability routes (assistant PRD §6.5, §8.6, §10.2).
 *
 * A module is reachable where the assistant has `<MODULE>_URL` and
 * `ASSISTANT_<MODULE>_TOKEN`; without both it is absent, said once at boot.
 * Every request carries the pair token, the asker as the router would forward
 * them — a web question's support or view-as session unchanged — and the
 * question's correlation id, and gets 4 s. What comes back is parsed with the
 * contract: anything else is a module that did not answer. A 403 is the
 * module saying no, in its own words, and is never retried.
 *
 * The catalogue is kept 60 s per tenant, account, session and module: field names and
 * option labels, never a value. A capability served at a major version the
 * assistant was not built against is dropped from it, and said once.
 *
 * Nothing logged here carries a word of the question or of an answer: the
 * module, the capability, a status.
 */

type Settings = Readonly<Record<string, string | undefined>>;

interface Endpoint {
  readonly url: string;
  readonly token: string;
}

export interface ModulesOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: Logger;
  /** Each request's deadline; 4 s. */
  readonly timeoutMs?: number;
}

const CACHE_MS = 60_000;
const PINNED = new Map(allCapabilities.map((c) => [c.name, c.version]));
const SERVING: readonly ModuleKey[] = [...new Set(allCapabilities.map((c) => c.module))];

/** The response's JSON, or undefined where there is none to read. */
const json = (response: Response): Promise<unknown> => response.json().catch(() => undefined);

/** A module's refusal in its own words (`{ error: { message } }`), or a plain one. */
function refusalOf(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === 'string' ? message : 'You can’t see that here.';
}

export function modulesFrom(settings: Settings, options: ModulesOptions = {}): Modules {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.logger ?? base;
  const timeoutMs = options.timeoutMs ?? 4_000;

  const endpoints = new Map<ModuleKey, Endpoint>();
  for (const module of SERVING) {
    const name = module.toUpperCase();
    const url = settings[`${name}_URL`]?.replace(/\/$/u, '');
    const token = settings[`ASSISTANT_${name}_TOKEN`];
    if (url && token) endpoints.set(module, { url, token });
    else log.info({ module }, 'module not configured for the assistant; treated as absent');
  }

  const cache = new Map<string, { readonly at: number; readonly catalogue: RuntimeCatalogue }>();
  const unpinned = new Set<string>();

  const headers = (endpoint: Endpoint, as: Principal, correlationId: string) => ({
    'content-type': 'application/json',
    'x-internal-token': endpoint.token,
    'x-kithena-principal': JSON.stringify({
      userId: as.userId,
      tenantId: as.tenantId,
      entitlements: as.entitlements,
      impersonatedBy: as.impersonatedBy,
      viewedBy: as.viewedBy,
    }),
    'x-correlation-id': correlationId,
  });

  return {
    configured: [...endpoints.keys()],

    async catalogue(module, as, correlationId) {
      const endpoint = endpoints.get(module);
      if (endpoint === undefined) return null;
      const key = `${as.tenantId}:${as.userId}:${String(as.impersonatedBy)}:${String(as.viewedBy)}:${module}`;
      const kept = cache.get(key);
      if (kept !== undefined && now() - kept.at < CACHE_MS) return kept.catalogue;
      try {
        const response = await send(`${endpoint.url}/internal/capabilities`, {
          headers: headers(endpoint, as, correlationId),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 403) return { refused: refusalOf(await json(response)) };
        if (response.status !== 200) {
          log.warn({ module, status: response.status, correlationId }, 'catalogue refused');
          return null;
        }
        const parsed = RuntimeCatalogue.safeParse(await json(response));
        if (!parsed.success || parsed.data.module !== module) {
          log.warn({ module, correlationId }, 'catalogue outside its contract');
          return null;
        }
        const serves = parsed.data.serves.filter(({ name, version }) => {
          if (PINNED.get(name) === version) return true;
          if (!unpinned.has(`${name}@${String(version)}`)) {
            unpinned.add(`${name}@${String(version)}`);
            log.warn(
              { module, capability: name, version },
              'capability version not pinned; absent',
            );
          }
          return false;
        });
        const catalogue = { ...parsed.data, serves };
        cache.set(key, { at: now(), catalogue });
        return catalogue;
      } catch (error) {
        log.warn({ module, correlationId, reason: (error as Error).name }, 'catalogue unreachable');
        return null;
      }
    },

    async call(capability: Capability, input: CapabilityInput, as, correlationId, signal) {
      const { module, name } = capability;
      const endpoint = endpoints.get(module);
      if (endpoint === undefined) return err({ code: 'UNREACHABLE' });
      const failed = (why: string, extra: object = {}): CallOutcome => {
        log.warn({ module, capability: name, correlationId, ...extra }, why);
        return err({ code: 'UNREACHABLE' });
      };
      try {
        const response = await send(`${endpoint.url}/internal/capabilities/${name}`, {
          method: 'POST',
          headers: headers(endpoint, as, correlationId),
          body: JSON.stringify(input),
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
        const body = await json(response);
        if (response.status === 403) return err({ code: 'REFUSED', message: refusalOf(body) });
        if (response.status !== 200)
          return failed('capability refused', { status: response.status });
        const parsed = capability.schemas.output.safeParse(body);
        return parsed.success
          ? ok(parsed.data)
          : failed('capability answered outside its contract');
      } catch (error) {
        return failed('capability unreachable', { reason: (error as Error).name });
      }
    },
  };
}
