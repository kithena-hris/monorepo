import { createHmac, timingSafeEqual } from 'node:crypto';
import { ok } from '@kithena/domain-kit';

import type { Webhooks } from '../application/ports.js';
import { egressPolicyFrom, pinnedPoster, vet } from './egress.js';

/**
 * Outbound webhooks (PRF-058): the signing, People's byte for byte
 * (`services/people/src/infrastructure/webhooks/payload.ts`), so an
 * integrator verifies every module with one function: `kithena-signature:
 * v1=<hex>` per live secret, HMAC-SHA256 over the raw body, both secrets while
 * a rotation overlaps. Copied, as Time Off and Recruiting copy it: there is no
 * package for it, and a module does not import another.
 *
 * An endpoint's secret is not stored. It is derived from the module's one key
 * (`PERFORMANCE_WEBHOOK_KEY`), the company, the endpoint and its rotation, so
 * a backup holds nothing a receiver would accept, and rotating is a counter.
 */

/** `whsec_` and 43 characters: the endpoint's secret at this rotation. */
export function secretFor(
  key: string,
  tenantId: string,
  endpointId: string,
  version: number,
): string {
  return `whsec_${createHmac('sha256', key)
    .update(`performance-webhook:${tenantId}:${endpointId}:${String(version)}`)
    .digest('base64url')}`;
}

/** `v1=<hex>` per live secret: HMAC-SHA256 over the raw body. */
export function signatureHeader(body: string, secrets: readonly string[]): string {
  return secrets
    .map((secret) => `v1=${createHmac('sha256', secret).update(body).digest('hex')}`)
    .join(',');
}

/** What a receiver does, here so the tests check what an integrator would. */
export function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .some((part) => {
      const presented = Buffer.from(part.slice(3));
      return presented.length === expected.length && timingSafeEqual(presented, expected);
    });
}

/**
 * Webhooks for this process (`PERFORMANCE_WEBHOOK_KEY`): derived secrets, the
 * signature, and People's pinned egress, so a delivery reaches only a public
 * address and follows no redirect. Absent in production without the key;
 * locally a fixed one, so `just dev` can try an endpoint.
 */
export function webhooksFrom(env: NodeJS.ProcessEnv): Webhooks | undefined {
  const key =
    env['PERFORMANCE_WEBHOOK_KEY'] ??
    (env['NODE_ENV'] === 'production' ? undefined : 'dev-only-webhook-key');
  if (key === undefined || key === '') return undefined;
  const policy = egressPolicyFrom(env);
  const poster = pinnedPoster(policy);
  return {
    secret: (tenantId, endpointId, version) => secretFor(key, tenantId, endpointId, version),
    sign: signatureHeader,
    vet: async (url) => {
      const vetted = await vet(url, policy);
      return vetted.ok ? ok(true) : vetted;
    },
    post: (url, request) => poster(url, request).catch(() => ({ status: 0 })),
  };
}
