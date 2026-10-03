import { describe, expect, it } from 'vitest';
import type { Prompt } from '@kithena/telemetry';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';
import type { ScreenDeps } from '../screens/record.js';
import { ask } from './ask.js';

/**
 * A question in words, answered as the asker: the model is shown the question
 * and field names only, and People runs what it made of them.
 */

const MICHAEL = '00000000-0000-4000-8000-0000000000d1';
const DWIGHT = '00000000-0000-4000-8000-0000000000d2';
const JIM = '00000000-0000-4000-8000-0000000000d3';
const TOBY = '00000000-0000-4000-8000-0000000000d4';
const TOBY_ACCOUNT = '00000000-0000-4000-8000-0000000000e4';

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;
const attributes = [
  define({ key: 'given_name', visibility: [...everyone] }),
  define({ key: 'family_name', visibility: [...everyone] }),
  define({ key: 'job_title', visibility: [...everyone] }),
  define({
    key: 'manager_id',
    dataType: 'person_ref',
    typeConfig: { kind: 'person_ref' },
    visibility: [...everyone],
  }),
  define({
    key: 'department',
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'sales', label: { default: 'Sales' }, retiredAt: null },
        { value: 'management', label: { default: 'Management' }, retiredAt: null },
      ],
    },
    visibility: [...everyone],
    indexed: true,
  }),
  // Never for a model: not offered to one, and a question naming it is refused.
  define({
    key: 'medical_notes',
    visibility: ['self', 'hr'],
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: false,
      aiEligible: false,
    },
  }),
];

const person = (
  given: string,
  family: string,
  title: string,
  department: string,
  manager?: string,
) => ({
  fields: manager === undefined ? {} : { managerId: manager },
  custom: { given_name: given, family_name: family, job_title: title, department },
});

function world(answer: (prompt: Prompt) => string) {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  store.seed(MICHAEL, person('Michael', 'Scott', 'Regional Manager', 'management'));
  store.seed(DWIGHT, person('Dwight', 'Schrute', 'Salesman', 'sales', MICHAEL));
  store.seed(JIM, person('Jim', 'Halpert', 'Salesman', 'sales', MICHAEL));
  store.seed(TOBY, { account: TOBY_ACCOUNT, ...person('Toby', 'Flenderson', 'HR', 'management') });
  const base = personAccess(store.deps);
  const asked: unknown[] = [];
  // What People was asked to run: the in-memory reader applies no conditions,
  // so the query itself is what is checked here (the database's own, in the
  // directory's integration tests).
  const access = {
    ...base,
    list: (tx: never, q: Parameters<typeof base.list>[1]) => {
      asked.push(q.refine);
      return base.list(tx, q);
    },
  };
  const service: PeopleService = {
    access,
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const prompts: Prompt[] = [];
  const deps: ScreenDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: () => Promise.resolve(null),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    assistant: {
      loadPolicies: () => Promise.resolve(),
      complete: (_tenant, prompt) => {
        prompts.push(prompt);
        return Promise.resolve({ ok: true, value: answer(prompt) });
      },
    },
  };
  const asking = {
    tenantId: TENANT,
    viewer: { accountId: TOBY_ACCOUNT, roles: new Set(['hr']) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  };
  return { deps, asking, prompts, asked };
}

describe('asking People in words', () => {
  it('shows the model the question and field names, never a record, and answers from People', async () => {
    const w = world(() =>
      JSON.stringify({
        kind: 'people',
        conditions: [{ key: 'department', op: 'is', values: ['Sales'] }],
      }),
    );
    const answered = await ask(w.deps, w.asking, 'Who is in sales?');
    expect(w.asked).toContainEqual({
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      match: 'all',
    });
    expect(answered.ok && answered.value.text).toMatch(
      /^I found \d+ (person|people) whose department is Sales\./,
    );
    const sent = JSON.stringify(w.prompts);
    expect(sent).toContain('Who is in sales?');
    expect(sent).not.toContain('Schrute');
    // Not for AI: never offered to the model.
    expect(sent).not.toContain('medical_notes');
  });

  it('answers who reports to somebody, found by name', async () => {
    const w = world(() => JSON.stringify({ kind: 'reports', name: 'Michael' }));
    const answered = await ask(w.deps, w.asking, 'Who reports to Michael?');
    expect(answered.ok && answered.value.text).toMatch(/^Michael Scott has 2 direct reports:/);
  });

  it('opens with the model’s own words, and fills in the count itself', async () => {
    const w = world(() =>
      JSON.stringify({
        kind: 'reports',
        name: 'Michael',
        say: 'Sure! Here are the {n} people on Michael’s team.',
      }),
    );
    const answered = await ask(w.deps, w.asking, 'Who reports to Michael?', ['Who is in sales?']);
    expect(answered.ok && answered.value.text).toMatch(
      /^Sure! Here are the 2 people on Michael’s team\.\n•/,
    );
    // A follow-up is read with the earlier question, never an earlier answer.
    expect(JSON.stringify(w.prompts)).toContain('"earlier":["Who is in sales?"]');
  });

  it('never lets an opening without the count stand in for a count', async () => {
    const w = world(() =>
      JSON.stringify({ kind: 'count', conditions: [], say: 'Here’s the count for the company:' }),
    );
    const answered = await ask(w.deps, w.asking, 'How many people work here?');
    expect(answered.ok && answered.value.text).toMatch(
      /^There (is|are) \d+ (person|people) across the company\.$/,
    );
  });

  it('reads "me" as whoever is asking, and never sends their name to the model', async () => {
    const w = world(() => JSON.stringify({ kind: 'reports', name: '@me' }));
    const asMichael = { ...w.deps, personOf: () => Promise.resolve(MICHAEL) };
    const answered = await ask(asMichael, w.asking, 'Who reports to me?');
    expect(answered.ok && answered.value.text).toMatch(/Michael Scott has 2 direct reports/);
    expect(JSON.stringify(w.prompts.map((p) => p.context))).not.toContain('Michael');

    const nobody = await ask(w.deps, w.asking, 'Who reports to me?');
    expect(nobody.ok && nobody.value.text).toMatch(/don’t have a profile/);
  });

  it('says so rather than guessing when the model answers with something People cannot run', async () => {
    const w = world(
      () => '{"kind":"people","conditions":[{"key":"medical_notes","op":"is","values":["x"]}]}',
    );
    const answered = await ask(w.deps, w.asking, 'Who is ill?');
    expect(answered.ok && answered.value.understood).toBe('Not a question People can answer');
  });

  it('is unavailable where no model is configured', async () => {
    const w = world(() => '{}');
    const { assistant: _none, ...bare } = w.deps;
    const answered = await ask(bare, w.asking, 'Who is in sales?');
    expect(!answered.ok && answered.error.code).toBe('UNAVAILABLE');
  });
});
