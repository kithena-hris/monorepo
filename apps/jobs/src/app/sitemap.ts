import type { MetadataRoute } from 'next';

import { search } from '../lib/api';

export const revalidate = 3600;

/**
 * Every job on the shared search, newest first. ponytail: the first 50 pages
 * (1,000 jobs); a sitemap index split by company when there are more.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com';
  const out: MetadataRoute.Sitemap = [{ url: origin, changeFrequency: 'hourly' }];
  for (let page = 1; page <= 50; page += 1) {
    const answer = await search(new URLSearchParams({ sort: 'newest', page: String(page) }));
    if (!answer.ok) break;
    for (const j of answer.data.rows)
      out.push({
        url: `${origin}/${j.company.slug}/${j.slug}`,
        lastModified: j.postedAt,
        changeFrequency: 'daily',
      });
    if (page * 20 >= answer.data.total) break;
  }
  return out;
}
