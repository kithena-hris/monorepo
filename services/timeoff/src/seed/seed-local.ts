import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { TenantId } from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { logNotifier } from '../infrastructure/background.js';
import { timeoffConsumer } from '../infrastructure/consumers/handle.js';
import { syncingTuples, timeoffFgaFrom } from '../infrastructure/openfga.js';
import { drizzleUnitOfWork, uuidv7 } from '../infrastructure/unit-of-work.js';
import { seedAcme, team } from './acme.js';

/**
 * `… | pnpm --filter @kithena/timeoff seed`: Acme's Platform team in Time Off
 * (TOF-049), after identity's and People's seeds in `pnpm db:seed`, with
 * identity's events on stdin as People's seed has them.
 *
 * Acme is found by its slug in `platform.tenant`, as the database owner,
 * because identity's seed made it and Time Off reads no other module's
 * tables; everything Time Off writes goes through its own unit of work as
 * `svc_timeoff`, under row-level security. Running it again changes nothing.
 *
 * With `OPENFGA_URL`, as `just dev` has it, Time Off's store and model are
 * made (`timeoffFgaFrom`, found by name or created, as People's are), the
 * team's tuples follow the rows as in a deployment (`syncingTuples`), and
 * identity's events go to Time Off's own consumer, so whom identity names
 * Time Off's administrator — Ada — holds `hr_admin`. People's seed does the
 * same with the same pipe (`services/people/src/seed-local.ts`).
 *
 * Local only. It refuses to run under NODE_ENV=production.
 */

if (process.env['NODE_ENV'] === 'production') {
  logger.error('the Time Off seed is for a laptop, not a deployment');
  process.exit(1);
}

const port = process.env['POSTGRES_PORT'] ?? '5432';
const ownerUrl =
  process.env['DATABASE_URL'] ?? `postgres://kithena:kithena@localhost:${port}/kithena`;
const timeoffUrl =
  process.env['TIMEOFF_DATABASE_URL'] ?? `postgres://svc_timeoff:kithena@localhost:${port}/kithena`;

/** Another module's events, one JSON envelope a line on stdin; none from a terminal. */
async function piped(): Promise<unknown[]> {
  if (process.stdin.isTTY) return [];
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  // pnpm may still print a banner; only envelopes are delivered.
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as unknown);
}

const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
const client = postgres(timeoffUrl, { max: 2 });
try {
  const plain = drizzleUnitOfWork(drizzle(client));
  const fga = timeoffFgaFrom(process.env, () => systemClock.date('UTC'));
  const synced = fga === null ? null : syncingTuples(plain, fga);
  const uow = synced?.uow ?? plain;

  const [acme] = await owner<{ id: string }[]>`SELECT id FROM platform.tenant WHERE slug = 'acme'`;
  if (acme === undefined) {
    logger.warn('no acme tenant yet; run identity’s seed first');
  } else {
    const tenantId = TenantId.parse(acme.id);
    const seeded = await seedAcme(uow, tenantId, uuidv7);
    if (!seeded.ok) {
      logger.error({ code: seeded.error.code, message: seeded.error.message }, 'seed refused');
      process.exitCode = 1;
    } else if (seeded.value === null) {
      logger.info('Acme’s Platform team is already in Time Off');
    } else {
      logger.info(seeded.value, 'Acme’s Platform team seeded into Time Off');
    }
    // A store made after the team was seeded has none of its tuples yet.
    for (const personId of Object.values(team)) {
      // oxlint-disable-next-line no-await-in-loop -- seven members, in order
      await synced?.tuples.resync(tenantId, personId);
    }
  }

  const handle = timeoffConsumer({
    uow,
    clock: systemClock,
    newId: uuidv7,
    notifier: logNotifier,
    ...(synced === null ? {} : { tuples: synced.tuples }),
  });
  let delivered = 0;
  for (const event of await piped()) {
    // oxlint-disable-next-line no-await-in-loop -- in order, one at a time, as a partition is consumed
    if ((await handle(event)) === 'applied') delivered += 1;
  }
  logger.info({ delivered }, 'events from stdin applied by Time Off');
} finally {
  await owner.end();
  await client.end();
}
