import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiGateway, type DeniedValueLookup, type Subjects } from './ai-gateway.js';
import { createPolicyRegistry } from './policy-registry.js';

const ACME = 'acme';

const denied = {
  classification: 'special-category',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;

function setup(deniedValues?: DeniedValueLookup) {
  const registry = createPolicyRegistry({
    staticRedaction: [],
    staticAiDeny: ['payload.name.given'],
    unknownTenantRedaction: [],
  });
  const send = vi.fn(() => Promise.resolve('model says hi'));
  return { registry, send, gateway: aiGateway({ registry, send, ...(deniedValues ? { deniedValues } : {}) }) };
}

describe('the AI gateway', () => {
  it('refuses a prompt carrying a tenant-defined special-category attribute', async () => {
    const { registry, send, gateway } = setup();
    registry.replace(ACME, [{ key: 'religion', policy: denied }]);

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

describe('free text, with subjects named', () => {
  const IBAN = 'DE89370400440532013000';
  const NIF = '12345678Z';
  const subjects: Subjects = { caller: { accountId: 'a-1', roles: new Set(['hr']) }, ids: ['p-1', 'p-2'] };
  const lookup = vi.fn<DeniedValueLookup>(() => Promise.resolve({
      ok: true,
      value: [
        { key: 'iban', value: IBAN },
        { key: 'national_id', value: NIF },
        { key: 'religion', value: 'Roman Catholic' },
        { key: 'blood_type', value: 'A' },
        { key: 'date_of_birth', value: '1990-01-02' },
      ],
    }));

  function loaded() {
    const s = setup(lookup);
    s.registry.replace(ACME, [
      { key: 'iban', policy: denied, encrypted: true },
      { key: 'national_id', policy: denied, labels: ['NIF'] },
      { key: 'religion', policy: denied },
      { key: 'blood_type', policy: denied, labels: ['Blood group'] },
      { key: 'date_of_birth', policy: denied, labels: ['Date of birth'] },
    ]);
    return s;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    lookup.mockClear();
  });

  it.each([
    ['an IBAN split by spaces', 'Draft a payslip note for DE89 3704 0044 0532 0130 00', {}],
    ['a NIF split by a dash', 'Check whether 12345678-z is valid', {}],
    ['a value in a string under an innocent key', 'Summarise', { notes: 'she is roman catholic' }],
    ['a one-letter value next to its field’s name', 'Their blood group: A. Draft a donor letter', {}],
    ['a date of birth written out', 'Plan something for Jan 2, 1990 birthdays', {}],
  ] as [string, string, Record<string, unknown>][])('refuses %s, and sends nothing', async (_what, instruction, context) => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, { instruction, context }, subjects);
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_VALUE_DENIED' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('asks for the denied keys of exactly the named subjects', async () => {
    const { gateway } = loaded();
    await gateway.complete(ACME, { instruction: 'Summarise their tenure', context: {} }, subjects);
    expect(lookup).toHaveBeenCalledWith(
      ACME,
      subjects,
      new Set(['iban', 'national_id', 'religion', 'blood_type', 'date_of_birth']),
    );
  });

  it('sends ordinary prose containing a one-letter denied value as a word', async () => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, { instruction: 'Write a short note to a new starter', context: {} }, subjects);
    expect(result).toEqual({ ok: true, value: 'model says hi' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('sends a prompt that names a denied field but carries none of its values', async () => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, { instruction: 'Do not mention religion or the NIF', context: {} }, subjects);
    expect(result).toEqual({ ok: true, value: 'model says hi' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('refuses when the subjects cannot be resolved, or nothing can resolve them', async () => {
    const failing = setup(() => Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'No such person' } }));
    failing.registry.replace(ACME, [{ key: 'religion', policy: denied }]);
    await expect(failing.gateway.complete(ACME, { instruction: 'x', context: {} }, subjects)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AI_SUBJECTS_UNRESOLVED' },
    });

    const unwired = setup();
    unwired.registry.replace(ACME, [{ key: 'religion', policy: denied }]);
    await expect(unwired.gateway.complete(ACME, { instruction: 'x', context: {} }, subjects)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AI_SUBJECTS_UNRESOLVED' },
    });
    expect(failing.send).not.toHaveBeenCalled();
    expect(unwired.send).not.toHaveBeenCalled();
  });

  it('never writes a denied value anywhere: not to a console, not to stdout, not into the refusal', async () => {
    const written: string[] = [];
    const keep = (...args: unknown[]) => {
      written.push(args.map(String).join(' '));
      return true;
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    vi.spyOn(process.stderr, 'write').mockImplementation(keep);

    const { gateway } = loaded();
    const result = await gateway.complete(ACME, { instruction: `pay ${IBAN}`, context: {} }, subjects);
    vi.restoreAllMocks();

    expect(result.ok).toBe(false);
    const everything = [...written, JSON.stringify(result)].join('\n');
    for (const value of [IBAN, NIF, 'Roman Catholic', 'DE89']) expect(everything).not.toContain(value);
  });
});

describe('free text, with no subjects named', () => {
  function loaded() {
    const s = setup();
    s.registry.replace(ACME, [{ key: 'blood_type', policy: denied, labels: ['Blood group', 'Groupe sanguin'] }]);
    return s;
  }

  it.each([
    ['its key', 'List everyone by blood_type', {}],
    ['its key, spaced', 'List everyone by Blood Type', {}],
    ['its label', 'what is their blood group?', {}],
    ['a translated label', 'Quel est le groupe sanguin ?', {}],
    ['a label inside the context', 'Summarise', { question: 'BLOOD-GROUP' }],
  ] as [string, string, Record<string, unknown>][])('refuses a prompt naming the denied field by %s, and says why', async (_what, instruction, context) => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, { instruction, context });
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_FIELD_NAMED' } });
    if (!result.ok) expect(result.error.message).toContain('No subjects were named');
    expect(send).not.toHaveBeenCalled();
  });

  it('treats an empty subject list as naming nobody', async () => {
    const { gateway } = loaded();
    const result = await gateway.complete(
      ACME,
      { instruction: 'blood type please', context: {} },
      { caller: { accountId: 'a', roles: new Set() }, ids: [] },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_FIELD_NAMED' } });
  });

  it('sends a prompt that names nothing denied', async () => {
    const { send, gateway } = loaded();
    await expect(gateway.complete(ACME, { instruction: 'Summarise the team’s tenure', context: {} })).resolves.toEqual({
      ok: true,
      value: 'model says hi',
    });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('a prompt about configuration', () => {
  function loaded() {
    const s = setup();
    s.registry.replace(ACME, [{ key: 'iban', policy: denied, labels: ['IBAN'] }]);
    return s;
  }
  const settings = {
    request: 'Mark the IBAN field as sensitive, and add a section for blood group',
    fields: [{ key: 'iban', label: 'IBAN' }],
    entity: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  };

  it('may name a denied field, since fields are its subject, and sends it', async () => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, {
      instruction: 'Plan it',
      context: settings,
      about: 'configuration',
    });
    expect(result).toEqual({ ok: true, value: 'model says hi' });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ['an IBAN', 'Add Maria, ES91 2100 0418 4502 0005 1332'],
    ['a national identifier', 'her NIF is 12345678Z'],
    ['a phone number', 'call +34 600 123 456'],
    ['an email address', 'make maria@acme.example HR'],
    ['a date in figures', 'born 02/01/1990'],
  ])('refuses one carrying something shaped like a value: %s', async (_what, request) => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, {
      instruction: 'Plan it',
      context: { ...settings, request },
      about: 'configuration',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_VALUE_SHAPED' } });
    // Says what it saw, never the text.
    if (!result.ok) expect(result.error.message).not.toContain(request);
    expect(send).not.toHaveBeenCalled();
  });

  it('still refuses a denied key in its structure, and an unloaded tenant', async () => {
    const { gateway } = loaded();
    await expect(
      gateway.complete(ACME, { instruction: 'x', context: { iban: 'x' }, about: 'configuration' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AI_FIELD_DENIED' } });
    await expect(
      gateway.complete('nobody', { instruction: 'x', context: {}, about: 'configuration' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AI_POLICY_UNKNOWN' } });
  });
});

describe('a prompt about aggregates', () => {
  function loaded() {
    const s = setup();
    s.registry.replace(ACME, [{ key: 'iban', policy: denied, labels: ['IBAN'] }]);
    return s;
  }
  const facts = {
    tab: 'headcount',
    facts: ['Headcount up {n1} since last month, to {n2}.', 'Most joiners this month are in {g1}.'],
  };

  it('sends sentences whose figures and groups are placeholders', async () => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, {
      instruction: 'Phrase it',
      context: facts,
      about: 'aggregates',
    });
    expect(result).toEqual({ ok: true, value: 'model says hi' });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ['a figure', { ...facts, facts: ['Headcount up 8 since last month, to {n2}.'] }],
    ['a number', { ...facts, headcount: 128 }],
    ['a percentage', { ...facts, facts: ['Attrition flat at 4.3% over the last year.'] }],
    ['an email address', { ...facts, facts: ['Ask maria@acme.example about {g1}.'] }],
  ])('refuses one carrying %s', async (_what, context) => {
    const { send, gateway } = loaded();
    const result = await gateway.complete(ACME, {
      instruction: 'Phrase it',
      context,
      about: 'aggregates',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_VALUE_SHAPED' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('still refuses a denied key, and a denied field by name, since nobody is named', async () => {
    const { gateway } = loaded();
    await expect(
      gateway.complete(ACME, { instruction: 'x', context: { iban: 'x' }, about: 'aggregates' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AI_FIELD_DENIED' } });
    await expect(
      gateway.complete(ACME, {
        instruction: 'x',
        context: { facts: ['Most missing details are in IBAN.'] },
        about: 'aggregates',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AI_FIELD_NAMED' } });
  });
});
