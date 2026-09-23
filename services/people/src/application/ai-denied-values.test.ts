import { describe, expect, it, vi } from 'vitest';
import { aiGateway, createPolicyRegistry } from '@kithena/telemetry';

import { aiDeniedValues, deniedValueLookup } from './ai-denied-values.js';
import { define, inMemoryPeople, noTransaction, TENANT, versionOf } from './person/in-memory.js';

const denied = {
  classification: 'special-category',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;

const IBAN = 'DE89370400440532013000';
const ADA = '01890000-0000-7000-8000-00000000000a';

function setup() {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'religion', classification: denied }),
      define({ key: 'iban', classification: denied, encrypted: true }),
      define({ key: 'disabled', classification: denied, dataType: 'boolean', typeConfig: { kind: 'boolean' } }),
      define({ key: 'languages', classification: denied, cardinality: 'repeating' }),
      define({ key: 'secret_note', classification: denied, visibility: [] }),
    ]),
  ]);
  store.seed(ADA, {
    custom: { religion: 'Roman Catholic', disabled: true, languages: ['Basque', 'Occitan'], secret_note: 'hidden' },
  });
  store.secrets.set(`${ADA}:iban`, IBAN);
  const { reader, schemas, relations } = store.deps;
  const deps = {
    reader,
    schemas,
    relations,
    secrets: {
      reveal: (_tx: unknown, where: { personId: string; attributeKey: string }) =>
        Promise.resolve(store.secrets.get(`${where.personId}:${where.attributeKey}`) ?? null),
    },
  };
  return { store, deps };
}

const keys = new Set(['religion', 'iban', 'disabled', 'languages', 'secret_note']);
const hr = { accountId: 'hr-1', roles: new Set(['hr']) };
const colleague = { accountId: 'someone', roles: new Set<string>() };

describe('the values the AI gateway checks free text against', () => {
  it('are every readable denied value, sealed ones revealed, repeating ones flattened, booleans left out', async () => {
    const { deps } = setup();
    const result = await aiDeniedValues(deps)(noTransaction, { tenantId: TENANT, viewer: hr, subjects: [ADA], keys });
    expect(result).toEqual({ ok: true, value: ['Roman Catholic', IBAN, 'Basque', 'Occitan'] });
  });

  it('leave out what the caller may not read, so a refusal cannot answer a question about it', async () => {
    const { deps } = setup();
    const result = await aiDeniedValues(deps)(noTransaction, {
      tenantId: TENANT,
      viewer: colleague,
      subjects: [ADA],
      keys,
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('fail for a person who does not resolve', async () => {
    const { deps } = setup();
    const result = await aiDeniedValues(deps)(noTransaction, {
      tenantId: TENANT,
      viewer: hr,
      subjects: [ADA, '01890000-0000-7000-8000-0000000000ff'],
      keys,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('the gateway over People', () => {
  it('refuses an IBAN pasted with spaces into the instruction, and writes the value nowhere', async () => {
    const { deps } = setup();
    const registry = createPolicyRegistry({ staticRedaction: [], staticAiDeny: [], unknownTenantRedaction: [] });
    registry.replace(TENANT, [
      { key: 'religion', policy: denied },
      { key: 'iban', policy: denied, encrypted: true },
    ]);
    const send = vi.fn(() => Promise.resolve('ok'));
    const inTenant = <R>(_tenant: string, fn: (scope: { tx: typeof noTransaction }) => Promise<R>) =>
      fn({ tx: noTransaction });
    const gateway = aiGateway({ registry, send, deniedValues: deniedValueLookup(inTenant, deps) });

    const written: string[] = [];
    const keep = (...args: unknown[]) => {
      written.push(args.map(String).join(' '));
      return true;
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(keep);
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    const result = await gateway.complete(
      TENANT,
      { instruction: 'Write to the bank about DE89 3704 0044 0532 0130 00', context: {} },
      { caller: hr, ids: [ADA] },
    );
    vi.restoreAllMocks();

    expect(result).toMatchObject({ ok: false, error: { code: 'AI_VALUE_DENIED' } });
    expect(send).not.toHaveBeenCalled();
    expect([...written, JSON.stringify(result)].join('\n')).not.toMatch(/DE89|Catholic/);
  });
});
