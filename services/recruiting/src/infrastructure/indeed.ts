import { createHmac, timingSafeEqual } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { BoardApplication, JobBoard } from '../application/ports.js';

/**
 * Indeed (PRD §26.1, REC-131, REC-132): Job Sync to publish and expire a job,
 * Indeed Apply posting applications to Recruiting, and disposition sync
 * telling Indeed where each went. Glassdoor lists what Indeed receives.
 *
 * ponytail: written from Indeed's public docs (2026-10-16). The Apply
 * payload's keys, the `indeedApply` settings and the expire and disposition
 * mutations sit behind the partner agreement; check each against Indeed's
 * sandbox once it is signed, before the client id goes into production.
 */

export interface IndeedConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Indeed Apply's shared secret: what `X-Indeed-Signature` is made with. */
  readonly applySecret: string;
  /** Where Indeed Apply posts: Recruiting's public `/indeed-apply`. */
  readonly postUrl: string;
  readonly api?: string;
}

/** Recruiting's stage categories in Indeed's disposition words. */
export const DISPOSITION: Readonly<Record<string, string>> = {
  applied: 'NEW',
  screening: 'REVIEW',
  assessment: 'ASSESSMENT',
  interview: 'INTERVIEW',
  offer: 'OFFER_MADE',
  works_council: 'OFFER_MADE',
  hired: 'HIRED',
  rejected: 'NOT_SELECTED',
  withdrawn: 'WITHDRAWN',
};

interface ApplyPayload {
  readonly id?: string;
  readonly job?: { readonly jobMeta?: string };
  readonly applicant?: {
    readonly fullName?: string;
    readonly email?: string;
    readonly phoneNumber?: string;
    readonly resume?: {
      readonly file?: {
        readonly fileName?: string;
        readonly contentType?: string;
        readonly data?: string;
      };
    };
  };
}

