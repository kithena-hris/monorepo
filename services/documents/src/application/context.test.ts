import { EventEnvelope } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { event, type Ctx } from './context.js';

/** Documents' events are read by other modules against the shared envelope. */
describe('who an event says acted', () => {
  const ctxOf = (accountId: string) =>
    ({
      deps: { newId: () => '01890000-0000-7000-8000-000000000001' },
      caller: {
        tenantId: '00000000-0000-4000-8000-0000000000a1',
        accountId,
        personId: null,
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      },
      at: '2026-10-25T22:20:00.000Z',
      today: '2026-10-25',
    }) as unknown as Ctx;
  const envelope = (accountId: string) => {
    const made = event(
      ctxOf(accountId),
      'documents.envelope.signed',
      { type: 'Envelope', id: 'e1' },
      {},
    );
    return EventEnvelope.safeParse({ ...made, recordedAt: made.occurredAt });
  };

  it('is the member who signed, by their account', () => {
    expect(envelope('00000000-0000-4000-8000-0000000000b1').data?.actor).toEqual({
      kind: 'user',
      userId: '00000000-0000-4000-8000-0000000000b1',
    });
  });

  it('is Documents itself for an outside signer or the seal, never a user without an account', () => {
    expect(envelope('signer').data?.actor).toEqual({ kind: 'system', process: 'documents.signer' });
    expect(envelope('system').data?.actor).toEqual({ kind: 'system', process: 'documents.system' });
  });
});
