import { describe, expect, it, vi } from 'vitest';
import { aiGateway, createPolicyRegistry, type Prompt } from '@kithena/telemetry';

import { PlanBudget } from '../../domain/import/new-fields.js';
import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';
import {
  exportViewWith,
  planDirectory,
  planExport,
  remindDirectory,
  type SelectionDeps,
} from './selection.js';

/**
 * Search and export in words, end to end with a fake model behind the real
 * AI gateway: what the model is shown, what People does with its answer, and
 * what happens when there is no answer to use.
 */

const DWIGHT = '00000000-0000-4000-8000-0000000000d2';
const JIM = '00000000-0000-4000-8000-0000000000d3';
const TOBY_ACCOUNT = '00000000-0000-4000-8000-0000000000e4';

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;
const select = (key: string, label: string, options: readonly [string, string][]) =>
  define({
    key,
    label: { default: label },
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: options.map(([value, text]) => ({
        value,
        label: { default: text },
        retiredAt: null,
      })),
    },
    visibility: [...everyone],
    indexed: true,
  });
const attributes = [
  define({ key: 'given_name', label: { default: 'First name' }, visibility: [...everyone] }),
  define({ key: 'family_name', label: { default: 'Last name' }, visibility: [...everyone] }),
  define({ key: 'job_title', label: { default: 'Job title' }, visibility: [...everyone] }),
  select('department', 'Department', [
    ['sales', 'Sales'],
    ['eng', 'Engineering'],
  ]),
  select('office', 'Office', [
    ['bcn', 'Barcelona'],
    ['mad', 'Madrid'],
  ]),
  define({
    key: 'start_on',
    label: { default: 'Start date' },
    dataType: 'date',
    typeConfig: { kind: 'date' },
    visibility: [...everyone],
  }),
  // Not for a model: named to it for "is empty" alone, never its options or values.
  define({
    key: 'emergency_contact',
    label: { default: 'Emergency contact' },
    visibility: ['self', 'hr'],
    // The employee fills it in, so they may be asked for it.
    ownership: ['employee', 'hr'],
    classification: {
      classification: 'confidential',
      piiKind: 'contact',
      exportable: true,
      aiEligible: false,
    },
  }),
];

function world(options: {
  answer?: (prompt: Prompt) => string | Promise<string>;
  model?: false;
  budget?: number;
}) {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  store.seed(DWIGHT, {
    custom: {
      given_name: 'Dwight',
      family_name: 'Schrute',
      job_title: 'Salesman',
      department: 'sales',
      office: 'bcn',
      emergency_contact: 'Mose Schrute',
    },
  });
  store.seed(JIM, {
    custom: { given_name: 'Jim', family_name: 'Halpert', job_title: 'Engineer', department: 'eng' },
  });
  const service: PeopleService = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  // The real gateway, with this tenant's policies: the fake model is behind it.
  const registry = createPolicyRegistry({
    staticRedaction: [],
    staticAiDeny: [],
    unknownTenantRedaction: [],
  });
  const sent: Prompt[] = [];
  const send = vi.fn(async (prompt: Prompt) => {
    sent.push(prompt);
    return options.answer === undefined ? '{}' : options.answer(prompt);
  });
  const gateway = aiGateway({ registry, send });
  const budget = new PlanBudget(options.budget ?? 10, 3_600_000);
  const deps: SelectionDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: () => Promise.resolve(null),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    searchBudget: budget,
    exportBudget: budget,
    ...(options.model === false
      ? {}
      : {
          selectionPlanner: {
            loadPolicies: () => {
              registry.replace(
                TENANT,
                attributes.map((a) => ({
                  key: a.key,
                  policy: a.classification,
                  labels: [a.label.default],
                })),
              );
              return Promise.resolve();
            },
            complete: (tenant, prompt) => gateway.complete(tenant, prompt),
          },
        }),
  };
  const asking = {
    tenantId: TENANT,
    viewer: { accountId: TOBY_ACCOUNT, roles: new Set(['hr']) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  };
  return { deps, asking, sent, send };
}

const RECORD_VALUES = ['Dwight', 'Schrute', 'Halpert', 'Salesman', 'Mose', DWIGHT, JIM];

