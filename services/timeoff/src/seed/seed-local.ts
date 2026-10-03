import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { drizzleUnitOfWork, uuidv7 } from '../infrastructure/unit-of-work.js';
import { seedAcme } from './acme.js';

/**
 * `pnpm --filter @kithena/timeoff seed`: Acme's Platform team in Time Off
 * (TOF-049), after identity's and People's seeds in `pnpm db:seed`.
 *
 * Acme is found by its slug in `platform.tenant`, as the database owner,
 * because identity's seed made it and Time Off reads no other module's
 * tables; everything Time Off writes goes through its own unit of work as
 * `svc_timeoff`, under row-level security. Running it again changes nothing.
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

const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
const client = postgres(timeoffUrl, { max: 2 });
try {
  const [acme] = await owner<{ id: string }[]>`SELECT id FROM platform.tenant WHERE slug = 'acme'`;
  if (acme === undefined) {
    logger.warn('no acme tenant yet; run identity’s seed first');
  } else {
    const seeded = await seedAcme(
      drizzleUnitOfWork(drizzle(client)),
      TenantId.parse(acme.id),
      uuidv7,
    );
    if (!seeded.ok) {
      logger.error({ code: seeded.error.code, message: seeded.error.message }, 'seed refused');
      process.exitCode = 1;
    } else if (seeded.value === null) {
      logger.info('Acme’s Platform team is already in Time Off');
    } else {
      logger.info(seeded.value, 'Acme’s Platform team seeded into Time Off');
    }
  }
} finally {
  await owner.end();
  await client.end();
}
