import { describe, expect, it } from 'vitest';

import { activityFilters, activityVariables, changesIn, idsToName } from './activity';

describe('the activity log’s address', () => {
  it('reads every filter it has', () => {
    const f = activityFilters({
      area: 'roles,sign_in,roles',
      by: 'support',
      actor: '00000000-0000-4000-8000-0000000000a1',
      subject: 'x1',
      from: '2026-09-01',
      to: '2026-09-29',
      tz: 'Europe/Madrid',
      q: ' role ',
    });
    expect(activityVariables(f, '01890000-0000-7000-8000-000000000001')).toEqual({
      areas: ['roles', 'sign_in'],
      by: 'support',
      actor: '00000000-0000-4000-8000-0000000000a1',
      subject: 'x1',
      from: '2026-09-01',
      to: '2026-09-29',
      zone: 'Europe/Madrid',
      search: 'role',
      before: '01890000-0000-7000-8000-000000000001',
    });
  });

  it('treats anything garbled as not there, and sends nothing for an untouched page', () => {
    const f = activityFilters({
      area: 'payroll,<script>',
      by: 'everyone',
      actor: 'ada',
      from: 'yesterday',
      tz: '../etc',
    });
    expect(activityVariables(f, '1 OR 1=1')).toEqual({});
  });
});

describe('what a page needs named', () => {
  it('asks People for people who acted and records acted on, never for support or the system', () => {
    const entry = {
      id: 'e',
      occurredAt: '2026-09-29T10:00:00.000Z',
      module: 'people',
      area: 'roles',
      action: 'Granted a role',
      detail: null,
      onBehalfOf: null,
      operatorLabel: null,
      subjectLabel: null,
      reason: null,
      supportSignIn: null,
    };
    expect(
      idsToName({
        entries: [
          {
            ...entry,
            actorKind: 'person',
            actorAccountId: 'a1',
            subjectKind: 'person',
            subjectId: 'p1',
          },
          {
            ...entry,
            actorKind: 'support',
            actorAccountId: 'a9',
            subjectKind: 'account',
            subjectId: 'a2',
          },
          {
            ...entry,
            actorKind: 'system',
            actorAccountId: null,
            subjectKind: null,
            subjectId: null,
          },
        ],
        next: null,
      }),
    ).toEqual({ accountIds: ['a1', 'a2'], personIds: ['p1'] });
  });
});

describe('a change in words', () => {
  it('splits "from → to" into its parts, and leaves a plain sentence alone', () => {
    expect(changesIn('Seen by: HR → HR and their manager. Required: No → Yes.')).toEqual([
      { what: 'Seen by', from: 'HR', to: 'HR and their manager' },
      { what: 'Required', from: 'No', to: 'Yes' },
    ]);
    expect(changesIn('Everyone signing up must fill it in.')).toBeNull();
  });
});
