import postgres from 'postgres';
import { PublicCompany, PublicJob, PublicListing, type JobSearch } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Listings } from '../application/ports.js';

/**
 * Kithena Jobs' reads over `recruiting_public` (REC-090, PRD §31.2), as
 * `svc_jobs_reader`: a role granted SELECT on that schema and nothing else,
 * so a bug here cannot reach a tenant's rows. Each row's `page` is the whole
 * `PublicJob` the outbox consumer wrote; a listing is that page parsed down.
 */

const PAGE = 20;

export function listingsFrom(env: NodeJS.ProcessEnv = process.env): Listings | null {
  const url = env['RECRUITING_JOBS_READER_URL'];
  if (!url) {
    logger.info(
      { module: 'recruiting' },
      'RECRUITING_JOBS_READER_URL unset; no Kithena Jobs reads',
    );
    return null;
  }
  const sql = postgres(url, { max: 5 });
  onShutdown('recruiting jobs reader', () => sql.end({ timeout: 5 }));
  return postgresListings(sql);
}

export function postgresListings(sql: postgres.Sql): Listings {
  // A host asked about on every request from it: kept a minute, so a new
  // domain answers within a minute of being verified and a removed one stops.
  // ponytail: per process; a shared cache if this ever runs on several.
  const hosts = new Map<string, { readonly company: string | null; readonly until: number }>();
  return {
    async companyForHost(host) {
      const kept = hosts.get(host);
      if (kept !== undefined && kept.until > Date.now()) return kept.company;
      const [row] = await sql<{ company_slug: string }[]>`
        SELECT company_slug FROM recruiting_public.careers_domain
        WHERE host = ${host} AND status = 'verified'`;
      const company = row?.company_slug ?? null;
      // Anyone can ask after any host; a flood of made-up ones empties the cache, not memory.
      if (hosts.size >= 1_000) hosts.clear();
      hosts.set(host, { company, until: Date.now() + 60_000 });
      return company;
    },
    async search(query: JobSearch) {
      const q = query.q?.trim() ?? '';
      // The ad's own language stemmed the stored tsvector; a query is matched
      // in each launch language and unstemmed, so "engineers" finds "Engineer".
      const tsq = sql`(websearch_to_tsquery('simple', ${q}) || websearch_to_tsquery('english', ${q})
        || websearch_to_tsquery('german', ${q}) || websearch_to_tsquery('spanish', ${q}))`;
      const order =
        query.sort === 'newest' || q === ''
          ? sql`ORDER BY posted_at DESC`
          : query.sort === 'salary'
            ? sql`ORDER BY salary_max_minor DESC NULLS LAST, posted_at DESC`
            : sql`ORDER BY ts_rank(tsv, ${tsq}) DESC, posted_at DESC`;
      const rows = await sql<{ page: unknown; total: string }[]>`
        SELECT page, count(*) OVER () AS total
        FROM recruiting_public.listing
        WHERE NOT closed
          ${query.company === undefined ? sql`` : sql`AND company_slug = ${query.company}`}
          ${q === '' ? sql`` : sql`AND tsv @@ ${tsq}`}
          ${query.country === undefined ? sql`` : sql`AND ${query.country} = ANY(country)`}
          ${query.workMode === undefined || query.workMode.length === 0 ? sql`` : sql`AND work_mode = ANY(${[...query.workMode]})`}
          ${query.hours === undefined ? sql`` : sql`AND hours = ${query.hours}`}
          ${query.language === undefined ? sql`` : sql`AND language = ${query.language}`}
          ${query.postedWithinDays === undefined ? sql`` : sql`AND posted_at > now() - make_interval(days => ${query.postedWithinDays})`}
          ${query.salaryFromMinor === undefined ? sql`` : sql`AND salary_max_minor >= ${query.salaryFromMinor}`}
        ${order}
        LIMIT ${PAGE} OFFSET ${(query.page - 1) * PAGE}`;
      const total = Number(rows[0]?.total ?? 0);
      if (total > 0 || q === '')
        return { rows: rows.map((r) => PublicListing.parse(r.page)), total };
      // Nothing matched every word: the closest, by any of them, with only the country kept.
      const words = q
        .split(/[^\p{L}\p{N}+#.]+/u)
        .filter((w) => w.length > 1)
        .slice(0, 8);
      if (words.length === 0) return { rows: [], total: 0 };
      const any = sql`(to_tsquery('simple', ${words.map((w) => `'${w.replaceAll("'", '')}':*`).join(' | ')})
        || to_tsquery('english', ${words.map((w) => `'${w.replaceAll("'", '')}':*`).join(' | ')}))`;
      const near = await sql<{ page: unknown }[]>`
        SELECT page FROM recruiting_public.listing
        WHERE NOT closed
          ${query.company === undefined ? sql`` : sql`AND company_slug = ${query.company}`}
          ${query.country === undefined ? sql`` : sql`AND ${query.country} = ANY(country)`}
          AND tsv @@ ${any}
        ORDER BY ts_rank(tsv, ${any}) DESC, posted_at DESC
        LIMIT 10`;
      return { rows: [], total: 0, nearby: near.map((r) => PublicListing.parse(r.page)) };
    },
    async job(company, slug, language) {
      const rows = await sql<{ page: unknown }[]>`
        SELECT page FROM recruiting_public.listing
        WHERE company_slug = ${company} AND slug = ${slug}
        ORDER BY (language = ${language ?? ''}) DESC, posted_at
        LIMIT 1`;
      return rows[0] === undefined ? null : PublicJob.parse(rows[0].page);
    },
    async company(slug) {
      const [row] = await sql<Record<string, unknown>[]>`
        SELECT slug, name, theme_id, logo_url, about FROM recruiting_public.company WHERE slug = ${slug}`;
      if (row === undefined) return null;
      const jobs = await sql<{ page: unknown }[]>`
        SELECT page FROM recruiting_public.listing
        WHERE company_slug = ${slug} AND NOT closed ORDER BY posted_at DESC LIMIT 500`;
      return {
        company: PublicCompany.parse({
          slug: row['slug'],
          name: row['name'],
          themeId: row['theme_id'],
          logoUrl: row['logo_url'] ?? null,
          about: row['about'] ?? null,
        }),
        jobs: jobs.map((j) => PublicListing.parse(j.page)),
      };
    },
  };
}
