import { describe, expect, it } from 'vitest';
import { err, failure, ok } from '@kithena/domain-kit';

import type { EmailTransport, OutgoingEmail } from './email-transport.js';
import type { DeliveryLog, DeliveryRecord } from './delivery-log.js';
import { sendInvitation, type SendRefusal } from './send-invitation.js';

const TRUSTED = 'https://auth.app.kithena.com';

/**
 * The length of a real token — 32 bytes base64url is 43 characters — but
 * unmistakably a fixture. Realistic randomness here reads as a credential to
 * `gitleaks`, which is exactly the judgement you want it making, so the
 * fixture says what it is rather than the scanner learning to ignore this file.
 */
const TOKEN = 'ENROLMENT-TOKEN-FIXTURE-NOT-A-REAL-CREDENTIAL';

const request = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  companyName: 'Acme Corp',
  email: 'Ada@Acme.Example',
  enrolUrl: `${TRUSTED}/enrol?tenant=acme&token=${TOKEN}`,
  expiresAt: '2026-08-27T09:05:00.000Z',
};

/** A transport that records rather than sends. */
function recorder(): EmailTransport & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: 'recorder',
    sent,
    send: (email) => {
      sent.push(email);
      return Promise.resolve(ok({ id: 'msg_1' }));
    },
  };
}

/** A delivery log that keeps what it was told, so a test can read it back. */
function ledger(): DeliveryLog & { recorded: DeliveryRecord[] } {
  const recorded: DeliveryRecord[] = [];
  return {
    recorded,
    record: (entry) => {
      recorded.push(entry);
      return Promise.resolve('row-1');
    },
    settle: () => Promise.resolve(true),
  };
}

const refusing: EmailTransport = {
  name: 'refusing',
  send: () => Promise.resolve(err(failure('PROVIDER_REFUSED', 'no'))),
};

const reasonOf = (result: { ok: false; error: { path?: readonly string[] } }): string | undefined =>
  result.error.path?.[0];

