import { Resend } from 'resend';

/**
 * Verifying that a webhook really came from the provider.
 *
 * The one piece of this service that is genuinely worth a dependency. Resend
 * signs with Svix, which is an HMAC over `id.timestamp.body` with a timestamp
 * tolerance and support for several keys during a rotation. Every one of those
 * is a place to be subtly wrong in a way that still passes a happy-path test
 * and quietly accepts forged events, so it is the provider's implementation
 * rather than ours.
 *
 * Returns undefined when no secret is configured, which the route turns into a
 * refusal rather than into trust. An unverified webhook endpoint is an open API
 * for marking any message bounced or complained, and the second of those is how
 * somebody would get a customer's sending domain suppressed.
 */
export type WebhookVerifier = (input: {
  payload: string;
  headers: Record<string, string>;
}) => unknown;

export function resendWebhookVerifier(secret: string | undefined): WebhookVerifier | undefined {
  if (secret === undefined || secret === '') return undefined;

  // The API key is not needed to verify a signature, and this client is never
  // used to send. An empty string rather than the real key so that a bug in
  // this path cannot become an outbound request.
  const resend = new Resend('');

  return ({ payload, headers }) =>
    resend.webhooks.verify({
      payload,
      // Renamed, not reshaped. Svix puts these on the wire as `svix-id`,
      // `svix-timestamp` and `svix-signature`; the SDK takes them as a struct.
      // The route deals in header names because that is what arrives, and the
      // translation belongs here with the rest of the vendor's vocabulary.
      headers: {
        id: headers['svix-id'] ?? '',
        timestamp: headers['svix-timestamp'] ?? '',
        signature: headers['svix-signature'] ?? '',
      },
      webhookSecret: secret,
    });
}
