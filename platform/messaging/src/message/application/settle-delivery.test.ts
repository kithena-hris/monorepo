import { describe, expect, it } from 'vitest';

import type { DeliveryLog, DeliveryStatus } from './delivery-log.js';
import { settleDelivery } from './settle-delivery.js';

function log(known = true) {
  const settled: { status: DeliveryStatus; reason: string | null }[] = [];
  const port: DeliveryLog = {
    record: () => Promise.resolve('row-1'),
    settle: (input) => {
      settled.push({ status: input.status, reason: input.reason });
      return Promise.resolve(known);
    },
  };
  return { port, settled };
}

const settle = (deliveries: DeliveryLog, ignored: string[] = []) =>
  settleDelivery({ deliveries, provider: 'resend', onIgnored: (type) => ignored.push(type) });

const event = (type: string) => ({ type, messageId: 'msg_1' });

describe('settleDelivery', () => {
  it.each([
    ['email.delivered', 'delivered'],
    ['email.bounced', 'bounced'],
    ['email.complained', 'complained'],
    ['email.suppressed', 'suppressed'],
    ['email.failed', 'failed'],
  ] as const)('turns %s into %s', async (type, status) => {
    const deliveries = log();
    const result = await settle(deliveries.port)(event(type));

    expect(result.ok && result.value).toBe(status);
    expect(deliveries.settled[0]?.status).toBe(status);
  });

  it('records the event type as the reason, never the provider’s words', async () => {
    // A bounce reason quotes the address it refused and often the receiving
    // server's diagnostic, which is somebody's mail configuration written into
    // our table. The type is the closed set that says what to do about it.
    const deliveries = log();
    await settle(deliveries.port)({
      type: 'email.bounced',
      messageId: 'msg_1',
      detail: '550 5.1.1 <grace@acme.exmaple>: Recipient address rejected',
    });

    expect(deliveries.settled[0]?.reason).toBe('email.bounced');
    expect(JSON.stringify(deliveries.settled)).not.toContain('exmaple');
  });

  it('leaves no reason on a delivery that simply worked', async () => {
    const deliveries = log();
    await settle(deliveries.port)(event('email.delivered'));
    expect(deliveries.settled[0]?.reason).toBeNull();
  });

  it.each(['email.sent', 'email.opened', 'email.clicked', 'email.delivery_delayed'])(
    'ignores %s without touching the log',
    async (type) => {
      // `sent` is what the send path already recorded. `opened` and `clicked`
      // are engagement tracking, and this is a transactional message to an
      // employee — recording who opened their own invitation is surveillance we
      // have no reason to do. `delivery_delayed` is transient and would move a
      // message backwards out of a state it may already have reached.
      const deliveries = log();
      const ignored: string[] = [];
      const result = await settle(deliveries.port, ignored)(event(type));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('EVENT_IGNORED');
      expect(deliveries.settled).toEqual([]);
      expect(ignored).toEqual([type]);
    },
  );

  it('reports an event about a message it does not know', async () => {
    // Not an error worth retrying. A provider replaying an event about a
    // message from before this table existed is a fact about our history.
    const deliveries = log(false);
    const result = await settle(deliveries.port)(event('email.bounced'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MESSAGE_UNKNOWN');
  });
});
