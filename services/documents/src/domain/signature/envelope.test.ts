import { describe, expect, it } from 'vitest';
import type { DocumentId, Instant, PersonId } from '@kithena/contracts';

import {
  checkCode,
  decline,
  defaultFields,
  fieldsAt,
  issueCode,
  markOpened,
  reassign,
  remaining,
  send,
  sign,
  voidEnvelope,
  type Envelope,
  type SendInput,
} from './envelope.js';

const at = (m: number) => `2026-10-09T10:${String(m).padStart(2, '0')}:00.000Z` as Instant;
const yuki = {
  personId: null,
  email: 'yuki@example.com',
  name: 'Yuki Sato',
  check: 'email_code' as const,
  order: 1,
  allowDelegate: false,
};
const nora = {
  personId: 'p-nora' as PersonId,
  email: null,
  name: 'Nora Becker',
  check: 'login' as const,
  order: 2,
  allowDelegate: true,
};

const input: SendInput = {
  id: 'env-1',
  documentId: 'd-1' as DocumentId,
  version: 1,
  pages: 6,
  senderAccount: 'acc-ada',
  signers: [
    { ...yuki, id: 's-yuki', tokenHash: 'h-yuki' },
    { ...nora, id: 's-nora', tokenHash: 'h-nora' },
  ],
  fields: [],
  message: 'Please sign by Friday',
  dueOn: '2026-10-18' as never,
  at: at(0),
};

