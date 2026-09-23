import { describe, expect, it, vi } from 'vitest';

import { aiGateway } from './ai-gateway.js';
import { createPolicyRegistry } from './policy-registry.js';

const ACME = 'acme';

function setup() {
  const registry = createPolicyRegistry({
    staticRedaction: [],
    staticAiDeny: ['payload.name.given'],
    unknownTenantRedaction: [],
  });
  const send = vi.fn(() => Promise.resolve('model says hi'));
  return { registry, send, gateway: aiGateway({ registry, send }) };
}

describe('the AI gateway', () => {
  it('refuses a prompt carrying a tenant-defined special-category attribute', async () => {
    const { registry, send, gateway } = setup();
    registry.replace(ACME, [
      {
        key: 'religion',
        policy: {
          classification: 'special-category',
          piiKind: 'none',
          exportable: true,
          aiEligible: false,
        },
      },
    ]);

    const result = await gateway.complete(ACME, {
      instruction: 'Summarise this person',
      context: { people: [{ custom: { department: 'ops', religion: 'x' } }] },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'AI_FIELD_DENIED', path: ['people', 'custom', 'religion'] } });
    // Refused, not filtered: nothing reached the model at all.
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a statically denied contract path', async () => {
    const { registry, send, gateway } = setup();
    registry.replace(ACME, []);
    const result = await gateway.complete(ACME, {
      instruction: 'x',
      context: { payload: { name: { given: 'Ada' } } },
    });
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses everything for a tenant whose policies are not loaded', async () => {
    const { send, gateway } = setup();
    const result = await gateway.complete(ACME, { instruction: 'x', context: {} });
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_POLICY_UNKNOWN' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a prompt with only eligible fields', async () => {
    const { registry, send, gateway } = setup();
    registry.replace(ACME, [
      { key: 'department', policy: { classification: 'internal', piiKind: 'none', exportable: true, aiEligible: true } },
    ]);
    const result = await gateway.complete(ACME, { instruction: 'x', context: { custom: { department: 'ops' } } });
    expect(result).toEqual({ ok: true, value: 'model says hi' });
    expect(send).toHaveBeenCalledOnce();
  });
});