/** Signature and payload of an Indeed Apply post: no network, so tested alone. */
export function indeedInbound(applySecret: string): NonNullable<JobBoard['inbound']> {
  return {
    verify(raw, signature) {
      const expected = Buffer.from(
        createHmac('sha1', applySecret).update(raw, 'utf8').digest('base64'),
      );
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
    parse(raw): Result<BoardApplication> {
      let body: ApplyPayload;
      try {
        body = JSON.parse(raw) as ApplyPayload;
      } catch {
        return err(failure('INVALID', 'The application is not JSON'));
      }
      const jobId = body.job?.jobMeta?.split('/')[1];
      const applicant = body.applicant;
      if (
        body.id === undefined ||
        jobId === undefined ||
        applicant?.email === undefined ||
        applicant.fullName === undefined
      )
        return err(failure('INVALID', 'The application is missing a required key'));
      const file = applicant.resume?.file;
      return ok({
        jobId,
        ref: body.id,
        name: applicant.fullName,
        email: applicant.email,
        phone: applicant.phoneNumber ?? null,
        files:
          file?.data === undefined
            ? []
            : [
                {
                  field: 'cv',
                  fileName: file.fileName ?? 'resume',
                  mediaType: file.contentType ?? 'application/octet-stream',
                  bytes: new Uint8Array(Buffer.from(file.data, 'base64')),
                },
              ],
      });
    },
  };
}

export function indeedBoard(config: IndeedConfig): JobBoard {
  const api = config.api ?? 'https://apis.indeed.com';
  let held: { token: string; until: number } | null = null;

  const token = async (): Promise<string | null> => {
    if (held !== null && held.until > Date.now()) return held.token;
    const response = await fetch(`${api}/oauth/v2/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'employer_access',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || body.access_token === undefined) return null;
    held = {
      token: body.access_token,
      until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    };
    return held.token;
  };

  const graphql = async (
    query: string,
    variables: unknown,
  ): Promise<Result<Record<string, unknown>>> => {
    const bearer = await token();
    if (bearer === null) return refused('token', 401);
    const response = await fetch(`${api}/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: Record<string, unknown>;
      errors?: { message?: string }[];
    };
    if (!response.ok || body.data === undefined || (body.errors?.length ?? 0) > 0)
      return refused(body.errors?.[0]?.message ?? 'graphql', response.status);
    return ok(body.data);
  };

  return {
    target: 'indeed',
    async publish(job) {
      const page = job.page;
      if (page === null || job.contactEmail === null)
        return err(
          failure(
            'BOARD_NEEDS',
            'Indeed needs the job on the careers page and the company’s reply address',
          ),
        );
      const place = page.places[0];
      const posted = await graphql(
        `
          mutation Post($input: CreateSourcedJobPostingsInput) {
            jobsIngest {
              createSourcedJobPostings(input: $input) {
                results {
                  jobPosting {
                    sourcedPostingId
                  }
                }
              }
            }
          }
        `,
        {
          input: {
            jobPostings: [
              {
                body: {
                  title: page.title,
                  description: page.html,
                  descriptionFormatting: 'RICH_FORMATTING',
                  location: {
                    country: place?.country ?? '',
                    cityRegionPostal: [place?.city, place?.region].filter(Boolean).join(', '),
                  },
                  benefits: page.benefits.map((b) => b.name),
                },
                metadata: {
                  jobSource: {
                    companyName: page.company.name,
                    sourceName: page.company.name,
                    sourceType: 'Employer',
                  },
                  jobPostingId: job.jobId,
                  datePublished: page.postedAt,
                  url: job.url,
                  contacts: [
                    {
                      contactType: ['contact'],
                      contactInfo: {
                        contactEmail: job.contactEmail,
                        contactName: page.company.name,
                      },
                    },
                  ],
                  applyMethod: {
                    indeedApply: {
                      postUrl: config.postUrl,
                      // Comes back on every application: which company and which job.
                      jobMeta: `${job.company}/${job.jobId}`,
                    },
                  },
                },
              },
            ],
          },
        },
      );
      if (!posted.ok) return posted;
      const ingest = posted.value['jobsIngest'] as
        | {
            createSourcedJobPostings?: {
              results?: { jobPosting?: { sourcedPostingId?: string } | null }[];
            };
          }
        | undefined;
      const ref = ingest?.createSourcedJobPostings?.results?.[0]?.jobPosting?.sourcedPostingId;
      if (ref === undefined) return refused('rejected', 200);
      // Indeed takes an hour or two to list it, and does not say where.
      return ok({ url: null, ref });
    },
    async close(job) {
      if (job.ref === null) return;
      await graphql(
        `
          mutation Expire($input: ExpireSourcedJobsBySourcedPostingIdInput!) {
            jobsIngest {
              expireSourcedJobsBySourcedPostingId(input: $input) {
                results {
                  trackingKey
                }
              }
            }
          }
        `,
        { input: { sourcedPostingIds: [job.ref] } },
      );
    },
    inbound: indeedInbound(config.applySecret),
    async disposition({ ref, status, at }) {
      const sent = await graphql(
        `
          mutation Disposition($input: SendPartnerDispositionInput!) {
            partnerDisposition {
              send(input: $input) {
                numberGoodDispositions
              }
            }
          }
        `,
        {
          input: {
            dispositions: [
              {
                dispositionStatus: DISPOSITION[status] ?? 'REVIEW',
                rawDispositionStatus: status,
                identifiedBy: { indeedApplyID: ref },
                atsName: 'Kithena',
                statusChangeDateTime: at,
              },
            ],
          },
        },
      );
      return sent.ok ? ok(undefined) : sent;
    },
  };
}

function refused(why: string, status: number) {
  logger.warn({ module: 'recruiting', board: 'indeed', status, why }, 'Indeed refused');
  return err(failure('BOARD_REFUSED', 'Indeed did not take it just now. Try again.'));
}

/** Indeed when its client and Apply secret are set; else not offered. */
export function indeedFrom(env: NodeJS.ProcessEnv): JobBoard | undefined {
  const clientId = env['INDEED_CLIENT_ID'];
  const clientSecret = env['INDEED_CLIENT_SECRET'];
  const applySecret = env['INDEED_APPLY_SECRET'];
  if (!clientId || !clientSecret || !applySecret) return undefined;
  return indeedBoard({
    clientId,
    clientSecret,
    applySecret,
    postUrl:
      env['INDEED_APPLY_POST_URL'] ?? 'https://api.kithena.com/v1/recruiting/public/indeed-apply',
  });
}
