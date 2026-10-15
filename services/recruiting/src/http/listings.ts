import { JobSearch } from '@kithena/contracts';

import type { Listings } from '../application/ports.js';

/**
 * Kithena Jobs' three reads, outside the route table because they have no
 * tenant and no caller (REC-090): the search across companies, one job page,
 * and a company's careers page. Everything they return is already public, so
 * the edge may cache it for a minute.
 */

export interface ListingsAnswer {
  readonly status: number;
  readonly body: unknown;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/u;
const list = (v: string | null) => (v === null || v === '' ? undefined : v.split(','));
const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));

/** The search's address as `JobSearch` takes it: lists comma-separated, numbers as numbers. */
export function searchFrom(params: URLSearchParams): ReturnType<typeof JobSearch.safeParse> {
  const raw: Record<string, unknown> = {
    q: params.get('q') ?? undefined,
    country: params.get('country') ?? undefined,
    workMode: list(params.get('workMode')),
    contractType: list(params.get('contractType')),
    hours: params.get('hours') ?? undefined,
    seniority: list(params.get('seniority')),
    salaryFromMinor: num(params.get('salaryFromMinor')),
    currency: params.get('currency') ?? undefined,
    postedWithinDays: num(params.get('postedWithinDays')),
    language: params.get('language') ?? undefined,
    company: params.get('company') ?? undefined,
    sort: params.get('sort') ?? undefined,
    page: num(params.get('page')),
  };
  return JobSearch.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== '')),
  );
}

/** Null when the path is not one of these reads. */
export async function listingsAnswer(
  listings: Listings,
  method: string,
  url: string,
): Promise<ListingsAnswer | null> {
  if (method !== 'GET') return null;
  const at = new URL(url, 'http://recruiting');
  const parts = at.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'v1' || parts[1] !== 'recruiting') return null;
  const notFound = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  if (parts[2] === 'listings' && parts.length === 3) {
    const query = searchFrom(at.searchParams);
    if (!query.success)
      return {
        status: 400,
        body: {
          error: { code: 'INVALID', message: query.error.issues[0]?.message ?? 'Check the search' },
        },
      };
    return { status: 200, body: await listings.search(query.data) };
  }
  if (parts[2] === 'listings' && parts.length === 5) {
    const [company = '', slug = ''] = parts.slice(3);
    if (!SLUG.test(company) || !SLUG.test(slug)) return notFound;
    const job = await listings.job(company, slug, at.searchParams.get('language'));
    return job === null ? notFound : { status: 200, body: job };
  }
  if (parts[2] === 'companies' && parts.length === 4) {
    const company = parts[3] ?? '';
    if (!SLUG.test(company)) return notFound;
    const page = await listings.company(company);
    return page === null ? notFound : { status: 200, body: page };
  }
  return null;
}
