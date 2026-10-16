import { createHmac, timingSafeEqual } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { BoardApplication, JobBoard } from '../application/ports.js';
import type { Answer, Question, Questionnaire } from '../domain/screening/questionnaire.js';

/**
 * Indeed (PRD §26.1, REC-131, REC-132): Job Sync to publish and expire a job,
 * Indeed Apply posting applications to Recruiting, with the job's
 * questionnaire as its screener questions (Indeed approves no integration
 * that leaves them out), and disposition sync telling Indeed where each went.
 * Glassdoor lists what Indeed receives.
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
  /** Indeed Apply's API token, from Indeed's Partner Console. */
  readonly applyToken: string;
  /** Recruiting's public API, which Indeed Apply posts to and reads questions from. */
  readonly publicUrl: string;
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

/** Recruiting's question kinds as Indeed's screener question types (schema 1.3). */
function screenerQuestion(q: Question): Record<string, unknown> {
  const base = { id: q.id, question: q.text, required: q.required };
  const choices = (options: readonly string[]) => options.map((o) => ({ value: o, label: o }));
  switch (q.kind) {
    case 'short_text':
      return { ...base, type: 'text' };
    case 'long_text':
      return { ...base, type: 'textarea' };
    case 'number':
      return { ...base, type: 'text', format: 'decimal' };
    case 'date':
      return { ...base, type: 'date', format: 'yyyy-MM-dd' };
    case 'file':
      return { ...base, type: 'file' };
    case 'yes_no':
      return {
        ...base,
        type: 'select',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      };
    case 'single':
      return { ...base, type: 'select', options: choices(q.options) };
    case 'multiple':
      return { ...base, type: 'multiselect', options: choices(q.options) };
  }
}

export const screenerQuestions = (
  questionnaire: Questionnaire,
): {
  schemaVersion: string;
  screenerQuestions: { questions: Record<string, unknown>[] };
} => ({
  schemaVersion: '1.3',
  screenerQuestions: { questions: questionnaire.questions.map(screenerQuestion) },
});

interface ApplyFile {
  readonly fileName?: string;
  readonly contentType?: string;
  readonly data?: string;
}

interface ApplyPayload {
  readonly id?: string;
  readonly job?: { readonly jobMeta?: string };
  readonly screenerQuestionsAndAnswers?: {
    readonly questionsAndAnswers?: readonly {
      readonly question?: {
        readonly id?: string;
        readonly type?: string;
        readonly format?: string;
      };
      readonly answer?: unknown;
    }[];
  };
  readonly applicant?: {
    readonly fullName?: string;
    readonly email?: string;
    readonly phoneNumber?: string;
    readonly resume?: {
      readonly file?: ApplyFile;
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
      const files: BoardApplication['files'][number][] = [];
      const take = (field: string, file: ApplyFile | undefined, name: string) => {
        if (file?.data !== undefined)
          files.push({
            field,
            fileName: file.fileName ?? name,
            mediaType: file.contentType ?? 'application/octet-stream',
            bytes: new Uint8Array(Buffer.from(file.data, 'base64')),
          });
      };
      take('cv', applicant.resume?.file, 'resume');
      const answers: Record<string, Answer> = {};
      for (const { question, answer } of body.screenerQuestionsAndAnswers?.questionsAndAnswers ??
        []) {
        const id = question?.id;
        if (question === undefined || id === undefined) continue;
        const key = `q_${id}`;
        const value = (a: unknown) => (a as { value?: string } | null)?.value ?? null;
        if (question.type === 'file' && Array.isArray(answer)) {
          for (const f of answer as ApplyFile[]) take(key, f, id);
          answers[key] = (answer as ApplyFile[]).map((f) => f.fileName ?? id);
        } else if (question.type === 'multiselect' && Array.isArray(answer))
          answers[key] = answer.map(value).filter((v): v is string => v !== null);
        else if (question.type === 'select') answers[key] = value(answer);
        else if (typeof answer === 'string' && answer !== '')
          answers[key] = question.format === 'decimal' ? Number(answer) : answer;
      }
      return ok({
        jobId,
        ref: body.id,
        name: applicant.fullName,
        email: applicant.email,
        phone: applicant.phoneNumber ?? null,
        answers,
        files,
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
                      apiToken: config.applyToken,
                      postUrl: `${config.publicUrl}/indeed-apply`,
                      // Comes back on every application: which company and which job.
                      jobMeta: `${job.company}/${job.jobId}`,
                      ...(job.asks
                        ? {
                            applyQuestions: `${config.publicUrl}/${job.company}/board-questions/indeed/${job.jobId}`,
                          }
                        : {}),
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
    questions: screenerQuestions,
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

/** Indeed when its client and Apply token and secret are set; else not offered. */
export function indeedFrom(env: NodeJS.ProcessEnv): JobBoard | undefined {
  const clientId = env['INDEED_CLIENT_ID'];
  const clientSecret = env['INDEED_CLIENT_SECRET'];
  const applyToken = env['INDEED_APPLY_TOKEN'];
  const applySecret = env['INDEED_APPLY_SECRET'];
  if (!clientId || !clientSecret || !applyToken || !applySecret) return undefined;
  return indeedBoard({
    clientId,
    clientSecret,
    applyToken,
    applySecret,
    publicUrl: env['INDEED_PUBLIC_URL'] ?? 'https://api.kithena.com/v1/recruiting/public',
  });
}
