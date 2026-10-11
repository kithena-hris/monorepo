import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';
import {
  DateSpan,
  LeaveTypeKey,
  RuntimeCatalogue,
  TimeOffAway,
  TimeOffBalances,
  TimeOffManagers,
  TimeOffPending,
} from '@kithena/contracts';

import type { Caller } from '../application/ports.js';
import { sendRequest } from '../application/request/request.js';
import { ADA_ACCOUNT, caller, people, world } from '../application/testing/world.js';
import type { CallerFrom } from '../http/caller.js';
import { timeoffServer } from '../http/server.js';

/**
 * Assistant PRD §15.5 with People absent: Time Off answers its capabilities
 * on its own projection, with no assistant and no sibling present.
 */

type Who = 'adam' | 'marco' | 'ada';
const callers: Record<Who, Caller> = {
  adam: caller(people.adam),
  marco: caller(people.marco),
  ada: caller(null, ADA_ACCOUNT),
};
const assistantCallerFrom: CallerFrom = (request) => ok(callers[request.headers['x-as'] as Who]);

function boot() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const server = timeoffServer({
    ...app.deps,
    callerFrom: () => {
      throw new Error('the router is not asked');
    },
    assistantCallerFrom,
  });
  return {
    app,
    ask: async (who: Who, path: string, input?: unknown) => {
      const answer = await server.capabilities({
        method: input === undefined ? 'GET' : 'POST',
        url: `/internal/capabilities${path}`,
        headers: { 'x-as': who },
        body: input === undefined ? '' : JSON.stringify(input),
      });
      if (answer === null) throw new Error('not a capability route');
      return answer;
    },
  };
}

describe('Time Off’s capabilities with People absent', () => {
  it('serves the catalogue, its own teams included', async () => {
    const { ask } = boot();
    const answer = await ask('adam', '');
    expect(answer.status).toBe(200);
    const catalogue = RuntimeCatalogue.parse(answer.body);
    expect(catalogue.serves.map((s) => s.name)).toEqual([
      'timeoff.away',
      'timeoff.managers',
      'timeoff.balances',
      'timeoff.pending',
    ]);
    expect(catalogue.fields['timeoff.away']?.find((f) => f.key === 'team')?.options).toEqual([
      { value: 'platform', label: 'Platform' },
    ]);
  });

  it('answers timeoff.away by its own team, a private type only as Away', async () => {
    const { app, ask } = boot();
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('sick'),
      span: DateSpan.parse({ from: '2026-10-06', to: '2026-10-06' }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    const input = {
      on: { from: '2026-10-06', to: '2026-10-06' },
      limit: 25,
      filters: [{ key: 'team', op: 'in', values: ['platform'] }],
    };
    const marco = await ask('marco', '/timeoff.away', input);
    expect(marco.status).toBe(200);
    expect(TimeOffAway.schemas.output.parse(marco.body)).toMatchObject({
      rows: [{ name: 'Adam Novak', detail: 'Tue 6 · Away', groups: { team: 'Platform' } }],
      total: 1,
      scope: 'visible',
    });
    const sick = { ...input, filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }] };
    expect((await ask('ada', '/timeoff.away', sick)).body).toMatchObject({ total: 1 });
    expect((await ask('adam', '/timeoff.away', sick)).body).toMatchObject({ total: 1 });
    expect((await ask('marco', '/timeoff.away', sick)).body).toMatchObject({ total: 1 });
  });

  it('answers timeoff.managers from its own projection', async () => {
    const { ask } = boot();
    const answer = await ask('adam', '/timeoff.managers', {
      personIds: [people.omar, people.yuki],
      limit: 25,
    });
    expect(answer.status).toBe(200);
    expect(TimeOffManagers.schemas.output.parse(answer.body)).toMatchObject({
      rows: [{ personId: people.marco, name: 'Marco Ruiz' }],
      total: 1,
    });
    expect((await ask('adam', '/timeoff.managers', { limit: 25 })).status).toBe(400);
  });

  it('answers timeoff.balances: “how much vacation do I have left?” and who has more than 10', async () => {
    const { ask } = boot();
    const vacation = { key: 'leave_type', op: 'in', values: ['vacation'] };
    const mine = await ask('adam', '/timeoff.balances', {
      name: '@me',
      filters: [vacation],
      limit: 25,
    });
    expect(mine.status).toBe(200);
    expect(TimeOffBalances.schemas.output.parse(mine.body)).toMatchObject({
      rows: [{ name: 'Adam Novak', detail: '25 days left', self: true }],
      total: 1,
    });
    const team = await ask('marco', '/timeoff.balances', {
      personIds: [people.adam, people.omar],
      filters: [{ key: 'days_left', op: 'after', values: ['10'] }],
      limit: 25,
    });
    expect(TimeOffBalances.schemas.output.parse(team.body)).toMatchObject({
      total: 2,
      described: 'with more than 10 days of Vacation left',
    });
    // Adam may not see Omar's balance.
    expect((await ask('adam', '/timeoff.balances', { name: 'omar', limit: 25 })).body).toEqual({
      kind: 'not_found',
      name: 'omar',
    });
  });

  it('answers timeoff.pending with the asker’s own queue', async () => {
    const { app, ask } = boot();
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-10-08', to: '2026-10-08' }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    const marco = await ask('marco', '/timeoff.pending', { limit: 25 });
    expect(marco.status).toBe(200);
    expect(TimeOffPending.schemas.output.parse(marco.body)).toEqual({
      kind: 'items',
      items: [{ name: 'Adam Novak', label: 'Vacation · Thu 8 Oct (1 day)' }],
      total: 1,
    });
    expect((await ask('adam', '/timeoff.pending', { limit: 25 })).body).toEqual({
      kind: 'items',
      items: [],
      total: 0,
    });
  });
});
