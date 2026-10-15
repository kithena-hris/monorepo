import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { outboxTable, publish, withTenant } from '@kithena/db-kit';
import type { CalendarDate, Instant, PersonId, PublicJob, TenantId } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { StageMove } from '../domain/pipeline/application.js';
import type { Stage } from '../domain/pipeline/pipeline.js';
import type { TeamRole } from '../domain/access/access.js';
import type { Benefit } from '../domain/benefits/benefits.js';
import type { Contract } from '../domain/contract/contract.js';
import type { FormField } from '../domain/form/form.js';
import type { Scorecard } from '../domain/interview/interview.js';
import type { Target } from '../domain/job/job.js';
import { versionHash, type Offer } from '../domain/offer/offer.js';
import type { Prehire } from '../domain/prehire/prehire.js';
import type { ApprovalChain, Requisition } from '../domain/requisition/requisition.js';
import type { Answer, Questionnaire } from '../domain/screening/questionnaire.js';
import { normalEmail, normalName, normalPhone } from '../domain/candidate/duplicates.js';
import type {
  Assessment,
  VerdictRow,
  Agency,
  ApplicationRecord,
  Approval,
  Candidate,
  CandidateFile,
  Consent,
  Criterion,
  Entity,
  InterviewRecord,
  JobAd,
  JobRecord,
  Location,
  Member,
  Message,
  Note,
  PayBand,
  PipelineTemplate,
  PlannedInterview,
  PoolMember,
  Pool,
  Records,
  ReferenceRequest,
  Referral,
  ScorecardTemplate,
  Template,
  Tx,
  UnitOfWork,
  WorkingHours,
} from '../application/ports.js';
import { tsConfigFor } from '../application/jobs.js';

/**
 * One tenant, one transaction, every store (REC-041), over the tables of
 * `migrations/20261015120010_recruiting_core.sql`, in raw SQL as Documents'
 * is. Bound to the transaction whose `app.tenant_id` row-level security
 * reads; events go to `recruiting.outbox` on the same one, and the public
 * projection is written on it too, so a job and its listing commit together.
 */

const outbox = outboxTable('recruiting');

type Row = Record<string, unknown>;
const rows = async (tx: PostgresJsDatabase, query: SQL): Promise<Row[]> => [
  ...(await tx.execute<Row>(query)),
];
const one = async (tx: PostgresJsDatabase, query: SQL): Promise<Row | null> =>
  (await rows(tx, query))[0] ?? null;
const J = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const iso = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const str = (v: unknown): string | null =>
  typeof v === 'string'
    ? v
    : v instanceof Date
      ? v.toISOString()
      : typeof v === 'number'
        ? String(v)
        : null;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `body` is the stored aggregate, typed by its table
const body = <T>(r: Row | null): T | null => (r === null ? null : (r['body'] as T));
const tail = (phone: string | null) =>
  phone === null ? null : normalPhone(phone).replace(/^\+/u, '').slice(-9);

/** A store over a table that keeps the whole value in `body`, with the columns its constraints need. */
function bodied<T extends { readonly id: string }>(
  tx: PostgresJsDatabase,
  tenantId: string,
  table: string,
  columns: (v: T) => Readonly<Record<string, SQL>>,
): Records<T> {
  const t = sql.raw(`recruiting.${table}`);
  return {
    get: async (id) => body<T>(await one(tx, sql`SELECT body FROM ${t} WHERE id = ${id}`)),
    list: async () =>
      (await rows(tx, sql`SELECT body FROM ${t} ORDER BY id`)).map((r) => r['body'] as T),
    save: async (value) => {
      const extra = columns(value);
      const names = Object.keys(extra);
      const cols = sql.raw(names.map((n) => `, ${n}`).join(''));
      const vals = sql.join(
        [sql`${tenantId}`, sql`${value.id}`, J(value), ...names.map((n) => extra[n] as SQL)],
        sql`, `,
      );
      const sets = sql.raw(
        ['body = EXCLUDED.body', ...names.map((n) => `${n} = EXCLUDED.${n}`)].join(', '),
      );
      await tx.execute(
        sql`INSERT INTO ${t} (tenant_id, id, body${cols}) VALUES (${vals}) ON CONFLICT (tenant_id, id) DO UPDATE SET ${sets}`,
      );
    },
    remove: async (id) => {
      await tx.execute(sql`DELETE FROM ${t} WHERE id = ${id}`);
    },
  };
}

const v = (value: unknown): SQL => sql`${value ?? null}`;

function memberOf(r: Row): Member {
  return {
    personId: r['person_id'] as PersonId,
    accountId: str(r['account_id']),
    displayName: String(r['display_name']),
    workEmail: str(r['work_email']),
    managerPersonId: str(r['manager_person_id']) as PersonId | null,
    teamKey: str(r['team_key']),
    teamName: str(r['team_name']),
    locationKey: str(r['location_key']),
    legalEntityId: str(r['legal_entity_id']),
    status: String(r['status']),
  };
}

const APPLICATION = sql`id, candidate_id, job_id, outcome, source, flagged, score, language, answers, adjustments, rejection,
  ${iso(sql`withdrawn_at`)} AS withdrawn_at, ${iso(sql`created_at`)} AS created_at`;

async function applicationOf(tx: PostgresJsDatabase, r: Row): Promise<ApplicationRecord> {
  const moves = await rows(
    tx,
    sql`SELECT id, from_stage, to_stage, ${iso(sql`at`)} AS at, by_person, supersedes, reason
        FROM recruiting.application_stage_event WHERE application_id = ${r['id'] as string} ORDER BY at, id`,
  );
  return {
    id: String(r['id']),
    candidateId: String(r['candidate_id']),
    jobId: String(r['job_id']),
    outcome: r['outcome'] as ApplicationRecord['outcome'],
    rejection: (r['rejection'] as ApplicationRecord['rejection']) ?? null,
    withdrawnAt: str(r['withdrawn_at']),
    flagged: Boolean(r['flagged']),
    history: moves.map((m): StageMove => ({
      id: String(m['id']),
      from: str(m['from_stage']),
      to: String(m['to_stage']),
      at: String(m['at']),
      by: str(m['by_person']) ?? 'candidate',
      supersedes: str(m['supersedes']),
      reason: str(m['reason']),
    })),
    source: r['source'] as ApplicationRecord['source'],
    language: String(r['language']),
    answers: (r['answers'] as Record<string, unknown> | null) ?? {},
    adjustments: str(r['adjustments']),
    score: r['score'] === null ? null : Number(r['score']),
    createdAt: String(r['created_at']) as Instant,
  };
}

const INTERVIEW = sql`i.id, i.application_id, i.plan_key, i.title, ${iso(sql`i.starts_at`)} AS starts_at, i.minutes, i.state, i.place, i.video_url,
  coalesce((SELECT array_agg(person_id::text ORDER BY person_id) FROM recruiting.interview_interviewer x
    WHERE x.tenant_id = i.tenant_id AND x.interview_id = i.id), '{}') AS interviewer_ids`;

const interviewOf = (r: Row): InterviewRecord => ({
  id: String(r['id']),
  applicationId: String(r['application_id']),
  planKey: String(r['plan_key']),
  title: String(r['title']),
  startsAt: String(r['starts_at']),
  minutes: Number(r['minutes']),
  state: r['state'] as InterviewRecord['state'],
  place: str(r['place']),
  videoUrl: str(r['video_url']),
  interviewerIds: (r['interviewer_ids'] as string[] | null) ?? [],
});

async function scorecardsWhere(tx: PostgresJsDatabase, where: SQL): Promise<Scorecard[]> {
  const cards = await rows(
    tx,
    sql`SELECT s.interview_id, s.interviewer_id, s.recommendation, ${iso(sql`s.submitted_at`)} AS submitted_at,
      coalesce((SELECT jsonb_object_agg(r.competency, r.rating) FROM recruiting.rating r
        WHERE r.tenant_id = s.tenant_id AND r.interview_id = s.interview_id AND r.interviewer_id = s.interviewer_id), '{}') AS ratings
    FROM recruiting.scorecard s WHERE ${where}`,
  );
  return cards.map((c) => ({
    interviewId: String(c['interview_id']),
    interviewerId: String(c['interviewer_id']),
    ratings: c['ratings'] as Scorecard['ratings'],
    recommendation: (c['recommendation'] as Scorecard['recommendation']) ?? null,
    submittedAt: str(c['submitted_at']),
  }));
}

const fileOf = (r: Row): CandidateFile => ({
  id: String(r['id']),
  candidateId: String(r['candidate_id']),
  applicationId: str(r['application_id']),
  kind: r['kind'] as CandidateFile['kind'],
  blobKey: String(r['blob_key']),
  fileName: String(r['file_name']),
  mediaType: String(r['media_type']),
  size: Number(r['size']),
  sha256: String(r['sha256']).trim(),
  uploadedAt: String(r['uploaded_at']) as Instant,
});
const FILE = sql`id, candidate_id, application_id, kind, blob_key, file_name, media_type, size, sha256, ${iso(sql`uploaded_at`)} AS uploaded_at`;

const messageOf = (r: Row): Message => ({
  id: String(r['id']),
  candidateId: String(r['candidate_id']),
  applicationId: str(r['application_id']),
  direction: r['direction'] as Message['direction'],
  subject: String(r['subject']),
  body: String(r['body']),
  fromPerson: str(r['from_person']),
  templateId: str(r['template_id']),
  sendAt: String(r['send_at']) as Instant,
  sentAt: str(r['sent_at']) as Instant | null,
  readAt: str(r['read_at']) as Instant | null,
  createdAt: String(r['created_at']) as Instant,
});
const MESSAGE = sql`id, candidate_id, application_id, direction, subject, body, from_person, template_id,
  ${iso(sql`send_at`)} AS send_at, ${iso(sql`sent_at`)} AS sent_at, ${iso(sql`read_at`)} AS read_at, ${iso(sql`created_at`)} AS created_at`;

