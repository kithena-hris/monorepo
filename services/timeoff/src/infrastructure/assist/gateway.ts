import {
  aiGateway,
  createPolicyRegistry,
  type AiGateway,
  type ModelTransport,
} from '@kithena/telemetry';

import { DENIED } from '../../application/assist/denied.js';

/**
 * Time Off's door to a model: the AI gateway (`@kithena/telemetry`), as
 * People's assistant uses it, with Time Off's own refusals loaded for every
 * tenant.
 *
 * Time Off defines no fields per tenant, so the registry would know nothing a
 * tenant set and refuse it as unloaded. Instead every tenant gets the same
 * list, `DENIED`: the keys and words that would mean health data or somebody's
 * identity had reached a prompt. A prompt carrying one of these keys at any
 * depth, or naming one of these words in its text, is refused whole and the
 * caller's template is shown. The features never build such a prompt (each
 * has a test saying so); this is the second lock.
 */

/** A gateway over `send` that refuses Time Off's denied keys and words for any tenant. */
export function timeOffGateway(send: ModelTransport): AiGateway {
  const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
  const gateway = aiGateway({ registry, send });
  return {
    complete(tenantId, prompt, subjects) {
      if (!registry.isLoaded(tenantId)) registry.replace(tenantId, DENIED);
      return gateway.complete(tenantId, prompt, subjects);
    },
  };
}
