import * as z from 'zod';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { TenantId, type Instant } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { normalEmail } from '../domain/candidate/duplicates.js';
import type {
  Accounts,
  CandidateAccount,
  CandidateCv,
  Deps,
  GoogleIdentity,
  IncomingUpload,
} from './ports.js';

/**
 * A candidate's account on Kithena Jobs (PRD §10.5, extended): one across
 * every company. It proves an email address, by a six-digit code or by
 * Google vouching for it, and keeps what is the candidate's own: a name, a
 * consent to keep their data, and a library of CVs with one as the default.
 *
 * It copies nothing a company holds. "My applications" is each company's own
 * candidate page, opened with a candidate token minted for the account's
 * email in that company, so every company flow (an offer, a withdrawal, a
 * pool consent, an export) stays the company's and under its own rules.
 *
 * No tenant: these run outside the route table, over `recruiting_public`.
 */

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 90;
/** Account mail has no company behind it; messaging records it under the nil tenant. */
const PLATFORM_TENANT = TenantId.parse('00000000-0000-0000-0000-000000000000');
const CV_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
]);
const MAX_CV_BYTES = 10 * 1024 * 1024;
const MAX_CVS = 5;

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export interface AccountDeps {
  readonly accounts: Accounts;
  readonly deps: Deps;
  readonly at: Instant;
}

const freshAccount = (d: AccountDeps, email: string, name: string): CandidateAccount => ({
  id: d.deps.newId(),
  email,
  emailNorm: normalEmail(email),
  name: name.trim().slice(0, 200),
  googleSub: null,
  pictureUrl: null,
  consentedAt: null,
  consentNotice: null,
  codeHash: null,
  codeExpiresAt: null,
  codeAttempts: 0,
  createdAt: d.at,
  lastSeenAt: d.at,
});

/** Email a code that signs in, making the account if there is none. The same answer whether or not one existed. */
export async function requestAccountCode(
  d: AccountDeps,
  email: string,
  name: string,
): Promise<Result<{ sent: true; code?: string }>> {
  const held = (await d.accounts.byEmail(normalEmail(email))) ?? freshAccount(d, email, name);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await d.accounts.save({
    ...held,
    name: held.name === '' ? name.trim().slice(0, 200) : held.name,
    codeHash: sha256(code),
    codeExpiresAt: new Date(Date.parse(d.at) + CODE_MINUTES * 60_000).toISOString() as Instant,
    codeAttempts: 0,
  });
  if (d.deps.mailer === undefined) return ok({ sent: true, code });
  await d.deps.mailer.send({
    tenantId: PLATFORM_TENANT,
    to: email,
    subject: `${code} is your Kithena Jobs code`,
    text: `Hello ${held.name || name},\n\nYour code to sign in to Kithena Jobs is ${code}. It works for ${String(CODE_MINUTES)} minutes.\n\nIf you did not ask for it, ignore this email.`,
    replyTo: null,
    dedupeKey: `account-code:${normalEmail(email)}:${d.at}`,
  });
  return ok({ sent: true });
}

export interface Session {
  readonly token: string;
  readonly expiresAt: Instant;
}

async function startSession(d: AccountDeps, account: CandidateAccount): Promise<Session> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.parse(d.at) + SESSION_DAYS * 86_400_000).toISOString() as Instant;
  await d.accounts.putSession(sha256(token), account.id, expiresAt);
  await d.accounts.save({ ...account, codeHash: null, codeExpiresAt: null, lastSeenAt: d.at });
  return { token, expiresAt };
}

/** The code, against the account's: a session when it is right, a refusal that says why when not. */
export async function signInWithCode(
  d: AccountDeps,
  email: string,
  code: string,
): Promise<Result<Session>> {
  const account = await d.accounts.byEmail(normalEmail(email));
  if (account?.codeHash == null || account.codeExpiresAt === null)
    return err(failure('CODE_EXPIRED', 'Ask for a new code'));
  if (account.codeExpiresAt < d.at) return err(failure('CODE_EXPIRED', 'Ask for a new code'));
  if (account.codeAttempts >= MAX_ATTEMPTS)
    return err(failure('CODE_ATTEMPTS', 'Too many tries; ask for a new code'));
  if (!timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(account.codeHash))) {
    await d.accounts.save({ ...account, codeAttempts: account.codeAttempts + 1 });
    return err(failure('CODE_WRONG', 'That code is not right'));
  }
  return ok(await startSession(d, account));
}

