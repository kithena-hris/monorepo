import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Signer } from '../infrastructure/jose-signer.js';

/**
 * `/.well-known/jwks.json` — the only thing a module ever asks identity for.
 *
 * Unauthenticated, deliberately. It publishes public keys, and a JWKS that
 * required a credential to fetch would mean every subgraph needed a credential
 * for this service, which is exactly the coupling the JWKS exists to avoid.
 *
 * Cached, also deliberately. Modules fetch this on boot and on an unknown
 * `kid`, so an hour of caching turns a restart storm into one request; short
 * enough that a rotation propagates without anybody being told.
 */
const PATH = '/.well-known/jwks.json';

export function jwksRoute(signer: Signer) {
  return (request: IncomingMessage, response: ServerResponse): boolean => {
    if ((request.url ?? '').split('?')[0] !== PATH) return false;

    const body = JSON.stringify(signer.jwks());
    response
      .writeHead(200, {
        'content-type': 'application/jwk-set+json',
        'cache-control': 'public, max-age=3600',
      })
      .end(body);
    return true;
  };
}
