import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A company's own domain for its careers page (PRD §10.1, REC-136):
 * `careers.acme.com` serving what `jobs.kithena.com/acme` serves.
 *
 * The domain is added to Kithena Jobs' Vercel project, and Vercel's Hobby plan
 * allows 50 domains a project (vercel.com/docs/limits, 2026-10-16). One is
 * `jobs.kithena.com`, so 49 companies can have their own; Pro lifts the cap.
 */
export const DOMAIN_CEILING = 49;

/** Whether one more company's domain fits under the ceiling. */
export const roomFor = (taken: number): boolean => taken < DOMAIN_CEILING;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
/** Hosts that are Kithena's or the platform's, never a company's. */
const NOT_THEIRS = /(?:^|\.)(?:kithena\.com|vercel\.app|localhost)$/u;

/** The host a person typed, however they typed it: case, scheme, path and a trailing dot aside. */
export function parseHost(typed: string): Result<string> {
  const host = typed
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//u, '')
    .replace(/[/?#].*$/u, '')
    .replace(/\.$/u, '');
  const labels = host.split('.');
  if (
    host.length === 0 ||
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    /^\d+$/u.test(labels.at(-1) ?? '')
  ) {
    return err(failure('INVALID', 'Enter a domain such as careers.yourcompany.com'));
  }
  if (NOT_THEIRS.test(host)) return err(failure('INVALID', 'Use a domain your company owns'));
  return ok(host);
}

export interface DnsRecord {
  readonly type: 'CNAME' | 'A' | 'TXT';
  /** As a DNS provider asks for it: the part before the company's domain, or `@`. */
  readonly name: string;
  readonly value: string;
}

/**
 * The record that sends the host to Kithena Jobs: a CNAME for a subdomain, an
 * address for a whole domain (a CNAME is not allowed at a domain's root).
 *
 * ponytail: a host of two labels is taken as a whole domain, so
 * `acme.co.uk` is told to CNAME `acme`; add the public suffix list if a
 * company on such a domain needs its root.
 */
export function pointing(host: string): DnsRecord {
  const labels = host.split('.');
  return labels.length === 2
    ? { type: 'A', name: '@', value: '76.76.21.21' }
    : { type: 'CNAME', name: labels.slice(0, -2).join('.'), value: 'cname.vercel-dns.com' };
}