const sent = (): Envelope => {
  const r = send(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe('sending (K1–K3)', () => {
  it('places a dated signature for each signer on the last page when none are given', () => {
    const env = sent();
    expect(env.fields.map((f) => [f.signerId, f.kind, f.page])).toEqual([
      ['s-yuki', 'date', 6],
      ['s-nora', 'date', 6],
    ]);
    expect(defaultFields(['a', 'b'], 1).every((f) => f.x >= 0 && f.x + f.w <= 1)).toBe(true);
  });

  it('takes a dated signature as a place to sign, and nothing that is not a signature', () => {
    const box = (signerId: string, kind: 'date' | 'name') => ({
      id: `${signerId}-${kind}`,
      signerId,
      kind,
      page: 1,
      x: 0.1,
      y: 0.8,
      w: 0.3,
      h: 0.08,
      required: true,
      label: null,
    });
    expect(send({ ...input, fields: [box('s-yuki', 'date'), box('s-nora', 'date')] }).ok).toBe(
      true,
    );
    const refused = send({ ...input, fields: [box('s-yuki', 'date'), box('s-nora', 'name')] });
    expect(refused.ok).toBe(false);
  });

  it('sends to the first in order; the rest wait their turn', () => {
    expect(sent().signers.map((s) => s.status)).toEqual(['sent', 'waiting']);
  });

  it('refuses no signers, a signer twice, or a field for nobody', () => {
    const second = input.signers[1];
    if (second === undefined) throw new Error('the input has two signers');
    expect(send({ ...input, signers: [] }).ok).toBe(false);
    expect(send({ ...input, signers: [second, { ...second, id: 's-x' }] }).ok).toBe(false);
    expect(
      send({
        ...input,
        fields: [
          {
            id: 'f',
            signerId: 'nobody',
            kind: 'signature',
            page: 1,
            x: 0.1,
            y: 0.1,
            w: 0.2,
            h: 0.05,
            required: true,
            label: null,
          },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe('signing (K4–K6)', () => {
  it('an outside signer proves the mailbox before signing; five wrong codes lock it', () => {
    let env = ok(markOpened(sent(), 's-yuki', at(1)));
    env = ok(issueCode(env, 's-yuki', 'hash-417233', at(1)));
    expect(
      sign(env, 's-yuki', { signature: { kind: 'typed', text: 'Yuki Sato' }, values: {} }, at(2)),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_VERIFIED' },
    });
    let wrong = env;
    for (let i = 0; i < 5; i++)
      wrong = ok(checkCode(wrong, 's-yuki', 'hash-wrong', at(2))).envelope;
    expect(checkCode(wrong, 's-yuki', 'hash-417233', at(2))).toMatchObject({
      ok: false,
      error: { code: 'CODE_LOCKED' },
    });
    const right = ok(checkCode(env, 's-yuki', 'hash-417233', at(3)));
    expect(right.matched).toBe(true);
    expect(right.envelope.signers[0]?.status).toBe('verified');
  });

  it('a code lasts ten minutes', () => {
    const env = ok(issueCode(ok(markOpened(sent(), 's-yuki', at(1))), 's-yuki', 'h', at(1)));
    expect(checkCode(env, 's-yuki', 'h', at(12))).toMatchObject({
      ok: false,
      error: { code: 'CODE_EXPIRED' },
    });
  });

  it('signs in order, fills the date, and completes with the last', () => {
    let env = ok(issueCode(ok(markOpened(sent(), 's-yuki', at(1))), 's-yuki', 'h', at(1)));
    env = ok(checkCode(env, 's-yuki', 'h', at(2))).envelope;
    expect(
      sign(env, 's-nora', { signature: { kind: 'typed', text: 'Nora' }, values: {} }, at(2)).ok,
    ).toBe(false);
    env = ok(
      sign(env, 's-yuki', { signature: { kind: 'typed', text: 'Yuki Sato' }, values: {} }, at(3)),
    );
    expect(env.signers.map((s) => s.status)).toEqual(['signed', 'sent']);
    expect(env.fields.find((f) => f.signerId === 's-yuki' && f.kind === 'date')?.value).toBe(
      '2026-10-09',
    );
    expect(remaining(env).map((s) => s.id)).toEqual(['s-nora']);
    env = ok(markOpened(env, 's-nora', at(4)));
    env = ok(
      sign(
        env,
        's-nora',
        { signature: { kind: 'drawn', path: 'M 10 60 L 120 40 L 300 80' }, values: {} },
        at(5),
      ),
    );
    expect(env.status).toBe('completed');
    expect(env.completedAt).toBe(at(5));
  });

  it('dates the box with the signer’s own day, never more than a day from the clock', () => {
    const verified = (): Envelope => {
      const env = ok(issueCode(ok(markOpened(sent(), 's-yuki', at(1))), 's-yuki', 'h', at(1)));
      return ok(checkCode(env, 's-yuki', 'h', at(2))).envelope;
    };
    const dated = (day: string | undefined): string | null | undefined => {
      const signature = { kind: 'typed' as const, text: 'Yuki Sato' };
      const env = ok(
        sign(
          verified(),
          's-yuki',
          { signature, values: {}, ...(day === undefined ? {} : { day }) },
          at(3),
        ),
      );
      return env.fields.find((f) => f.signerId === 's-yuki' && f.kind === 'date')?.value;
    };
    // Just after midnight in Tokyo, the day before in UTC: Tokyo's day.
    expect(dated('2026-10-10')).toBe('2026-10-10');
    // Late evening in Honolulu, already tomorrow in UTC.
    expect(dated('2026-10-08')).toBe('2026-10-08');
    // No zone is two days off, and nothing that is not a day is one.
    expect(dated('2026-10-12')).toBe('2026-10-09');
    expect(dated('10/10/2026')).toBe('2026-10-09');
    // Not said: the clock's own day, as before.
    expect(dated(undefined)).toBe('2026-10-09');
  });

  it('refuses a required field left empty', () => {
    const fields = [
      ...defaultFields(['s-yuki', 's-nora'], 6),
      {
        id: 'f-cb',
        signerId: 's-nora',
        kind: 'checkbox' as const,
        page: 1,
        x: 0.1,
        y: 0.5,
        w: 0.05,
        h: 0.03,
        required: true,
        label: 'I have read the notice',
      },
    ];
    let env = ok(
      send({
        ...input,
        signers: [{ ...nora, order: 1, id: 's-nora', tokenHash: 'h' }],
        fields: fields.filter((f) => f.signerId === 's-nora'),
      }),
    );
    env = ok(markOpened(env, 's-nora', at(1)));
    expect(
      sign(env, 's-nora', { signature: { kind: 'typed', text: 'Nora' }, values: {} }, at(2)),
    ).toMatchObject({ ok: false, error: { code: 'FIELDS_MISSING' } });
    expect(
      sign(
        env,
        's-nora',
        { signature: { kind: 'typed', text: 'Nora' }, values: { 'f-cb': 'true' } },
        at(2),
      ).ok,
    ).toBe(true);
  });
});

describe('everything but signing (K7, K8)', () => {
  it('a decline ends it, with the reason', () => {
    const env = ok(decline(sent(), 's-yuki', 'The salary is wrong', at(2)));
    expect(env.status).toBe('declined');
    expect(
      sign(env, 's-yuki', { signature: { kind: 'typed', text: 'Y' }, values: {} }, at(3)).ok,
    ).toBe(false);
  });

  it('passes a turn on only where the sender allowed it', () => {
    expect(
      reassign(
        sent(),
        's-yuki',
        { personId: 'p-lena' as PersonId, email: null, name: 'Lena Weber' },
        'h2',
      ).ok,
    ).toBe(false);
    const env = ok(
      reassign(
        sent(),
        's-nora',
        { personId: 'p-lena' as PersonId, email: null, name: 'Lena Weber' },
        'h2',
      ),
    );
    expect(env.signers[1]).toMatchObject({
      name: 'Lena Weber',
      personId: 'p-lena',
      status: 'waiting',
    });
  });

  it('voids with a reason, once', () => {
    const env = ok(voidEnvelope(sent(), 'Wrong version', at(2)));
    expect(env.status).toBe('voided');
    expect(voidEnvelope(env, 'Again', at(3)).ok).toBe(false);
  });
});

describe('fields beside the signature lines (K2)', () => {
  it('puts each signer, in order, beside a line the document has, and the rest at the foot', () => {
    const fields = fieldsAt(
      ['a', 'b', 'c'],
      [
        { page: 3, x: 0.1, y: 0.7 },
        { page: 4, x: 0.55, y: 0.2 },
      ],
      4,
    );
    const sig = (id: string) => fields.find((f) => f.signerId === id && f.kind === 'date');
    expect(sig('a')).toMatchObject({ page: 3, x: 0.1, y: 0.7 });
    expect(sig('b')).toMatchObject({ page: 4, x: 0.55, y: 0.2 });
    expect(sig('c')).toMatchObject({ page: 4 });
    expect(fields.filter((f) => f.kind === 'date')).toHaveLength(3);
  });

  it('keeps a field on its page near an edge', () => {
    const [dated] = fieldsAt(['a'], [{ page: 1, x: 0.9, y: 0.97 }], 1);
    expect((dated?.x ?? 0) + (dated?.w ?? 0)).toBeLessThanOrEqual(1);
    expect((dated?.y ?? 0) + (dated?.h ?? 0)).toBeLessThanOrEqual(1);
  });
});
