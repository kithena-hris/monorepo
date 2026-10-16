import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { parseHost, roomFor, DOMAIN_CEILING } from '../domain/careers/domain.js';
import { adminOnly, type Ctx } from './context.js';
import type { CareersDomain } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * A company's own domain for its careers page (PRD §10.1, REC-136).
 * Administrators only: the domain is added to Kithena Jobs' Vercel project,
 * the company points its DNS there, and once Vercel has verified it
 * `careers.acme.com` serves what `jobs.kithena.com/acme` does.
 */

const notSetUp = () =>
  err(failure('NO_PROVIDER', 'Own domains for the careers page are not set up yet'));

export async function setCareersDomain(
  ctx: Ctx,
  input: { readonly host: string },
): Promise<Result<CareersDomain>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const domains = ctx.deps.domains;
  if (domains === undefined) return notSetUp();
  const host = parseHost(input.host);
  if (!host.ok) return host;
  const current = await ctx.tx.public.careersDomain();
  if (current?.host === host.value) return ok(current);
  if (current === null && !roomFor(await ctx.tx.public.careersDomainCount())) {
    return err(
      failure(
        'LIMIT',
        `Kithena Jobs serves ${String(DOMAIN_CEILING)} companies' own domains on its plan, and all are taken`,
      ),
    );
  }
  const added = await domains.add(host.value);
  if (!added.ok) return added;
  if (current !== null) await domains.remove(current.host);
  const domain: CareersDomain = {
    host: host.value,
    status: added.value.verified ? 'verified' : 'pending',
    records: added.value.records,
    verifiedAt: added.value.verified ? ctx.deps.clock.now().toISOString() : null,
  };
  const { companySlug } = await generalSettings(ctx);
  await ctx.tx.public.putCareersDomain({ ...domain, companySlug });
  return ok(domain);
}

/** Asks again whether the DNS points at Kithena Jobs; verified, the domain starts serving. */
export async function checkCareersDomain(ctx: Ctx): Promise<Result<CareersDomain>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const domains = ctx.deps.domains;
  if (domains === undefined) return notSetUp();
  const current = await ctx.tx.public.careersDomain();
  if (current === null) return err(failure('NOT_FOUND', 'Add a domain first'));
  const checked = await domains.check(current.host);
  if (!checked.ok) return checked;
  const domain: CareersDomain = {
    host: current.host,
    status: checked.value.verified ? 'verified' : 'pending',
    records: checked.value.records,
    verifiedAt: checked.value.verified
      ? (current.verifiedAt ?? ctx.deps.clock.now().toISOString())
      : null,
  };
  const { companySlug } = await generalSettings(ctx);
  await ctx.tx.public.putCareersDomain({ ...domain, companySlug });
  return ok(domain);
}

export async function removeCareersDomain(ctx: Ctx): Promise<Result<null>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const current = await ctx.tx.public.careersDomain();
  if (current === null) return ok(null);
  const domains = ctx.deps.domains;
  if (domains !== undefined) {
    const removed = await domains.remove(current.host);
    if (!removed.ok) return removed;
  }
  await ctx.tx.public.removeCareersDomain();
  return ok(null);
}