function storesIn(tx: PostgresJsDatabase, tenantId: TenantId): Tx {
  const T = tenantId as string;
  return {
    members: {
      get: async (personId) => {
        const r = await one(tx, sql`SELECT * FROM recruiting.member WHERE person_id = ${personId}`);
        return r === null ? null : memberOf(r);
      },
      byAccount: async (accountId) => {
        const found = await rows(
          tx,
          sql`SELECT * FROM recruiting.member WHERE account_id = ${accountId} LIMIT 2`,
        );
        return found.length === 1 && found[0] !== undefined ? memberOf(found[0]) : null;
      },
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.member ORDER BY display_name`)).map(memberOf),
      upsert: async (m, eventId, effectiveFrom) => {
        const written = await rows(
          tx,
          sql`INSERT INTO recruiting.member (tenant_id, person_id, account_id, display_name, work_email, manager_person_id,
                team_key, team_name, location_key, legal_entity_id, status, last_event_id, last_effective_from)
              VALUES (${T}, ${m.personId}, ${m.accountId}, ${m.displayName}, ${m.workEmail}, ${m.managerPersonId}, ${m.teamKey},
                ${m.teamName}, ${m.locationKey}, ${m.legalEntityId}, ${m.status}, ${eventId}, ${effectiveFrom})
              ON CONFLICT (tenant_id, person_id) DO UPDATE SET account_id = EXCLUDED.account_id,
                display_name = EXCLUDED.display_name, work_email = EXCLUDED.work_email,
                manager_person_id = EXCLUDED.manager_person_id, team_key = EXCLUDED.team_key, team_name = EXCLUDED.team_name,
                location_key = EXCLUDED.location_key, legal_entity_id = EXCLUDED.legal_entity_id, status = EXCLUDED.status,
                last_event_id = EXCLUDED.last_event_id, last_effective_from = EXCLUDED.last_effective_from
              WHERE (recruiting.member.last_effective_from, recruiting.member.last_event_id::text)
                  < (EXCLUDED.last_effective_from, EXCLUDED.last_event_id::text)
              RETURNING person_id`,
        );
        return written.length > 0;
      },
    },
    admins: {
      has: async (a) =>
        (await one(tx, sql`SELECT 1 AS ok FROM recruiting.admin WHERE account_id = ${a}`)) !== null,
      list: async () =>
        (await rows(tx, sql`SELECT account_id FROM recruiting.admin`)).map((r) =>
          String(r['account_id']),
        ),
      add: async (a) => {
        await tx.execute(
          sql`INSERT INTO recruiting.admin (tenant_id, account_id) VALUES (${T}, ${a}) ON CONFLICT DO NOTHING`,
        );
      },
      remove: async (a) => {
        await tx.execute(sql`DELETE FROM recruiting.admin WHERE account_id = ${a}`);
      },
    },
    entities: {
      get: async (id) =>
        body<Entity>(await one(tx, sql`SELECT body FROM recruiting.entity WHERE id = ${id}`)),
      list: async () =>
        (await rows(tx, sql`SELECT body FROM recruiting.entity ORDER BY name`)).map(
          (r) => r['body'] as Entity,
        ),
      save: async (e) => {
        await tx.execute(sql`INSERT INTO recruiting.entity (tenant_id, id, name, country, currency, full_time_weekly_minutes, headcount,
            founded_on, works_council, works_council_ids, body)
          VALUES (${T}, ${e.id}, ${e.name}, ${e.country}, ${e.currency}, ${e.fullTimeWeeklyMinutes}, ${e.headcount}, ${e.foundedOn},
            ${e.worksCouncil}, ${uuids(e.worksCouncilIds)}, ${J(e)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country, currency = EXCLUDED.currency,
            full_time_weekly_minutes = EXCLUDED.full_time_weekly_minutes, headcount = EXCLUDED.headcount,
            founded_on = EXCLUDED.founded_on, works_council = EXCLUDED.works_council,
            works_council_ids = EXCLUDED.works_council_ids, body = EXCLUDED.body`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.entity WHERE id = ${id}`);
      },
    },
    locations: {
      get: async (id) => {
        const r = await one(tx, sql`SELECT * FROM recruiting.location WHERE id = ${id}`);
        return r === null ? null : locationOf(r);
      },
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.location ORDER BY name`)).map(locationOf),
      save: async (l) => {
        await tx.execute(sql`INSERT INTO recruiting.location (tenant_id, id, name, entity_id, country, region, city, time_zone)
          VALUES (${T}, ${l.id}, ${l.name}, ${l.entityId}, ${l.country}, ${l.region}, ${l.city}, ${l.timeZone})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, entity_id = EXCLUDED.entity_id, country = EXCLUDED.country,
            region = EXCLUDED.region, city = EXCLUDED.city, time_zone = EXCLUDED.time_zone`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.location WHERE id = ${id}`);
      },
    },
    orgUnits: {
      get: async (id) => {
        const r = await one(
          tx,
          sql`SELECT id, name, parent_id FROM recruiting.org_unit WHERE id = ${id}`,
        );
        return r === null
          ? null
          : { id: String(r['id']), name: String(r['name']), parentId: str(r['parent_id']) };
      },
      list: async () =>
        (
          await rows(tx, sql`SELECT id, name, parent_id FROM recruiting.org_unit ORDER BY name`)
        ).map((r) => ({
          id: String(r['id']),
          name: String(r['name']),
          parentId: str(r['parent_id']),
        })),
      save: async (o) => {
        await tx.execute(sql`INSERT INTO recruiting.org_unit (tenant_id, id, name, parent_id) VALUES (${T}, ${o.id}, ${o.name}, ${o.parentId})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.org_unit WHERE id = ${id}`);
      },
    },
    requisitions: bodied<Requisition>(tx, T, 'requisition', (r) => ({
      state: v(r.state),
      title: v(r.title),
      hiring_manager_id: v(r.hiringManagerId),
      org_unit_id: v(r.orgUnitId),
      legal_entity_id: v(r.legalEntityId),
      openings: v(r.openings),
      filled: v(r.filled),
      budget_to_minor: v(r.budget?.to.amountMinor ?? null),
      currency: v(r.budget?.to.currency ?? null),
    })),
    chains: bodied<ApprovalChain>(tx, T, 'approval_chain', (c) => ({
      applies_to: v(c.appliesTo),
      priority: v(c.priority),
    })),
    approvals: approvalsIn(tx, T),
    jobs: jobsIn(tx, T),
    pipelines: {
      get: async (id) =>
        pipelineOf(await one(tx, sql`SELECT * FROM recruiting.pipeline_template WHERE id = ${id}`)),
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.pipeline_template ORDER BY name`)).flatMap(
          (r) => pipelineOf(r) ?? [],
        ),
      save: async (p) => {
        await tx.execute(sql`INSERT INTO recruiting.pipeline_template (tenant_id, id, name, is_default, stages)
          VALUES (${T}, ${p.id}, ${p.name}, ${p.isDefault}, ${J(p.stages)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default, stages = EXCLUDED.stages`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.pipeline_template WHERE id = ${id}`);
      },
    },
    questionnaires: {
      get: async (id) => {
        const q = await one(
          tx,
          sql`SELECT id, version, name, works_council_consent_version FROM recruiting.questionnaire WHERE id = ${id}`,
        );
        return q === null
          ? null
          : questionnaireOf(
              q,
              await rows(
                tx,
                sql`SELECT body FROM recruiting.question WHERE questionnaire_id = ${id} ORDER BY position`,
              ),
            );
      },
      list: async () => {
        const all = await rows(
          tx,
          sql`SELECT id, version, name, works_council_consent_version FROM recruiting.questionnaire WHERE NOT archived ORDER BY name`,
        );
        const out: Questionnaire[] = [];
        for (const q of all)
          out.push(
            questionnaireOf(
              q,
              await rows(
                tx,
                sql`SELECT body FROM recruiting.question WHERE questionnaire_id = ${q['id'] as string} ORDER BY position`,
              ),
            ),
          );
        return out;
      },
      save: async (q) => {
        await tx.execute(sql`INSERT INTO recruiting.questionnaire (tenant_id, id, version, name, works_council_consent_version)
          VALUES (${T}, ${q.id}, ${q.version}, ${q.name}, ${q.worksCouncilConsentVersion})
          ON CONFLICT (tenant_id, id) DO UPDATE SET version = EXCLUDED.version, name = EXCLUDED.name,
            works_council_consent_version = EXCLUDED.works_council_consent_version`);
        await tx.execute(sql`DELETE FROM recruiting.question WHERE questionnaire_id = ${q.id}`);
        for (const [i, question] of q.questions.entries()) {
          await tx.execute(sql`INSERT INTO recruiting.question (tenant_id, id, questionnaire_id, position, body)
            VALUES (${T}, ${question.id}, ${q.id}, ${i}, ${J(question)})`);
        }
      },
      answers: async (applicationId) =>
        (
          await rows(
            tx,
            sql`SELECT questionnaire_id, answers, score FROM recruiting.answer WHERE application_id = ${applicationId}`,
          )
        ).map((r) => ({
          questionnaireId: String(r['questionnaire_id']),
          answers: r['answers'] as Record<string, Answer>,
          score: r['score'] === null ? null : Number(r['score']),
        })),
      saveAnswers: async (applicationId, questionnaireId, version, answers, score, knockedOut) => {
        await tx.execute(sql`INSERT INTO recruiting.answer (tenant_id, application_id, questionnaire_id, version, answers, score, knocked_out)
          VALUES (${T}, ${applicationId}, ${questionnaireId}, ${version}, ${J(answers)}, ${score}, ${J(knockedOut)})
          ON CONFLICT (tenant_id, application_id, questionnaire_id) DO UPDATE SET version = EXCLUDED.version,
            answers = EXCLUDED.answers, score = EXCLUDED.score, knocked_out = EXCLUDED.knocked_out`);
      },
    },
    candidates: {
      get: async (id) =>
        body<Candidate>(await one(tx, sql`SELECT body FROM recruiting.candidate WHERE id = ${id}`)),
      byEmail: async (email) =>
        body<Candidate>(
          await one(
            tx,
            sql`SELECT body FROM recruiting.candidate WHERE email_norm = ${normalEmail(email)} AND merged_into IS NULL AND anonymised_at IS NULL`,
          ),
        ),
      suspects: async (phoneTail, cvHash) =>
        (
          await rows(
            tx,
            sql`SELECT body FROM recruiting.candidate WHERE merged_into IS NULL AND anonymised_at IS NULL
              AND ((${phoneTail}::text IS NOT NULL AND phone_tail = ${phoneTail}) OR (${cvHash}::text IS NOT NULL AND cv_hash = ${cvHash}))
              LIMIT 20`,
          )
        ).map((r) => r['body'] as Candidate),
      search: async ({ text, tag, limit }) => {
        const words = text?.trim() ?? '';
        const found = await rows(
          tx,
          sql`SELECT c.body FROM recruiting.candidate c WHERE c.merged_into IS NULL AND c.anonymised_at IS NULL
            AND (${tag ?? null}::text IS NULL OR c.body->'tags' ? ${tag ?? ''})
            AND (${words} = '' OR c.name_norm LIKE ${`%${normalName(words)}%`} OR c.email_norm LIKE ${`%${words.toLowerCase()}%`}
              OR EXISTS (SELECT 1 FROM recruiting.candidate_file f JOIN recruiting.candidate_text t
                ON t.tenant_id = f.tenant_id AND t.file_id = f.id
                WHERE f.tenant_id = c.tenant_id AND f.candidate_id = c.id AND t.tsv @@ plainto_tsquery('simple', ${words})))
            ORDER BY c.created_at DESC LIMIT ${limit}`,
        );
        return found.map((r) => r['body'] as Candidate);
      },
      save: async (c) => {
        await tx.execute(sql`INSERT INTO recruiting.candidate (tenant_id, id, name, name_norm, email, email_norm, phone, phone_tail, cv_hash,
            person_id, body, merged_into, anonymised_at)
          VALUES (${T}, ${c.id}, ${c.name}, ${normalName(c.name)}, ${c.email}, ${normalEmail(c.email)}, ${c.phone}, ${tail(c.phone)},
            ${c.cvHash}, ${c.personId}, ${J(c)}, ${c.mergedInto}, ${c.anonymisedAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, name_norm = EXCLUDED.name_norm, email = EXCLUDED.email,
            email_norm = EXCLUDED.email_norm, phone = EXCLUDED.phone, phone_tail = EXCLUDED.phone_tail, cv_hash = EXCLUDED.cv_hash,
            person_id = EXCLUDED.person_id, body = EXCLUDED.body, merged_into = EXCLUDED.merged_into, anonymised_at = EXCLUDED.anonymised_at`);
      },
    },
    files: {
      get: async (id) => {
        const r = await one(
          tx,
          sql`SELECT ${FILE} FROM recruiting.candidate_file WHERE id = ${id}`,
        );
        return r === null ? null : fileOf(r);
      },
      of: async (candidateId) =>
        (
          await rows(
            tx,
            sql`SELECT ${FILE} FROM recruiting.candidate_file WHERE candidate_id = ${candidateId} ORDER BY uploaded_at`,
          )
        ).map(fileOf),
      add: async (f) => {
        await tx.execute(sql`INSERT INTO recruiting.candidate_file (tenant_id, id, candidate_id, application_id, kind, blob_key, file_name,
            media_type, size, sha256, uploaded_at)
          VALUES (${T}, ${f.id}, ${f.candidateId}, ${f.applicationId}, ${f.kind}, ${f.blobKey}, ${f.fileName}, ${f.mediaType}, ${f.size},
            ${f.sha256}, ${f.uploadedAt})`);
      },
      setText: async (fileId, text) => {
        await tx.execute(sql`INSERT INTO recruiting.candidate_text (tenant_id, file_id, no_text, text)
          VALUES (${T}, ${fileId}, ${text === null}, ${text ?? ''})
          ON CONFLICT (tenant_id, file_id) DO UPDATE SET no_text = EXCLUDED.no_text, text = EXCLUDED.text`);
      },
      text: async (fileId) => {
        const r = await one(
          tx,
          sql`SELECT text, no_text FROM recruiting.candidate_text WHERE file_id = ${fileId}`,
        );
        return r === null ? null : { text: String(r['text']), noText: Boolean(r['no_text']) };
      },
      removeOf: async (candidateId) => {
        const gone = (
          await rows(
            tx,
            sql`DELETE FROM recruiting.candidate_file WHERE candidate_id = ${candidateId} RETURNING ${FILE}`,
          )
        ).map(fileOf);
        if (gone.length > 0)
          await tx.execute(
            sql`DELETE FROM recruiting.candidate_text WHERE file_id = ANY(${uuids(gone.map((f) => f.id))})`,
          );
        return gone;
      },
    },
    applications: {
      get: async (id) => {
        const r = await one(
          tx,
          sql`SELECT ${APPLICATION} FROM recruiting.application WHERE id = ${id}`,
        );
        return r === null ? null : applicationOf(tx, r);
      },
      forJob: async (jobId) =>
        Promise.all(
          (
            await rows(
              tx,
              sql`SELECT ${APPLICATION} FROM recruiting.application WHERE job_id = ${jobId} ORDER BY created_at DESC`,
            )
          ).map((r) => applicationOf(tx, r)),
        ),
      forCandidate: async (candidateId) =>
        Promise.all(
          (
            await rows(
              tx,
              sql`SELECT ${APPLICATION} FROM recruiting.application WHERE candidate_id = ${candidateId} ORDER BY created_at DESC`,
            )
          ).map((r) => applicationOf(tx, r)),
        ),
      find: async (candidateId, jobId) => {
        const r = await one(
          tx,
          sql`SELECT ${APPLICATION} FROM recruiting.application WHERE candidate_id = ${candidateId} AND job_id = ${jobId}`,
        );
        return r === null ? null : applicationOf(tx, r);
      },
      all: async () =>
        Promise.all(
          (await rows(tx, sql`SELECT ${APPLICATION} FROM recruiting.application`)).map((r) =>
            applicationOf(tx, r),
          ),
        ),
      save: async (app, category, newMoves, effectiveFrom) => {
        const stage = app.history.at(-1)?.to;
        if (stage === undefined) throw new Error(`Application ${app.id} has no stage`);
        const decided =
          app.outcome === 'active'
            ? null
            : (app.rejection?.at ?? app.withdrawnAt ?? app.history.at(-1)?.at ?? null);
        await tx.execute(sql`INSERT INTO recruiting.application (tenant_id, id, candidate_id, job_id, stage_id, category, outcome, source,
            flagged, score, language, answers, adjustments, rejection, withdrawn_at, decided_at, created_at)
          VALUES (${T}, ${app.id}, ${app.candidateId}, ${app.jobId}, ${stage}, ${category}, ${app.outcome}, ${J(app.source)}, ${app.flagged},
            ${app.score}, ${app.language}, ${J(app.answers)}, ${app.adjustments}, ${app.rejection === null ? null : J(app.rejection)},
            ${app.withdrawnAt}, ${decided}, ${app.createdAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET stage_id = EXCLUDED.stage_id, category = EXCLUDED.category, outcome = EXCLUDED.outcome,
            flagged = EXCLUDED.flagged, score = EXCLUDED.score, answers = EXCLUDED.answers, adjustments = EXCLUDED.adjustments,
            rejection = EXCLUDED.rejection, withdrawn_at = EXCLUDED.withdrawn_at, decided_at = EXCLUDED.decided_at`);
        for (const m of newMoves) {
          await tx.execute(sql`INSERT INTO recruiting.application_stage_event (tenant_id, id, application_id, from_stage, to_stage, category,
              at, effective_from, by_person, supersedes, reason)
            VALUES (${T}, ${m.id}, ${app.id}, ${m.from}, ${m.to}, ${category}, ${m.at}, ${effectiveFrom},
              ${/^[0-9a-f-]{36}$/u.test(m.by) ? m.by : null}, ${m.supersedes}, ${m.reason})`);
        }
      },
    },
    consents: {
      of: async (candidateId) =>
        (
          await rows(
            tx,
            sql`SELECT id, candidate_id, purpose, ${iso(sql`given_at`)} AS given_at, expires_on::text AS expires_on,
            ${iso(sql`withdrawn_at`)} AS withdrawn_at, notice FROM recruiting.consent WHERE candidate_id = ${candidateId}`,
          )
        ).map((r): Consent => ({
          id: String(r['id']),
          candidateId: String(r['candidate_id']),
          purpose: r['purpose'] as Consent['purpose'],
          givenAt: String(r['given_at']) as Instant,
          expiresOn: str(r['expires_on']) as CalendarDate | null,
          withdrawnAt: str(r['withdrawn_at']) as Instant | null,
          notice: String(r['notice']),
        })),
      save: async (c) => {
        await tx.execute(sql`INSERT INTO recruiting.consent (tenant_id, id, candidate_id, purpose, given_at, expires_on, withdrawn_at, notice)
          VALUES (${T}, ${c.id}, ${c.candidateId}, ${c.purpose}, ${c.givenAt}, ${c.expiresOn}, ${c.withdrawnAt}, ${c.notice})
          ON CONFLICT (tenant_id, id) DO UPDATE SET expires_on = EXCLUDED.expires_on, withdrawn_at = EXCLUDED.withdrawn_at`);
      },
    },
    pools: {
      list: async () =>
        (await rows(tx, sql`SELECT id, name, description FROM recruiting.pool ORDER BY name`)).map(
          (r): Pool => ({
            id: String(r['id']),
            name: String(r['name']),
            description: str(r['description']),
          }),
        ),
      get: async (id) => {
        const r = await one(
          tx,
          sql`SELECT id, name, description FROM recruiting.pool WHERE id = ${id}`,
        );
        return r === null
          ? null
          : { id: String(r['id']), name: String(r['name']), description: str(r['description']) };
      },
      save: async (p) => {
        await tx.execute(sql`INSERT INTO recruiting.pool (tenant_id, id, name, description) VALUES (${T}, ${p.id}, ${p.name}, ${p.description})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`);
      },
      members: async (poolId) =>
        (
          await rows(
            tx,
            sql`SELECT pool_id, candidate_id, reason, added_by, ${iso(sql`added_at`)} AS added_at FROM recruiting.pool_member WHERE pool_id = ${poolId}`,
          )
        ).map(poolMemberOf),
      of: async (candidateId) =>
        (
          await rows(
            tx,
            sql`SELECT pool_id, candidate_id, reason, added_by, ${iso(sql`added_at`)} AS added_at FROM recruiting.pool_member WHERE candidate_id = ${candidateId}`,
          )
        ).map(poolMemberOf),
      add: async (m) => {
        await tx.execute(sql`INSERT INTO recruiting.pool_member (tenant_id, pool_id, candidate_id, reason, added_by, added_at)
          VALUES (${T}, ${m.poolId}, ${m.candidateId}, ${m.reason}, ${m.addedBy}, ${m.addedAt}) ON CONFLICT DO NOTHING`);
      },
      remove: async (poolId, candidateId) => {
        await tx.execute(
          sql`DELETE FROM recruiting.pool_member WHERE pool_id = ${poolId} AND candidate_id = ${candidateId}`,
        );
      },
    },
    notes: {
      of: async (candidateId) =>
        (
          await rows(
            tx,
            sql`SELECT id, candidate_id, application_id, author_id, body, mentions::text[] AS mentions, ${iso(sql`created_at`)} AS created_at
            FROM recruiting.note WHERE candidate_id = ${candidateId} ORDER BY created_at`,
          )
        ).map((r): Note => ({
          id: String(r['id']),
          candidateId: String(r['candidate_id']),
          applicationId: str(r['application_id']),
          authorId: String(r['author_id']),
          body: String(r['body']),
          mentions: (r['mentions'] as string[] | null) ?? [],
          createdAt: String(r['created_at']) as Instant,
        })),
      add: async (n) => {
        await tx.execute(sql`INSERT INTO recruiting.note (tenant_id, id, candidate_id, application_id, author_id, body, mentions, created_at)
          VALUES (${T}, ${n.id}, ${n.candidateId}, ${n.applicationId}, ${n.authorId}, ${n.body}, ${uuids(n.mentions)}, ${n.createdAt})`);
      },
    },
    messages: {
      thread: async (candidateId) =>
        (
          await rows(
            tx,
            sql`SELECT ${MESSAGE} FROM recruiting.message WHERE candidate_id = ${candidateId} ORDER BY created_at, id`,
          )
        ).map(messageOf),
      add: async (m) => {
        await tx.execute(sql`INSERT INTO recruiting.message (tenant_id, id, candidate_id, application_id, direction, subject, body, from_person,
            template_id, send_at, sent_at, read_at, created_at)
          VALUES (${T}, ${m.id}, ${m.candidateId}, ${m.applicationId}, ${m.direction}, ${m.subject}, ${m.body}, ${m.fromPerson}, ${m.templateId},
            ${m.sendAt}, ${m.sentAt}, ${m.readAt}, ${m.createdAt})`);
      },
      markSent: async (id, at) => {
        await tx.execute(sql`UPDATE recruiting.message SET sent_at = ${at} WHERE id = ${id}`);
      },
      markRead: async (candidateId, at) => {
        await tx.execute(
          sql`UPDATE recruiting.message SET read_at = ${at} WHERE candidate_id = ${candidateId} AND direction = 'in' AND read_at IS NULL`,
        );
      },
      due: async (at) =>
        (
          await rows(
            tx,
            sql`SELECT ${MESSAGE} FROM recruiting.message WHERE direction = 'out' AND sent_at IS NULL AND send_at <= ${at} LIMIT 200`,
          )
        ).map(messageOf),
    },
    templates: {
      get: async (id) =>
        templateOf(await one(tx, sql`SELECT * FROM recruiting.template WHERE id = ${id}`)),
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.template ORDER BY name`)).flatMap(
          (r) => templateOf(r) ?? [],
        ),
      save: async (t) => {
        await tx.execute(sql`INSERT INTO recruiting.template (tenant_id, id, kind, purpose, language, name, subject, body)
          VALUES (${T}, ${t.id}, ${t.kind}, ${t.purpose}, ${t.language}, ${t.name}, ${t.subject}, ${t.body})
          ON CONFLICT (tenant_id, id) DO UPDATE SET kind = EXCLUDED.kind, purpose = EXCLUDED.purpose, language = EXCLUDED.language,
            name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.template WHERE id = ${id}`);
      },
    },
    interviews: {
      get: async (id) => {
        const r = await one(
          tx,
          sql`SELECT ${INTERVIEW} FROM recruiting.interview i WHERE i.id = ${id}`,
        );
        return r === null ? null : interviewOf(r);
      },
      forApplication: async (applicationId) =>
        (
          await rows(
            tx,
            sql`SELECT ${INTERVIEW} FROM recruiting.interview i WHERE i.application_id = ${applicationId} ORDER BY i.starts_at`,
          )
        ).map(interviewOf),
      forInterviewer: async (personId, from, to) =>
        (
          await rows(
            tx,
            sql`SELECT ${INTERVIEW} FROM recruiting.interview i JOIN recruiting.interview_interviewer x ON x.tenant_id = i.tenant_id AND x.interview_id = i.id
            WHERE x.person_id = ${personId} AND i.starts_at >= ${from} AND i.starts_at < ${to} ORDER BY i.starts_at`,
          )
        ).map(interviewOf),
      startingBetween: async (from, to) =>
        (
          await rows(
            tx,
            sql`SELECT ${INTERVIEW} FROM recruiting.interview i WHERE i.state = 'scheduled' AND i.starts_at >= ${from} AND i.starts_at < ${to} ORDER BY i.starts_at`,
          )
        ).map(interviewOf),
      save: async (i) => {
        await tx.execute(sql`INSERT INTO recruiting.interview (tenant_id, id, application_id, plan_key, title, starts_at, minutes, state, place, video_url)
          VALUES (${T}, ${i.id}, ${i.applicationId}, ${i.planKey}, ${i.title}, ${i.startsAt}, ${i.minutes}, ${i.state}, ${i.place}, ${i.videoUrl})
          ON CONFLICT (tenant_id, id) DO UPDATE SET starts_at = EXCLUDED.starts_at, minutes = EXCLUDED.minutes, state = EXCLUDED.state,
            place = EXCLUDED.place, video_url = EXCLUDED.video_url, title = EXCLUDED.title`);
        await tx.execute(
          sql`DELETE FROM recruiting.interview_interviewer WHERE interview_id = ${i.id}`,
        );
        for (const p of i.interviewerIds) {
          await tx.execute(
            sql`INSERT INTO recruiting.interview_interviewer (tenant_id, interview_id, person_id) VALUES (${T}, ${i.id}, ${p})`,
          );
        }
      },
      scorecards: async (interviewId) => scorecardsWhere(tx, sql`s.interview_id = ${interviewId}`),
      forApplicationScorecards: async (applicationId) =>
        scorecardsWhere(
          tx,
          sql`s.interview_id IN (SELECT id FROM recruiting.interview WHERE application_id = ${applicationId})`,
        ),
      saveScorecard: async (card) => {
        await tx.execute(sql`INSERT INTO recruiting.scorecard (tenant_id, interview_id, interviewer_id, recommendation, notes, submitted_at)
          VALUES (${T}, ${card.interviewId}, ${card.interviewerId}, ${card.recommendation}, ${card.notes}, ${card.submittedAt})
          ON CONFLICT (tenant_id, interview_id, interviewer_id) DO UPDATE SET recommendation = EXCLUDED.recommendation,
            notes = EXCLUDED.notes, submitted_at = EXCLUDED.submitted_at`);
        await tx.execute(
          sql`DELETE FROM recruiting.rating WHERE interview_id = ${card.interviewId} AND interviewer_id = ${card.interviewerId}`,
        );
        for (const [competency, rating] of Object.entries(card.ratings)) {
          await tx.execute(sql`INSERT INTO recruiting.rating (tenant_id, interview_id, interviewer_id, competency, rating)
            VALUES (${T}, ${card.interviewId}, ${card.interviewerId}, ${competency}, ${rating})`);
        }
      },
      owedBy: async (personId) =>
        (
          await rows(
            tx,
            sql`SELECT ${INTERVIEW} FROM recruiting.interview i JOIN recruiting.interview_interviewer x ON x.tenant_id = i.tenant_id AND x.interview_id = i.id
            WHERE x.person_id = ${personId} AND i.state = 'completed'
              AND NOT EXISTS (SELECT 1 FROM recruiting.scorecard s WHERE s.tenant_id = i.tenant_id AND s.interview_id = i.id
                AND s.interviewer_id = ${personId} AND s.submitted_at IS NOT NULL)`,
          )
        ).map(interviewOf),
    },
    scorecardTemplates: {
      get: async (id) =>
        scorecardTemplateOf(
          await one(tx, sql`SELECT * FROM recruiting.scorecard_template WHERE id = ${id}`),
        ),
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.scorecard_template ORDER BY name`)).flatMap(
          (r) => scorecardTemplateOf(r) ?? [],
        ),
      save: async (t) => {
        await tx.execute(sql`INSERT INTO recruiting.scorecard_template (tenant_id, id, name, competencies) VALUES (${T}, ${t.id}, ${t.name}, ${J(t.competencies)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, competencies = EXCLUDED.competencies`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.scorecard_template WHERE id = ${id}`);
      },
    },
    workingHours: {
      get: async (personId) => {
        const r = await one(
          tx,
          sql`SELECT person_id, time_zone, week FROM recruiting.working_hours WHERE person_id = ${personId}`,
        );
        return r === null
          ? null
          : ({
              personId: String(r['person_id']),
              timeZone: String(r['time_zone']),
              week: r['week'] as WorkingHours['week'],
            } satisfies WorkingHours);
      },
      save: async (h) => {
        await tx.execute(sql`INSERT INTO recruiting.working_hours (tenant_id, person_id, time_zone, week) VALUES (${T}, ${h.personId}, ${h.timeZone}, ${J(h.week)})
          ON CONFLICT (tenant_id, person_id) DO UPDATE SET time_zone = EXCLUDED.time_zone, week = EXCLUDED.week`);
      },
    },
    assessments: {
      save: async (a) => {
        await tx.execute(sql`INSERT INTO recruiting.ai_assessment (tenant_id, id, application_id, feature, model,
              prompt_version, input_hash, masked_input, output, score_bp, band, requested_by, created_at)
            VALUES (${T}, ${a.id}, ${a.applicationId}, ${a.feature}, ${a.model}, ${a.promptVersion}, ${a.inputHash},
              ${a.maskedInput}, ${J(a.output)}, ${a.scoreBp}, ${a.band}, ${a.requestedBy}, ${a.createdAt})`);
      },
      forApplication: async (applicationId) =>
        (
          await rows(
            tx,
            sql`SELECT id, application_id, feature, model, prompt_version, input_hash, masked_input, output, score_bp,
                  band, requested_by, ${iso(sql`created_at`)} AS created_at
                FROM recruiting.ai_assessment WHERE application_id = ${applicationId} ORDER BY created_at`,
          )
        ).map(
          (r) =>
            ({
              id: String(r['id']),
              applicationId: String(r['application_id']),
              feature: r['feature'] as Assessment['feature'],
              model: String(r['model']),
              promptVersion: String(r['prompt_version']),
              inputHash: String(r['input_hash']),
              maskedInput: String(r['masked_input']),
              output: r['output'],
              scoreBp: r['score_bp'] === null ? null : Number(r['score_bp']),
              band: (r['band'] as string | null) ?? null,
              requestedBy: String(r['requested_by']),
              createdAt: r['created_at'] as Assessment['createdAt'],
            }) satisfies Assessment,
        ),
    },
    verdicts: {
      save: async (assessmentId, list) => {
        for (const r of list)
          await tx.execute(sql`INSERT INTO recruiting.ai_verdict (tenant_id, assessment_id, criterion_id, verdict, passages)
            VALUES (${T}, ${assessmentId}, ${r.criterionId}, ${r.verdict}, ${J(r.passages)})`);
      },
      agree: async (assessmentId, criterionId, agreed, by) => {
        await tx.execute(sql`UPDATE recruiting.ai_verdict SET agreed = ${agreed}, agreed_by = ${by}
          WHERE assessment_id = ${assessmentId} AND criterion_id = ${criterionId}`);
      },
      of: async (assessmentId) =>
        (
          await rows(
            tx,
            sql`SELECT criterion_id, verdict, passages, agreed, agreed_by FROM recruiting.ai_verdict
                WHERE assessment_id = ${assessmentId}`,
          )
        ).map(
          (r) =>
            ({
              criterionId: String(r['criterion_id']),
              verdict: r['verdict'] as VerdictRow['verdict'],
              passages: r['passages'] as string[],
              agreed: (r['agreed'] as boolean | null) ?? null,
              agreedBy: (r['agreed_by'] as string | null) ?? null,
            }) satisfies VerdictRow,
        ),
    },
    references: {
      forApplication: async (applicationId) =>
        (
          await rows(
            tx,
            sql`SELECT * FROM recruiting.reference_request WHERE application_id = ${applicationId}`,
          )
        ).map(referenceOf),
      byToken: async (hash) => {
        const r = await one(
          tx,
          sql`SELECT * FROM recruiting.reference_request WHERE token_hash = ${hash}`,
        );
        return r === null ? null : referenceOf(r);
      },
      save: async (r) => {
        await tx.execute(sql`INSERT INTO recruiting.reference_request (tenant_id, id, application_id, referee_name, referee_email, relationship,
            token_hash, state, answers, requested_at, completed_at)
          VALUES (${T}, ${r.id}, ${r.applicationId}, ${r.refereeName}, ${r.refereeEmail}, ${r.relationship}, ${r.tokenHash}, ${r.state},
            ${r.answers === null ? null : J(r.answers)}, ${r.requestedAt}, ${r.completedAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, answers = EXCLUDED.answers,
            requested_at = EXCLUDED.requested_at, completed_at = EXCLUDED.completed_at`);
      },
    },
    offers: {
      get: async (id) =>
        body<Offer>(await one(tx, sql`SELECT body FROM recruiting.offer WHERE id = ${id}`)),
      forApplication: async (applicationId) =>
        (
          await rows(
            tx,
            sql`SELECT body FROM recruiting.offer WHERE application_id = ${applicationId} ORDER BY created_at`,
          )
        ).map((r) => r['body'] as Offer),
      list: async () =>
        (await rows(tx, sql`SELECT body FROM recruiting.offer`)).map((r) => r['body'] as Offer),
      save: async (o) => {
        const latest = o.versions.at(-1);
        if (latest === undefined) throw new Error(`Offer ${o.id} has no version`);
        await tx.execute(sql`INSERT INTO recruiting.offer (tenant_id, id, application_id, state, version, base_minor, currency, acceptance, body)
          VALUES (${T}, ${o.id}, ${o.applicationId}, ${o.state}, ${latest.version}, ${latest.pay.baseMinor}, ${latest.pay.currency},
            ${o.acceptance === null ? null : J(o.acceptance)}, ${J(o)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, version = EXCLUDED.version, base_minor = EXCLUDED.base_minor,
            currency = EXCLUDED.currency, acceptance = EXCLUDED.acceptance, body = EXCLUDED.body`);
        for (const version of o.versions) {
          await tx.execute(sql`INSERT INTO recruiting.offer_version (tenant_id, offer_id, version, body, hash, superseded_at)
            VALUES (${T}, ${o.id}, ${version.version}, ${J(version)}, ${versionHash(version)}, ${version.supersededAt})
            ON CONFLICT (tenant_id, offer_id, version) DO UPDATE SET superseded_at = EXCLUDED.superseded_at
            WHERE recruiting.offer_version.superseded_at IS NULL`);
        }
      },
    },
    contracts: {
      get: async (id) =>
        contractOf(await one(tx, sql`SELECT * FROM recruiting.contract WHERE id = ${id}`)),
      forOffer: async (offerId) =>
        contractOf(
          await one(
            tx,
            sql`SELECT * FROM recruiting.contract WHERE offer_id = ${offerId} AND state <> 'voided' ORDER BY created_at DESC LIMIT 1`,
          ),
        ),
      bySubjectRef: async (ref) =>
        contractOf(
          await one(tx, sql`SELECT * FROM recruiting.contract WHERE subject_ref = ${ref}`),
        ),
      save: async (c) => {
        await tx.execute(sql`INSERT INTO recruiting.contract (tenant_id, id, offer_id, offer_version, route, state, documents, pack_version, subject_ref,
            file_id, signed_on, signed_by)
          VALUES (${T}, ${c.id}, ${c.offerId}, ${c.offerVersion}, ${c.route}, ${c.state}, ${J(c.documents)}, ${c.packVersion}, ${c.subjectRef},
            ${c.fileId}, ${c.signedOn}, ${c.signedBy})
          ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, file_id = EXCLUDED.file_id, signed_on = EXCLUDED.signed_on,
            signed_by = EXCLUDED.signed_by`);
      },
    },
    prehires: {
      get: async (applicationId) =>
        prehireOf(
          tx,
          await one(
            tx,
            sql`SELECT * , start_date::text AS start FROM recruiting.prehire WHERE application_id = ${applicationId}`,
          ),
        ),
      list: async () => {
        const out: Prehire[] = [];
        for (const r of await rows(
          tx,
          sql`SELECT *, start_date::text AS start FROM recruiting.prehire ORDER BY start_date`,
        )) {
          const p = await prehireOf(tx, r);
          if (p !== null) out.push(p);
        }
        return out;
      },
      save: async (p) => {
        await tx.execute(sql`INSERT INTO recruiting.prehire (tenant_id, application_id, candidate_id, start_date, state, cancel_reason)
          VALUES (${T}, ${p.applicationId}, ${p.candidateId}, ${p.startDate}, ${p.state}, ${p.cancelReason})
          ON CONFLICT (tenant_id, application_id) DO UPDATE SET start_date = EXCLUDED.start_date, state = EXCLUDED.state,
            cancel_reason = EXCLUDED.cancel_reason`);
        for (const c of p.conditions) {
          await tx.execute(sql`INSERT INTO recruiting.condition (tenant_id, application_id, kind, state, decided_by, decided_at, note)
            VALUES (${T}, ${p.applicationId}, ${c.kind}, ${c.state}, ${c.decidedBy && /^[0-9a-f-]{36}$/u.test(c.decidedBy) ? c.decidedBy : null},
              ${c.decidedAt}, ${c.note})
            ON CONFLICT (tenant_id, application_id, kind) DO UPDATE SET state = EXCLUDED.state, decided_by = EXCLUDED.decided_by,
              decided_at = EXCLUDED.decided_at, note = EXCLUDED.note`);
        }
      },
    },
    benefits: bodied<Benefit>(tx, T, 'benefit', (b) => ({
      entity_id: v(b.legalEntityId),
      key: v(b.key),
      category: v(b.category),
      statutory: v(b.statutory),
    })),
    payBands: {
      get: async (id) =>
        payBandOf(await one(tx, sql`SELECT * FROM recruiting.pay_band WHERE id = ${id}`)),
      list: async () =>
        (await rows(tx, sql`SELECT * FROM recruiting.pay_band ORDER BY grade`)).flatMap(
          (r) => payBandOf(r) ?? [],
        ),
      save: async (b) => {
        await tx.execute(sql`INSERT INTO recruiting.pay_band (tenant_id, id, entity_id, grade, min_minor, max_minor, currency, source)
          VALUES (${T}, ${b.id}, ${b.entityId}, ${b.grade}, ${b.minMinor}, ${b.maxMinor}, ${b.currency}, ${b.source})
          ON CONFLICT (tenant_id, id) DO UPDATE SET entity_id = EXCLUDED.entity_id, grade = EXCLUDED.grade, min_minor = EXCLUDED.min_minor,
            max_minor = EXCLUDED.max_minor, currency = EXCLUDED.currency, source = EXCLUDED.source`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.pay_band WHERE id = ${id}`);
      },
    },
    referrals: {
      list: async () =>
        (
          await rows(
            tx,
            sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.referral ORDER BY created_at DESC`,
          )
        ).map(referralOf),
      byReferrer: async (personId) =>
        (
          await rows(
            tx,
            sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.referral WHERE referrer_id = ${personId} ORDER BY created_at DESC`,
          )
        ).map(referralOf),
      save: async (r) => {
        await tx.execute(sql`INSERT INTO recruiting.referral (tenant_id, id, job_id, referrer_id, candidate_name, candidate_email, note, application_id, created_at)
          VALUES (${T}, ${r.id}, ${r.jobId}, ${r.referrerId}, ${r.candidateName}, ${r.candidateEmail}, ${r.note}, ${r.applicationId}, ${r.createdAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET application_id = EXCLUDED.application_id`);
      },
    },
    agencies: {
      get: async (id) =>
        agencyOf(tx, await one(tx, sql`SELECT * FROM recruiting.agency WHERE id = ${id}`)),
      list: async () => {
        const out: Agency[] = [];
        for (const r of await rows(tx, sql`SELECT * FROM recruiting.agency ORDER BY name`)) {
          const a = await agencyOf(tx, r);
          if (a !== null) out.push(a);
        }
        return out;
      },
      save: async (a) => {
        await tx.execute(sql`INSERT INTO recruiting.agency (tenant_id, id, name, contact_email, fee, guarantee_days, ownership_months, active)
          VALUES (${T}, ${a.id}, ${a.name}, ${a.contactEmail}, ${J(a.fee)}, ${a.guaranteeDays}, ${a.ownershipMonths}, ${a.active})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, contact_email = EXCLUDED.contact_email, fee = EXCLUDED.fee,
            guarantee_days = EXCLUDED.guarantee_days, ownership_months = EXCLUDED.ownership_months, active = EXCLUDED.active`);
        await tx.execute(sql`DELETE FROM recruiting.agency_job WHERE agency_id = ${a.id}`);
        for (const jobId of a.jobIds)
          await tx.execute(
            sql`INSERT INTO recruiting.agency_job (tenant_id, agency_id, job_id) VALUES (${T}, ${a.id}, ${jobId})`,
          );
      },
      remove: async (id) => {
        await tx.execute(sql`UPDATE recruiting.agency SET active = false WHERE id = ${id}`);
      },
    },
    submissions: {
      forEmail: async (email) =>
        (
          await rows(
            tx,
            sql`SELECT *, submitted_on::text AS on_day FROM recruiting.agency_submission WHERE email_norm = ${email}`,
          )
        ).map(submissionOf),
      forAgency: async (agencyId) =>
        (
          await rows(
            tx,
            sql`SELECT *, submitted_on::text AS on_day FROM recruiting.agency_submission WHERE agency_id = ${agencyId}`,
          )
        ).map(submissionOf),
      add: async (s) => {
        await tx.execute(sql`INSERT INTO recruiting.agency_submission (tenant_id, id, agency_id, job_id, email_norm, application_id, submitted_on)
          VALUES (${T}, ${s.id}, ${s.agencyId}, ${s.jobId}, ${s.emailNorm}, ${s.applicationId}, ${s.submittedOn})`);
      },
    },
    codes: {
      put: async (email, jobId, hash, expiresAt) => {
        await tx.execute(sql`INSERT INTO recruiting.email_code (tenant_id, email_norm, job_id, code_hash, attempts, expires_at)
          VALUES (${T}, ${email}, ${jobId}, ${hash}, 0, ${expiresAt})
          ON CONFLICT (tenant_id, email_norm, job_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at`);
      },
      get: async (email, jobId) => {
        const r = await one(
          tx,
          sql`SELECT code_hash, attempts, ${iso(sql`expires_at`)} AS expires_at FROM recruiting.email_code WHERE email_norm = ${email} AND job_id = ${jobId}`,
        );
        return r === null
          ? null
          : {
              codeHash: String(r['code_hash']).trim(),
              attempts: Number(r['attempts']),
              expiresAt: String(r['expires_at']) as Instant,
            };
      },
      attempt: async (email, jobId) => {
        await tx.execute(
          sql`UPDATE recruiting.email_code SET attempts = attempts + 1 WHERE email_norm = ${email} AND job_id = ${jobId}`,
        );
      },
      remove: async (email, jobId) => {
        await tx.execute(
          sql`DELETE FROM recruiting.email_code WHERE email_norm = ${email} AND job_id = ${jobId}`,
        );
      },
    },
    tokens: {
      put: async (hash, candidateId, expiresAt) => {
        await tx.execute(
          sql`INSERT INTO recruiting.portal_token (tenant_id, token_hash, candidate_id, expires_at) VALUES (${T}, ${hash}, ${candidateId}, ${expiresAt})`,
        );
      },
      candidate: async (hash, at) => {
        const r = await one(
          tx,
          sql`SELECT candidate_id FROM recruiting.portal_token WHERE token_hash = ${hash} AND expires_at > ${at}`,
        );
        return r === null ? null : String(r['candidate_id']);
      },
    },
    legalHolds: {
      has: async (id) =>
        (await one(
          tx,
          sql`SELECT 1 AS ok FROM recruiting.legal_hold WHERE candidate_id = ${id}`,
        )) !== null,
      place: async (id, reason, by) => {
        await tx.execute(sql`INSERT INTO recruiting.legal_hold (tenant_id, candidate_id, reason, placed_by)
          VALUES (${T}, ${id}, ${reason}, ${/^[0-9a-f-]{36}$/u.test(by) ? by : null}) ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET reason = EXCLUDED.reason`);
      },
      lift: async (id) => {
        await tx.execute(sql`DELETE FROM recruiting.legal_hold WHERE candidate_id = ${id}`);
      },
    },
    settings: {
      get: async (key) =>
        (await one(tx, sql`SELECT value FROM recruiting.settings WHERE key = ${key}`))?.['value'] ??
        null,
      set: async (key, value) => {
        await tx.execute(sql`INSERT INTO recruiting.settings (tenant_id, key, value) VALUES (${T}, ${key}, ${J(value)})
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`);
      },
    },
    idempotency: {
      get: async (key) => {
        const r = await one(
          tx,
          sql`SELECT request_hash, status, answer FROM recruiting.idempotency_key WHERE key = ${key}`,
        );
        return r === null
          ? null
          : {
              requestHash: String(r['request_hash']).trim(),
              status: Number(r['status']),
              answer: r['answer'],
            };
      },
      put: async (key, requestHash, status, answer) => {
        await tx.execute(sql`INSERT INTO recruiting.idempotency_key (tenant_id, key, request_hash, status, answer)
          VALUES (${T}, ${key}, ${requestHash}, ${status}, ${J(answer)}) ON CONFLICT DO NOTHING`);
      },
    },
    outbox: { publish: (events) => publish(tx, outbox, events) },
    tenant: {
      register: async (slug) => {
        await tx.execute(sql`INSERT INTO recruiting.tenant (tenant_id, slug) VALUES (${T}, ${slug})
          ON CONFLICT (tenant_id) DO UPDATE SET slug = coalesce(EXCLUDED.slug, recruiting.tenant.slug)`);
      },
      slug: async () =>
        str(
          (await one(tx, sql`SELECT slug FROM recruiting.tenant WHERE tenant_id = ${T}`))?.['slug'],
        ),
    },
    public: {
      putCompany: async (c) => {
        await tx.execute(sql`INSERT INTO recruiting_public.company (tenant_id, slug, name, theme_id, logo_url, about, searchable)
          VALUES (${T}, ${c.slug}, ${c.name}, ${c.themeId}, ${c.logoUrl}, ${c.about}, ${c.searchable})
          ON CONFLICT (tenant_id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, theme_id = EXCLUDED.theme_id,
            logo_url = EXCLUDED.logo_url, about = EXCLUDED.about, searchable = EXCLUDED.searchable, updated_at = now()`);
      },
      putListing: async (job: PublicJob, text) => {
        const config = tsConfigFor(job.language);
        await tx.execute(sql`INSERT INTO recruiting_public.listing (job_id, language, tenant_id, company_slug, slug, title, country, work_mode,
            contract_type, hours, department, seniority, salary_min_minor, salary_max_minor, currency, salary_period, posted_at,
            valid_through, searchable, closed, page, tsv)
          VALUES (${job.jobId}, ${job.language}, ${T}, ${job.company.slug}, ${job.slug}, ${job.title},
            ${`{${[...new Set(job.places.map((p) => p.country))].join(',')}}`}::char(2)[], ${job.workMode}, ${job.contractType}, ${job.hours},
            ${job.department}, ${job.seniority}, ${job.salary?.minMinor ?? null}, ${job.salary?.maxMinor ?? null}, ${job.salary?.currency ?? null},
            ${job.salary?.period ?? null}, ${job.postedAt}, ${job.validThrough}, ${job.searchable}, ${job.closed}, ${J(job)},
            setweight(to_tsvector(${config}::regconfig, ${job.title}), 'A') || to_tsvector(${config}::regconfig, ${text}))
          ON CONFLICT (job_id, language) DO UPDATE SET title = EXCLUDED.title, country = EXCLUDED.country, work_mode = EXCLUDED.work_mode,
            contract_type = EXCLUDED.contract_type, hours = EXCLUDED.hours, department = EXCLUDED.department, seniority = EXCLUDED.seniority,
            salary_min_minor = EXCLUDED.salary_min_minor, salary_max_minor = EXCLUDED.salary_max_minor, currency = EXCLUDED.currency,
            salary_period = EXCLUDED.salary_period, searchable = EXCLUDED.searchable, closed = EXCLUDED.closed, page = EXCLUDED.page,
            tsv = EXCLUDED.tsv, updated_at = now()`);
      },
      removeListing: async (jobId) => {
        await tx.execute(sql`DELETE FROM recruiting_public.listing WHERE job_id = ${jobId}`);
      },
    },
  };
}

const locationOf = (r: Row): Location => ({
  id: String(r['id']),
  name: String(r['name']),
  entityId: str(r['entity_id']),
  country: String(r['country']) as Location['country'],
  region: str(r['region']),
  city: str(r['city']),
  timeZone: String(r['time_zone']),
});
const pipelineOf = (r: Row | null): PipelineTemplate | null =>
  r === null
    ? null
    : {
        id: String(r['id']),
        name: String(r['name']),
        isDefault: Boolean(r['is_default']),
        stages: r['stages'] as Stage[],
      };
const templateOf = (r: Row | null): Template | null =>
  r === null
    ? null
    : {
        id: String(r['id']),
        kind: r['kind'] as Template['kind'],
        purpose: String(r['purpose']),
        language: String(r['language']),
        name: String(r['name']),
        subject: str(r['subject']),
        body: String(r['body']),
      };
const scorecardTemplateOf = (r: Row | null): ScorecardTemplate | null =>
  r === null
    ? null
    : {
        id: String(r['id']),
        name: String(r['name']),
        competencies: r['competencies'] as ScorecardTemplate['competencies'],
      };
const payBandOf = (r: Row | null): PayBand | null =>
  r === null
    ? null
    : {
        id: String(r['id']),
        entityId: str(r['entity_id']),
        grade: String(r['grade']),
        minMinor: Number(r['min_minor']),
        maxMinor: Number(r['max_minor']),
        currency: String(r['currency']),
        source: r['source'] as PayBand['source'],
      };
const poolMemberOf = (r: Row): PoolMember => ({
  poolId: String(r['pool_id']),
  candidateId: String(r['candidate_id']),
  reason: String(r['reason']),
  addedBy: str(r['added_by']),
  addedAt: String(r['added_at']) as Instant,
});
const referenceOf = (r: Row): ReferenceRequest => ({
  id: String(r['id']),
  applicationId: String(r['application_id']),
  refereeName: String(r['referee_name']),
  refereeEmail: String(r['referee_email']),
  relationship: str(r['relationship']),
  tokenHash: String(r['token_hash']).trim(),
  state: r['state'] as ReferenceRequest['state'],
  answers: (r['answers'] as ReferenceRequest['answers']) ?? null,
  requestedAt: str(r['requested_at']) as Instant | null,
  completedAt: str(r['completed_at']) as Instant | null,
});
const referralOf = (r: Row): Referral => ({
  id: String(r['id']),
  jobId: String(r['job_id']),
  referrerId: String(r['referrer_id']),
  candidateName: String(r['candidate_name']),
  candidateEmail: String(r['candidate_email']),
  note: str(r['note']),
  applicationId: str(r['application_id']),
  createdAt: String(r['at']) as Instant,
});
const submissionOf = (r: Row) => ({
  id: String(r['id']),
  agencyId: String(r['agency_id']),
  jobId: String(r['job_id']),
  emailNorm: String(r['email_norm']),
  applicationId: str(r['application_id']),
  submittedOn: String(r['on_day']) as CalendarDate,
});
const contractOf = (r: Row | null): (Contract & { readonly fileId: string | null }) | null =>
  r === null
    ? null
    : {
        id: String(r['id']),
        offerId: String(r['offer_id']),
        offerVersion: Number(r['offer_version']),
        route: r['route'] as Contract['route'],
        state: r['state'] as Contract['state'],
        documents: r['documents'] as string[],
        packVersion: String(r['pack_version']),
        subjectRef: String(r['subject_ref']),
        signedOn: (str(r['signed_on'])?.slice(0, 10) ?? null) as CalendarDate | null,
        signedBy: str(r['signed_by']),
        fileId: str(r['file_id']),
      };

async function prehireOf(tx: PostgresJsDatabase, r: Row | null): Promise<Prehire | null> {
  if (r === null) return null;
  const conditions = await rows(
    tx,
    sql`SELECT kind, state, decided_by, ${iso(sql`decided_at`)} AS decided_at, note FROM recruiting.condition
    WHERE application_id = ${r['application_id'] as string} ORDER BY kind`,
  );
  return {
    applicationId: String(r['application_id']),
    candidateId: String(r['candidate_id']),
    startDate: String(r['start']) as CalendarDate,
    state: r['state'] as Prehire['state'],
    cancelReason: (r['cancel_reason'] as Prehire['cancelReason']) ?? null,
    conditions: conditions.map((c) => ({
      kind: c['kind'] as Prehire['conditions'][number]['kind'],
      state: c['state'] as Prehire['conditions'][number]['state'],
      decidedBy: str(c['decided_by']),
      decidedAt: str(c['decided_at']),
      note: str(c['note']),
    })),
  };
}

async function agencyOf(tx: PostgresJsDatabase, r: Row | null): Promise<Agency | null> {
  if (r === null) return null;
  const jobs = await rows(
    tx,
    sql`SELECT job_id FROM recruiting.agency_job WHERE agency_id = ${r['id'] as string}`,
  );
  return {
    id: String(r['id']),
    name: String(r['name']),
    contactEmail: String(r['contact_email']),
    fee: r['fee'] as Agency['fee'],
    guaranteeDays: Number(r['guarantee_days']),
    ownershipMonths: Number(r['ownership_months']),
    active: Boolean(r['active']),
    jobIds: jobs.map((j) => String(j['job_id'])),
  };
}

function questionnaireOf(q: Row, questions: readonly Row[]): Questionnaire {
  return {
    id: String(q['id']),
    version: Number(q['version']),
    name: String(q['name']),
    worksCouncilConsentVersion:
      q['works_council_consent_version'] === null
        ? null
        : Number(q['works_council_consent_version']),
    questions: questions.map((x) => x['body'] as Questionnaire['questions'][number]),
  };
}

function approvalsIn(tx: PostgresJsDatabase, T: string): Tx['approvals'] {
  const of = (r: Row, kind: 'requisition' | 'offer'): Approval => ({
    id: String(r['id']),
    subject: {
      kind,
      id: String(kind === 'requisition' ? r['requisition_id'] : r['offer_id']),
      version: kind === 'offer' ? Number(r['version']) : 1,
    },
    chainId: str(r['chain_id']),
    steps: r['steps'] as string[][],
    decisions: r['decisions'] as Approval['decisions'],
    outcome: r['outcome'] as Approval['outcome'],
    changes: kind === 'requisition' ? (r['changes'] as Approval['changes']) : [],
    createdAt: String(r['at']) as Instant,
  });
  const all = async (where: SQL): Promise<Approval[]> => [
    ...(
      await rows(
        tx,
        sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.requisition_approval WHERE ${where}`,
      )
    ).map((r) => of(r, 'requisition')),
    ...(
      await rows(
        tx,
        sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.offer_approval WHERE ${where}`,
      )
    ).map((r) => of(r, 'offer')),
  ];
  return {
    get: async (id) => (await all(sql`id = ${id}`))[0] ?? null,
    open: async (kind, subjectId) => {
      const r =
        kind === 'requisition'
          ? await one(
              tx,
              sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.requisition_approval WHERE requisition_id = ${subjectId} AND outcome = 'pending'`,
            )
          : await one(
              tx,
              sql`SELECT *, ${iso(sql`created_at`)} AS at FROM recruiting.offer_approval WHERE offer_id = ${subjectId} AND outcome = 'pending'`,
            );
      return r === null ? null : of(r, kind);
    },
    waitingOn: async (personId) =>
      (await all(sql`outcome = 'pending'`)).filter((a) => {
        const step = a.steps.findIndex((_, i) => !a.decisions.some((d) => d.step === i));
        return step !== -1 && (a.steps[step] ?? []).includes(personId);
      }),
    save: async (a) => {
      if (a.subject.kind === 'requisition') {
        await tx.execute(sql`INSERT INTO recruiting.requisition_approval (tenant_id, id, requisition_id, chain_id, steps, decisions, outcome, changes, created_at)
          VALUES (${T}, ${a.id}, ${a.subject.id}, ${a.chainId}, ${J(a.steps)}, ${J(a.decisions)}, ${a.outcome}, ${J(a.changes)}, ${a.createdAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET decisions = EXCLUDED.decisions, outcome = EXCLUDED.outcome`);
      } else {
        await tx.execute(sql`INSERT INTO recruiting.offer_approval (tenant_id, id, offer_id, version, chain_id, steps, decisions, outcome, created_at)
          VALUES (${T}, ${a.id}, ${a.subject.id}, ${a.subject.version}, ${a.chainId}, ${J(a.steps)}, ${J(a.decisions)}, ${a.outcome}, ${a.createdAt})
          ON CONFLICT (tenant_id, id) DO UPDATE SET decisions = EXCLUDED.decisions, outcome = EXCLUDED.outcome`);
      }
    },
  };
}

function jobsIn(tx: PostgresJsDatabase, T: string): Tx['jobs'] {
  return {
    get: async (id) =>
      body<JobRecord>(await one(tx, sql`SELECT body FROM recruiting.job WHERE id = ${id}`)),
    bySlug: async (slug) =>
      body<JobRecord>(await one(tx, sql`SELECT body FROM recruiting.job WHERE slug = ${slug}`)),
    list: async () =>
      (await rows(tx, sql`SELECT body FROM recruiting.job ORDER BY created_at DESC`)).map(
        (r) => r['body'] as JobRecord,
      ),
    save: async (j) => {
      await tx.execute(sql`INSERT INTO recruiting.job (tenant_id, id, state, title, slug, entity_id, openings, hired, internal_only, confidential, body, opened_at, created_at)
        VALUES (${T}, ${j.id}, ${j.state}, ${j.title}, ${j.slug}, ${j.entityId}, ${j.openings}, ${j.hired}, ${j.internalOnly}, ${j.confidential}, ${J(j)},
          ${j.openedAt}, ${j.createdAt})
        ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, title = EXCLUDED.title, entity_id = EXCLUDED.entity_id,
          openings = EXCLUDED.openings, hired = EXCLUDED.hired, internal_only = EXCLUDED.internal_only, confidential = EXCLUDED.confidential,
          body = EXCLUDED.body, opened_at = EXCLUDED.opened_at`);
      await tx.execute(sql`DELETE FROM recruiting.job_requisition WHERE job_id = ${j.id}`);
      for (const r of j.requisitionIds)
        await tx.execute(
          sql`INSERT INTO recruiting.job_requisition (tenant_id, job_id, requisition_id) VALUES (${T}, ${j.id}, ${r})`,
        );
    },
    team: async (jobId) =>
      (
        await rows(
          tx,
          sql`SELECT person_id, role FROM recruiting.job_team WHERE job_id = ${jobId} ORDER BY role, person_id`,
        )
      ).map((r) => ({ personId: String(r['person_id']), role: r['role'] as TeamRole })),
    setTeam: async (jobId, team) => {
      await tx.execute(sql`DELETE FROM recruiting.job_team WHERE job_id = ${jobId}`);
      for (const t of team)
        await tx.execute(
          sql`INSERT INTO recruiting.job_team (tenant_id, job_id, person_id, role) VALUES (${T}, ${jobId}, ${t.personId}, ${t.role}) ON CONFLICT DO NOTHING`,
        );
    },
    onTeam: async (personId) =>
      (
        await rows(
          tx,
          sql`SELECT DISTINCT job_id FROM recruiting.job_team WHERE person_id = ${personId}`,
        )
      ).map((r) => String(r['job_id'])),
    stages: async (jobId) =>
      (
        await rows(
          tx,
          sql`SELECT id, name, candidate_name, category, automations FROM recruiting.stage WHERE job_id = ${jobId} ORDER BY position`,
        )
      ).map((r): Stage => ({
        id: String(r['id']),
        name: String(r['name']),
        candidateName: str(r['candidate_name']),
        category: r['category'] as Stage['category'],
        automations: r['automations'] as Stage['automations'],
      })),
    setStages: async (jobId, stages) => {
      // Positions move out of the way first, so the unique (job, position) never collides mid-rewrite.
      await tx.execute(
        sql`UPDATE recruiting.stage SET position = position + 10000 WHERE job_id = ${jobId}`,
      );
      for (const [i, s] of stages.entries()) {
        await tx.execute(sql`INSERT INTO recruiting.stage (tenant_id, id, job_id, position, name, candidate_name, category, automations)
          VALUES (${T}, ${s.id}, ${jobId}, ${i}, ${s.name}, ${s.candidateName}, ${s.category}, ${J(s.automations)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET position = EXCLUDED.position, name = EXCLUDED.name,
            candidate_name = EXCLUDED.candidate_name, category = EXCLUDED.category, automations = EXCLUDED.automations`);
      }
      await tx.execute(
        sql`DELETE FROM recruiting.stage WHERE job_id = ${jobId} AND position >= 10000`,
      );
    },
    form: async (jobId) => {
      const r = await one(
        tx,
        sql`SELECT fields, questionnaire_id FROM recruiting.form WHERE job_id = ${jobId}`,
      );
      return r === null
        ? null
        : { fields: r['fields'] as FormField[], questionnaireId: str(r['questionnaire_id']) };
    },
    setForm: async (jobId, fields, questionnaireId) => {
      await tx.execute(sql`INSERT INTO recruiting.form (tenant_id, job_id, fields, questionnaire_id) VALUES (${T}, ${jobId}, ${J(fields)}, ${questionnaireId})
        ON CONFLICT (tenant_id, job_id) DO UPDATE SET fields = EXCLUDED.fields, questionnaire_id = EXCLUDED.questionnaire_id`);
    },
    ads: async (jobId) =>
      (
        await rows(
          tx,
          sql`SELECT job_id, language, title, doc, html, plain, checks FROM recruiting.job_ad WHERE job_id = ${jobId} ORDER BY language`,
        )
      ).map((r): JobAd => ({
        jobId: String(r['job_id']),
        language: String(r['language']),
        title: String(r['title']),
        doc: r['doc'],
        html: String(r['html']),
        plain: String(r['plain']),
        checks: r['checks'] as JobAd['checks'],
      })),
    saveAd: async (ad) => {
      await tx.execute(sql`INSERT INTO recruiting.job_ad (tenant_id, job_id, language, title, doc, html, plain, checks)
        VALUES (${T}, ${ad.jobId}, ${ad.language}, ${ad.title}, ${J(ad.doc ?? {})}, ${ad.html}, ${ad.plain}, ${J(ad.checks)})
        ON CONFLICT (tenant_id, job_id, language) DO UPDATE SET title = EXCLUDED.title, doc = EXCLUDED.doc, html = EXCLUDED.html,
          plain = EXCLUDED.plain, checks = EXCLUDED.checks`);
    },
    targets: async (jobId) =>
      (
        await rows(
          tx,
          sql`SELECT target, state, url, error, ${iso(sql`live_since`)} AS live_since, expires_on::text AS expires_on FROM recruiting.job_target WHERE job_id = ${jobId} ORDER BY target`,
        )
      ).map((r): Target => ({
        target: r['target'] as Target['target'],
        state: r['state'] as Target['state'],
        url: str(r['url']),
        error: str(r['error']),
        liveSince: str(r['live_since']),
        expiresOn: str(r['expires_on']) as CalendarDate | null,
      })),
    saveTarget: async (jobId, t) => {
      await tx.execute(sql`INSERT INTO recruiting.job_target (tenant_id, job_id, target, state, url, error, live_since, expires_on)
        VALUES (${T}, ${jobId}, ${t.target}, ${t.state}, ${t.url}, ${t.error}, ${t.liveSince}, ${t.expiresOn})
        ON CONFLICT (tenant_id, job_id, target) DO UPDATE SET state = EXCLUDED.state, url = EXCLUDED.url, error = EXCLUDED.error,
          live_since = EXCLUDED.live_since, expires_on = EXCLUDED.expires_on, updated_at = now()`);
    },
    criteria: async (jobId) =>
      (
        await rows(
          tx,
          sql`SELECT id, text, must, weight FROM recruiting.job_criterion WHERE job_id = ${jobId} ORDER BY position`,
        )
      ).map((r): Criterion => ({
        id: String(r['id']),
        text: String(r['text']),
        must: Boolean(r['must']),
        weight: Number(r['weight']),
      })),
    setCriteria: async (jobId, criteria) => {
      await tx.execute(sql`DELETE FROM recruiting.job_criterion WHERE job_id = ${jobId}`);
      for (const [i, c] of criteria.entries()) {
        await tx.execute(
          sql`INSERT INTO recruiting.job_criterion (tenant_id, id, job_id, position, text, must, weight) VALUES (${T}, ${c.id}, ${jobId}, ${i}, ${c.text}, ${c.must}, ${c.weight})`,
        );
      }
    },
    plan: async (jobId) =>
      ((await one(tx, sql`SELECT body FROM recruiting.interview_plan WHERE job_id = ${jobId}`))?.[
        'body'
      ] as PlannedInterview[] | undefined) ?? [],
    setPlan: async (jobId, plan) => {
      await tx.execute(sql`INSERT INTO recruiting.interview_plan (tenant_id, job_id, body) VALUES (${T}, ${jobId}, ${J(plan)})
        ON CONFLICT (tenant_id, job_id) DO UPDATE SET body = EXCLUDED.body`);
    },
  };
}

export function drizzleUnitOfWork(db: PostgresJsDatabase): UnitOfWork {
  return {
    run: (tenantId, fn) => withTenant(db, tenantId, (tx) => fn(storesIn(tx, tenantId))),
    tenants: async () =>
      (await rows(db, sql`SELECT tenant_id, slug FROM recruiting.tenant ORDER BY tenant_id`)).map(
        (r) => ({ tenantId: r['tenant_id'] as TenantId, slug: str(r['slug']) }),
      ),
    tenantBySlug: async (slug) =>
      (str(
        (await one(db, sql`SELECT tenant_id FROM recruiting.tenant WHERE slug = ${slug}`))?.[
          'tenant_id'
        ],
      ) as TenantId | null) ?? null,
  };
}

/** Recruiting's pool, as `svc_recruiting`, closed on SIGTERM; null without a URL. */
export function recruitingDatabase(
  env: NodeJS.ProcessEnv = process.env,
): PostgresJsDatabase | null {
  const url = env['RECRUITING_DATABASE_URL'];
  if (!url) {
    logger.info({ module: 'recruiting' }, 'RECRUITING_DATABASE_URL unset; no storage');
    return null;
  }
  const client = postgres(url, { max: 10 });
  onShutdown('recruiting database', () => client.end({ timeout: 5 }));
  return drizzle(client);
}
