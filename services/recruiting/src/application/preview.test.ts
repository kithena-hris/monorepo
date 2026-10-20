import { randomUUID } from 'node:crypto';
import { CalendarDate, Instant, TenantId, type PersonId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { contextOf, type Ctx } from './context.js';
import { previewJob, previewTokenFor } from './intake.js';
import { createJob, saveAd } from './jobs.js';
import type { Deps } from './ports.js';

/** A job's team previews it on Kithena Jobs before it is published (R7). */

const tenantId = TenantId.parse(randomUUID());
const at = '2026-10-20T09:00:00.000Z';
const clock: Clock = {
  now: () => new Date(at),
  today: () => at.slice(0, 10),
  instant: () => Instant.parse(at),
  date: () => CalendarDate.parse(at.slice(0, 10)),
};

describe('previewing a job', () => {
  it('hands the team one token a day, shows the ad by it, and refuses a token it never made', async () => {
    const uow = memoryUnitOfWork();
    const deps: Deps = {
      uow,
      blobs: memoryBlobs(),
      clock,
      newId: randomUUID,
      jobsOrigin: 'https://jobs.example',
      extractText: () => Promise.resolve(''),
    };
    const admin = randomUUID() as PersonId;
    const asAdmin = <T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> =>
      uow.run(tenantId, async (tx) => {
        await tx.admins.add('account-admin');
        return fn(
          await contextOf(deps, tx, {
            tenantId,
            accountId: 'account-admin',
            personId: admin,
            correlationId: randomUUID(),
          }),
        );
      });
    const jobId = randomUUID();
    const created = await asAdmin((ctx) =>
      createJob(ctx, {
        id: jobId,
        title: 'Backend engineer',
        internalTitle: 'Backend engineer',
        requisitionIds: [],
        entityId: null,
        locationIds: [],
        department: null,
        workMode: 'remote',
        openings: 1,
        languages: ['en'],
        hiringManagerId: null,
      }),
    );
    expect(created.ok).toBe(true);
    const first = await asAdmin((ctx) => previewTokenFor(ctx, jobId));
    const again = await asAdmin((ctx) => previewTokenFor(ctx, jobId));
    expect(again).toBe(first);

    // Without an ad there is nothing to show yet.
    const empty = await asAdmin((ctx) => previewJob(ctx, first, null));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('NO_AD');

    const written = await asAdmin((ctx) =>
      saveAd(ctx, jobId, 'en', 'Backend engineer', {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build the platform.' }] }],
      }),
    );
    expect(written.ok).toBe(true);
    const shown = await asAdmin((ctx) => previewJob(ctx, first, null));
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value).toMatchObject({ title: 'Backend engineer', closed: false });

    const unknown = await asAdmin((ctx) => previewJob(ctx, 'not-a-token-anyone-made', null));
    expect(unknown.ok).toBe(false);
  });
});
