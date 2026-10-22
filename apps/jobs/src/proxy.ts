import { NextResponse, type NextRequest } from 'next/server';

/**
 * A company's careers page on its own domain (REC-136): `careers.acme.com/x`
 * serves what `jobs.kithena.com/acme/x` does. Recruiting says which company a
 * host is, and only once Vercel has verified the domain.
 */

/** Kithena Jobs' own hosts, never a company's. */
const OURS = /(?:^|\.)(?:kithena\.com|vercel\.app)$|^(?:localhost|127\.0\.0\.1)$/u;
/** Pages that are no company's, the same on every host. */
const SHARED = new Set([
  'agency',
  'alerts',
  'auth',
  'preview',
  'sign-in',
  'embed',
  'embed.js',
  'feeds',
  'me',
  'reference',
  'schedule',
  'search',
  'welcome',
]);

// ponytail: per-instance and best effort; Recruiting caches the same answer for a minute too.
const known = new Map<string, { readonly company: string | null; readonly until: number }>();

async function companyFor(host: string): Promise<string | null> {
  const kept = known.get(host);
  if (kept !== undefined && kept.until > Date.now()) return kept.company;
  const base = (process.env['RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(
    /\/$/u,
    '',
  );
  let company: string | null = null;
  try {
    const response = await fetch(
      `${base}/v1/recruiting/companies/by-host/${encodeURIComponent(host)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (response.ok) company = ((await response.json()) as { company: string }).company;
    else if (response.status !== 404) return null;
  } catch {
    // Unreachable is not "no company": answer nothing, remember nothing.
    return null;
  }
  if (known.size >= 1_000) known.clear();
  known.set(host, { company, until: Date.now() + 60_000 });
  return company;
}

/** Shared pages that belong to one company, named second: `/preview/acme/…`. */
const PER_COMPANY = new Set(['agency', 'alerts', 'me', 'preview', 'reference', 'schedule']);
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/u;

/** The company a page is for, by its path; null for Kithena Jobs' own pages. */
export function companyOf(pathname: string): string | null {
  const [first = '', second = ''] = pathname.split('/').filter(Boolean);
  if (first === '') return null;
  if (!SHARED.has(first)) return SLUG.test(first) ? first : null;
  return PER_COMPANY.has(first) && SLUG.test(second) && second !== 'cv' ? second : null;
}

/**
 * The page, told which company it is for (`x-kithena-company`), so it wears
 * that company's name, logo and colours rather than Kithena Jobs': a
 * candidate applies to the company, not to us.
 */
function forCompany(request: NextRequest, company: string | null, url?: URL): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete('x-kithena-company');
  if (company !== null) headers.set('x-kithena-company', company);
  return url === undefined
    ? NextResponse.next({ request: { headers } })
    : NextResponse.rewrite(url, { request: { headers } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/u, '');
  const { pathname } = request.nextUrl;
  if (host === '' || OURS.test(host)) return forCompany(request, companyOf(pathname));
  const company = await companyFor(host);
  if (company === null) return forCompany(request, companyOf(pathname));
  const first = pathname.split('/')[1] ?? '';
  // On a company's own domain every page is theirs.
  if (first === company || SHARED.has(first)) return forCompany(request, company);
  const url = request.nextUrl.clone();
  url.pathname = `/${company}${pathname === '/' ? '' : pathname}`;
  return forCompany(request, company, url);
}

export const config = {
  // Pages only: not Next's own files, nor anything with an extension.
  matcher: ['/((?!_next/|.*\\.[a-z0-9]+$).*)'],
};
