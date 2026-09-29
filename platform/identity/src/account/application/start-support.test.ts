import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { startSupport, type StartSupportDeps } from './start-support.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OPERATOR = '00000000-0000-4000-8000-0000000000e1';
const LIVE = '00000000-0000-4000-8000-0000000000f1';

function harness(over: Partial<StartSupportDeps> = {}) {
  const begun: Parameters<StartSupportDeps['begin']>[0][] = [];
  const handed: { tenantId: string; sessionId: string }[] = [];
  const start = startSupport({
    supportAgentOf: (id) => Promise.resolve(id === LIVE ? OPERATOR : null),
    begin: (input) => {
      begun.push(input);
      return Promise.resolve(input.tenantId === TENANT);
    },
    issueHandoff: (input) => {
      handed.push(input);
      return Promise.resolve(ok({ code: 'the-code' }));
    },
    clock: fixedClock('2026-09-29T09:00:00.000Z'),
    newId: () => 'session-1',
    ...over,
  });
  return { start, begun, handed };
}

describe('starting support', () => {
  it('acts as the operator the session belongs to', async () => {
    const { start, begun, handed } = harness();

    const result = await start({ operatorSessionId: LIVE, tenantId: TENANT, reason: ' #4821 ' });

    expect(result).toEqual(ok({ code: 'the-code', expiresAt: '2026-09-29T10:00:00.000Z' }));
    expect(begun).toEqual([
      {
        tenantId: TENANT,
        operatorId: OPERATOR,
        reason: '#4821',
        sessionId: 'session-1',
        startedAt: '2026-09-29T09:00:00.000Z',
        // One hour, from the clock, whatever the caller asked for.
        expiresAt: '2026-09-29T10:00:00.000Z',
      },
    ]);
    expect(handed).toEqual([{ tenantId: TENANT, sessionId: 'session-1' }]);
  });

  it('refuses without a live operator session, and starts nothing', async () => {
    const { start, begun, handed } = harness();

    const result = await start({ operatorSessionId: 'stale', tenantId: TENANT, reason: '#4821' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OPERATOR_UNAUTHENTICATED');
    expect(begun).toEqual([]);
    expect(handed).toEqual([]);
  });

  it('refuses without a reason, and starts nothing', async () => {
    const { start, begun } = harness();

    const result = await start({ operatorSessionId: LIVE, tenantId: TENANT, reason: '  ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SUPPORT_REASON_REQUIRED');
    expect(begun).toEqual([]);
  });

  it('issues no code for a company that does not exist', async () => {
    const { start, handed } = harness();

    const result = await start({
      operatorSessionId: LIVE,
      tenantId: '00000000-0000-4000-8000-000000000009',
      reason: '#4821',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TENANT_UNKNOWN');
    expect(handed).toEqual([]);
  });
});
