import { describe, expect, it } from 'vitest';
import type { DocumentId, Instant } from '@kithena/contracts';

import { send } from '../domain/signature/envelope.js';
import { viewOf } from './signing-screens.js';

const at = '2026-10-13T10:00:00.000Z' as Instant;
const signer = (id: string, order: number) => ({
  id,
  order,
  personId: `p-${id}` as never,
  email: null,
  name: id,
  check: 'login' as const,
  allowDelegate: false,
  tokenHash: id,
});

describe('who sees which boxes', () => {
  const sent = send({
    id: 'env',
    documentId: 'd' as DocumentId,
    version: 1,
    pages: 2,
    senderAccount: 'acc',
    signers: [signer('s1', 1), signer('s2', 2)],
    fields: [],
    message: '',
    dueOn: null,
    at,
  });
  if (!sent.ok) throw new Error(sent.error.message);
  const env = sent.value;

  it('shows a signer only their own boxes', () => {
    const view = viewOf(env, 'Offer', 2, 'Ada', [], 's2', false);
    expect(view.fields.map((f) => f.signerId)).toEqual(['s2', 's2']);
  });

  it('shows whoever follows the request every box', () => {
    const view = viewOf(env, 'Offer', 2, 'Ada', [], null, true);
    expect(new Set(view.fields.map((f) => f.signerId))).toEqual(new Set(['s1', 's2']));
  });
});
