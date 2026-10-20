import * as z from 'zod';
import { failure, type Result } from '@kithena/domain-kit';

import {
  CvDraft,
  accountByToken,
  accountHome,
  addCv,
  cvFile,
  cvFromDraft,
  draftCv,
  removeCv,
  renameAccount,
  requestAccountCode,
  setAccountConsent,
  setDefaultCv,
  signInWithCode,
  signInWithGoogle,
  signOut,
  type AccountDeps,
} from '../application/accounts.js';
import { renderCv } from '../infrastructure/cv-pdf.js';

/**
 * Candidate accounts' routes, outside the route table because they have no
 * tenant (PRD §10.5, extended): `/v1/recruiting/public/accounts/*`. The
 * session token travels in `x-account-token`, never in a URL.
 */

export interface AccountsAnswer {
  readonly status: number;
  readonly body: unknown;
}

const PREFIX = '/v1/recruiting/public/accounts';
const Email = z.email().max(320);
const Code = z.string().regex(/^\d{6}$/u);
const Upload = z.object({
  fileName: z.string().min(1).max(200),
  mediaType: z.string().max(120),
  /** Base64; the bytes are checked against 10 MB. */
  base64: z.string().max(14_000_000),
  makeDefault: z.boolean().optional(),
});

const STATUS: Readonly<Record<string, number>> = {
  INVALID: 400,
  NOT_FOUND: 404,
  CODE_EXPIRED: 410,
  CODE_WRONG: 401,
  CODE_ATTEMPTS: 429,
  GOOGLE_OFF: 503,
  GOOGLE_REFUSED: 401,
  FILE_TYPE: 415,
  FILE_SIZE: 413,
  CV_LIMIT: 409,
  UNAUTHENTICATED: 401,
  AI_OFF: 503,
  AI_UNAVAILABLE: 503,
};

const answer = <T>(result: Result<T>, status = 200): AccountsAnswer =>
  result.ok
    ? { status, body: result.value }
    : {
        status: STATUS[result.error.code] ?? 400,
        body: { error: { code: result.error.code, message: result.error.message } },
      };
const refused = (code: string, message: string): AccountsAnswer =>
  answer({ ok: false, error: failure(code, message) });

function parsed<T>(schema: z.ZodType<T>, body: string | null): T | null {
  try {
    const result = schema.safeParse(JSON.parse(body ?? 'null'));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Null when the path is not one of the account routes. */
export async function accountsAnswer(
  d: AccountDeps,
  method: string,
  url: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  body: string | null,
): Promise<AccountsAnswer | null> {
  const at = new URL(url, 'http://recruiting');
  if (!at.pathname.startsWith(`${PREFIX}/`) && at.pathname !== PREFIX) return null;
  const path = at.pathname.slice(PREFIX.length);
  const raw = headers['x-account-token'];
  const token = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');

  if (method === 'POST' && path === '/code') {
    const input = parsed(z.object({ email: Email, name: z.string().max(200).default('') }), body);
    if (input === null) return refused('INVALID', 'Check the address');
    return answer(await requestAccountCode(d, input.email, input.name));
  }
  if (method === 'POST' && path === '/sign-in') {
    const input = parsed(z.object({ email: Email, code: Code }), body);
    if (input === null) return refused('INVALID', 'Check the code');
    return answer(await signInWithCode(d, input.email, input.code));
  }
  if (method === 'POST' && path === '/google') {
    const input = parsed(z.object({ idToken: z.string().min(20).max(4000) }), body);
    if (input === null) return refused('INVALID', 'No token');
    return answer(await signInWithGoogle(d, input.idToken));
  }

  // Everything below is the account's own.
  const account = await accountByToken(d, token);
  if (account === null) return refused('UNAUTHENTICATED', 'Sign in again');

  if (method === 'POST' && path === '/sign-out') {
    await signOut(d, token);
    return { status: 200, body: { ok: true } };
  }
  if (method === 'GET' && path === '/me')
    return { status: 200, body: await accountHome(d, account) };
  if (method === 'POST' && path === '/name') {
    const input = parsed(z.object({ name: z.string().max(200) }), body);
    if (input === null) return refused('INVALID', 'Check the name');
    return answer(await renameAccount(d, account, input.name));
  }
  if (method === 'POST' && path === '/consent') {
    const input = parsed(z.object({ given: z.boolean(), notice: z.string().max(1000) }), body);
    if (input === null) return refused('INVALID', 'Check the consent');
    return answer(await setAccountConsent(d, account, input.given, input.notice));
  }
  if (method === 'POST' && path === '/cvs') {
    const input = parsed(Upload, body);
    if (input === null) return refused('INVALID', 'Check the file');
    return answer(
      await addCv(
        d,
        account,
        {
          fileName: input.fileName,
          mediaType: input.mediaType,
          bytes: Buffer.from(input.base64, 'base64'),
        },
        input.makeDefault ?? false,
      ),
      201,
    );
  }
  // The CV writer: a draft from what they said, and the edited draft kept as a PDF.
  if (method === 'POST' && path === '/cv-draft') {
    const input = parsed(
      z.object({
        targetRole: z.string().max(200).default(''),
        about: z.string().max(4000).default(''),
        experience: z.string().max(8000).default(''),
        education: z.string().max(3000).default(''),
        skills: z.string().max(2000).default(''),
        languages: z.string().max(500).default(''),
        location: z.string().max(120).default(''),
        phone: z.string().max(40).default(''),
      }),
      body,
    );
    if (input === null) return refused('INVALID', 'Check what you wrote');
    return answer(await draftCv(d, account, input));
  }
  if (method === 'POST' && path === '/cvs/from-draft') {
    const input = parsed(CvDraft, body);
    if (input === null) return refused('INVALID', 'Check the CV');
    return answer(await cvFromDraft(d, account, input, renderCv), 201);
  }
  const cv = /^\/cvs\/([0-9a-f-]{36})(\/default|\/file)?$/u.exec(path);
  if (cv !== null && method === 'GET' && cv[2] === '/file') {
    const file = await cvFile(d, account, cv[1] ?? '');
    return answer(
      file.ok
        ? {
            ok: true,
            value: {
              fileName: file.value.fileName,
              mediaType: file.value.mediaType,
              base64: Buffer.from(file.value.bytes).toString('base64'),
            },
          }
        : file,
    );
  }
  if (cv !== null && method === 'POST' && cv[2] === '/default')
    return answer(await setDefaultCv(d, account, cv[1] ?? ''));
  if (cv !== null && method === 'DELETE' && cv[2] === undefined)
    return answer(await removeCv(d, account, cv[1] ?? ''));
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
}