describe('sendInvitation', () => {
  it('sends the rendered message to the normalised address', async () => {
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    const result = await send(request);

    expect(result.ok).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe('ada@acme.example');
    expect(transport.sent[0]?.subject).toContain('Acme Corp');
    expect(transport.sent[0]?.text).toContain(request.enrolUrl);
  });

  it('reports the provider id, so a missing message can be traced', async () => {
    const send = sendInvitation({
      transport: recorder(),
      deliveries: ledger(),
      trustedLinkOrigin: TRUSTED,
    });
    const result = await send(request);
    expect(result.ok && result.value.messageId).toBe('msg_1');
  });

  it('refuses an address that would bounce, without asking the provider', async () => {
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    const result = await send({ ...request, email: 'not-an-address' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasonOf(result)).toBe('address');
    // Hard bounces are what get a sending domain suppressed, and a suppressed
    // domain means nobody's invitation arrives. Not sending is the point.
    expect(transport.sent).toHaveLength(0);
  });

  it('refuses a link pointing anywhere but the auth origin', async () => {
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    const result = await send({ ...request, enrolUrl: 'https://evil.example/enrol?token=stolen' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasonOf(result)).toBe('untrusted_link');
    expect(transport.sent).toHaveLength(0);
  });

  it('refuses copy it cannot render', async () => {
    const send = sendInvitation({
      transport: recorder(),
      deliveries: ledger(),
      trustedLinkOrigin: TRUSTED,
    });
    const result = await send({ ...request, companyName: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasonOf(result)).toBe('unrenderable');
  });

  it('reports a provider refusal as its own reason', async () => {
    // Distinct from the three above because it is the only one worth retrying,
    // and because it is the only one that is not our own fault.
    const send = sendInvitation({
      transport: refusing,
      deliveries: ledger(),
      trustedLinkOrigin: TRUSTED,
    });
    const result = await send(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasonOf(result)).toBe('provider');
  });

  it('tells the log which refusal it was', async () => {
    const seen: SendRefusal[] = [];
    const send = sendInvitation({
      transport: recorder(),
      deliveries: ledger(),
      trustedLinkOrigin: TRUSTED,
      onRefusal: (reason) => seen.push(reason),
    });

    await send({ ...request, email: 'nope' });

    expect(seen).toEqual(['address']);
  });
});

describe('the idempotency key', () => {
  it('is stable for the same link, so a retry does not send twice', async () => {
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    await send(request);
    await send(request);

    expect(transport.sent[0]?.idempotencyKey).toBe(transport.sent[1]?.idempotencyKey);
  });

  it('changes when the link does, so a reissued invitation is actually sent', async () => {
    // The case that rules out keying on the account. Re-issuing kills the
    // previous token, so the first message now points at a dead link; a key
    // that did not move would either swallow the second send or be rejected as
    // a conflict, and either way the person never gets a link that works.
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    await send(request);
    await send({ ...request, enrolUrl: `${TRUSTED}/enrol?tenant=acme&token=${TOKEN}x` });

    expect(transport.sent[0]?.idempotencyKey).not.toBe(transport.sent[1]?.idempotencyKey);
  });

  it('never carries the enrolment token', async () => {
    // The token is stored as a hash precisely so it cannot be read back out of
    // anything. A provider logs this header and shows it in a dashboard.
    const transport = recorder();
    const send = sendInvitation({ transport, deliveries: ledger(), trustedLinkOrigin: TRUSTED });

    await send(request);

    expect(transport.sent[0]?.idempotencyKey).not.toContain(TOKEN);
    expect(transport.sent[0]?.idempotencyKey.startsWith('account-invitation/')).toBe(true);
    // Resend caps the key at 256 characters.
    expect(transport.sent[0]?.idempotencyKey.length).toBeLessThanOrEqual(256);
  });
});

describe('the delivery log', () => {
  it('records an accepted send, never the message', async () => {
    // `accepted`, not `delivered`: a provider queueing a message is not a
    // mailbox receiving one, and the difference arrives later by webhook.
    const deliveries = ledger();
    await sendInvitation({ transport: recorder(), deliveries, trustedLinkOrigin: TRUSTED })(
      request,
    );

    expect(deliveries.recorded).toHaveLength(1);
    const [entry] = deliveries.recorded;
    expect(entry?.status).toBe('accepted');
    expect(entry?.kind).toBe('account_invitation');
    expect(entry?.to).toBe('ada@acme.example');
    expect(entry?.providerMessageId).toBe('msg_1');
    expect(entry?.tenantId).toBe(request.tenantId);

    // The whole point of the log's shape. The enrolment token is stored as a
    // hash precisely so it cannot be read back out of anything, and a rendered
    // message in a table would undo that in one column.
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
    expect(JSON.stringify(entry)).not.toContain('Set up your account');
  });

  it('records a provider refusal, which is the interesting case', async () => {
    // A log that only holds successes cannot answer the question it exists for.
    // A mistyped work address is exactly what this is meant to surface.
    const deliveries = ledger();
    await sendInvitation({ transport: refusing, deliveries, trustedLinkOrigin: TRUSTED })(request);

    expect(deliveries.recorded).toHaveLength(1);
    expect(deliveries.recorded[0]?.status).toBe('failed');
    expect(deliveries.recorded[0]?.providerMessageId).toBeNull();
  });

  it('records nothing for a message it never tried to send', async () => {
    // Nothing was sent, so there is no delivery to have a record of — and a row
    // saying "failed" for an address we refused ourselves would make the log
    // read as though the provider had a problem.
    const deliveries = ledger();
    await sendInvitation({ transport: recorder(), deliveries, trustedLinkOrigin: TRUSTED })({
      ...request,
      email: 'not-an-address',
    });

    expect(deliveries.recorded).toEqual([]);
  });
});