describe('searching the directory in words', () => {
  it('a name alone searches names, and no model is asked', async () => {
    const w = world({});
    const plan = await planDirectory(w.deps, w.asking, { sentence: 'Dwight Schrute' });
    expect(plan.ok && plan.value).toMatchObject({
      search: 'Dwight Schrute',
      conditions: [],
      by: 'search',
    });
    expect(w.send).not.toHaveBeenCalled();
  });

  it('shows the model the sentence and field names, never a record, and runs what it answered', async () => {
    const w = world({
      answer: () =>
        JSON.stringify({
          conditions: [
            { key: 'job_title', op: 'contains', values: ['engineer'] },
            { key: 'office', op: 'in', values: ['Barcelona'] },
          ],
        }),
    });
    const plan = await planDirectory(w.deps, w.asking, { sentence: 'engineers in Barcelona' });
    expect(plan.ok && plan.value).toEqual({
      search: null,
      conditions: [
        { key: 'job_title', op: 'contains', values: ['engineer'] },
        { key: 'office', op: 'in', values: ['bcn'] },
      ],
      match: 'all',
      sort: null,
      unused: [],
      by: 'assistant',
      note: null,
      person: null,
      ask: null,
      refused: [],
      remembered: null,
    });
    const [prompt] = w.sent;
    expect(prompt?.about).toBe('configuration');
    expect(prompt?.context['sentence']).toBe('engineers in Barcelona');
    const text = JSON.stringify(prompt);
    for (const value of RECORD_VALUES) expect(text).not.toContain(value);
    // The field not for the assistant: its name, for "is empty" alone.
    expect(prompt?.context['fields']).toContainEqual({
      key: 'emergency_contact',
      label: 'Emergency contact',
      kind: 'presence',
      options: [],
    });
  });

  it('what looks like somebody’s details never leaves: People’s rules read it instead', async () => {
    const w = world({ answer: () => '{"conditions":[]}' });
    const plan = await planDirectory(w.deps, w.asking, {
      sentence: 'in Sales like dwight@dundermifflin.com',
    });
    expect(w.send).not.toHaveBeenCalled();
    expect(plan.ok && plan.value).toMatchObject({
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      by: 'rules',
    });
    expect(plan.ok && plan.value.note).toMatch(/looks like somebody’s details/u);
    const long = await planDirectory(w.deps, w.asking, {
      sentence: 'Sales with IBAN ES9121000418450200051332',
    });
    expect(long.ok && long.value.by).toBe('rules');
    expect(w.send).not.toHaveBeenCalled();
  });

  it('with no model, a spent budget, a failure or an answer it cannot use, the rules stand and say why', async () => {
    const none = world({ model: false });
    const read = await planDirectory(none.deps, none.asking, {
      sentence: 'people missing an emergency contact',
    });
    expect(read.ok && read.value).toMatchObject({
      conditions: [{ key: 'emergency_contact', op: 'empty', values: [] }],
      by: 'rules',
    });
    expect(read.ok && read.value.note).toMatch(/isn’t set up/u);

    const spent = world({
      budget: 1,
      answer: () => '{"conditions":[{"key":"department","op":"in","values":["eng"]}]}',
    });
    await planDirectory(spent.deps, spent.asking, { sentence: 'in Engineering' });
    const second = await planDirectory(spent.deps, spent.asking, { sentence: 'in Sales' });
    expect(second.ok && second.value).toMatchObject({ by: 'rules' });
    expect(second.ok && second.value.note).toMatch(/enough for this hour/u);
    expect(spent.send).toHaveBeenCalledTimes(1);

    const slow = world({ answer: () => Promise.reject(new Error('timeout')) });
    const late = await planDirectory(slow.deps, slow.asking, { sentence: 'in Sales' });
    expect(late.ok && late.value).toMatchObject({
      by: 'rules',
      conditions: [{ key: 'department' }],
    });
    expect(late.ok && late.value.note).toMatch(/in time/u);

    const odd = world({
      answer: () => '{"conditions":[{"key":"salary","op":"after","values":["1"]}]}',
    });
    const unread = await planDirectory(odd.deps, odd.asking, { sentence: 'in Sales' });
    expect(unread.ok && unread.value).toMatchObject({ by: 'rules' });
    expect(unread.ok && unread.value.note).toMatch(/couldn’t be used/u);
  });
});

describe('an export described in words', () => {
  it('the model chooses among what the builder offers; the audience is counted as the viewer lists it', async () => {
    const w = world({
      answer: () =>
        JSON.stringify({
          fields: ['given_name', 'family_name', 'start_on'],
          audience: {
            kind: 'conditions',
            conditions: [{ key: 'department', op: 'in', values: ['Sales'] }],
          },
          asOf: null,
          format: 'csv',
          photos: false,
          reason: 'Headcount for the sales team',
        }),
    });
    const plan = await planExport(w.deps, w.asking, {
      sentence: 'names and start dates of sales as a csv',
    });
    expect(plan.ok && plan.value).toMatchObject({
      who: 'conditions',
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      audience: 'Everybody whose department is Sales',
      fields: ['given_name', 'family_name', 'start_on'],
      format: 'csv',
      reason: 'Headcount for the sales team',
      by: 'assistant',
    });
    expect(plan.ok && typeof plan.value.count).toBe('number');
    const text = JSON.stringify(w.sent[0]);
    for (const value of RECORD_VALUES) expect(text).not.toContain(value);
  });

  it('a field the builder does not offer refuses the answer; People’s rules draft it instead', async () => {
    const w = world({
      answer: () =>
        JSON.stringify({ fields: ['given_name', 'health'], audience: { kind: 'everyone' } }),
    });
    const plan = await planExport(w.deps, w.asking, {
      sentence: 'first name and department for Sales',
    });
    expect(plan.ok && plan.value).toMatchObject({
      by: 'rules',
      fields: ['given_name', 'department'],
      who: 'conditions',
    });
    expect(plan.ok && plan.value.reason).toMatch(/^People data for Sales, as of /u);
  });

  it('the builder offers the directory’s conditions as one more audience, and refuses ones the viewer cannot run', async () => {
    const w = world({ model: false });
    const view = await exportViewWith(w.deps, w.asking, {
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      match: 'all',
    });
    expect(view.ok && view.value.who.at(-1)).toMatchObject({
      value: 'conditions',
      label: 'Everybody whose department is Sales',
    });
    const refused = await exportViewWith(w.deps, w.asking, {
      conditions: [{ key: 'salary', op: 'not_empty', values: [] }],
      match: 'all',
    });
    expect(refused.ok).toBe(false);
  });
});

