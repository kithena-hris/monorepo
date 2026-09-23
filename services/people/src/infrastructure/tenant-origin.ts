import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { ReminderCompany } from '../application/completeness/reminders.js';
import type { OrgStore } from '../application/org/org.js';

/**
 * Where a company's people sign in, and what it is called — the two things
 * an email People asks messaging to send must carry (PEO-084, PEO-093).
 *
 * `TENANT_APP_BASE` is the rule the auth origin already uses to send somebody
 * to their company (`MODERN_TENANT_APP_BASE` there): a URL with `{slug}` where
 * the tenant's label goes. `https://{slug}.app.kithena.com` in production;
 * the default is the one `just local` serves.
 */
export const DEFAULT_TENANT_APP_BASE = 'http://{slug}.app.localhost:3000';

export function tenantAppBase(env: NodeJS.ProcessEnv): string {
  const base = env['TENANT_APP_BASE'];
  return base === undefined || base === '' ? DEFAULT_TENANT_APP_BASE : base;
}

/** One DNS label: what a slug must be before it goes in front of a host. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The company's own origin, or null when the slug could not be a host label
 * or the base has nowhere to put it. Null, never a guess: a link to the wrong
 * origin is worse than no email.
 */
export function tenantOrigin(base: string, slug: string): string | null {
  if (!LABEL.test(slug) || !base.includes('{slug}')) return null;
  try {
    const origin = new URL(base.replace('{slug}', slug)).origin;
    return origin.includes(`//${slug}.`) ? origin : null;
  } catch {
    return null;
  }
}

/** The company as the sweep and the alert need it, from People's copy of the tenant. */
export function tenantCompanies(base: string, org: Pick<OrgStore, 'settings'>) {
  return async (tx: PostgresJsDatabase, tenantId: string): Promise<ReminderCompany | null> => {
    const { slug, displayName } = await org.settings(tx, tenantId);
    const name = displayName?.trim() ?? '';
    if (slug === null || name === '') return null;
    const origin = tenantOrigin(base, slug);
    return origin === null ? null : { name, origin };
  };
}