/**
 * Google vouches for the address: the token is checked against Google and
 * this site's client id by `verifyGoogle`. The first time, an account under
 * that address is linked by its `sub`; after that the `sub` is what it is.
 */
export async function signInWithGoogle(d: AccountDeps, idToken: string): Promise<Result<Session>> {
  if (d.deps.verifyGoogle === undefined)
    return err(failure('GOOGLE_OFF', 'Signing in with Google is not set up here'));
  const identity: GoogleIdentity | null = await d.deps.verifyGoogle(idToken);
  if (identity === null || !identity.emailVerified)
    return err(failure('GOOGLE_REFUSED', 'Google did not vouch for that account'));
  const bySub = await d.accounts.byGoogleSub(identity.sub);
  const account =
    bySub ??
    (await d.accounts.byEmail(normalEmail(identity.email))) ??
    freshAccount(d, identity.email, identity.name ?? identity.email.split('@')[0] ?? '');
  const linked: CandidateAccount = {
    ...account,
    googleSub: identity.sub,
    pictureUrl: identity.picture ?? account.pictureUrl,
  };
  await d.accounts.save(linked);
  return ok(await startSession(d, linked));
}

export async function signOut(d: AccountDeps, token: string): Promise<void> {
  await d.accounts.endSession(sha256(token));
}

export async function accountByToken(
  d: AccountDeps,
  token: string,
): Promise<CandidateAccount | null> {
  if (token === '') return null;
  return d.accounts.bySession(sha256(token), d.at);
}

export interface AccountHome {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly google: boolean;
  readonly pictureUrl: string | null;
  readonly consentedAt: Instant | null;
  readonly cvs: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly mediaType: string;
    readonly size: number;
    readonly isDefault: boolean;
    readonly uploadedAt: Instant;
  }[];
  /** Every company that knows this address, with a candidate token good for an hour there. */
  readonly companies: readonly {
    readonly slug: string;
    readonly name: string;
    readonly token: string;
  }[];
}

/**
 * The account's home: who they are, their CVs, and each company where the
 * address has applied, with a short-lived candidate token for that company's
 * own page. Every tenant is asked; nothing about a company is kept here.
 */
export async function accountHome(d: AccountDeps, account: CandidateAccount): Promise<AccountHome> {
  const companies: { slug: string; name: string; token: string }[] = [];
  // ponytail: one query per tenant on every load; a projection of (email, tenant) when tenants are many.
  for (const tenant of await d.deps.uow.tenants()) {
    if (tenant.slug === null) continue;
    const found = await d.deps.uow.run(tenant.tenantId, async (tx) => {
      const candidate = await tx.candidates.byEmail(account.emailNorm);
      if (candidate === null || candidate.mergedInto !== null || candidate.anonymisedAt !== null)
        return null;
      // The company's name as its settings hold it; the slug when it never set one.
      const held = await tx.settings.get('general');
      const companyName =
        typeof held === 'object' && held !== null && 'companyName' in held
          ? String(held.companyName)
          : (tenant.slug ?? '');
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(Date.parse(d.at) + 3_600_000).toISOString() as Instant;
      await tx.tokens.put(sha256(token), candidate.id, expires);
      return { slug: tenant.slug ?? '', name: companyName, token };
    });
    if (found !== null) companies.push(found);
  }
  const cvs = await d.accounts.cvs(account.id);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    google: account.googleSub !== null,
    pictureUrl: account.pictureUrl,
    consentedAt: account.consentedAt,
    cvs: cvs.map((c) => ({
      id: c.id,
      fileName: c.fileName,
      mediaType: c.mediaType,
      size: c.size,
      isDefault: c.isDefault,
      uploadedAt: c.uploadedAt,
    })),
    companies,
  };
}

