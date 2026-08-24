import type { IncomingMessage, ServerResponse } from 'node:http';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { logger } from '@kithena/telemetry';

import { parseSender } from './message/domain/sender.js';
import { sendInvitation } from './message/application/send-invitation.js';
import { settleDelivery } from './message/application/settle-delivery.js';
import { noDeliveryLog, type DeliveryLog } from './message/application/delivery-log.js';
import type { EmailTransport } from './message/application/email-transport.js';
import { resendTransport } from './message/infrastructure/resend-transport.js';
import { logTransport } from './message/infrastructure/log-transport.js';
import { drizzleDeliveryLog } from './message/infrastructure/drizzle-delivery-log.js';
import { resendWebhookVerifier } from './message/infrastructure/resend-webhooks.js';
import { messagingRoutes } from './message/http/messaging-routes.js';
import { webhookRoutes } from './message/http/webhook-routes.js';

/**
 * Where the service is assembled.
 *
 * The same arrangement the identity service uses and for the same reason: one
 * file knows about more than one slice, everything else declares what it needs.
 * `main.ts` starts a server; this decides what the server is.
 */
export interface Config {
  /** Absent locally. Its absence selects the transport that writes to the log. */
  readonly resendApiKey: string | undefined;
  /**
   * Who the message is from, as `Name <address@domain>` or a bare address.
   *
   * Configuration and never a constant, because this is the setting that
   * changes: a company starts on a shared mailbox and moves to a dedicated
   * sending address, and that should be one environment variable rather than a
   * deploy of this service. It is required whenever a key is present, and
   * parsed at boot — see `parseSender` for why a malformed one must not be
   * allowed to reach the first invitation.
   *
   * The domain has to be one verified in Resend, and has to match *exactly*.
   * A key verified for `send.kithena.com` and a `from` of `info@kithena.com`
   * is a 403 at send time, which no amount of checking here can catch.
   */
  readonly from: string | undefined;
  /**
   * Where a reply goes. Worth setting, and worth it being a mailbox somebody
   * reads: people answer these, and a reply bouncing off a no-reply address is
   * a new hire who could not ask a question.
   */
  readonly replyTo: string | undefined;
  readonly internalToken: string;
  /**
   * The only origin a link in an outgoing message may point at.
   *
   * The auth origin, which is where enrolment happens. Without it this service
   * is a way to send a Kithena-branded email pointing anywhere, authenticated
   * by a secret that lives in a CI variable.
   */
  readonly authOrigin: string;
  /**
   * Whether this deployment is allowed to fall back to the log transport.
   *
   * False in production, and it is a hard failure rather than a warning there:
   * a production service that silently writes invitations to stdout looks
   * exactly like one that is working, right up until somebody asks why no new
   * hire has ever been able to log in.
   */
  readonly allowLogTransport: boolean;
  /**
   * Where the delivery log lives, or absent.
   *
   * Absent is a supported deployment and the one a developer runs: nothing is
   * recorded, `record` reports that it recorded nothing, and the outcome is
   * still in the response and the structured log. It is not a silent no-op —
   * see `noDeliveryLog` — because a deployment with no delivery log must not
   * look like one that has it.
   */
  readonly databaseUrl?: string | undefined;
  /**
   * The provider's webhook signing secret.
   *
   * Absent means the webhook endpoint refuses every request with a 503 rather
   * than trusting it. That is the safe direction: an unverified webhook is an
   * open API for marking any message bounced or complained, and the last of
   * those is how somebody gets a customer's sending domain suppressed.
   */
  readonly webhookSecret?: string | undefined;
}

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

