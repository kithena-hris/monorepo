import { describe, expect, it } from 'vitest';

import { DOMAIN_CEILING, parseHost, pointing, roomFor } from './domain.js';

describe('a company’s own careers domain (REC-136)', () => {
  it('reads a host however it is typed', () => {
    for (const typed of [
      'careers.acme.com',
      ' Careers.Acme.com ',
      'https://careers.acme.com/jobs',
      'careers.acme.com.',
    ]) {
      expect(parseHost(typed)).toEqual({ ok: true, value: 'careers.acme.com' });
    }
  });

  it('refuses what is not a domain the company can own', () => {
    for (const typed of [
      '',
      'acme',
      '10.0.0.1',
      'careers..acme.com',
      '-careers.acme.com',
      'jobs.kithena.com',
      'acme.kithena.com',
      'acme.vercel.app',
      'localhost',
      `${'a'.repeat(64)}.com`,
    ]) {
      expect(parseHost(typed).ok, typed).toBe(false);
    }
  });

  it('points a subdomain by CNAME and a whole domain by its address', () => {
    expect(pointing('careers.acme.com')).toEqual({
      type: 'CNAME',
      name: 'careers',
      value: 'cname.vercel-dns.com',
    });
    expect(pointing('acme-jobs.com')).toEqual({ type: 'A', name: '@', value: '76.76.21.21' });
  });

  it('keeps one domain of the project for Kithena Jobs itself', () => {
    expect(DOMAIN_CEILING).toBe(49);
    expect(roomFor(48)).toBe(true);
    expect(roomFor(49)).toBe(false);
  });
});
