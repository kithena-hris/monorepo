import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { uuidv7 } from '../application/person/ids.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import { configureGraphQL } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../infrastructure/drizzle-person-reader.js';
import { staticKeyRing, type MasterKey } from '../infrastructure/envelope.js';
import { drizzleSecretStore } from '../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../infrastructure/unique.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { callerFromHeaders } from './caller.js';

/**
 * The composition root for People's transports, called once from `main.ts`.
 *
 * With no `PEOPLE_DATABASE_URL` nothing is wired and the subgraph still
 * serves its schema, so `just supergraph` can introspect a module that has no
 * database behind it. Every operation then answers UNAVAILABLE rather than
 * pretending.
 */

/** `id:base64,id:base64` — the first is the key new secrets are written under. */
function keysFrom(value: string | undefined): MasterKey[] {
  return (value ?? '')
    .split(',')
    .filter((pair) => pair.includes(':'))
    .map((pair) => {
      const [id = '', key = ''] = pair.split(':');
      return { id, key: Buffer.from(key, 'base64') };
    });
}

export function peopleService(databaseUrl: string, secretKeys: string | undefined): PeopleService {
  const db = drizzle(postgres(databaseUrl));
  const schemas = drizzleSchemaVersions();
  return {
    access: personAccess({
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      schemas,
      relations: drizzleRelations(),
      secrets: drizzleSecretStore(staticKeyRing(keysFrom(secretKeys)), logger),
      uniques: drizzleUniqueClaims(),
      clock: systemClock,
      newId: uuidv7,
    }),
    schemas,
    inTenant: tenantTransaction(db),
  };
}

export function wirePeople(): void {
  const url = process.env['PEOPLE_DATABASE_URL'];
  if (!url) {
    logger.warn({ module: 'people' }, 'PEOPLE_DATABASE_URL is not set; serving the schema only');
    return;
  }

  const service = peopleService(url, process.env['PEOPLE_SECRET_KEYS']);
  const callerFrom = callerFromHeaders(
    process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '',
  );
  configureGraphQL({ service, callerFrom });
}
