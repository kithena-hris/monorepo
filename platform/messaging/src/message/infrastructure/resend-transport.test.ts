import { describe, expect, it } from 'vitest';

import type { EmailAddress } from '../domain/address.js';
import { resendTransport } from './resend-transport.js';

const send = (to: string) =>
  resendTransport({ apiKey: 're_test', from: 'Kithena <no-reply@send.kithena.com>' }).send({
    to: to as EmailAddress,
    subject: 's',
    html: '<p>h</p>',
    text: 't',
    idempotencyKey: 'k',
  });

describe('resendTransport', () => {
  it.each([
    'grace@meridianfreight.example',
    'ada@acme.test',
    'x@nowhere.invalid',
    'dev@app.localhost',
    'someone@example.com',
  ])('never hands %s to the provider', async (to) => {
    const result = await send(to);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toEqual(['reserved_domain']);
  });
});
