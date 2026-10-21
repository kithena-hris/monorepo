import type { PublicJob, PublicListing } from '@kithena/contracts';

/**
 * What search engines and aggregators read (REC-062): schema.org
 * `JobPosting` on the job page, so Google for Jobs lists it, and an open XML
 * feed per company. Pure: the page passes the job and its address.
 */

const EMPLOYMENT: Readonly<Record<string, string>> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
};
const UNIT: Readonly<Record<string, string>> = { year: 'YEAR', month: 'MONTH', hour: 'HOUR' };

const strip = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

export function jobPosting(job: PublicJob, url: string): Record<string, unknown> {
  const remote = job.workMode === 'remote';
  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.html,
    identifier: { '@type': 'PropertyValue', name: job.company.name, value: job.jobId },
    datePosted: job.postedAt,
    ...(job.validThrough === null ? {} : { validThrough: `${job.validThrough}T23:59:59Z` }),
    employmentType: EMPLOYMENT[job.hours],
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company.name,
      sameAs: url.replace(/\/[^/]+$/u, ''),
      ...(job.company.logoUrl === null ? {} : { logo: job.company.logoUrl }),
    },
    ...(remote
      ? {
          jobLocationType: 'TELECOMMUTE',
          applicantLocationRequirements: [
            ...new Set(
              job.places.flatMap((p) => (p.remoteFrom.length > 0 ? p.remoteFrom : [p.country])),
            ),
          ].map((c) => ({ '@type': 'Country', name: c })),
        }
      : {}),
    jobLocation: job.places.map((p) => ({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressCountry: p.country,
        ...(p.region === null ? {} : { addressRegion: p.region }),
        ...(p.city === null ? {} : { addressLocality: p.city }),
      },
    })),
    ...(job.salary === null
      ? {}
      : {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: job.salary.currency,
            // Google's form: one `value` for a fixed salary, `minValue` and `maxValue` for a range.
            value: {
              '@type': 'QuantitativeValue',
              ...(job.salary.minMinor === job.salary.maxMinor
                ? { value: job.salary.minMinor / 100 }
                : { minValue: job.salary.minMinor / 100, maxValue: job.salary.maxMinor / 100 }),
              unitText: UNIT[job.salary.period],
            },
          },
        }),
    directApply: true,
    url,
  };
}

/** The JSON for a `<script type="application/ld+json">`: `<` escaped so the ad cannot close the tag. */
export const ldJson = (value: unknown): string => JSON.stringify(value).replace(/</gu, '\\u003c');

const x = (s: string) =>
  s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/** An open XML feed of a company's jobs, the shape aggregators read. */
export function feed(origin: string, listings: readonly PublicListing[]): string {
  const items = listings.map((l) => {
    const place = l.places[0];
    return `  <job>
    <id>${x(l.jobId)}</id>
    <title>${x(l.title)}</title>
    <company>${x(l.company.name)}</company>
    <url>${x(`${origin}/${l.company.slug}/${l.slug}`)}</url>
    <date>${x(l.postedAt)}</date>
    <country>${x(place?.country ?? '')}</country>
    <city>${x(place?.city ?? '')}</city>
    <remote>${l.workMode === 'remote' ? 'yes' : 'no'}</remote>
    <jobtype>${x(l.hours)}</jobtype>
    <contract>${x(l.contractType)}</contract>${
      l.salary === null
        ? ''
        : `
    <salary currency="${x(l.salary.currency)}" period="${x(l.salary.period)}">${String(l.salary.minMinor / 100)}-${String(l.salary.maxMinor / 100)}</salary>`
    }
  </job>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jobs>\n${items.join('\n')}\n</jobs>\n`;
}

export const plain = strip;
