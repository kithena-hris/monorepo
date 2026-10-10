import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import {
  choicesOf,
  deliverInbox,
  flushDigests,
  type DigestStore,
  type HeldUpdate,
} from './inbox-delivery.js';
import type { SendNoticeRequest } from './send-notice.js';

const base = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  email: 'adam@acme.example',
  url: 'https://acme.app.kithena.com/inbox/todo?item=x',
  companyName: 'Acme',
  dedupeKey: 'k',
};

function world(stored: unknown) {
  const sent: SendNoticeRequest[] = [];
  const held: HeldUpdate[] = [];
  const digests: DigestStore = {
    hold: (e) => {
      held.push(e);
      return Promise.resolve();
    },
    tenantsWaiting: () => Promise.resolve(held.length === 0 ? [] : [base.tenantId]),
    take: () => Promise.resolve(held.splice(0).map((h) => ({ ...h, count: 1 }))),
  };
  const sendNotice = (r: SendNoticeRequest) => {
    sent.push(r);
    return Promise.resolve(ok({ messageId: 'm' }));
  };
  const deliver = deliverInbox({ sendNotice, digests, choices: () => Promise.resolve(stored) });
  return {
    sent,
    held,
    deliver,
    flush: flushDigests({ sendNotice, digests, today: () => '2026-10-10' }),
  };
}

describe('Inbox email, as the person chose', () => {
  it('sends a task now and holds an update for the digest, by default', async () => {
    const w = world(null);
    await w.deliver({
      ...base,
      accountId: 'a',
      notice: { kind: 'inbox_task', topic: 'document_sign' },
    });
    await w.deliver({
      ...base,
      accountId: 'a',
      notice: { kind: 'inbox_update', topic: 'decided' },
    });
    expect(w.sent.map((s) => s.notice.kind)).toEqual(['inbox_task']);
    expect(w.held).toEqual([
      {
        tenantId: base.tenantId,
        email: base.email,
        companyName: base.companyName,
        url: 'https://acme.app.kithena.com/inbox/updates',
      },
    ]);
    expect(await w.flush()).toEqual({ sent: 1, failed: 0 });
    expect(w.sent.at(-1)?.notice).toEqual({ kind: 'inbox_digest', count: 1 });
  });

  it('follows their settings: tasks off are not sent, decided updates right away are', async () => {
    const w = world({ tasks: { asked: { email: 'off' } }, updates: { decided: { email: 'now' } } });
    expect(
      await w.deliver({
        ...base,
        accountId: 'a',
        notice: { kind: 'inbox_task', topic: 'details' },
      }),
    ).toEqual(ok({ outcome: 'skipped' }));
    await w.deliver({
      ...base,
      accountId: 'a',
      notice: { kind: 'inbox_update', topic: 'answered' },
    });
    expect(w.sent.map((s) => s.notice.kind)).toEqual(['inbox_update']);
  });

  it('reads odd settings as the defaults', () => {
    expect(choicesOf({ tasks: { asked: { email: 'sometimes' } } }).task).toBe('now');
    expect(choicesOf('nonsense').team).toBe('off');
  });
});
