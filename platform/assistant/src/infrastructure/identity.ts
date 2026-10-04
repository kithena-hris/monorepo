import { AssistantAsker } from '@kithena/contracts';
import { err, ok } from '@kithena/domain-kit';
import { logger as base, type Logger } from '@kithena/telemetry';

import type { AskerKey, AskerLookup, Identity } from '../application/ports.js';

/**
 * Who is asking, from identity (assistant PRD §6.6, §10.1):
 * `POST {IDENTITY_URL}/api/internal/tenants/<id>/assistant/asker` with
 * `ASSISTANT_IDENTITY_TOKEN`, the body a chat app's `{ email }` or the web's
 * `{ accountId }`. A 404 is nobody to answer — none, several, or
 * access ended, which identity does not say — and anything else, including no
 * identity configured, is identity unreachable.
 *
 * Kept 60 s per tenant and email or account, so a burst of questions is one call and an
 * ended access takes effect within a minute. Only a found asker is kept.
 */

type Settings = Readonly<Record<string, string | undefined>>;

export interface IdentityOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
}

const CACHE_MS = 60_000;

export function identityFrom(settings: Settings, options: IdentityOptions = {}): Identity {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.logger ?? base;
  const url = settings['IDENTITY_URL']?.replace(/\/$/u, '');
  const token = settings['ASSISTANT_IDENTITY_TOKEN'];
  if (!url || !token) log.info('identity not configured for the assistant; nobody can be found');
  const cache = new Map<string, { readonly at: number; readonly found: AskerLookup }>();

  return {
    async asker(tenantId, who: AskerKey) {
      if (!url || !token) return err('UNREACHABLE');
      const key =
        'email' in who
          ? `${tenantId}:email:${who.email.toLowerCase()}`
          : `${tenantId}:account:${who.accountId}`;
      const kept = cache.get(key);
      if (kept !== undefined && now() - kept.at < CACHE_MS) return kept.found;
      try {
        const response = await send(
          `${url}/api/internal/tenants/${encodeURIComponent(tenantId)}/assistant/asker`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-token': token },
            body: JSON.stringify(who),
            signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
          },
        );
        if (response.status === 404) return err('NOT_FOUND');
        if (response.status !== 200) {
          log.warn({ status: response.status }, 'identity refused the asker lookup');
          return err('UNREACHABLE');
        }
        const parsed = AssistantAsker.safeParse(await response.json());
        if (!parsed.success) {
          log.warn('identity answered the asker lookup outside its contract');
          return err('UNREACHABLE');
        }
        const found = ok(parsed.data);
        cache.set(key, { at: now(), found });
        return found;
      } catch (error) {
        log.warn({ reason: (error as Error).name }, 'identity unreachable');
        return err('UNREACHABLE');
      }
    },
  };
}
