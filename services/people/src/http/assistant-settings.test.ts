import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';
import { aiGateway, createPolicyRegistry } from '@kithena/telemetry';

import { inMemoryNumbers, inMemoryOrg } from '../application/org/in-memory.js';
import { orgAdmin } from '../application/org/org.js';
import { inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import type { Viewer } from '../application/person/ports.js';
import type { ActivityEntry } from '../application/settings/activity-store.js';
import {
  ANSWERS,
  COMPLEX,
  fakePlanner,
  MEDIUM,
  OUT_OF_SCOPE,
  SIMPLE,
} from '../application/assistant/settings-fixtures.js';
import type { AssistantPort } from '../application/assistant/assistant-port.js';
import { PlanBudget, specOf, type Plan, type ToolCall } from '../domain/assistant/settings-plan.js';
import { settingsPrompt } from '../domain/assistant/settings-prompt.js';
import { snapshot as fixtureSnapshot, FIELDS } from '../domain/assistant/settings.fixture.js';
import type { Attribute, Section } from '../domain/schema/draft.js';
import { inMemoryIdempotency } from './idempotency.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';
import { screenRoutes, type ScreenRouteDeps } from './screens.js';

/**
 * The whole pipeline, as REST runs it, with a fake model deterministic from
 * recorded answers: a request becomes a plan, the plan is applied through the
 * settings routes the screens use, and each change lands in the draft and
 * the settings log — as done with the AI assistant, never with the request.
 */

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const HR_ONLY = '00000000-0000-4000-8000-0000000000a2';
const OPERATOR = '00000000-0000-4000-8000-0000000000e1';
const clock = fixedClock('2026-09-29T10:00:00.000Z');

const section = (
  key: string,
  label: string,
  order: number,
  origin: Section['origin'] = 'tenant',
): Section =>
  ({
    key,
    label: { default: label, translations: {} },
    order,
    defaultVisibility: ['self', 'hr'],
    origin,
    archivedAt: null,
  }) as Section;

function world(
  options: {
    viewer?: Viewer;
    planner?: AssistantPort;
    budget?: PlanBudget;
    sections?: Section[];
    attributes?: Attribute[];
  } = {},
) {
  const sections = new Map<string, Section>(
    (
      options.sections ?? [
        section('personal', 'Personal information', 0, 'core'),
        section('bank', 'Bank', 1),
      ]
    ).map((s) => [s.key, s]),
  );
  const attributes = new Map<string, Attribute>(
    (options.attributes ?? FIELDS.filter((f) => f.key !== 'contract_type')).map((a) => [a.key, a]),
  );
  const people = inMemoryPeople([versionOf(1, [])]);
  const org = inMemoryOrg();
  let n = 0;
  const newId = () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`;
  const recorded: ActivityEntry[] = [];
  const viewer = options.viewer ?? {
    accountId: ADMIN,
    roles: new Set(['people_admin', 'hr', 'finance']),
  };
  const service = {
    access: personAccess(people.deps),
    schemas: people.deps.schemas,
    inTenant: <R>(_tenant: string, fn: (s: { tx: never }) => Promise<R>) => fn({ tx: {} as never }),
    org: orgAdmin({ store: org.store, numbers: inMemoryNumbers(), clock, newId }),
  };
  let rest: (request: RestRequest) => Promise<RestResponse | null> = () => Promise.resolve(null);
  const deps = {
    service,
    relations: people.deps.relations,
    clock,
    calendars: { load: () => org.store.load({} as never, TENANT) },
    personOf: () => Promise.resolve(null),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    schema: {
      loadDraft: () =>
        Promise.resolve({ sections: [...sections.values()], attributes: [...attributes.values()] }),
      currentVersion: () => Promise.resolve(null),
      appendVersion: () => Promise.resolve(),
    },
    draft: {
      saveSection: (_tx: never, _t: string, s: Section) => {
        sections.set(s.key, s);
        return Promise.resolve();
      },
      saveAttribute: (_tx: never, _t: string, a: Attribute) => {
        attributes.set(a.key, a);
        return Promise.resolve();
      },
      orderSections: (_tx: never, _t: string, keys: readonly string[]) => {
        keys.forEach((k, i) => {
          const s = sections.get(k);
          if (s) sections.set(k, { ...s, order: i });
        });
        return Promise.resolve();
      },
      orderAttributes: (_tx: never, _t: string, _s: string, keys: readonly string[]) => {
        keys.forEach((k, i) => {
          const a = attributes.get(k);
          if (a) attributes.set(k, { ...a, order: i });
        });
        return Promise.resolve();
      },
    },
    settingsAssistant: {
      budget: options.budget ?? new PlanBudget(20, 3_600_000),
      dispatch: (r: RestRequest) => rest(r),
      ...(options.planner === undefined ? {} : { planner: options.planner }),
    },
  } as unknown as ScreenRouteDeps;
  const idempotency = inMemoryIdempotency();
  rest = restHandler({
    service: service,
    callerFrom: () =>
      ok({ tenantId: TENANT, viewer, correlationId: '00000000-0000-4000-8000-0000000000c1' }),
    idempotency,
    screens: screenRoutes(deps, idempotency),
    activity: {
      store: {
        record: (_tx, _tenant, e) => {
          recorded.push(e);
          return Promise.resolve();
        },
      },
      newId,
      now: () => clock.instant(),
    },
  });
  const call = async (method: string, url: string, body: unknown, key?: string) => {
    const answer = await rest({
      method,
      url,
      headers: key === undefined ? {} : { 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    if (answer === null) throw new Error(`no route ${method} ${url}`);
    return answer;
  };
  const plan = async (request: string) => call('POST', '/v1/assistant/settings/plan', { request });
  const apply = async (p: Plan, only?: (id: string) => boolean) => {
    const kept = p.changes.filter((c) => only?.(c.id) ?? true);
    return call(
      'POST',
      '/v1/assistant/settings/apply',
      {
        summary: p.summary,
        changes: kept.map((c) => ({ id: c.id, ...c.change })),
        confirmed: kept.filter((c) => c.confirm !== null).map((c) => c.id),
      },
      'apply-1',
    );
  };
  return { sections, attributes, org, recorded, call, plan, apply };
}

const planOf = (answer: RestResponse): Plan => answer.body as Plan;

describe('a request in words, planned and applied', () => {
  it('a simple one: one field, in the draft, logged as done with the assistant', async () => {
    const w = world({ planner: fakePlanner() });
    const p = planOf(await w.plan(SIMPLE));
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]).toMatchObject({
      title: 'Add a field',
      subject: 'T-shirt size in Personal information',
      confirm: null,
      problem: null,
    });
    const applied = await w.apply(p);
    expect(applied.body).toMatchObject({ applied: 1, failed: 0, publish: true });
    expect(w.attributes.get('t_shirt_size')).toMatchObject({
      sectionKey: 'personal',
      classificationSource: 'suggested',
    });
    expect(w.recorded).toEqual([
      expect.objectContaining({
        action: 'Added a field with the AI assistant',
        subject: 'T-shirt size',
        reason:
          'With the AI assistant: Adds an optional T-shirt size field to Personal information.',
      }),
    ]);
    expect(JSON.stringify(w.recorded)).not.toContain(SIMPLE);
  });

  it('a medium one: edits relative to what exists, and a sensitive field needs ticking on purpose', async () => {
    const w = world({ planner: fakePlanner() });
    const p = planOf(await w.plan(MEDIUM));
    expect(p.changes.map((c) => [c.title, c.subject, c.confirm !== null])).toEqual([
      ['Rename a section', 'Bank', false],
      ['Add a field', 'IBAN in Payment', true],
    ]);
    // Not ticked: refused whole, nothing applied.
    const unticked = await w.call(
      'POST',
      '/v1/assistant/settings/apply',
      {
        summary: p.summary,
        changes: p.changes.map((c) => ({ id: c.id, ...c.change })),
        confirmed: [],
      },
      'apply-0',
    );
    expect(unticked.status).toBe(409);
    expect(w.sections.get('bank')?.label.default).toBe('Bank');
    expect((await w.apply(p)).body).toMatchObject({ applied: 2, failed: 0 });
    expect(w.sections.get('bank')?.label.default).toBe('Payment');
    expect(w.attributes.get('iban')).toMatchObject({
      sectionKey: 'bank',
      encrypted: true,
      classification: { classification: 'confidential', piiKind: 'financial', aiEligible: false },
      typeConfig: { kind: 'bank_account', country: 'ES' },
    });
  });

  it('the complex one: a whole Spanish company in one valid plan, applied in order', async () => {
    const w = world({ planner: fakePlanner() });
    await w.call(
      'POST',
      '/v1/legal-entities',
      { name: 'Acme Iberia SL', country: 'ES', timeZone: 'Europe/Madrid' },
      'e1',
    );
    w.recorded.length = 0;
    const p = planOf(await w.plan(COMPLEX));
    expect(p.changes.filter((c) => c.problem !== null)).toEqual([]);
    expect(p.unreadable).toBe(0);
    // NIF comes with the pack; IBAN and the tax rate are flagged.
    expect(p.changes[0]?.change.kind).toBe('add_country_pack');
    expect(p.changes.filter((c) => c.confirm !== null).map((c) => c.subject)).toEqual([
      'IBAN in Bank and tax',
      'IRPF withholding rate in Bank and tax',
    ]);
    const applied = (await w.apply(p)).body as { applied: number; failed: number };
    expect(applied).toMatchObject({ failed: 0, applied: p.changes.length });
    expect(w.attributes.get('es_nif')).toMatchObject({ encrypted: true, origin: 'country_pack' });
    // Managers see the contract, not the bank.
    expect(w.attributes.get('weekly_hours')?.visibility).toContain('manager');
    expect(w.attributes.get('iban')?.visibility).not.toContain('manager');
    expect([...w.sections.values()].map((s) => s.label.default)).toEqual(
      expect.arrayContaining([
        'Personal details',
        'Contract',
        'Bank and tax',
        'Emergency contact',
        'Equipment',
      ]),
    );
    const locations = await w.call('GET', '/v1/locations', undefined);
    expect(locations.body).toMatchObject({ items: [{ name: 'Barcelona office', country: 'ES' }] });
    expect(w.recorded.every((e) => e.action.endsWith(' with the AI assistant'))).toBe(true);
    expect(w.recorded.map((e) => e.action)).toContain(
      'Added a work location with the AI assistant',
    );
  });

  it('refuses what needs a secret, and links to where it is done', async () => {
    const w = world({ planner: fakePlanner() });
    const p = planOf(await w.plan(OUT_OF_SCOPE));
    expect(p.changes).toEqual([]);
    expect(p.refused.map((r) => r.href)).toEqual([
      '/settings/people/integrations?tab=chat',
      '/settings/people/integrations?tab=webhooks',
    ]);
  });
});

describe('who may, and how often', () => {
  it('is a People administrator’s: HR alone is refused, and the model is never asked', async () => {
    const planner = fakePlanner();
    const w = world({ planner, viewer: { accountId: HR_ONLY, roles: new Set(['hr']) } });
    expect((await w.plan(SIMPLE)).status).toBe(403);
    expect(planner.prompts).toEqual([]);
  });

  it('is Kithena support’s too, logged as support with the plan as the reason', async () => {
    const w = world({
      planner: fakePlanner(),
      viewer: {
        accountId: ADMIN,
        roles: new Set(['people_admin', 'hr', 'finance']),
        support: { operatorId: OPERATOR, reason: 'Ticket 7' },
      },
    });
    await w.apply(planOf(await w.plan(SIMPLE)));
    expect(w.recorded[0]).toMatchObject({
      onBehalfOf: OPERATOR,
      reason:
        'Ticket 7 · With the AI assistant: Adds an optional T-shirt size field to Personal information.',
    });
  });

  it('allows so many plans an hour per company', async () => {
    const w = world({ planner: fakePlanner(), budget: new PlanBudget(1, 3_600_000) });
    expect((await w.plan(SIMPLE)).status).toBe(200);
    const second = await w.plan(SIMPLE);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('says so when no model is configured', async () => {
    expect((await world().plan(SIMPLE)).body).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });

  it('never sends a request carrying a value: the gateway refuses it first', async () => {
    const registry = createPolicyRegistry({
      staticRedaction: [],
      staticAiDeny: [],
      unknownTenantRedaction: [],
    });
    registry.replace(TENANT, []);
    const sent: unknown[] = [];
    const gateway = aiGateway({
      registry,
      send: (p) => (sent.push(p), Promise.resolve('{"calls":[]}')),
    });
    const w = world({
      planner: {
        loadPolicies: () => Promise.resolve(),
        complete: (t, p) => gateway.complete(t, p),
      },
    });
    const refused = await w.plan('Add Maria García, her IBAN is ES91 2100 0418 4502 0005 1332');
    expect(refused.body).toMatchObject({ error: { code: 'REQUEST_HOLDS_VALUE' } });
    expect(sent).toEqual([]);
  });

  it('shows the model the settings and the request, never a person', async () => {
    const planner = fakePlanner();
    await world({ planner }).plan(SIMPLE);
    const sent = JSON.stringify(planner.prompts);
    expect(planner.prompts[0]?.about).toBe('configuration');
    expect(sent).not.toContain(ADMIN);
    expect(sent).toContain('shirt_size');
  });
});

describe('a copied setting, planned again elsewhere', () => {
  // What a faithful planner answers for each copied prompt: recorded against
  // the exact text, so a change to the generator fails here until re-recorded.
  const source = fixtureSnapshot();
  const field = (settingsPrompt(source, { kind: 'field', key: 'shirt_size' }) ?? '').trim();
  const personal = (settingsPrompt(source, { kind: 'section', key: 'personal' }) ?? '').trim();
  const all = (settingsPrompt(source, { kind: 'fields' }) ?? '').trim();
  const add = (a: Attribute): ToolCall => ({ name: 'add_field', input: { field: specOf(a) } });
  const addSection = (key: string): ToolCall => ({
    name: 'add_section',
    input: { key, label: source.sections.find((s) => s.key === key)?.label },
  });
  const done: ToolCall = {
    name: 'finish_plan',
    input: { summary: 'Recreates the copied settings.' },
  };
  const answers = {
    ...ANSWERS,
    [field]: [add(FIELDS[1] as Attribute), done],
    [personal]: [
      addSection('personal'),
      ...FIELDS.filter((f) => f.sectionKey === 'personal').map(add),
      done,
    ],
    [all]: [addSection('personal'), addSection('bank'), ...FIELDS.map(add), done],
  };

  const same = (a: Attribute | undefined, b: Attribute) => {
    expect(a === undefined ? undefined : { ...specOf(a), origin: a.origin }).toEqual({
      ...specOf(b),
      origin: 'tenant',
    });
  };

  it('recreates an equal field in a company that lacks it', async () => {
    const w = world({
      planner: fakePlanner(answers),
      attributes: FIELDS.filter((f) => f.key === 'given_name'),
    });
    const p = planOf(await w.plan(field));
    expect((await w.apply(p)).body).toMatchObject({ failed: 0 });
    same(w.attributes.get('shirt_size'), FIELDS[1] as Attribute);
  });

  it('recreates an equal section, fields in order', async () => {
    const w = world({ planner: fakePlanner(answers), sections: [], attributes: [] });
    const p = planOf(await w.plan(personal));
    expect((await w.apply(p)).body).toMatchObject({ failed: 0 });
    expect(w.sections.get('personal')?.label.default).toBe('Personal information');
    for (const f of FIELDS.filter((x) => x.sectionKey === 'personal'))
      same(w.attributes.get(f.key), f);
  });

  it('recreates the whole employee-field schema', async () => {
    const w = world({ planner: fakePlanner(answers), sections: [], attributes: [] });
    const p = planOf(await w.plan(all));
    expect((await w.apply(p)).body).toMatchObject({ failed: 0 });
    for (const f of FIELDS) same(w.attributes.get(f.key), f);
    expect([...w.sections.keys()]).toEqual(['personal', 'bank']);
  });
});
