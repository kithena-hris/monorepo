import type { MetadataRoute } from 'next';

/** Search and the job pages are for crawlers; a candidate's own pages are not. */
export default function robots(): MetadataRoute.Robots {
  const origin = process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/me/', '/schedule/', '/reference/', '/welcome', '/search'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
