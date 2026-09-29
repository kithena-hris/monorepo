import { describe, expect, it } from 'vitest';

import {
  PlanBudget,
  planChanges,
  readChange,
  readPlan,
  SETTINGS_TOOLS,
  type FieldSpec,
} from './settings-plan.js';
import { ALAN, GRACE, MADRID_SL, snapshot } from './settings.fixture.js';

/**
 * What People makes of a model's tool calls: read strictly, ordered so they
 * apply, resolved against the settings, and said in words with anything
 * sensitive flagged. The model's answer is untrusted input, so most of these
 * are about what it may not get through.
 */

const iban: FieldSpec = {
  sectionKey: 'Bank & tax',
  label: 'IBAN',
  description: 'Where your salary is paid',
  dataType: 'bank_account',
  country: 'ES',
  requiredness: 'always',
  ownership: ['employee'],
  visibility: ['self', 'finance', 'hr'],
  collectAt: 'onboarding',
  classification: 'confidential',
  piiKind: 'financial',
};

describe('reading a plan', () => {
  it('keeps the calls that are changes, and counts, never guesses at, the rest', () => {
    const plan = readPlan(
      [
        { name: 'add_section', input: { label: 'Bank & tax' } },
        { name: 'add_section', input: { label: '' } },
        { name: 'drop_database', input: {} },
        { name: 'add_field', input: { field: { ...iban, extra: 'no' } } },
        { name: 'finish_plan', input: { summary: 'Adds bank details.' } },
      ],
      snapshot(),
    );
    expect(plan.changes.map((c) => c.change.kind)).toEqual(['add_section']);
    expect(plan.unreadable).toBe(3);
    expect(plan.summary).toBe('Adds bank details.');
  });

  it('puts what later changes name first, whatever order the model called them in', () => {
    const plan = readPlan(
      [
        {
          name: 'add_location',
          input: {
            name: 'Barcelona office',
            country: 'ES',
            timeZone: 'Europe/Madrid',
            legalEntity: 'Acme Barcelona SL',
          },
        },
        { name: 'add_field', input: { field: iban } },
        {
          name: 'add_legal_entity',
          input: { name: 'Acme Barcelona SL', country: 'ES', timeZone: 'Europe/Madrid' },
        },
        { name: 'add_section', input: { label: 'Bank & tax' } },
      ],
      snapshot(),
    );
    expect(plan.changes.map((c) => c.change.kind)).toEqual([
      'add_section',
      'add_field',
      'add_legal_entity',
      'add_location',
    ]);
    expect(plan.changes.every((c) => c.problem === null)).toBe(true);
    expect(plan.changes.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('finds a section by key, by name, or by the name of one the plan adds', () => {
    const [rename, add] = readPlan(
      [
        { name: 'rename_section', input: { sectionKey: 'Bank', label: 'Payment' } },
        { name: 'add_field', input: { field: { ...iban, sectionKey: 'payment' } } },
      ],
      snapshot(),
    ).changes;
    expect(rename).toMatchObject({
      title: 'Rename a section',
      before: 'Bank',
      after: 'Payment',
      problem: null,
    });
    expect(add).toMatchObject({ subject: 'IBAN in Payment', problem: null });
  });

  it('says what it cannot apply, and why, instead of dropping it', () => {
    const plan = readPlan(
      [
        { name: 'add_field', input: { field: { ...iban, sectionKey: 'nowhere' } } },
        { name: 'edit_field', input: { key: 'no_such', changes: { label: 'X' } } },
        {
          name: 'add_location',
          input: {
            name: 'Lisbon',
            country: 'PT',
            timeZone: 'Europe/Lisbon',
            legalEntity: 'Acme Portugal',
          },
        },
        { name: 'set_cohort_minimum', input: { minimum: 10 } },
        { name: 'add_section', input: { label: 'Personal information' } },
      ],
      snapshot({ organisation: { ...snapshot().organisation, cohortMinimum: 12 } }),
    );
    expect(plan.changes.map((c) => c.problem)).toEqual([
      'A section called Personal information already exists',
      'There is no section called nowhere',
      'There is no field called no_such',
      'There is no legal entity called Acme Portugal',
      'It can be raised, never lowered below 12',
    ]);
  });

  it('turns a refusal into a link to the page where it is done', () => {
    const plan = readPlan(
      [
        { name: 'cannot_do', input: { request: 'Connect Slack', area: 'chat_apps' } },
        { name: 'cannot_do', input: { request: 'Add a webhook', area: 'webhooks' } },
        { name: 'finish_plan', input: { summary: 'Nothing I can set up here.' } },
      ],
      snapshot(),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.refused).toEqual([
      { request: 'Connect Slack', href: '/settings/people/integrations?tab=chat' },
      { request: 'Add a webhook', href: '/settings/people/integrations?tab=webhooks' },
    ]);
  });
});

describe('what needs an explicit tick', () => {
  it('flags financial, identifier and special-category fields, and nothing ordinary', () => {
    const plan = readPlan(
      [
        { name: 'add_section', input: { label: 'Bank & tax' } },
        { name: 'add_field', input: { field: iban } },
        {
          name: 'add_field',
          input: {
            field: {
              ...iban,
              label: 'NIF',
              dataType: 'national_id',
              scheme: 'nif',
              piiKind: 'identity',
            },
          },
        },
        {
          name: 'add_field',
          input: {
            field: {
              ...iban,
              label: 'Allergies',
              dataType: 'long_text',
              country: null,
              classification: 'special-category',
              piiKind: 'health',
            },
          },
        },
        {
          name: 'add_field',
          input: {
            field: {
              ...iban,
              label: 'Laptop',
              dataType: 'text',
              country: null,
              classification: 'internal',
              piiKind: 'none',
            },
          },
        },
      ],
      snapshot(),
    );
    expect(plan.changes.map((c) => c.confirm?.split(':')[0] ?? null)).toEqual([
      null,
      'Financial data',
      'A national identifier',
      'Special-category data (GDPR Article 9)',
      null,
    ]);
  });

  it('flags an edit that makes a field less protected, and one that changes who sees sensitive data', () => {
    const base = snapshot();
    const plan = planChanges(
      [
        { kind: 'edit_field', key: 'contract_type', changes: { classification: 'public' } },
        { kind: 'edit_field', key: 'shirt_size', changes: { label: 'T-shirt size' } },
      ],
      base,
    );
    expect(plan[0]?.confirm).toBe('Makes Contract type less protected (internal → public).');
    expect(plan[1]?.confirm).toBeNull();
  });

  it('always flags a role change, and refuses one to yourself or of the last administrator', () => {
    const plan = readPlan(
      [
        { name: 'grant_role', input: { person: 'grace hopper', role: 'hr' } },
        { name: 'grant_role', input: { person: 'Ada Lovelace', role: 'finance' } },
        { name: 'revoke_role', input: { person: 'Alan', role: 'finance' } },
        { name: 'grant_role', input: { person: 'Nobody Here', role: 'hr' } },
      ],
      snapshot(),
    );
    expect(plan.changes.every((c) => c.confirm !== null)).toBe(true);
    expect(plan.changes.map((c) => c.problem)).toEqual([
      null,
      'Nobody changes their own roles: another administrator has to',
      'Nobody here is called Nobody Here',
      null,
    ]);
    expect(plan.changes[0]).toMatchObject({ subject: 'HR for Grace Hopper', before: 'No role' });
    // A person is never sent anywhere by account: resolved here, from the name.
    expect(JSON.stringify(plan.changes)).not.toContain(GRACE);
    expect(JSON.stringify(plan.changes)).not.toContain(ALAN);
  });

  it('keeps the last People administrator', () => {
    const plan = readPlan(
      [{ name: 'revoke_role', input: { person: 'Grace Hopper', role: 'people_admin' } }],
      snapshot({
        people: [
          { accountId: GRACE, name: 'Grace Hopper', roles: ['people_admin'] },
          { accountId: ALAN, name: 'Alan Turing', roles: [] },
        ],
        viewerAccountId: ALAN,
      }),
    );
    expect(plan.changes[0]?.problem).toBe('The last People administrator keeps the role');
  });
});

describe('a change sent back from the review screen', () => {
  it('is read with the same shapes, so an edited plan is checked like a proposed one', () => {
    expect(readChange({ kind: 'add_section', label: 'Equipment' })).toEqual({
      kind: 'add_section',
      label: 'Equipment',
    });
    expect(readChange({ kind: 'add_section', label: 'Equipment', sql: 'drop' })).toBeNull();
    expect(readChange({ kind: 'grant_role', person: 'Grace', role: 'owner' })).toBeNull();
    expect(
      readChange({
        kind: 'set_numbering',
        legalEntity: MADRID_SL,
        prefix: 'ES-',
        digits: 13,
        start: 1,
      }),
    ).toBeNull();
  });
});

describe('the tools a model is offered', () => {
  it('are one per change, plus refusing and finishing, and none of them writes', () => {
    expect(SETTINGS_TOOLS.map((t) => t.name)).toContain('cannot_do');
    expect(SETTINGS_TOOLS.map((t) => t.name).at(-1)).toBe('finish_plan');
    expect(SETTINGS_TOOLS.map((t) => t.name)).not.toContain('add_webhook');
    expect(SETTINGS_TOOLS.every((t) => t.description.length > 10)).toBe(true);
  });
});

describe('the budget', () => {
  it('allows so many plans a window per company, then says when the next is free', () => {
    const budget = new PlanBudget(2, 60_000);
    expect(budget.take('t1', '2026-09-29T10:00:00.000Z').ok).toBe(true);
    expect(budget.take('t1', '2026-09-29T10:00:10.000Z').ok).toBe(true);
    expect(budget.take('t2', '2026-09-29T10:00:10.000Z').ok).toBe(true);
    expect(budget.take('t1', '2026-09-29T10:00:20.000Z')).toEqual({
      ok: false,
      retryAfterSeconds: 40,
    });
    expect(budget.take('t1', '2026-09-29T10:01:00.000Z').ok).toBe(true);
  });
});
