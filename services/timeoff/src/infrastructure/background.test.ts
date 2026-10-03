import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import { Policy } from '../domain/policy/policy.js';
import {
  d,
  people,
  TENANT,
  VACATION_POLICY,
  vacationPolicy,
  world,
} from '../application/testing/world.js';
import { jobs, runJob } from './background.js';

/** TOF-043's "done when": the October accrual, posted once however often the job runs. */
describe('the accrual job', () => {
  it('posts the October accrual once even if run twice', async () => {
    const app = world('2026-09-01T00:30:00.000Z');
    const s = app.state(TENANT);
    const monthly = Policy.draft({
      id: VACATION_POLICY,
      tenantId: TENANT,
      definition: vacationPolicy({ earning: 'monthly' }),
    });
    monthly.publish(d('2026-01-01'), {
      clock: fixedClock('2025-12-01T00:00:00.000Z'),
      newId: () => '0189ffff-0000-7000-8000-000000000001',
      actor: { kind: 'system', process: 'test' },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      causationId: null,
      timeZone: 'Europe/Madrid',
    });
    s.policies.set(VACATION_POLICY, monthly);
    const table = jobs(app.deps);

    await runJob(table, 'accrual', [TENANT]);
    const adams = () => s.ledger.filter((e) => e.personId === people.adam);
    expect(adams()).toHaveLength(9);

    app.clock.set('2026-10-01T00:15:00.000Z');
    await runJob(table, 'accrual', [TENANT]);
    await runJob(table, 'accrual', [TENANT]);

    const october = adams().filter((e) => e.effectiveOn === '2026-10-01');
    expect(october.map((e) => [e.kind, e.amount])).toEqual([['accrual', '2.083']]);
    expect(adams()).toHaveLength(10);
    expect(s.ledger.filter((e) => e.effectiveOn === '2026-10-01')).toHaveLength(7);
  });
});
