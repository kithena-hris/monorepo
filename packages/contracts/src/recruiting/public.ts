import * as z from 'zod';

import {
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
  policy,
} from '../classification.js';
import { CalendarDate, Instant } from '../primitives.js';
import { JobId, LaunchCountry, PublicationTarget, WorkMode } from './primitives.js';

/**
 * What Kithena Jobs reads and what the public API takes (Recruiting PRD §10,
 * §31.2, §32, REC-013).
 *
 * The listing and the job page are the `recruiting_public` projection's rows:
 * **every field is `public`**, and `public.test.ts` fails the build when one
 * is not, because that schema is readable across companies by design. The
 * apply payload and the candidate page come the other way and carry personal
 * data, classified as such.
 */

function pub<T extends z.ZodType>(schema: T): T {
  policy.add(schema, asPublic());
  return schema;
}

export const PublicSalary = z.object({
  minMinor: pub(z.int().nonnegative()),
  maxMinor: pub(z.int().nonnegative()),
  currency: pub(z.string().length(3)),
  period: pub(z.enum(['year', 'month', 'hour'])),
});
export type PublicSalary = z.infer<typeof PublicSalary>;

export const PublicCompany = z.object({
  slug: pub(z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u)),
  name: pub(z.string().max(200)),
  /** A theme preset's id (`branding.ts`): a closed list, contrast kept at AA. */
  themeId: pub(z.string().max(40)),
  logoUrl: pub(z.url().nullable()),
  about: pub(z.string().max(4000).nullable()),
});
export type PublicCompany = z.infer<typeof PublicCompany>;

export const PublicPlace = z.object({
  country: LaunchCountry,
  region: pub(z.string().max(10).nullable()),
  city: pub(z.string().max(120).nullable()),
  /** A remote job may be done from these countries. */
  remoteFrom: pub(z.array(pub(z.string().length(2)))),
});
export type PublicPlace = z.infer<typeof PublicPlace>;

/** One search result (J2). */
export const PublicListing = z.object({
  jobId: JobId,
  slug: pub(z.string().max(120)),
  company: PublicCompany,
  title: pub(z.string().max(200)),
  language: pub(z.string().min(2).max(5)),
  places: pub(z.array(PublicPlace)),
  workMode: WorkMode,
  /** The pack's contract type in the ad's words: "Permanent", "Indefinido". */
  contractType: pub(z.string().max(80)),
  hours: pub(z.enum(['full_time', 'part_time'])),
  department: pub(z.string().max(80).nullable()),
  seniority: pub(z.enum(['entry', 'mid', 'senior', 'lead', 'executive']).nullable()),
  salary: PublicSalary.nullable(),
  /** Dates on a public page are public, unlike a person's (`Instant`, `CalendarDate`). */
  postedAt: pub(z.iso.datetime()),
  validThrough: pub(z.iso.date().nullable()),
  /** On the cross-company search as well as the careers page (opt-in, PRD §36.2). */
  searchable: pub(z.boolean()),
});
export type PublicListing = z.infer<typeof PublicListing>;

export const PublicBenefit = z.object({
  category: pub(z.string().max(40)),
  name: pub(z.string().max(120)),
  description: pub(z.string().max(500).nullable()),
});

/** The job page (J3): the listing, the ad's text, benefits and the process. */
export const PublicJob = PublicListing.extend({
  /** The ad as sanitised HTML from the editor, in this language. */
  html: pub(z.string().max(100_000)),
  otherLanguages: pub(z.array(pub(z.string().min(2).max(5)))),
  benefits: pub(z.array(PublicBenefit)),
  /** The pipeline's candidate-facing stage names, in order (§10.3). */
  process: pub(z.array(pub(z.string().max(80)))),
  /** The apply form's visible fields, for rendering (`form.ts` builds the schema). */
  form: pub(
    z.array(
      z.object({
        key: pub(z.string().max(60)),
        label: pub(z.string().max(200)),
        kind: pub(z.string().max(20)),
        required: pub(z.boolean()),
        options: pub(z.array(pub(z.string().max(200)))),
      }),
    ),
  ),
  /** An automated tool is used in New York City: the notice is shown (§22.8). */
  nycNotice: pub(z.boolean()),
  closed: pub(z.boolean()),
});
export type PublicJob = z.infer<typeof PublicJob>;

/** Search (J1, J2): every part in the URL. */
export const JobSearch = z.object({
  q: pub(z.string().max(200).optional()),
  country: LaunchCountry.optional(),
  region: pub(z.string().max(10).optional()),
  city: pub(z.string().max(120).optional()),
  remoteIn: pub(z.string().length(2).optional()),
  workMode: pub(z.array(WorkMode).optional()),
  contractType: pub(z.array(pub(z.string().max(80))).optional()),
  hours: pub(z.enum(['full_time', 'part_time']).optional()),
  department: pub(z.array(pub(z.string().max(80))).optional()),
  seniority: pub(z.array(pub(z.enum(['entry', 'mid', 'senior', 'lead', 'executive']))).optional()),
  salaryFromMinor: pub(z.int().nonnegative().optional()),
  currency: pub(z.string().length(3).optional()),
  postedWithinDays: pub(z.int().min(1).max(90).optional()),
  language: pub(z.string().min(2).max(5).optional()),
  company: pub(z.string().max(63).optional()),
  sort: pub(z.enum(['relevance', 'newest', 'salary']).default('relevance')),
  page: pub(z.int().min(1).max(500).default(1)),
});
export type JobSearch = z.infer<typeof JobSearch>;

