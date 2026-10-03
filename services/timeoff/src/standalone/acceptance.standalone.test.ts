import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { Caller } from '../application/ports.js';
import { ADA_ACCOUNT, caller, people, TENANT, world } from '../application/testing/world.js';
import type { CallerFrom } from '../http/caller.js';
import type { RestRequest, RestResponse } from '../http/rest.js';
import { timeoffServer } from '../http/server.js';

/**
 * TOF-050: the module's acceptance suite, with no sibling, no Postgres, no
 * Kafka and no network — the in-memory ports behind the real REST handler
 * and the real subgraph. `@kithena/people` resolves to a module that throws
 * (`vitest.standalone.ts`), so the members arrive the way they would for a
 * customer without People: by import.
 *
 * Platform in October 2026: import the seven, request and approve, a clash
 * with the team minimum shown before sending, borrowing within the limit
 * through manager then HR, a day clocked and corrected, and the month closed
 * for Payroll.
 *
 * Time Off calls no AI service yet, so `TYPESAFE_API_KEY` changes nothing
 * here; CI runs this file with it unset and set, and `fetch` answers nothing
 * in either, so a feature that reached for the network would fail here.
 */

const header =
  'personId,displayName,firstName,managerPersonId,teamKey,teamName,locationKey,country,region,city,timeZone,hireDate,terminationDate,workPattern,status';
const row = (id: string, name: string, manager: string) =>
  `${id},"${name}",${name.split(' ')[0] ?? name},${manager},platform,Platform,madrid,ES,Comunidad de Madrid,Madrid,Europe/Madrid,2022-03-01,,"1,2,3,4,5",active`;
const csv = [
  header,
  row(people.marco, 'Marco Ruiz', ''),
  row(people.adam, 'Adam Novak', people.marco),
  row(people.omar, 'Omar Haddad', people.marco),
  row(people.yuki, 'Yuki Tanaka', people.marco),
  row(people.leo, 'Leo Martin', people.marco),
  row(people.hana, 'Hana Kim', people.marco),
  row(people.ravi, 'Ravi Patel', people.marco),
].join('\r\n');

type Who = keyof typeof people | 'ada';
const callers: Record<Who, Caller> = {
  ...(Object.fromEntries(Object.entries(people).map(([k, id]) => [k, caller(id)])) as Record<
    keyof typeof people,
    Caller
  >),
  ada: caller(null, ADA_ACCOUNT),
};

/** The standalone suite's router: `x-as` names who is asking. */
const callerFrom: CallerFrom = (request) => ok(callers[request.headers['x-as'] as Who]);

function boot() {
  const app = world('2026-10-01T07:00:00.000Z', { members: false });
  const server = timeoffServer({ ...app.deps, callerFrom });
  let keys = 0;
  const rest = async (
    who: Who,
    method: string,
    url: string,
    body?: unknown,
    key = `key-${String((keys += 1))}`,
  ): Promise<RestResponse> => {
    const request: RestRequest = {
      method,
      url,
      headers: { 'x-as': who, ...(method === 'GET' ? {} : { 'idempotency-key': key }) },
      body: body === undefined ? '' : JSON.stringify(body),
    };
    const answer = await server.rest(request);
    if (answer === null) throw new Error(`${url} is not a REST route`);
    return answer;
  };
  const graphql = async (who: Who, query: string, variables: Record<string, unknown> = {}) => {
    const response = await server.graphql.fetch('http://timeoff.standalone/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-as': who },
      body: JSON.stringify({ query, variables }),
    });
    const answer = (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: { message: string; extensions?: { code?: string } }[];
    };
    return answer;
  };
  const events = () => app.state(TENANT).events.map((e) => e.eventName);
  return { app, rest, graphql, events };
}

const PANEL = `query ($leaveTypeKey: String, $from: String, $to: String) {
  timeOffRequestPanel(leaveTypeKey: $leaveTypeKey, from: $from, to: $to) {
    leaveTypes { key left }
    preview {
      span { workingDays }
      balance { before after }
      belowMinimum { date in of required }
      negative { kind days approvers }
      approvers
      approver { displayName }
    }
  }
}`;

const REQUEST = `mutation ($input: JSON!, $key: String!) {
  requestTimeOff(input: $input, idempotencyKey: $key) { requestId status }
}`;

const DECIDE = `mutation ($id: String!, $input: JSON!, $key: String!) {
  decideTimeOffRequest(requestId: $id, input: $input, idempotencyKey: $key) { status next }
}`;

const vacation = (from: string, to: string) => ({ leaveTypeKey: 'vacation', span: { from, to } });

/** Whatever `fetch` is asked for, recorded; nothing answers. */
const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    return Promise.reject(new Error(`the standalone suite reached for the network: ${url}`));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(asked).toEqual([]);
});

