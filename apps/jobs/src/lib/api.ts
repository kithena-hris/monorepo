import 'server-only';

import type { CandidatePage, PublicCompany, PublicJob, PublicListing } from '@kithena/contracts';

/**
 * Recruiting's public API, from the server (REC-090). Search, job and
 * careers page read the public projection; everything a candidate does
 * goes through the public routes, the token in a header and never a URL.
 */

const base = () =>
  (process.env['RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(/\/$/u, '');

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function call<T>(
  path: string,
  init: RequestInit & { revalidate?: number } = {},
): Promise<Answer<T>> {
  const { revalidate, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      ...rest,
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    });
  } catch {
    return { ok: false, status: 503, message: 'Kithena Jobs is not reachable right now.' };
  }
  const body = (await response.json().catch(() => null)) as
    { error?: { message?: string } } | T | null;
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      message:
        (body as { error?: { message?: string } } | null)?.error?.message ?? 'Something went wrong',
    };
  return { ok: true, data: body as T };
}

export interface Results {
  readonly rows: readonly PublicListing[];
  readonly total: number;
}

/** The search's address, passed through: it is already the API's query. */
export const search = (query: URLSearchParams) =>
  call<Results>(`/v1/recruiting/listings?${query.toString()}`, { revalidate: 60 });

export const job = (company: string, slug: string, language?: string) =>
  call<PublicJob>(
    `/v1/recruiting/listings/${encodeURIComponent(company)}/${encodeURIComponent(slug)}${
      language === undefined ? '' : `?language=${encodeURIComponent(language)}`
    }`,
    { revalidate: 60 },
  );

export const company = (slug: string) =>
  call<{ company: PublicCompany; jobs: readonly PublicListing[] }>(
    `/v1/recruiting/companies/${encodeURIComponent(slug)}`,
    { revalidate: 60 },
  );

/** One of the public routes under a company, as the candidate or a referee. */
export function publicCall<T>(
  company: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string; ip?: string | null } = {},
): Promise<Answer<T>> {
  return call<T>(`/v1/recruiting/public/${encodeURIComponent(company)}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token === undefined ? {} : { 'x-candidate-token': options.token }),
      ...(options.ip == null ? {} : { 'x-forwarded-for': options.ip }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export type { CandidatePage };
