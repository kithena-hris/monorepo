import { describe, expect, it } from 'vitest';

import { entryFrom, type SourceEvent } from './entry.js';

/**
 * What an event becomes in the log. The rules that matter are negative ones:
 * a payload's numbers, keys and values never become an entry's words beyond
 * what the log says, and support is never mistaken for the account it used.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const SUPPORT_ACCOUNT = '00000000-0000-4000-8000-0000000000a9';
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';

function event(eventName: string, payload: unknown, over: Partial<SourceEvent> = {}): SourceEvent {
  return {
    eventId: '01890000-0000-7000-8000-000000000001',
    eventName,
    tenantId: TENANT,
    occurredAt: '2026-09-29T10:00:00.000Z',
    recordedAt: '2026-09-29T10:00:01.000Z',
    actor: { kind: 'user', userId: ADA },
    payload,
    ...over,
  };
}

const setting = {
  area: 'fields',
  action: 'Changed a field',
  subject: 'Work phone',
  detail: 'Seen by: HR → HR and their manager.',
  reason: null,
};

describe('an entry from an event', () => {
  it('takes a settings change in the log’s own words', () => {
    expect(entryFrom(event('people.settings.activity_recorded', setting))).toEqual({
      tenantId: TENANT,
      sourceEventId: '01890000-0000-7000-8000-000000000001',
      occurredAt: '2026-09-29T10:00:00.000Z',
      recordedAt: '2026-09-29T10:00:01.000Z',
      module: 'people',
      area: 'fields',
      action: 'Changed a field',
      detail: 'Seen by: HR → HR and their manager.',
      actor: { kind: 'person', accountId: ADA, onBehalfOf: null },
      subject: { kind: 'setting', id: null, label: 'Work phone' },
      reason: null,
    });
  });

  it('names support as support, with the operator, never as the account it signed in as', () => {
    const entry = entryFrom(
      event('people.settings.activity_recorded', setting, {
        actor: { kind: 'user', userId: SUPPORT_ACCOUNT, onBehalfOf: OPERATOR },
      }),
    );
    expect(entry?.actor).toEqual({
      kind: 'support',
      accountId: SUPPORT_ACCOUNT,
      onBehalfOf: OPERATOR,
    });
  });

  it('keeps integrations and the system as themselves, with no account', () => {
    const scim = entryFrom(
      event('people.settings.activity_recorded', setting, {
        actor: { kind: 'integration', integrationId: ADA, provider: 'okta' },
      }),
    );
    const job = entryFrom(
      event('people.settings.activity_recorded', setting, {
        actor: { kind: 'system', process: 'people.consumer' },
      }),
    );
    expect(scim?.actor).toEqual({ kind: 'integration', accountId: null, onBehalfOf: null });
    expect(job?.actor).toEqual({ kind: 'system', accountId: null, onBehalfOf: null });
  });

  it('says a support sign-in with its reason, as the operator', () => {
    const entry = entryFrom(
      event(
        'identity.support.session_started',
        {
          sessionId: '00000000-0000-4000-8000-0000000000b1',
          accountId: SUPPORT_ACCOUNT,
          operatorId: OPERATOR,
          reason: 'Ticket 4411',
          expiresAt: '2026-09-29T11:00:00.000Z',
        },
        { actor: { kind: 'user', userId: SUPPORT_ACCOUNT, onBehalfOf: OPERATOR } },
      ),
    );
    expect(entry).toMatchObject({
      module: 'identity',
      area: 'sign_in',
      action: 'Kithena support signed in',
      actor: { kind: 'support', accountId: SUPPORT_ACCOUNT, onBehalfOf: OPERATOR },
      subject: { kind: 'session', id: '00000000-0000-4000-8000-0000000000b1', label: null },
      reason: 'Ticket 4411',
    });
  });

  it('counts an import without naming anybody in it', () => {
    const entry = entryFrom(
      event('people.import.completed', {
        importId: '00000000-0000-4000-8000-0000000000c1',
        counts: { created: 12, updated: 3, unchanged: 40, blocked: 1, duplicate: 0, incomplete: 0 },
        completedAt: '2026-09-29T10:00:00.000Z',
      }),
    );
    expect(entry).toMatchObject({
      area: 'imports_exports',
      action: 'Imported people',
      detail: '12 added, 3 changed, 1 blocked.',
      subject: { kind: 'import', id: '00000000-0000-4000-8000-0000000000c1', label: null },
    });
  });

  it('keeps an export’s stated reason and says what left, not what was in it', () => {
    const entry = entryFrom(
      event('people.export.completed', {
        exportId: '00000000-0000-4000-8000-0000000000e1',
        attributeKeys: ['given_name', 'salary'],
        rowCount: 40,
        format: 'xlsx',
        reason: 'Year-end review',
      }),
    );
    expect(entry).toMatchObject({
      area: 'imports_exports',
      action: 'Exported people',
      detail: '40 people, 2 fields, as XLSX.',
      reason: 'Year-end review',
    });
  });

  it('files every step of a full-values request under sensitive access', () => {
    const request = '00000000-0000-4000-8000-0000000000d1';
    const steps = [
      event('people.export.full_values_requested', {
        requestId: request,
        attributeKeys: ['salary'],
        reason: 'Payroll run',
        expiresAt: '2026-10-06T10:00:00.000Z',
      }),
      event('people.export.full_values_decided', {
        requestId: request,
        decision: 'rejected',
        attributeKeys: ['salary'],
        reason: 'Payroll run',
        note: 'Ask again after the freeze',
      }),
      event('people.export.full_values_issued', {
        requestId: request,
        exportId: '00000000-0000-4000-8000-0000000000e1',
        attributeKeys: ['salary'],
        rowCount: 4,
        linkExpiresAt: '2026-09-30T10:00:00.000Z',
      }),
      event('people.export.full_values_downloaded', {
        requestId: request,
        exportId: '00000000-0000-4000-8000-0000000000e1',
        issuedTo: ADA,
      }),
      event('people.export.full_values_expired', { requestId: request, attributeKeys: ['salary'] }),
    ].map(entryFrom);
    expect(steps.map((e) => e?.area)).toEqual(Array(5).fill('sensitive_access'));
    expect(steps.map((e) => e?.action)).toEqual([
      'Asked for full values',
      'Turned down a full-values request',
      'Issued a full-values file',
      'Downloaded a full-values file',
      'A full-values request lapsed undecided',
    ]);
    expect(steps[0]?.reason).toBe('Payroll run');
    expect(steps[1]?.reason).toBe('Ask again after the freeze');
  });

  it('records an identifier read in full as whose, never the value', () => {
    const entry = entryFrom(
      event('people.person.identifier_revealed', {
        personId: ADA,
        attributeKey: 'national_id',
        reviewId: '00000000-0000-4000-8000-0000000000d2',
      }),
    );
    expect(entry).toMatchObject({
      area: 'sensitive_access',
      action: 'Read an identifier in full',
      subject: { kind: 'person', id: '00000000-0000-4000-8000-0000000000a1', label: null },
      detail: 'Field: national_id.',
    });
  });

  it('says the back office named an administrator, as support', () => {
    const entry = entryFrom(
      event(
        'identity.tenant.administrator_named',
        { entitlement: 'module.people', accountId: ADA, namedBy: OPERATOR },
        { actor: { kind: 'system', process: 'identity.admin' } },
      ),
    );
    expect(entry).toMatchObject({
      area: 'roles',
      action: 'Named an administrator of People',
      actor: { kind: 'support', accountId: null, onBehalfOf: OPERATOR },
      subject: { kind: 'account', id: ADA, label: null },
    });
  });

  it('ignores what the log does not keep, ordinary sign-ins among them', () => {
    expect(entryFrom(event('identity.session.started', {}))).toBeNull();
    expect(entryFrom(event('people.person.hired', {}))).toBeNull();
  });
});
