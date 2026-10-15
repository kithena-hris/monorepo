import { JobId, type PublicJob } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { feed, jobPosting, ldJson } from './structured';

const job: PublicJob = {
  jobId: JobId.parse('0190a000-0000-7000-8000-000000000001'),
  slug: 'senior-backend-engineer',
  company: { slug: 'acme', name: 'Acme & Co', themeId: 'teal', logoUrl: null, about: null },
  title: 'Senior Backend Engineer (m/w/d)',
  language: 'en',
  places: [{ country: 'DE', region: 'BE', city: 'Berlin', remoteFrom: [] }],
  workMode: 'remote',
  contractType: 'Permanent',
  hours: 'full_time',
  department: 'Engineering',
  seniority: 'senior',
  salary: { minMinor: 7_200_000, maxMinor: 8_800_000, currency: 'EUR', period: 'year' },
  postedAt: '2026-10-13T09:00:00.000Z',
  validThrough: '2026-11-30',
  searchable: true,
  html: '<p>Own the ledger.</p><script>alert(1)</script>',
  otherLanguages: [],
  benefits: [],
  process: ['Application received', 'Offer'],
  form: [],
  nycNotice: false,
  closed: false,
};

describe('JobPosting', () => {
  it('states pay in major units, remote as telecommute, and cannot close its script tag', () => {
    const ld = jobPosting(job, 'https://jobs.kithena.com/acme/senior-backend-engineer');
    expect(ld).toMatchObject({
      employmentType: 'FULL_TIME',
      jobLocationType: 'TELECOMMUTE',
      validThrough: '2026-11-30T23:59:59Z',
      baseSalary: {
        currency: 'EUR',
        value: { minValue: 72_000, maxValue: 88_000, unitText: 'YEAR' },
      },
    });
    expect(ldJson(ld)).not.toContain('</script>');
  });
});

describe('the XML feed', () => {
  it('escapes what it carries', () => {
    const xml = feed('https://jobs.kithena.com', [job]);
    expect(xml).toContain('<company>Acme &amp; Co</company>');
    expect(xml).toContain('<url>https://jobs.kithena.com/acme/senior-backend-engineer</url>');
    expect(xml).toContain('<salary currency="EUR" period="year">72000-88000</salary>');
  });
});
