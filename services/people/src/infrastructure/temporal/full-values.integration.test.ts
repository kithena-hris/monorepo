import { randomBytes } from 'node:crypto';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock, type Clock } from '@kithena/domain-kit';

import { asking, FINANCE, financeTenant, HR } from '../../application/export/fixture.js';
import {
  decideFullValues,
  requestFullValues,
  type FullValuesDeps,
} from '../../application/export/full-values.js';
import { inMemoryFullValuesStore } from '../../application/export/full-values-store.js';
import { inMemoryExportLedger } from '../../application/export/ledger.js';
import { localObjectStore } from '../../application/export/object-store.js';
import { noTransaction as tx } from '../../application/person/in-memory.js';
import { personAccess } from '../../application/person/person-access.js';
import { activities, TASK_QUEUE, workflowId, workflowsPath } from './full-values.js';
import { decidedSignal, fullValuesApproval } from './full-values.workflow.js';
import { utcCalendars } from '../../application/org/org.js';

/**
 * The workflow on Temporal's time-skipping test server: a week passes in
 * milliseconds, and the activity is the real `settle` over in-memory stores.
 */

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env.teardown();
});

function setup() {
  const people = financeTenant();
  let current = fixedClock('2026-09-22T09:00:00.000Z');
  const clock: Clock = {
    now: () => current.now(),
    today: (tz) => current.today(tz),
    instant: () => current.instant(),
    date: (tz) => current.date(tz),
  };
  const sent: string[] = [];
  let ids = 0;
  const deps: FullValuesDeps = { calendars: utcCalendars,
    access: personAccess(people.deps),
    schemas: people.deps.schemas,
    relations: people.deps.relations,
    records: people.deps,
    clock,
    store: localObjectStore({
      encryptionKey: randomBytes(32),
      signingKey: randomBytes(32),
      clock,
      baseUrl: 'https://people.test/f',
    }),
    notifier: { notify: (m) => (sent.push(m.exportId), Promise.resolve()) },
    audit: { publish: () => Promise.resolve() },
    ledger: inMemoryExportLedger(),
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
    requests: inMemoryFullValuesStore(),
    reveal: () => Promise.resolve('ES9121000418450200051332'),
  };
  const inTenant = <R>(_t: string, fn: (s: { tx: typeof tx }) => Promise<R>) => fn({ tx });
  const later = (iso: string) => {
    current = fixedClock(iso);
  };
  return { deps, inTenant, sent, later };
}

async function run(
  s: ReturnType<typeof setup>,
  body: (requestId: string) => Promise<void>,
  settleAt?: string,
) {
  const requested = await requestFullValues(tx, s.deps, {
    ...asking(FINANCE),
    fields: ['iban'],
    reason: 'September payroll run',
  });
  if (!requested.ok) throw new Error(requested.error.message);
  const requestId = requested.value.approval.id;
  const real = activities(s.inTenant, s.deps);
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: {
      // The test server skips the workflow's week, not the application's
      // clock; the activity is told the week has passed.
      settle: (input: Parameters<typeof real.settle>[0]) => {
        if (settleAt) s.later(settleAt);
        return real.settle(input);
      },
    },
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(fullValuesApproval, {
      taskQueue: TASK_QUEUE,
      workflowId: workflowId(requestId),
      args: [
        {
          tenantId: asking(HR).tenantId,
          requestId,
          correlationId: 'c',
          windowMs: 7 * 24 * 60 * 60 * 1000,
        },
      ],
    });
    await body(requestId);
    return handle.result();
  });
}

describe('the full-values workflow', () => {
  it('issues the file once HR approves and signals', async () => {
    const s = setup();
    const result = await run(s, async (requestId) => {
      const decided = await decideFullValues(tx, s.deps, {
        ...asking(HR),
        requestId,
        approve: true,
      });
      expect(decided.ok).toBe(true);
      await env.client.workflow.getHandle(workflowId(requestId)).signal(decidedSignal);
    });
    expect(result).toBe('issued');
    expect(s.sent).toHaveLength(1);
  });

  it('issues nothing on a rejection', async () => {
    const s = setup();
    const result = await run(s, async (requestId) => {
      await decideFullValues(tx, s.deps, { ...asking(HR), requestId, approve: false });
      await env.client.workflow.getHandle(workflowId(requestId)).signal(decidedSignal);
    });
    expect(result).toBe('rejected');
    expect(s.sent).toHaveLength(0);
  });

  it('expires a request nobody decided within the week', async () => {
    const s = setup();
    const result = await run(s, () => Promise.resolve(), '2026-09-29T09:00:00.000Z');
    expect(result).toBe('expired');
    expect(s.sent).toHaveLength(0);
  });
});
