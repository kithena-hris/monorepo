'use server';

import type { CompanyRow } from '../components/companies-overview';
import { readIdentity } from '../lib/identity';
import { currentOperator } from '../lib/session';

/**
 * The next page of companies, as the list scrolls (`usePages`). A cursor, not
 * a page number: the list is ordered by creation and only grows, so `?page=7`
 * would name a different set each time somebody is added.
 *
 * Fails closed as the page does: this is the one surface that crosses
 * tenants, so no operator, no rows.
 */
export async function moreCompanies(
  cursor: string,
): Promise<{ readonly items: readonly CompanyRow[]; readonly next: string | null } | null> {
  if (!(await currentOperator())) return null;
  const page = (await readIdentity(
    `/api/internal/admin/tenants?limit=50&cursor=${encodeURIComponent(cursor)}`,
  )) as { tenants?: CompanyRow[]; nextCursor?: string | null } | null;
  return { items: page?.tenants ?? [], next: page?.nextCursor ?? null };
}
