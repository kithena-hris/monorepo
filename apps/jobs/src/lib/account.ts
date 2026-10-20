import 'server-only';

import type { CandidatePage } from '@kithena/contracts';
import { cookies } from 'next/headers';

import { publicCall, type Answer } from './api';

/**
 * The candidate's account on this site (PRD §10.5, extended): one across
 * every company. The session is a cookie on this host; Recruiting holds the
 * account and hands out, per company that knows the address, a short-lived
 * candidate token for that company's own page, so every company flow stays
 * the company's.
 */

export const SESSION_COOKIE = 'kj_session';

const base = () =>
  (process.env['RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(/\/$/u, '');

export interface AccountHome {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly google: boolean;
  readonly pictureUrl: string | null;
  readonly consentedAt: string | null;
  readonly cvs: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly mediaType: string;
    readonly size: number;
    readonly isDefault: boolean;
    readonly uploadedAt: string;
  }[];
  readonly companies: readonly {
    readonly slug: string;
    readonly name: string;
    readonly token: string;
  }[];
}

export async function sessionToken(): Promise<string> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? '';
}

/** One of the account routes, as this server, with the session's token. */
export async function accountCall<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; token?: string } = {},
): Promise<Answer<T>> {
  const token = options.token ?? (await sessionToken());
  let response: Response;
  try {
    response = await fetch(`${base()}/v1/recruiting/public/accounts${path}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(token === '' ? {} : { 'x-account-token': token }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    return { ok: false, status: 503, message: 'Kithena Jobs is not reachable right now.' };
  }
  const body = (await response.json().catch(() => null)) as
    { error?: { message?: string } } | T | null;
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      message:
        (body as { error?: { message?: string } } | null)?.error?.message ?? 'Something went wrong',
    };
  return { ok: true, data: body as T };
}

/** The signed-in account, or null when there is no session or it has ended. */
export async function me(): Promise<AccountHome | null> {
  if ((await sessionToken()) === '') return null;
  const answer = await accountCall<AccountHome>('/me');
  return answer.ok ? answer.data : null;
}

/** Each company's own page for this account, by the token Recruiting minted for it. */
export async function applicationsOf(home: AccountHome): Promise<
  readonly {
    readonly company: AccountHome['companies'][number];
    readonly page: CandidatePage | null;
  }[]
> {
  return Promise.all(
    home.companies.map(async (company) => {
      const answer = await publicCall<CandidatePage>(company.slug, '/me', { token: company.token });
      return { company, page: answer.ok ? answer.data : null };
    }),
  );
}
