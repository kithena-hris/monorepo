import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TASK_QUEUE, workflowId, workflowsPath } from './import-run.js';
import { importRun, type ImportRunActivities } from './import-run.workflow.js';

/**
 * The import workflow on Temporal's time-skipping test server: it asks for
 * one chunk after another until the run says it is over, a chunk that
 * failed is retried, and one that keeps failing stops the run. The chunks
 * themselves are `stepRun`'s, tested with the run (`application/import`).
 */

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env.teardown();
});

async function drive(
  step: ImportRunActivities['step'],
): Promise<{ steps: number; stopped: string[] }> {
  let steps = 0;
  const stopped: string[] = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: {
      step: (input: Parameters<ImportRunActivities['step']>[0]) => {
        steps += 1;
        return step(input);
      },
      stop: (_input: unknown, why: string) => {
        stopped.push(why);
        return Promise.resolve();
      },
    } satisfies ImportRunActivities,
  });
  const runId = `00000000-0000-4000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`;
  await worker.runUntil(
    env.client.workflow.execute(importRun, {
      taskQueue: TASK_QUEUE,
      workflowId: workflowId(runId),
      args: [{ tenantId: '00000000-0000-4000-8000-000000000001', runId }],
    }),
  );
  return { steps, stopped };
}

describe('the import workflow', () => {
  it('steps until the run is over', async () => {
    let left = 5;
    const ran = await drive(() => Promise.resolve((left -= 1) > 0 ? 'more' : 'done'));
    expect(ran).toEqual({ steps: 5, stopped: [] });
  });

  it('retries a chunk that failed, on and on as Temporal retries it, then carries on', async () => {
    let calls = 0;
    const ran = await drive(() => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('the database went away'));
      return Promise.resolve(calls < 4 ? 'more' : 'done');
    });
    expect(ran).toEqual({ steps: 4, stopped: [] });
  });

  it('stops the run once a chunk has failed past its retries', async () => {
    const ran = await drive(() => Promise.reject(new Error('still down')));
    expect(ran.steps).toBe(10);
    expect(ran.stopped).toEqual(['The import kept failing and was stopped']);
  });
});
