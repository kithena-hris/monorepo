import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, type SQL } from 'drizzle-orm';
import type { Instant } from '@kithena/contracts';

import type { Accounts, CandidateAccount, CandidateCv } from '../application/ports.js';

/**
 * Candidate accounts over `recruiting_public` (PRD §10.5, extended), as
 * `svc_recruiting`: no tenant, so no RLS; the rows hold an email, a name and
 * a CV library, never anything a company knows.
 */

type Row = Record<string, unknown>;
const rows = async (db: PostgresJsDatabase, query: SQL): Promise<Row[]> => [
  ...(await db.execute<Row>(query)),
];
const one = async (db: PostgresJsDatabase, query: SQL): Promise<Row | null> =>
  (await rows(db, query))[0] ?? null;
const iso = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : null;

const ACCOUNT = sql`id, email_norm, email, name, google_sub, consent_notice, code_hash, code_attempts,
  ${iso(sql`consented_at`)} AS consented_at, ${iso(sql`code_expires_at`)} AS code_expires_at,
  ${iso(sql`created_at`)} AS created_at, ${iso(sql`last_seen_at`)} AS last_seen_at`;

const accountOf = (r: Row): CandidateAccount => ({
  id: String(r['id']),
  emailNorm: String(r['email_norm']),
  email: String(r['email']),
  name: String(r['name']),
  googleSub: str(r['google_sub']),
  consentedAt: str(r['consented_at']) as Instant | null,
  consentNotice: str(r['consent_notice']),
  codeHash: str(r['code_hash']),
  codeExpiresAt: str(r['code_expires_at']) as Instant | null,
  codeAttempts: Number(r['code_attempts'] ?? 0),
  createdAt: String(r['created_at']) as Instant,
  lastSeenAt: String(r['last_seen_at']) as Instant,
});

const cvOf = (r: Row): CandidateCv => ({
  id: String(r['id']),
  accountId: String(r['account_id']),
  fileName: String(r['file_name']),
  mediaType: String(r['media_type']),
  blobKey: String(r['blob_key']),
  size: Number(r['size']),
  isDefault: r['is_default'] === true,
  uploadedAt: String(r['uploaded_at']) as Instant,
});

export function postgresAccounts(db: PostgresJsDatabase): Accounts {
  const account = async (where: SQL): Promise<CandidateAccount | null> => {
    const r = await one(
      db,
      sql`SELECT ${ACCOUNT} FROM recruiting_public.candidate_account WHERE ${where}`,
    );
    return r === null ? null : accountOf(r);
  };
  return {
    byEmail: (emailNorm) => account(sql`email_norm = ${emailNorm}`),
    byGoogleSub: (sub) => account(sql`google_sub = ${sub}`),
    async save(a) {
      await db.execute(sql`INSERT INTO recruiting_public.candidate_account
          (id, email_norm, email, name, google_sub, consented_at, consent_notice, code_hash, code_expires_at, code_attempts, created_at, last_seen_at)
        VALUES (${a.id}, ${a.emailNorm}, ${a.email}, ${a.name}, ${a.googleSub}, ${a.consentedAt}, ${a.consentNotice},
          ${a.codeHash}, ${a.codeExpiresAt}, ${a.codeAttempts}, ${a.createdAt}, ${a.lastSeenAt})
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, google_sub = EXCLUDED.google_sub,
          consented_at = EXCLUDED.consented_at, consent_notice = EXCLUDED.consent_notice, code_hash = EXCLUDED.code_hash,
          code_expires_at = EXCLUDED.code_expires_at, code_attempts = EXCLUDED.code_attempts, last_seen_at = EXCLUDED.last_seen_at`);
    },
    async putSession(tokenHash, accountId, expiresAt) {
      await db.execute(sql`INSERT INTO recruiting_public.candidate_session (token_hash, account_id, expires_at)
        VALUES (${tokenHash}, ${accountId}, ${expiresAt})`);
    },
    async bySession(tokenHash, now) {
      const r = await one(
        db,
        sql`SELECT ${ACCOUNT} FROM recruiting_public.candidate_account a
          WHERE a.id = (SELECT account_id FROM recruiting_public.candidate_session WHERE token_hash = ${tokenHash} AND expires_at > ${now})`,
      );
      return r === null ? null : accountOf(r);
    },
    async endSession(tokenHash) {
      await db.execute(
        sql`DELETE FROM recruiting_public.candidate_session WHERE token_hash = ${tokenHash}`,
      );
    },
    async cvs(accountId) {
      return (
        await rows(
          db,
          sql`SELECT id, account_id, file_name, media_type, blob_key, size, is_default, ${iso(sql`uploaded_at`)} AS uploaded_at
            FROM recruiting_public.candidate_cv WHERE account_id = ${accountId} ORDER BY is_default DESC, uploaded_at DESC`,
        )
      ).map(cvOf);
    },
    async saveCv(cv) {
      await db.execute(sql`INSERT INTO recruiting_public.candidate_cv (id, account_id, file_name, media_type, blob_key, size, is_default, uploaded_at)
        VALUES (${cv.id}, ${cv.accountId}, ${cv.fileName}, ${cv.mediaType}, ${cv.blobKey}, ${cv.size}, ${cv.isDefault}, ${cv.uploadedAt})
        ON CONFLICT (id) DO UPDATE SET file_name = EXCLUDED.file_name, is_default = EXCLUDED.is_default`);
    },
    async setDefaultCv(accountId, cvId) {
      await db.execute(
        sql`UPDATE recruiting_public.candidate_cv SET is_default = (id = ${cvId}) WHERE account_id = ${accountId}`,
      );
    },
    async removeCv(cvId) {
      await db.execute(sql`DELETE FROM recruiting_public.candidate_cv WHERE id = ${cvId}`);
    },
  };
}
