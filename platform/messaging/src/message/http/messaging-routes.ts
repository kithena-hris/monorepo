import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/http.js';
import type { SendInvitation, SendRefusal } from '../application/send-invitation.js';

/**
 * The only way into this service.
 *
 * Plain HTTP and Zod rather than GraphQL, for the same reason the identity
 * service is not a subgraph: there is no principal here and nothing to
 * federate. This is one process asking another to do a thing, the caller is
 * authenticated by a shared secret, and the router in front of it has no
 * business knowing the request exists.
 *
 * Not tRPC either — `.dependency-cruiser.cjs` forbids it outside `apps/admin`,
 * and Connect-RPC is the sanctioned escape hatch for typed platform-to-platform
 * calls. It is not reached for here because there is one endpoint with five
 * fields, and a code-generated client would be more machinery than the thing it
 * describes.
 */

const INVITATION = '/api/internal/messaging/invitation';
const HEALTH = '/healthz';

/**
 * The request, checked at the boundary.
 *
 * Zod validates shape here and the domain re-checks meaning afterwards — the
 * address is normalised and the link is matched against the trusted origin
 * inside the use case, not here. That split is deliberate: this is one of the
 * transports, and a rule enforced only in a route is a rule that leaks the day
 * a second one is added.
 */
const InvitationRequest = z.object({
  tenantId: z.uuid(),
  companyName: z.string().min(1),
  email: z.string().min(3),
  enrolUrl: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  /**
   * Optional, and nullable rather than merely absent.
   *
   * Null is a *decision* — the identity service resolved the company's branding
   * and the answer was "do not show a mark" — where absent is a caller that
   * does not know about logos. Both end up in the same place, but only one of
   * them is a caller that needs updating.
   */
  logoUrl: z.string().nullish(),
});

/** A provider that said no is worth retrying. Everything else is not. */
const STATUS: Record<SendRefusal, number> = {
  address: 422,
  untrusted_link: 422,
  unrenderable: 422,
  provider: 502,
};

/**
 * The refusal a failure carried, narrowed by asking rather than by asserting.
 *
 * `DomainFailure.path` is `readonly string[]`, so a cast to `SendRefusal` would
 * be a claim about a value the type system has not checked — and the claim is
 * what makes the status lookup unsafe. Anything unrecognised is reported as
 * `provider`, which is the one that says "try again" and is therefore the safe
 * direction to be wrong in.
 */
function refusalOf(reason: string | undefined): SendRefusal {
  return reason !== undefined && reason in STATUS ? (reason as SendRefusal) : 'provider';
}

export interface MessagingRoutesDeps {
  readonly sendInvitation: SendInvitation;
  readonly internalToken: string;
  /** For the health check, so an operator can see which one is composed. */
  readonly transportName: string;
}

export function messagingRoutes({
  sendInvitation,
  internalToken,
  transportName,
}: MessagingRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';

    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };

    /*
     * Unauthenticated on purpose, and it says nothing worth having.
     *
     * A deploy needs something to curl before it promotes, and putting the
     * shared secret into a smoke test is how a shared secret ends up in a
     * workflow log. The transport name is not a secret — it is `resend` or
     * `log`, and knowing which is the difference between a deployment that
     * would send mail and one that silently would not.
     */
    if (path === HEALTH) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' }).end();
        return true;
      }
      return json(200, { status: 'ok', transport: transportName });
    }

    if (path !== INVITATION) return false;

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }

    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const body = await readJsonBody(request);
    if (body === null) return json(400, { code: 'MALFORMED_BODY' });

    const parsed = InvitationRequest.safeParse(body);
    if (!parsed.success) {
      // The caller is one of ours, so it gets the field. Nothing here is
      // reachable by a person, and "which field" is the difference between a
      // one-line fix and reading somebody else's logs.
      return json(422, {
        code: 'MALFORMED_REQUEST',
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
    }

    const sent = await sendInvitation(parsed.data);
    if (!sent.ok) {
      const reason = refusalOf(sent.error.path?.[0]);
      return json(STATUS[reason], { code: sent.error.code, reason });
    }

    // 202 rather than 201. Nothing was created here, and accepting a message
    // for delivery is not the same as it arriving — the provider queues, the
    // recipient's server greylists, and a 200 would be claiming more than this
    // service can know.
    return json(202, { messageId: sent.value.messageId });
  };
}
