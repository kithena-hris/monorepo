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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/u, '');
  if (host === '' || OURS.test(host)) return NextResponse.next();
  const company = await companyFor(host);
  if (company === null) return NextResponse.next();
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1] ?? '';
  if (first === company || SHARED.has(first)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `/${company}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: not Next's own files, nor anything with an extension.
  matcher: ['/((?!_next/|.*\\.[a-z0-9]+$).*)'],
};
