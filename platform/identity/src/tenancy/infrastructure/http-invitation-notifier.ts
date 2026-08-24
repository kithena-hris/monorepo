import type {
  Delivery,
  Invitation,
  InvitationNotifier,
} from '../application/invitation-notifier.js';
import { notDelivered } from '../application/invitation-notifier.js';

/**
 * The messaging service, over the wire.
 *
 * `fetch` and a shared secret, not a generated client. There is one endpoint
 * with five fields; a code-generated client would be more machinery than the
 * thing it describes, and `.dependency-cruiser.cjs` rules out the tRPC that
 * would otherwise be reached for here.
 *
 * Every failure is a `Delivery` rather than a throw. This is called after the
 * transaction has committed — see `invite-account.ts` — so there is nothing
 * left to roll back, and an exception escaping here would turn a messaging
 * outage into a 500 on a request that actually succeeded.
 */
export interface HttpNotifierConfig {
  /** Where the messaging service is. Absent means invitations are not emailed. */
  readonly baseUrl: string;
  readonly internalToken: string;
  /**
   * How long to wait.
   *
   * Short on purpose. This sits inside an operator's request, the provider's
   * own timeout is longer than anyone should hold a page for, and the fallback
   * — hand the link over — is immediate. Five seconds is long enough for a
   * healthy provider and short enough that an unhealthy one is a delay rather
   * than a hang.
   */
  readonly timeoutMs?: number | undefined;
}

export function httpInvitationNotifier(config: HttpNotifierConfig): InvitationNotifier {
  const endpoint = new URL('/api/internal/messaging/invitation', config.baseUrl).toString();

  return {
    async send(invitation: Invitation): Promise<Delivery> {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-token': config.internalToken,
          },
          body: JSON.stringify(invitation satisfies Invitation),
          signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
        });
      } catch {
        // DNS, TLS, a refused connection or the timeout above. Indistinguishable
        // from here and the same thing to do about all of them.
        return notDelivered('unreachable');
      }

      if (!response.ok) {
        const reason = await refusalReason(response);
        return { delivered: false, messageId: null, reason };
      }

      const body: unknown = await response.json().catch(() => null);
      return { delivered: true, messageId: stringField(body, 'messageId'), reason: null };
    },
  };
}

/**
 * Why it refused, from a closed set the messaging service defines.
 *
 * The body is read rather than the status alone, because `address` and
 * `provider` are both a refusal to an operator and only one of them is worth
 * retrying. Anything unreadable becomes the status, which is at least true.
 */
async function refusalReason(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  // The status is the fallback, and it is at least true. A refusal with no
  // readable body is still a refusal.
  return stringField(body, 'reason') ?? `http_${String(response.status)}`;
}

/**
 * One string field off a body nobody typed.
 *
 * The response comes over a network from another process, so it is `unknown`
 * however well we think we know the other end. Narrowed by asking rather than
 * by asserting: a cast here would describe what the messaging service is
 * supposed to send, which is exactly the thing that is not guaranteed.
 */
function stringField(body: unknown, key: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value: unknown = Reflect.get(body, key);
  return typeof value === 'string' ? value : null;
}
