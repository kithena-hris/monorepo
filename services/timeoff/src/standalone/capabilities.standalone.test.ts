import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';
import { RuntimeCatalogue } from '@kithena/contracts';

import type { Caller } from '../application/ports.js';
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
    expect(catalogue.serves.map((s) => s.name)).toEqual(['timeoff.away', 'timeoff.managers']);
    expect(catalogue.fields['timeoff.away']?.find((f) => f.key === 'team')?.options).toEqual([
      { value: 'platform', label: 'Platform' },
    ]);
  });
});