/* ------------------------------------------------------- smart search -- */

describe('smart search', () => {
  it('a name that finds one person is that person; one that finds several is a name search', async () => {
    const w = world({});
    const one = await planDirectory(w.deps, w.asking, { sentence: 'Dwight' });
    expect(one.ok && one.value.person).toEqual({ id: DWIGHT, name: 'Dwight Schrute' });
    const several = await planDirectory(w.deps, w.asking, { sentence: 'e' });
    expect(several.ok && several.value).toMatchObject({ person: null, search: 'e', by: 'search' });
    expect(w.send).not.toHaveBeenCalled();
  });

  it('a judgement is left out and said, and never reaches the model', async () => {
    const w = world({ answer: () => '{"conditions":[]}' });
    const plan = await planDirectory(w.deps, w.asking, {
      sentence: 'engineers in Madrid who are good at Go',
    });
    expect(plan.ok && plan.value.refused).toEqual([
      { text: 'who are good at Go', why: 'Kithena doesn’t rate people’s skills.', instead: null },
    ]);
    expect(plan.ok && plan.value.conditions).toEqual([
      { key: 'office', op: 'in', values: ['mad'] },
      { key: 'job_title', op: 'contains', values: ['engineer'] },
    ]);
    const [prompt] = w.sent;
    expect(prompt?.context['sentence']).toBe('engineers in Madrid');
    expect(JSON.stringify(prompt)).not.toMatch(/good at|\bGo\b/u);

    const nothingLeft = world({});
    await planDirectory(nothingLeft.deps, nothingLeft.asking, { sentence: 'top performers' });
    expect(nothingLeft.send).not.toHaveBeenCalled();
  });

  it('asks instead of guessing, with each reading counted as the viewer may list people; no model', async () => {
    const w = world({});
    const plan = await planDirectory(w.deps, w.asking, { sentence: 'new joiners in Sales' });
    expect(w.send).not.toHaveBeenCalled();
    expect(plan.ok && plan.value.conditions).toEqual([
      { key: 'department', op: 'in', values: ['sales'] },
    ]);
    expect(plan.ok && plan.value.ask).toMatchObject({
      topic: 'new',
      phrase: 'new joiners',
      // Counted by the list (in memory, conditions are Postgres's to apply: everybody here).
      readings: [
        { label: 'Joined in the last 30 days', count: 2 },
        { label: 'Joined in the last 90 days', count: 2 },
        { label: 'Joined this year', count: 2 },
      ],
    });
    // Each reading is the whole selection it would be.
    expect(plan.ok && plan.value.ask?.readings[0]?.conditions[0]).toEqual({
      key: 'department',
      op: 'in',
      values: ['sales'],
    });
  });

  it('a reading chosen before is taken, and said', async () => {
    const w = world({});
    const plan = await planDirectory(w.deps, w.asking, {
      sentence: 'new joiners',
      remembered: { new: 'Joined this year' },
    });
    expect(plan.ok && plan.value).toMatchObject({
      ask: null,
      remembered: { topic: 'new', label: 'Joined this year' },
      conditions: [{ key: 'start_on', op: 'between' }],
      note: null,
    });
  });

  it('Remind all asks everybody found for the empty details, as the profile asks one person', async () => {
    const asked: { personId: string; keys: readonly string[] }[] = [];
    const w = world({});
    const deps: SelectionDeps = {
      ...w.deps,
      requests: {
        store: {
          record: (_tx, r) => {
            asked.push({ personId: r.personId, keys: r.keys });
            return Promise.resolve(r.keys);
          },
          of: () => Promise.resolve([]),
        },
      },
    };
    const done = await remindDirectory(deps, w.asking, {
      conditions: [{ key: 'emergency_contact', op: 'empty', values: [] }],
      match: 'all',
    });
    // Whoever the list found (in memory, conditions are Postgres's to apply: both).
    expect(done).toEqual({ ok: true, value: { asked: 2, emailed: 0, skipped: 0, more: false } });
    expect(asked.map((a) => a.keys)).toEqual([['emergency_contact'], ['emergency_contact']]);
    const nothing = await remindDirectory(deps, w.asking, {
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      match: 'all',
    });
    expect(nothing.ok).toBe(false);
  });
});
