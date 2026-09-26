import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock, type Clock } from '@kithena/domain-kit';

import {
  define,
  inMemoryPeople,
  noTransaction as tx,
  TENANT,
  versionOf,
} from '../../application/person/in-memory.js';
import {
  decidePendingChange,
  withdrawPendingChange,
  type Holding,
  type PendingChangeDeps,
} from '../../application/person/pending-changes.js';
import { inMemoryPendingChangeStore } from '../../application/person/pending-store.js';
import { personAccess } from '../../application/person/person-access.js';
import type { ApprovalNotice } from '../approval-mailer.js';
import { activities, TASK_QUEUE, workflowId, workflowsPath } from './pending-change.js';
import { closedSignal, pendingChangeApproval } from './pending-change.workflow.js';

/**
 * The approval workflow of a held change (PEO-077) on Temporal's
 * time-skipping test server: a week passes in milliseconds, and the
 * activities are the real ones over in-memory stores.
 */

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env.teardown();
});

const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const HANNA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';

const iban = define({
  key: 'iban',
  dataType: 'bank_account',
  typeConfig: { kind: 'bank_account', country: 'DE' },
  encrypted: true,
  visibility: ['self', 'hr'],
  ownership: ['employee'],
  classification: {
    classification: 'confidential',
    piiKind: 'financial',
    exportable: true,
    aiEligible: false,
  },
});

function setup() {
  const store = inMemoryPeople([versionOf(3, [iban])]);
  store.seed(ADA, { account: ADA_ACCOUNT });
  let current = fixedClock('2026-09-22T09:00:00.000Z');
  const clock: Clock = {
    now: () => current.now(),
    today: (tz) => current.today(tz),
    instant: () => current.instant(),
    date: (tz) => current.date(tz),
  };
  const holding: Holding = {
    store: inMemoryPendingChangeStore(),
    publish: () => Promise.resolve(),
    clock,
    newId: store.deps.newId,
  };
  const access = personAccess({ ...store.deps, approvals: holding });
  const deps: PendingChangeDeps = {
    ...holding,
    access,
    schemas: store.deps.schemas,
    reader: store.deps.reader,
    relations: store.deps.relations,
  };
  const sent: { email: string; notice: ApprovalNotice; key: string }[] = [];
  const acts = activities((_t, fn) => fn({ tx }), {
    holding,
    reader: store.deps.reader,
    roles: {
      holdings: () =>
        Promise.resolve(
          new Map([
            [HR_ACCOUNT, new Set(['hr'])],
            [HANNA_ACCOUNT, new Set(['hr'])],
          ]),
        ),
      candidates: () =>
        Promise.resolve([
          { accountId: ADA_ACCOUNT, workEmail: 'ada@acme.test' },
          { accountId: HR_ACCOUNT, workEmail: 'hr@acme.test' },
          { accountId: HANNA_ACCOUNT, workEmail: 'hanna@acme.test' },
        ]),
    },
    companyOf: () => Promise.resolve({ name: 'Acme', origin: 'https://acme.app.kithena.test' }),
    mailer: {
      send: (_tenant, _company, email, notice, key) => {
        sent.push({ email, notice, key });
        return Promise.resolve();
      },
    },
  });
  const later = (iso: string) => {
    current = fixedClock(iso);
  };
  return { access, deps, acts, sent, later };
}

async function run(
  s: ReturnType<typeof setup>,
  body: (changeId: string) => Promise<void>,
  settleAt?: string,
) {
  const written = await s.access.update(tx, {
    tenantId: TENANT,
    viewer: { accountId: ADA_ACCOUNT, roles: new Set() },
    correlationId: 'c',
    personId: ADA,
    changes: { iban: 'DE89370400440532013000' },
  });
  const changeId = written.ok ? written.value.held?.[0]?.changeId : undefined;
  if (changeId === undefined) throw new Error('nothing held');
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: {
      announce: (input: Parameters<typeof s.acts.announce>[0]) => s.acts.announce(input),
      // The test server skips the workflow's week, not the application's
      // clock; the activity is told the week has passed.
      settle: (input: Parameters<typeof s.acts.settle>[0]) => {
        if (settleAt) s.later(settleAt);
        return s.acts.settle(input);
      },
    },
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(pendingChangeApproval, {
      taskQueue: TASK_QUEUE,
      workflowId: workflowId(changeId),
      args: [{ tenantId: TENANT, changeId, correlationId: 'c', windowMs: 7 * 24 * 60 * 60 * 1000 }],
    });
    await body(changeId);
    return handle.result();
  });
}

describe('the pending-change workflow', () => {
  it('tells the approvers, then the requester once HR approves', async () => {
    const s = setup();
    const result = await run(s, async (changeId) => {
      // HR decides after being told; an announcement after the decision tells nobody.
      for (let i = 0; i < 200 && s.sent.length < 2; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const decided = await decidePendingChange(tx, s.deps, {
        tenantId: TENANT,
        viewer: { accountId: HR_ACCOUNT, roles: new Set(['hr']) },
        correlationId: 'c',
        changeId,
        approve: true,
      });
      expect(decided.ok).toBe(true);
      await env.client.workflow.getHandle(workflowId(changeId)).signal(closedSignal);
    });
    expect(result).toBe('approved');
    // Both HR members approve; Ada asked, and it is her record.
    expect(s.sent.map((m) => [m.email, m.notice.kind])).toEqual([
      ['hr@acme.test', 'approval_requested'],
      ['hanna@acme.test', 'approval_requested'],
      ['ada@acme.test', 'approval_decided'],
    ]);
  });

  it('tells the requester nothing more once they withdrew it', async () => {
    const s = setup();
    const result = await run(s, async (changeId) => {
      await withdrawPendingChange(tx, s.deps, {
        tenantId: TENANT,
        viewer: { accountId: ADA_ACCOUNT, roles: new Set() },
        correlationId: 'c',
        changeId,
      });
      await env.client.workflow.getHandle(workflowId(changeId)).signal(closedSignal);
    });
    expect(result).toBe('withdrawn');
    expect(s.sent.filter((m) => m.email === 'ada@acme.test')).toEqual([]);
  });

  it('expires a change nobody decided within the week, and says so to the requester', async () => {
    const s = setup();
    const result = await run(s, () => Promise.resolve(), '2026-09-29T09:00:00.000Z');
    expect(result).toBe('expired');
    expect(s.sent.at(-1)).toMatchObject({
      email: 'ada@acme.test',
      notice: { kind: 'approval_expired' },
    });
  });
});
