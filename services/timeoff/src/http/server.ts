import type { IncomingMessage, ServerResponse } from 'node:http';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * The one request listener on Time Off's one port: `/healthz` answered here,
 * everything else to GraphQL. The REST router joins in front of GraphQL with
 * TOF-046, the way People's `wirePeople` puts its routes before Yoga.
 *
 * `/healthz` needs nothing — no database, no broker — so it says the process
 * is up and serving, which is what a container health check asks.
 */
export function timeoffListener(graphql: Listener): Listener {
  return (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    graphql(request, response);
  };
}
