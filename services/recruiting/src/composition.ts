import type { IncomingMessage, ServerResponse } from 'node:http';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

export interface Composed {
  readonly listener: Listener;
}

/**
 * Recruiting's composition root. Phase 0 (REC-004): the process boots and
 * answers `/healthz`; the transports join it as they land (REC-060 on).
 */
export function composeRecruiting(_env: NodeJS.ProcessEnv = process.env): Promise<Composed> {
  return Promise.resolve({
    listener: (request, response) => {
      if (request.method === 'GET' && request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      response
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":{"code":"NOT_FOUND","message":"No such route"}}');
    },
  });
}