describe('Time Off with People absent', () => {
  it('imports the team, after a dry run that writes nothing', async () => {
    const { app, rest } = boot();
    const dry = await rest('ada', 'POST', '/v1/timeoff/members:import', {
      format: 'csv',
      content: csv,
    });
    expect(dry).toMatchObject({ status: 200, body: { dryRun: true, rows: 7, created: 7 } });
    expect(app.state(TENANT).members.size).toBe(0);

    const real = await rest('ada', 'POST', '/v1/timeoff/members:import', {
      format: 'csv',
      content: csv,
      dryRun: false,
    });
    expect(real).toMatchObject({ status: 200, body: { dryRun: false, created: 7, errors: [] } });
    expect(app.state(TENANT).members.size).toBe(7);

    // Only HR imports.
    const refused = await rest('adam', 'POST', '/v1/timeoff/members:import', {
      format: 'csv',
      content: csv,
      dryRun: false,
    });
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
  });

  it('requests, warns of the clash, approves, borrows within the limit, clocks, corrects and closes the month', async () => {
    const { app, rest, graphql, events } = boot();
    const clock = app.clock;
    await rest('ada', 'POST', '/v1/timeoff/members:import', {
      format: 'csv',
      content: csv,
      dryRun: false,
    });

    /* Omar takes 19–23 October and Yuki the 21st; Marco approves both over GraphQL. */
    const omar = await graphql('omar', REQUEST, {
      input: vacation('2026-10-19', '2026-10-23'),
      key: 'omar-1',
    });
    expect(omar.errors).toBeUndefined();
    const yuki = await rest(
      'yuki',
      'POST',
      '/v1/timeoff/requests',
      vacation('2026-10-21', '2026-10-21'),
    );
    expect(yuki.status).toBe(201);
    const omarId = (omar.data?.['requestTimeOff'] as { requestId: string } | undefined)?.requestId;
    const yukiId = (yuki.body as { requestId: string }).requestId;
    for (const [id, key] of [
      [omarId, 'd-omar'],
      [yukiId, 'd-yuki'],
    ] as const) {
      const decided = await graphql('marco', DECIDE, { id, input: { decision: 'approve' }, key });
      expect(decided.errors).toBeUndefined();
      expect(decided.data?.['decideTimeOffRequest']).toEqual({ status: 'approved', next: null });
    }

    /* Adam's panel shows the clash before he sends: Wednesday, 4 of 7 in, 5 required. */
    const panel = await graphql('adam', PANEL, {
      leaveTypeKey: 'vacation',
      from: '2026-10-19',
      to: '2026-10-23',
    });
    expect(panel.errors).toBeUndefined();
    expect(panel.data?.['timeOffRequestPanel']).toMatchObject({
      leaveTypes: expect.arrayContaining([{ key: 'vacation', left: '25.000' }]) as unknown,
      preview: {
        span: { workingDays: '5.000' },
        balance: { before: '25.000', after: '20.000' },
        belowMinimum: [{ date: '2026-10-21', in: 4, of: 7, required: 5 }],
        negative: { kind: 'fits' },
        approvers: ['manager'],
        approver: { displayName: 'Marco Ruiz' },
      },
    });

    /* He sends anyway; it waits on Marco under "look closer", and Marco approves it. */
    const sent = await rest(
      'adam',
      'POST',
      '/v1/timeoff/requests',
      vacation('2026-10-19', '2026-10-23'),
      'adam-1',
    );
    expect(sent).toMatchObject({ status: 201, body: { status: 'pending' } });
    const adamId = (sent.body as { requestId: string }).requestId;
    // A retry with the same key is answered, not repeated.
    const again = await rest(
      'adam',
      'POST',
      '/v1/timeoff/requests',
      vacation('2026-10-19', '2026-10-23'),
      'adam-1',
    );
    expect(again).toEqual(sent);
    expect(events().filter((e) => e === 'timeoff.request.requested')).toHaveLength(3);
    // The same key for something else is refused.
    const reused = await rest(
      'adam',
      'POST',
      '/v1/timeoff/requests',
      vacation('2026-11-02', '2026-11-03'),
      'adam-1',
    );
    expect(reused).toMatchObject({
      status: 422,
      body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });

    const queue = await rest('marco', 'GET', '/v1/timeoff/approvals?tab=waiting');
    expect(queue.body).toMatchObject({
      clear: [],
      lookCloser: [
        {
          item: { requestId: adamId, displayName: 'Adam Novak' },
          reason: { rule: 'below_minimum', days: ['2026-10-21'] },
        },
      ],
    });
    const viewer = await graphql(
      'marco',
      '{ timeOffViewer { approves hrAdmin counts { requestsWaiting attendanceExceptions } } }',
    );
    expect(viewer.data?.['timeOffViewer']).toEqual({
      approves: true,
      hrAdmin: false,
      counts: { requestsWaiting: 1, attendanceExceptions: 0 },
    });
    const approved = await rest('marco', 'POST', `/v1/timeoff/requests/${adamId}/decision`, {
      decision: 'approve',
    });
    expect(approved).toMatchObject({ status: 200, body: { status: 'approved', next: null } });
    // Adam does not approve anything, and is told nothing waits on him.
    const adamViewer = await rest('adam', 'GET', '/v1/timeoff/viewer');
    expect(adamViewer.body).toMatchObject({ approves: false, counts: { requestsWaiting: 0 } });

    /* Leo borrows a day: 26 working days on 25 left, inside the 3 allowed, manager then HR. */
    const leoPanel = await rest(
      'leo',
      'GET',
      '/v1/timeoff/request-panel?leaveTypeKey=vacation&from=2026-11-03&to=2026-12-11',
    );
    expect(leoPanel.body).toMatchObject({
      preview: {
        span: { workingDays: '26.000' },
        negative: { kind: 'borrow', days: '1.000', approvers: ['manager', 'hr'] },
        approvers: ['manager', 'hr'],
      },
    });
    const leo = await rest(
      'leo',
      'POST',
      '/v1/timeoff/requests',
      vacation('2026-11-03', '2026-12-11'),
    );
    const leoId = (leo.body as { requestId: string }).requestId;
    const byMarco = await rest('marco', 'POST', `/v1/timeoff/requests/${leoId}/decision`, {
      decision: 'approve',
    });
    expect(byMarco.body).toMatchObject({ status: 'pending', next: 'hr' });
    const byAda = await rest('ada', 'POST', `/v1/timeoff/requests/${leoId}/decision`, {
      decision: 'approve',
    });
    expect(byAda.body).toMatchObject({ status: 'approved', next: null });
    const leoBalance = await graphql(
      'leo',
      '{ timeOffBalance(leaveTypeKey: "vacation") { balance { left booked } entries { kind amount } } }',
    );
    expect(leoBalance.data?.['timeOffBalance']).toMatchObject({
      balance: { left: '-1.000', booked: '26.000' },
    });

    /* Hana clocks Thursday 1 October, 09:00 to 17:30 in Madrid, then corrects the clock-out. */
    const PUNCH = `mutation ($input: JSON!, $key: String!) {
      punchTimeOffClock(input: $input, idempotencyKey: $key) { punch { id kind } state }
    }`;
    const punchedIn = await graphql('hana', PUNCH, {
      input: { kind: 'in', source: 'web', workModel: 'office' },
      key: 'hana-in',
    });
    expect(punchedIn.data?.['punchTimeOffClock']).toMatchObject({ state: 'in' });
    clock.set('2026-10-01T15:30:00.000Z');
    const punchedOut = await graphql('hana', PUNCH, {
      input: { kind: 'out', source: 'web', workModel: 'office' },
      key: 'hana-out',
    });
    const out = punchedOut.data?.['punchTimeOffClock'] as { punch: { id: string }; state: string };
    expect(out.state).toBe('out');

    clock.set('2026-10-01T19:00:00.000Z');
    const corrected = await rest('hana', 'POST', '/v1/timeoff/punches/corrections', {
      personId: people.hana,
      supersedes: out.punch.id,
      at: '2026-10-01T16:30:00.000Z',
      kind: 'out',
      reason: 'Stayed for the release',
    });
    expect(corrected).toMatchObject({ status: 201, body: { punch: { kind: 'out' } } });
    const sheet = await graphql(
      'hana',
      `
        {
          timeOffTimesheet(from: "2026-10-01", to: "2026-10-01") {
            days {
              date
              status
              workedMinutes
            }
            punches {
              kind
              at
              supersedes
            }
          }
        }
      `,
    );
    expect(sheet.errors).toBeUndefined();
    const day = (
      sheet.data?.['timeOffTimesheet'] as { days: { workedMinutes: number }[] } | undefined
    )?.days[0];
    // 09:00 to 18:30 with no break taken: nine and a half hours, the missing break flagged.
    expect(day).toMatchObject({ status: 'complete', workedMinutes: 9 * 60 + 30 });
    expect(events()).toContain('timeoff.attendance.corrected');

    /* November: HR sends October to Payroll. */
    clock.set('2026-11-02T08:00:00.000Z');
    expect((await rest('marco', 'POST', '/v1/timeoff/pay-periods/2026-10/close')).status).toBe(403);
    const closed = await rest('ada', 'POST', '/v1/timeoff/pay-periods/2026-10/close');
    expect(closed).toMatchObject({
      status: 200,
      body: { from: '2026-10-01', to: '2026-10-31', members: 1 },
    });
    const event = app.state(TENANT).events.find((e) => e.eventName === 'timeoff.period.closed');
    expect(event?.payload).toMatchObject({
      members: [{ personId: people.hana, workedHours: '9.500', overtimeHours: '0.000' }],
    });
    const twice = await rest('ada', 'POST', '/v1/timeoff/pay-periods/2026-10/close');
    expect(twice).toMatchObject({ status: 409, body: { error: { code: 'ALREADY_CLOSED' } } });
  });
});