/** "Keep my data to apply faster", given or taken back; the notice shown is kept with it. */
export async function setAccountConsent(
  d: AccountDeps,
  account: CandidateAccount,
  given: boolean,
  notice: string,
): Promise<Result<CandidateAccount>> {
  const next: CandidateAccount = given
    ? { ...account, consentedAt: d.at, consentNotice: notice.slice(0, 1000) }
    : { ...account, consentedAt: null, consentNotice: null };
  await d.accounts.save(next);
  return ok(next);
}

export async function renameAccount(
  d: AccountDeps,
  account: CandidateAccount,
  name: string,
): Promise<Result<CandidateAccount>> {
  if (name.trim() === '') return err(failure('INVALID', 'A name is needed'));
  const next = { ...account, name: name.trim().slice(0, 200) };
  await d.accounts.save(next);
  return ok(next);
}

/** A CV into the library; the first one is the default, and `makeDefault` moves it. */
export async function addCv(
  d: AccountDeps,
  account: CandidateAccount,
  file: IncomingUpload,
  makeDefault: boolean,
): Promise<Result<CandidateCv>> {
  if (!CV_TYPES.has(file.mediaType))
    return err(failure('FILE_TYPE', 'A CV is a PDF, Word, OpenDocument or RTF file'));
  if (file.bytes.length === 0 || file.bytes.length > MAX_CV_BYTES)
    return err(failure('FILE_SIZE', 'A CV is up to 10 MB'));
  const held = await d.accounts.cvs(account.id);
  if (held.length >= MAX_CVS)
    return err(failure('CV_LIMIT', `Keep up to ${String(MAX_CVS)} CVs; remove one first`));
  const id = d.deps.newId();
  const blobKey = `account/${account.id}/${id}`;
  await d.deps.blobs.put(blobKey, file.bytes, file.mediaType);
  const cv: CandidateCv = {
    id,
    accountId: account.id,
    fileName: file.fileName.slice(0, 200),
    mediaType: file.mediaType,
    blobKey,
    size: file.bytes.length,
    isDefault: makeDefault || held.length === 0,
    uploadedAt: d.at,
  };
  await d.accounts.saveCv(cv);
  if (cv.isDefault) await d.accounts.setDefaultCv(account.id, id);
  return ok(cv);
}

export async function setDefaultCv(
  d: AccountDeps,
  account: CandidateAccount,
  cvId: string,
): Promise<Result<true>> {
  const held = (await d.accounts.cvs(account.id)).find((c) => c.id === cvId);
  if (held === undefined) return err(failure('NOT_FOUND', 'No such CV'));
  await d.accounts.setDefaultCv(account.id, cvId);
  return ok(true);
}

/** Out of the library; what was sent with an application stays with that application. */
export async function removeCv(
  d: AccountDeps,
  account: CandidateAccount,
  cvId: string,
): Promise<Result<true>> {
  const all = await d.accounts.cvs(account.id);
  const held = all.find((c) => c.id === cvId);
  if (held === undefined) return err(failure('NOT_FOUND', 'No such CV'));
  await d.accounts.removeCv(cvId);
  if (held.isDefault) {
    const next = all.find((c) => c.id !== cvId);
    if (next !== undefined) await d.accounts.setDefaultCv(account.id, next.id);
  }
  return ok(true);
}

/** The default CV's bytes, for applying without attaching one. */
export async function defaultCv(
  d: AccountDeps,
  account: CandidateAccount,
): Promise<(CandidateCv & { readonly bytes: Uint8Array }) | null> {
  const cv = (await d.accounts.cvs(account.id)).find((c) => c.isDefault);
  if (cv === undefined) return null;
  const bytes = await d.deps.blobs.get(cv.blobKey);
  return bytes === null ? null : { ...cv, bytes };
}

/** One of the account's CVs with its bytes: to open or download again. */
export async function cvFile(
  d: AccountDeps,
  account: CandidateAccount,
  cvId: string,
): Promise<Result<CandidateCv & { readonly bytes: Uint8Array }>> {
  const cv = (await d.accounts.cvs(account.id)).find((c) => c.id === cvId);
  const bytes = cv === undefined ? null : await d.deps.blobs.get(cv.blobKey);
  return cv === undefined || bytes === null
    ? err(failure('NOT_FOUND', 'No such CV'))
    : ok({ ...cv, bytes });
}

