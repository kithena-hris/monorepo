'use server';

import { headers } from 'next/headers';

import { currentTenant } from '../../../lib/branding';
import { serverWords } from '../../../lib/server-words';

/**
 * An outside signer's page (Documents K4–K6, X7): Documents' public routes,
 * reached with the link's token and nothing else. The token names its tenant;
 * the company host this page is on must be that tenant, or nothing is sent.
 */

const base = () =>
  (process.env['DOCUMENTS_PUBLIC_URL'] ?? 'http://localhost:4003').replace(/\/$/u, '');

type Answer<T> = { ok: true; data: T } | { ok: false; message: string };

async function here(token: string): Promise<{ origin: string; companyName: string } | null> {
  const inbound = await headers();
  if (inbound.get('x-tenant-id') !== token.split('.')[0]) return null;
  const host = inbound.get('x-forwarded-host') ?? inbound.get('host') ?? '';
  const proto =
    inbound.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const tenant = await currentTenant();
  return {
    origin: `${proto}://${host}`,
    companyName: tenant?.branding.displayName ?? tenant?.slug ?? host,
  };
}

export async function call<T>(token: string, path: string, body?: unknown): Promise<Answer<T>> {
  const t = await serverWords();
  const at = await here(token);
  if (at === null)
    return {
      ok: false,
      message: t(
        'app.sign.token.actions.this_link_is_for_another_company',
        'This link is for another company.',
      ),
    };
  const response = await fetch(`${base()}/v1/documents/sign/${encodeURIComponent(token)}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify({ ...(body as object), ...at }) }),
    cache: 'no-store',
  }).catch(() => null);
  if (response === null)
    return {
      ok: false,
      message: t(
        'app.sign.token.actions.kithena_could_not_be_reached_try_again',
        'Kithena could not be reached. Try again.',
      ),
    };
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok || json === null)
    return {
      ok: false,
      message:
        json?.error?.message ?? t('app.sign.token.actions.that_did_not_work', 'That did not work.'),
    };
  return { ok: true, data: json as T };
}

export async function requestCode(token: string): Promise<Answer<{ sentTo: string }>> {
  return call<{ sentTo: string }>(token, '/code', {});
}

export async function verifyCode(
  token: string,
  code: string,
): Promise<{ ok: true; verified: boolean } | { ok: false; message: string }> {
  const t = await serverWords();
  const at = await here(token);
  if (at === null)
    return {
      ok: false as const,
      message: t(
        'app.sign.token.actions.this_link_is_for_another_company',
        'This link is for another company.',
      ),
    };
  const response = await fetch(`${base()}/v1/documents/sign/${encodeURIComponent(token)}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    cache: 'no-store',
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as {
    verified?: boolean;
    error?: { message?: string };
  } | null;
  if (response?.ok !== true || json === null)
    return {
      ok: false as const,
      message:
        json?.error?.message ?? t('app.sign.token.actions.that_did_not_work', 'That did not work.'),
    };
  return { ok: true as const, verified: json.verified === true };
}

export async function signLink(
  token: string,
  signature:
    | { kind: 'typed'; text: string; style?: 'flowing' | 'light' | 'bold' }
    | { kind: 'drawn'; path: string },
  values: Readonly<Record<string, string>>,
  /** The signer's own day, from their browser: this runs on the server, whose day may differ. */
  day: string,
  /** The Signature ID their screen printed under each box as it was filled. */
  traceId: string,
): Promise<Answer<{ completed: boolean; next: readonly string[] }>> {
  return call<{ completed: boolean; next: readonly string[] }>(token, '/sign', {
    signature,
    values,
    day,
    traceId,
  });
}

export async function declineLink(
  token: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const t = await serverWords();
  const at = await here(token);
  if (at === null)
    return {
      ok: false as const,
      message: t(
        'app.sign.token.actions.this_link_is_for_another_company',
        'This link is for another company.',
      ),
    };
  const response = await fetch(`${base()}/v1/documents/sign/${encodeURIComponent(token)}/decline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
    cache: 'no-store',
  }).catch(() => null);
  return response?.ok === true
    ? { ok: true as const }
    : {
        ok: false as const,
        message: t('app.sign.token.actions.that_did_not_work', 'That did not work.'),
      };
}
