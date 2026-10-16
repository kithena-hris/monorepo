import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { pointing, type DnsRecord } from '../domain/careers/domain.js';
import type { DomainHost, HostedDomain } from '../application/ports.js';

/**
 * A company's careers domain on Kithena Jobs' Vercel project (REC-136), by
 * Vercel's REST API: added to the project, asked whether Vercel has verified
 * it and its DNS points there, and removed. A token scoped to the team, and
 * the Jobs project's id.
 */
export function vercelDomains(config: {
  readonly token: string;
  readonly projectId: string;
  readonly teamId?: string;
  readonly api?: string;
}): DomainHost {
  const api = config.api ?? 'https://api.vercel.com';
  const team = config.teamId === undefined ? '' : `?teamId=${encodeURIComponent(config.teamId)}`;
  const project = encodeURIComponent(config.projectId);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${api}${path}${team}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, answer };
  };
  const unavailable = (status: number, answer: Record<string, unknown>) => {
    const code = (answer['error'] as { code?: string } | undefined)?.code;
    logger.warn({ module: 'recruiting', status, code }, 'careers domain: Vercel refused');
    return err(failure('UNAVAILABLE', 'The domain could not be set up just now. Try again.'));
  };

  const state = async (host: string): Promise<Result<HostedDomain>> => {
    const domain = await call('GET', `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
    if (domain.status !== 200) return unavailable(domain.status, domain.answer);
    const configured = await call('GET', `/v6/domains/${encodeURIComponent(host)}/config`);
    const misconfigured = configured.status !== 200 || configured.answer['misconfigured'] === true;
    const proofs = (domain.answer['verification'] ?? []) as {
      type?: string;
      domain?: string;
      value?: string;
    }[];
    const records: DnsRecord[] = [
      pointing(host),
      ...proofs.map((v) => ({
        type: 'TXT' as const,
        name: v.domain ?? '',
        value: v.value ?? '',
      })),
    ];
    return ok({ verified: domain.answer['verified'] === true && !misconfigured, records });
  };

  return {
    async add(host) {
      const added = await call('POST', `/v10/projects/${project}/domains`, { name: host });
      // Already on this project is where we wanted it.
      if (added.status !== 200 && added.status !== 409)
        return unavailable(added.status, added.answer);
      return state(host);
    },
    async check(host) {
      // Vercel checks a TXT proof only when asked; a domain that needs none answers anyway.
      await call('POST', `/v9/projects/${project}/domains/${encodeURIComponent(host)}/verify`);
      return state(host);
    },
    async remove(host) {
      const removed = await call(
        'DELETE',
        `/v9/projects/${project}/domains/${encodeURIComponent(host)}`,
      );
      return removed.status === 200 || removed.status === 404
        ? ok(undefined)
        : unavailable(removed.status, removed.answer);
    },
  };
}

/** Vercel when its token and the Jobs project are set. */
export function domainsFrom(env: NodeJS.ProcessEnv): DomainHost | undefined {
  const token = env['VERCEL_DOMAINS_TOKEN'];
  const projectId = env['JOBS_VERCEL_PROJECT_ID'];
  if (!token || !projectId) return undefined;
  const teamId = env['VERCEL_TEAM_ID'];
  return vercelDomains({ token, projectId, ...(teamId ? { teamId } : {}) });
}