/** Google's answer to an ID token, checked against this site's client id: who they are, or null. */
export function googleVerifier(
  clientId: string,
): (idToken: string) => Promise<GoogleIdentity | null> {
  return async (idToken) => {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return null;
      const claims = (await response.json()) as Record<string, unknown>;
      if (claims['aud'] !== clientId || typeof claims['sub'] !== 'string') return null;
      if (typeof claims['email'] !== 'string') return null;
      return {
        sub: claims['sub'],
        email: claims['email'],
        emailVerified: claims['email_verified'] === 'true' || claims['email_verified'] === true,
        name: typeof claims['name'] === 'string' ? claims['name'] : null,
        picture: typeof claims['picture'] === 'string' ? claims['picture'] : null,
      };
    } catch {
      return null;
    }
  };
}

/* ------------------------------------------------------- the CV writer -- */

/**
 * A CV written from scratch (the candidate asked for it): the person says
 * what they have done in their own words, the model lays it out as a CV, the
 * person edits every line, and only then is it kept as a PDF in their
 * library. The model sees what the candidate typed here and nothing else; it
 * assesses nobody.
 */

const CvEntry = z.object({
  title: z.string().max(120),
  organisation: z.string().max(160),
  from: z.string().max(20),
  to: z.string().max(20),
  bullets: z.array(z.string().max(300)).max(8),
});
export const CvDraft = z.object({
  name: z.string().max(200),
  headline: z.string().max(160),
  location: z.string().max(120).nullable(),
  email: z.string().max(320),
  phone: z.string().max(40).nullable(),
  summary: z.string().max(1200),
  experience: z.array(CvEntry).max(10),
  education: z.array(CvEntry).max(6),
  skills: z.array(z.string().max(60)).max(30),
  languages: z.array(z.string().max(60)).max(10),
});
export type CvDraft = z.infer<typeof CvDraft>;

const WRITE_CV = `You write a candidate's CV from what they tell you about themselves. Return a JSON object {"name":"","headline":"","location":""|null,"email":"","phone":""|null,"summary":"","experience":[{"title":"","organisation":"","from":"","to":"","bullets":[""]}],"education":[{"title":"","organisation":"","from":"","to":"","bullets":[]}],"skills":[""],"languages":[""]}.
Use only what they said: never invent an employer, a date, a degree or a number; where something is missing leave it blank or out. Dates as the person gave them ("2021", "Mar 2023", "now"). The summary is three or four plain sentences in the first person, specific, no clichés. Each experience bullet starts with a verb and says what was done and, where they said so, what it led to. Keep their wording where it is good. Write in the language they wrote in.`;

export interface CvAnswers {
  readonly targetRole: string;
  readonly about: string;
  readonly experience: string;
  readonly education: string;
  readonly skills: string;
  readonly languages: string;
  readonly location: string;
  readonly phone: string;
}

export async function draftCv(
  d: AccountDeps,
  account: CandidateAccount,
  answers: CvAnswers,
): Promise<Result<CvDraft>> {
  const model = d.deps.model;
  if (model === undefined) return err(failure('AI_OFF', 'Writing a CV with AI is not set up here'));
  if (answers.experience.trim().length < 20 && answers.about.trim().length < 20)
    return err(failure('INVALID', 'Say a little more about what you have done'));
  const raw = await model.complete('kithena-jobs', {
    instruction: WRITE_CV,
    context: {
      name: account.name,
      email: account.email,
      ...answers,
    },
  });
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const draft = CvDraft.safeParse(parsed);
  if (!draft.success)
    return err(failure('AI_UNAVAILABLE', 'The writer could not draft this just now'));
  return ok({ ...draft.data, name: account.name, email: account.email });
}

/** The edited draft as a PDF in the library, the default when there was none. */
export async function cvFromDraft(
  d: AccountDeps,
  account: CandidateAccount,
  draft: CvDraft,
  render: (draft: CvDraft) => Promise<Uint8Array>,
): Promise<Result<CandidateCv>> {
  const bytes = await render(draft);
  const stem =
    draft.name
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'cv';
  return addCv(
    d,
    account,
    { fileName: `${stem}-cv.pdf`, mediaType: 'application/pdf', bytes },
    false,
  );
}
