import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { DeliveryLog, DeliveryStatus } from './delivery-log.js';

/**
 * A provider telling us what became of a message we sent.
 *
 * This is the half of delivery that a send cannot know. Accepting a message is
 * not delivering it: a mistyped work address is accepted, queued, rejected by
 * the receiving server minutes later, and — without this — recorded forever as
 * having gone out fine. A new hire then cannot log in and nobody can say why.
 *
 * It is also the justification for taking the provider's SDK as a dependency
 * rather than calling its REST API with `fetch`. Verifying the signature is the
 * part that must not be hand-rolled, and the SDK ships it.
 */

/**
 * The events worth acting on, mapped onto what the log records.
 *
 * Deliberately not every event Resend sends. `email.sent` says the API call
 * worked, which the send path already recorded; `email.opened` and
 * `email.clicked` are engagement tracking, and this is a transactional message
 * to an employee rather than a marketing campaign — recording who opened their
 * own invitation is surveillance we have no reason to do and would then have to
 * declare.
 *
 * `email.delivery_delayed` is left out for a different reason: it is transient,
 * the provider retries by itself, and writing it would move a message backwards
 * out of a state it may already have reached.
 */
const OUTCOMES: Readonly<Record<string, DeliveryStatus>> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
};

export const NotAnOutcome = failure(
  'EVENT_IGNORED',
  'That event does not change what we know about a message',
);
export const Unattributable = failure('MESSAGE_UNKNOWN', 'No message of ours by that identifier');

export interface ProviderEvent {
  readonly type: string;
  readonly messageId: string;
  /** The provider's own words for why. Never passed on; see below. */
  readonly detail?: string | undefined;
}

export interface SettleDeliveryDeps {
  readonly deliveries: DeliveryLog;
  readonly provider: string;
  readonly onIgnored?: (type: string) => void;
}

export type SettleDelivery = (event: ProviderEvent) => Promise<Result<DeliveryStatus>>;

export function settleDelivery(deps: SettleDeliveryDeps): SettleDelivery {
  return async (event) => {
    const status = OUTCOMES[event.type];
    if (status === undefined) {
      deps.onIgnored?.(event.type);
      return err(NotAnOutcome);
    }

    const settled = await deps.deliveries.settle({
      provider: deps.provider,
      providerMessageId: event.messageId,
      status,
      // The event type, not the provider's message. A bounce reason quotes the
      // address it refused and sometimes the receiving server's diagnostic,
      // which is somebody's mail configuration written into our table. The type
      // is the closed set that says what to do about it.
      reason: status === 'delivered' ? null : event.type,
    });

    // Not an error to the caller — see `DeliveryLog.settle`. A provider
    // replaying an event about a message from before this table existed is a
    // fact about our history, and answering 500 would make it retry forever.
    return settled ? ok(status) : err(Unattributable);
  };
}