/* ---------------------------------------------------- the other way in -- */

/** The source a public application names: the target it came through, or a tracked link. */
export const ApplySource = z
  .object({
    target: PublicationTarget.optional(),
    link: z.string().max(80).optional().register(policy, asInternal()),
  })
  .register(policy, asInternal());

/**
 * An application through the public API (J4, §10.4). The answers are checked
 * against the job's own form schema (`answersSchema`) in Recruiting; here
 * only their envelope.
 */
export const ApplyPayload = z.object({
  jobId: JobId,
  language: z.string().min(2).max(5).register(policy, asPublic()),
  answers: z.record(z.string().max(60), z.unknown()).register(policy, asFreeText()),
  consent: z.object({
    application: z.literal(true).register(policy, asInternal()),
    talentPool: z.boolean().register(policy, asInternal()),
    nycNotice: z.boolean().optional().register(policy, asInternal()),
  }),
  adjustments: z.string().max(2000).nullable().register(policy, asFreeText()),
  source: ApplySource,
  /** The six-digit code sent to the email address (§10.4). */
  code: z
    .string()
    .regex(/^\d{6}$/u)
    .register(policy, asInternal()),
  /** A field no person fills in; a bot does. */
  website: z.string().max(0).optional().register(policy, asInternal()),
});
export type ApplyPayload = z.infer<typeof ApplyPayload>;

export const CodeRequest = z.object({
  jobId: JobId,
  email: z.email().register(policy, asContact()),
  name: z.string().min(1).max(200).register(policy, asIdentity()),
});

/** The candidate's own page (J6, J7): each application under the candidate-facing names. */
export const CandidatePage = z.object({
  name: z.string().max(200).register(policy, asIdentity()),
  applications: z.array(
    z.object({
      applicationId: z.uuid().register(policy, asPublic()),
      job: z.object({
        title: pub(z.string().max(200)),
        company: pub(z.string().max(200)),
        slug: pub(z.string().max(120)),
      }),
      stage: z.string().max(80).nullable().register(policy, asInternal()),
      steps: z.array(
        z.object({
          name: pub(z.string().max(80)),
          state: pub(z.enum(['done', 'current', 'next'])),
        }),
      ),
      outcome: z.enum(['active', 'hired', 'rejected', 'withdrawn']).register(policy, asInternal()),
      interviews: z.array(
        z.object({
          id: z.uuid().register(policy, asPublic()),
          title: z.string().max(120).register(policy, asInternal()),
          startsAt: Instant,
          minutes: z.int().register(policy, asInternal()),
          where: z.string().max(500).nullable().register(policy, asInternal()),
          rescheduleUrl: z.url().nullable().register(policy, asInternal()),
        }),
      ),
      /** What the company asks of the candidate, and what they asked back (`asks.ts`). */
      requests: z.array(
        z.object({
          id: z.uuid().register(policy, asPublic()),
          kind: z.enum(['slots', 'info', 'change']).register(policy, asInternal()),
          label: z.string().max(200).register(policy, asInternal()),
          detail: z.string().max(4000).nullable().register(policy, asFreeText()),
          createdAt: Instant,
          /** `slots`: the times offered, and where it would be. */
          times: z.array(Instant),
          where: z.string().max(500).nullable().register(policy, asInternal()),
          interviewId: z.uuid().nullable().register(policy, asPublic()),
          state: z.enum(['open', 'answered', 'closed']).register(policy, asInternal()),
          answer: z
            .object({
              time: Instant.nullable(),
              text: z.string().max(4000).nullable().register(policy, asFreeText()),
            })
            .nullable(),
        }),
      ),
      offer: z
        .object({
          offerId: z.uuid().register(policy, asPublic()),
          version: z.int().register(policy, asInternal()),
          state: z.string().max(20).register(policy, asInternal()),
          expiresOn: CalendarDate,
          hash: z.string().max(64).register(policy, asInternal()),
        })
        .nullable(),
      /** The contract after an accepted offer (§21.2): where it is, and how it is signed. */
      contract: z
        .object({
          state: z.string().max(40).register(policy, asInternal()),
          route: z.enum(['documents', 'upload', 'wet_ink']).register(policy, asInternal()),
          signedOn: CalendarDate.nullable(),
        })
        .nullable(),
    }),
  ),
});
export type CandidatePage = z.infer<typeof CandidatePage>;
