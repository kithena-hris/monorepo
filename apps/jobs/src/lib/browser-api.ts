import { t } from './i18n';

/**
 * The public API from the browser (REC-093, REC-094): the apply form and the
 * candidate's own pages call Recruiting directly, because a CV is up to 10 MB
 * and a serverless function relays less. The token comes from the address's
 * fragment, which no server ever sees, and travels in a header.
 */

const base = () =>
  (process.env['NEXT_PUBLIC_RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(/\/$/u, '');

export type Answer<T> = { ok: true; data: T } | { ok: false; message: string };

/** The account's session token, from its cookie on this host; empty when signed out. */
export const accountToken = (): string => {
  if (typeof document === 'undefined') return '';
  const found = document.cookie.split('; ').find((c) => c.startsWith('kj_session='));
  return found === undefined ? '' : decodeURIComponent(found.slice('kj_session='.length));
};

export async function publicApi<T>(
  company: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<Answer<T>> {
  try {
    const account = accountToken();
    const response = await fetch(
      `${base()}/v1/recruiting/public/${encodeURIComponent(company)}${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.token === undefined ? {} : { 'x-candidate-token': options.token }),
          ...(account === '' ? {} : { 'x-account-token': account }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return response.ok
      ? { ok: true, data: body as T }
      : {
          ok: false,
          message:
            body?.error?.message ??
            t('lib.browser-api.that_did_not_go_through_try', 'That did not go through. Try again.'),
        };
  } catch {
    return {
      ok: false,
      message: t(
        'lib.browser-api.kithena_jobs_is_not_reachable_right',
        'Kithena Jobs is not reachable right now. Try again in a moment.',
      ),
    };
  }
}

/** One of the account's own routes, from the browser (a CV is up to 10 MB). */
export async function accountApi<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {},
): Promise<Answer<T>> {
  try {
    const response = await fetch(`${base()}/v1/recruiting/public/accounts${path}`, {
      method: options.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-account-token': accountToken() },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return response.ok
      ? { ok: true, data: body as T }
      : {
          ok: false,
          message:
            body?.error?.message ??
            t('lib.browser-api.that_did_not_go_through_try', 'That did not go through. Try again.'),
        };
  } catch {
    return {
      ok: false,
      message: t(
        'lib.browser-api.kithena_jobs_is_not_reachable_right',
        'Kithena Jobs is not reachable right now. Try again in a moment.',
      ),
    };
  }
}

/** A file as the public API takes it: base64, with the field it answers. */
export async function asUpload(
  field: string,
  file: File,
): Promise<{ field: string; fileName: string; mediaType: string; base64: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    field,
    fileName: file.name,
    mediaType: file.type || 'application/octet-stream',
    base64: btoa(binary),
  };
}

/** The candidate's token, from `#token`: never in a URL a server logs. */
export const tokenFromHash = (): string =>
  typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.replace(/^#/u, ''));

/** J8 on search: a sentence turned into the search's own filters, and what the AI understood, or null. */
export async function planSearch(
  sentence: string,
): Promise<{ readonly filters: Record<string, unknown>; readonly say: string } | null> {
  try {
    const response = await fetch(`${base()}/v1/recruiting/public/search-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentence }),
    });
    if (!response.ok) return null;
    const plan = (await response.json()) as { filters?: unknown; say?: unknown };
    return typeof plan.filters === 'object' && plan.filters !== null
      ? {
          filters: plan.filters as Record<string, unknown>,
          say: typeof plan.say === 'string' ? plan.say : '',
        }
      : null;
  } catch {
    return null;
  }
}
