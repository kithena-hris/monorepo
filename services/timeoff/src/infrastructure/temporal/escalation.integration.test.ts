import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateSpan, LedgerEntry, LeaveTypeKey, PersonId } from '@kithena/contracts';

import { decideRequest } from '../../application/approval/decide.js';
import { sendRequest } from '../../application/request/request.js';
import { addDays } from '../../domain/days.js';
import { caller, people, TENANT, world } from '../../application/testing/world.js';
import { activities, TASK_QUEUE, workflowId, workflowsPath } from './escalation.js';
import { closedSignal, requestEscalation } from './escalation.workflow.js';

/**
 * TOF-039 on Temporal's time-skipping test server: a week passes in
 * milliseconds, and the activity is the real one over the in-memory ports.
 * The workflow hands the activity its own time, so the skipped days are the
 * days the escalation counts.
 */

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env.teardown();
});

const NORA = PersonId.parse('00000000-0000-7000-8000-000000000008');
const DAY = 24 * 60 * 60 * 1000;

describe('the escalation workflow', () => {
  it("escalates to the approver's manager once three working days are skipped", async () => {
    const now = new Date(await env.currentTimeMs());
    const app = world(now.toISOString());
    const s = app.state(TENANT);
    const marco = s.members.get(people.marco);
    if (marco === undefined) throw new Error('no Marco');
    s.members.set(people.marco, { ...marco, managerPersonId: NORA });
    const today = app.clock.date('Europe/Madrid');
    s.ledger.push(
      LedgerEntry.parse({
        entryId: '0189eeee-0000-7000-8000-000000000001',
        personId: people.adam,
        leaveTypeKey: 'vacation',
        kind: 'grant',
        amount: '25.000',
        unit: 'day',
        effectiveOn: `${today.slice(0, 4)}-01-01`,
        occurredAt: now.toISOString(),
        policyVersion: 1,
        supersedes: null,
        requestId: null,
        reason: null,
      }),
    );
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: addDays(today, 40), to: addDays(today, 44) }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    const id = sent.value.requestId;

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: activities(app.deps),
    });
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(requestEscalation, {
        taskQueue: TASK_QUEUE,
        workflowId: workflowId(id),
        args: [{ tenantId: TENANT, requestId: id, correlationId: 'c' }],
      });
      // However the week falls, eight days hold three working days.
      await env.sleep(8 * DAY);
      expect(s.requests.get(id)?.routing.escalatedTo).toBe(NORA);
      expect(app.notices.some((n) => n.to === NORA && n.notice.kind === 'approval_escalated')).toBe(
        true,
      );

      app.clock.set(new Date(await env.currentTimeMs()).toISOString());
      const decided = await decideRequest(app.deps)(caller(NORA), {
        requestId: id,
        decision: 'approve',
      });
      expect(decided.ok).toBe(true);
      await handle.signal(closedSignal);
      return handle.result();
    });
    expect(result).toBe('closed');
  });
});