export function selectTransport(config: Config): EmailTransport {
  if (config.resendApiKey === undefined || config.resendApiKey === '') {
    if (!config.allowLogTransport) {
      throw new Error('RESEND_API_KEY is required outside development');
    }
    logger.warn(
      { transport: 'log' },
      'no RESEND_API_KEY: invitations will be written to the log, not sent',
    );
    return logTransport((line) => process.stdout.write(`${line}\n`));
  }

  if (config.from === undefined || config.from === '') {
    // Refused rather than defaulted. Resend's sandbox sender only delivers to
    // the account holder's own address, so a default here would produce a
    // service that appears to send and reaches exactly one person — and a
    // hard-coded real address would be worse, because staging would then send
    // as production.
    throw new Error('RESEND_FROM is required when RESEND_API_KEY is set');
  }

  /*
   * Parsed at boot, not at send.
   *
   * The provider does not refuse a malformed `from` until something is actually
   * sent, so a typo here deploys clean, sits there, and surfaces as the first
   * new hire never receiving their invitation. This turns it into a service
   * that will not start — noticed in the minute the change was made rather than
   * on the morning somebody else starts a job.
   */
  const sender = parseSender(config.from);
  if (!sender.ok) {
    throw new Error(`RESEND_FROM is not a usable sender: ${JSON.stringify(config.from)}`);
  }

  const replyTo =
    config.replyTo === undefined || config.replyTo === '' ? undefined : config.replyTo;
  if (replyTo !== undefined && !parseSender(replyTo).ok) {
    throw new Error(`RESEND_REPLY_TO is not a usable address: ${JSON.stringify(replyTo)}`);
  }

  logger.info({ transport: 'resend', from: sender.value.formatted }, 'invitations will be sent');

  return resendTransport({
    apiKey: config.resendApiKey,
    from: sender.value.formatted,
    replyTo,
  });
}

/**
 * The delivery log, and the connection it needs, or neither.
 *
 * `max: 1` and `prepare: false` for the same reasons the identity service gives
 * at length: the host is a pooler rather than Postgres, so a prepared statement
 * created on one server connection is missing on the next, and a serverless
 * instance handling one request at a time needs one connection rather than ten.
 */
export function selectDeliveryLog(config: Config): DeliveryLog {
  if (config.databaseUrl === undefined || config.databaseUrl === '') {
    logger.warn(
      { reason: 'no MESSAGING_DATABASE_URL' },
      'deliveries will not be recorded; outcomes are in the response and the log only',
    );
    return noDeliveryLog;
  }

  const db = drizzle(postgres(config.databaseUrl, { max: 1, prepare: false }));

  const inTenantTransaction = <T>(
    tenantId: string,
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      // `true` makes it LOCAL: it lasts to the end of this transaction and no
      // further. Session-level would leak this tenant's id onto whatever the
      // pooled connection served next.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });

  return drizzleDeliveryLog(inTenantTransaction, async (provider, messageId) => {
    // Outside any tenant scope, because the question is which tenant it was.
    // The function is SECURITY DEFINER and answers exactly that and nothing
    // else; the migration explains why it is the only safe shape for it.
    const rows = await db.execute(
      sql`SELECT messaging.delivery_tenant_of(${provider}, ${messageId}) AS tenant_id`,
    );
    const value = [...rows][0]?.['tenant_id'];
    return typeof value === 'string' ? value : null;
  });
}

export function compose(config: Config): RequestHandler {
  const transport = selectTransport(config);
  const deliveries = selectDeliveryLog(config);

  const send = sendInvitation({
    transport,
    deliveries,
    trustedLinkOrigin: config.authOrigin,
    onRefusal: (reason, detail) => {
      // Named fields, never the request. The request holds the enrolment link,
      // and a link in a log store is a link anyone with log access can use.
      logger.info({ reason, transport: transport.name, ...detail }, 'invitation refused');
    },
  });

  const invitations = messagingRoutes({
    sendInvitation: send,
    internalToken: config.internalToken,
    transportName: transport.name,
  });

  const verifier = resendWebhookVerifier(config.webhookSecret);
  if (verifier === undefined) {
    logger.warn(
      { reason: 'no RESEND_WEBHOOK_SECRET' },
      'webhooks refused: a bounced invitation will not be recorded as bounced',
    );
  }

  const webhooks = webhookRoutes({
    settle: settleDelivery({
      deliveries,
      provider: transport.name,
      onIgnored: (type) => {
        logger.debug({ type }, 'provider event ignored');
      },
    }),
    ...(verifier === undefined ? {} : { verify: verifier }),
    onRefusal: (reason) => {
      logger.info({ reason }, 'webhook refused');
    },
  });

  return async (request, response) =>
    (await invitations(request, response)) || (await webhooks(request, response));
}
