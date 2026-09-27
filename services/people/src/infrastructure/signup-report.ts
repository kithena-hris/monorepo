import type * as z from 'zod';
import type { SignupQuestionSet } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { signupQuestions } from '../domain/schema/signup.js';
import { drizzleSchemaVersions } from './drizzle-person-reader.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * Tell identity what the sign-up page asks in one tenant:
 * `PUT /api/internal/tenants/<id>/signup-questions`, a `SignupQuestionSet`.
 *
 * The page is identity's and the fields are People's, and neither may import
 * or read the other, so People reports — the way `role-report.ts` does, with
 * the same token. Sent after a schema version is published (the consumer, on
 * `people.schema.published`) and for every tenant at boot and daily beside
 * reconciliation (the background job), so a report lost to an absent identity
 * is overtaken by the next one. A tenant with nothing published reports an
 * empty set at version 0, which is what clears a set a rollback took away.
 *
 * Never throws: a failure only leaves the sign-up page asking an older set.
 */
export type ReportSignup = (tenantId: string) => Promise<void>;

export function httpSignupReport(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly inTenant: InTenantTransaction;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}): ReportSignup {
  const schemas = drizzleSchemaVersions();
  return async (tenantId) => {
    try {
      const set = await config.inTenant(tenantId, async ({ tx }) => {
        const asOf: string = config.clock.instant();
        const version = await schemas.current(tx, tenantId);
        return {
          asOf,
          schemaVersion: version?.version ?? 0,
          questions: version === null ? [] : signupQuestions(version.document.attributes),
        } satisfies z.input<typeof SignupQuestionSet>;
      });
      const response = await fetch(
        new URL(`/api/internal/tenants/${tenantId}/signup-questions`, config.baseUrl),
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
          body: JSON.stringify(set),
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        },
      );
      if (!response.ok) {
        logger.warn(
          { tenantId, status: response.status },
          'identity refused the sign-up questions',
        );
      }
    } catch (error) {
      logger.warn({ tenantId, err: error }, 'sign-up questions not sent');
    }
  };
}

/** From `IDENTITY_URL` and `PEOPLE_IDENTITY_TOKEN` (else `INTERNAL_API_TOKEN`); null without both. */
export function signupReportFrom(
  env: NodeJS.ProcessEnv,
  inTenant: InTenantTransaction,
  clock: Clock,
): ReportSignup | null {
  const baseUrl = env['IDENTITY_URL'];
  const token = env['PEOPLE_IDENTITY_TOKEN'] ?? env['INTERNAL_API_TOKEN'];
  if (!baseUrl || !token) return null;
  return httpSignupReport({ baseUrl, token, inTenant, clock });
}
