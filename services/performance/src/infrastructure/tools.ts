import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { EvidenceItem, ToolConnector } from '../application/ports.js';

/**
 * The work tools a person links for themselves (PRD §22.3, §23.1, PRF-166).
 *
 * **Slack** is Kithena's one Slack app, which `platform/slack` owns: the
 * person's token is kept there, beside the app's secret, and Performance asks
 * it to search over the pair's secret (`SLACK_PERFORMANCE_TOKEN`). Off without
 * `SLACK_URL` and that secret.
 *
 * **GitHub** is a GitHub App the company installs on its organisation,
 * acting as the person (`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`):
 * it sees only what both the installation and the person may. Its token is
 * sealed here (AES-256-GCM under a key derived from `PERFORMANCE_WEBHOOK_KEY`)
 * and kept in the person's grant; an expiring one is renewed as it is used.
 * Off without the three, and `AUTH_ORIGIN`, where GitHub sends the person
 * back (`/tools/github/done`).
 *
 * Both return through the auth origin, which reads the company's origin from
 * the `state` and passes the browser on; the signature is checked here.
 */

/* --------------------------------------------------------------- state -- */

const STATE_LIFETIME_MS = 10 * 60 * 1000;

/** The same shape as the Slack service's, which the auth origin reads `o` from. */
export function signToolState(
  secret: Buffer,
  claims: { readonly t: string; readonly a: string; readonly o: string },
  now: number,
): string {
  const body = Buffer.from(JSON.stringify({ ...claims, e: now + STATE_LIFETIME_MS })).toString(
    'base64url',
  );
  return `${body}.${createHmac('sha256', secret).update(`tool-state.${body}`).digest('base64url')}`;
}

export function verifyToolState(
  secret: Buffer,
  state: string,
  now: number,
): { readonly t: string; readonly a: string } | null {
  const [body, signature, ...rest] = state.split('.');
  if (body === undefined || signature === undefined || rest.length > 0) return null;
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`tool-state.${body}`).digest('base64url'),
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof c['t'] !== 'string' || typeof c['a'] !== 'string') return null;
    if (typeof c['e'] !== 'number' || c['e'] < now) return null;
    return { t: c['t'], a: c['a'] };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- sealing -- */

export function sealWith(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unsealWith(key: Buffer, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- Slack -- */

export function slackTools(
  env: NodeJS.ProcessEnv,
  http: typeof fetch = fetch,
): ToolConnector | undefined {
  const url = (env['SLACK_URL'] ?? '').replace(/\/$/u, '');
  const token = env['SLACK_PERFORMANCE_TOKEN'] ?? '';
  if (url === '' || token === '') return undefined;
  const call = async <T>(path: string, body: unknown): Promise<Result<T>> => {
    const response = await http(`${url}/internal/performance/tools/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (response === null) return err(failure('TOOL_UNAVAILABLE', 'Slack could not be reached'));
    const answer = (await response.json().catch(() => ({}))) as T & { message?: string };
    return response.ok
      ? ok(answer)
      : err(failure('TOOL_REFUSED', answer.message ?? 'Slack refused it'));
  };
  return {
    authorize: ({ tenantId, personId, origin }) =>
      call<{ url: string }>('authorize', { tenantId, personId, origin }),
    async complete({ tenantId, personId, code, state }) {
      const done = await call<{ account: string }>('complete', { tenantId, personId, code, state });
      return done.ok ? ok({ account: done.value.account, secret: null }) : done;
    },
    async search({ tenantId, personId, subject, from, to }) {
      if (subject.email === null) return ok({ items: [] });
      return call<{ items: EvidenceItem[] }>('search', {
        tenantId,
        personId,
        subjectEmail: subject.email,
        from,
        to,
      });
    },
    async revoke({ tenantId, personId }) {
      await call('revoke', { tenantId, personId });
    },
  };
}

/* --------------------------------------------------------------- GitHub -- */

interface GitHubSecret {
  /** The access token. */
  readonly a: string;
  /** The refresh token, when GitHub expires its tokens. */
  readonly r: string | null;
  /** When the access token expires, epoch ms; null when it does not. */
  readonly e: number | null;
}

interface Issue {
  readonly html_url?: string;
  readonly title?: string;
  readonly body?: string | null;
  readonly created_at?: string;
  readonly closed_at?: string | null;
  readonly repository_url?: string;
  readonly pull_request?: { readonly merged_at?: string | null };
}

export function githubTools(
  env: NodeJS.ProcessEnv,
  http: typeof fetch = fetch,
  now: () => number = Date.now,
): ToolConnector | undefined {
  const clientId = env['GITHUB_APP_CLIENT_ID'] ?? '';
  const clientSecret = env['GITHUB_APP_CLIENT_SECRET'] ?? '';
  const root = env['PERFORMANCE_WEBHOOK_KEY'] ?? '';
  const authOrigin = env['AUTH_ORIGIN'] ?? '';
  if (clientId === '' || clientSecret === '' || root === '' || authOrigin === '') return undefined;
  const sealKey = createHmac('sha256', root).update('performance-tools-seal').digest();
  const stateKey = createHmac('sha256', root).update('performance-tools-state').digest();
  const redirectUri = new URL('/tools/github/done', authOrigin).toString();

  const exchange = async (params: Record<string, string>): Promise<GitHubSecret | null> => {
    const response = await http('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const answer = (await response?.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    } | null;
    if (!answer?.access_token) return null;
    return {
      a: answer.access_token,
      r: answer.refresh_token ?? null,
      e: answer.expires_in === undefined ? null : now() + answer.expires_in * 1000,
    };
  };
  const api = async <T>(token: string, path: string): Promise<T | null> => {
    const response = await http(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (response?.ok !== true) return null;
    return (await response.json().catch(() => null)) as T | null;
  };
  const open = (secret: string | null): GitHubSecret | null => {
    const plain = secret === null ? null : unsealWith(sealKey, secret);
    if (plain === null) return null;
    try {
      return JSON.parse(plain) as GitHubSecret;
    } catch {
      return null;
    }
  };

  const slug = env['GITHUB_APP_SLUG'] ?? '';
  return {
    ...(slug === '' ? {} : { install: `https://github.com/apps/${slug}/installations/new` }),
    authorize({ tenantId, personId, origin }) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set(
        'state',
        signToolState(stateKey, { t: tenantId, a: personId, o: origin }, now()),
      );
      return Promise.resolve(ok({ url: url.toString() }));
    },

    async complete({ tenantId, personId, code, state }) {
      const claims = verifyToolState(stateKey, state, now());
      if (claims === null || claims.t !== tenantId || claims.a !== personId)
        return err(failure('BAD_REQUEST', 'That link expired or was not started here. Try again.'));
      const got = await exchange({ code, redirect_uri: redirectUri });
      if (got === null)
        return err(failure('TOOL_REFUSED', 'GitHub did not confirm it. Try again.'));
      const me = await api<{ login?: string }>(got.a, '/user');
      if (me?.login === undefined)
        return err(failure('TOOL_REFUSED', 'GitHub did not say who you are. Try again.'));
      return ok({ account: me.login, secret: sealWith(sealKey, JSON.stringify(got)) });
    },

    async search({ secret, subject, from, to }) {
      let held = open(secret);
      if (held === null) return err(failure('TOOL_REFUSED', 'GitHub is not linked.'));
      let renewed: string | null | undefined;
      // An expiring token is renewed a minute early, and the new one kept.
      if (held.e !== null && held.e < now() + 60_000) {
        const fresh =
          held.r === null
            ? null
            : await exchange({ grant_type: 'refresh_token', refresh_token: held.r });
        if (fresh === null) return err(failure('TOOL_REFUSED', 'GitHub needs linking again.'));
        held = fresh;
        renewed = sealWith(sealKey, JSON.stringify(fresh));
      }
      const token = held.a;
      // Their login as they linked it; else the one GitHub shows for their
      // work address, which it does only when they made that address public.
      const login =
        subject.account ??
        (subject.email === null
          ? null
          : ((
              await api<{ items?: readonly { login?: string }[] }>(
                token,
                `/search/users?q=${encodeURIComponent(`${subject.email} in:email`)}&per_page=1`,
              )
            )?.items?.[0]?.login ?? null));
      if (login === null)
        return ok({ items: [], ...(renewed === undefined ? {} : { secret: renewed }) });
      const period = `${from}..${to}`;
      const search = (q: string, n: number) =>
        api<{ items?: readonly Issue[] }>(
          token,
          `/search/issues?q=${encodeURIComponent(q)}&per_page=${String(n)}&sort=created&order=desc`,
        );
      const [authored, reviewed] = await Promise.all([
        search(`type:pr author:${login} created:${period}`, 30),
        search(`type:pr reviewed-by:${login} -author:${login} updated:${period}`, 20),
      ]);
      const item = (i: Issue, kind: string): EvidenceItem | null => {
        if (i.html_url === undefined || i.title === undefined || i.created_at === undefined)
          return null;
        const repo = i.repository_url?.split('/').slice(-2).join('/') ?? '';
        const merged = i.pull_request?.merged_at != null ? ' (merged)' : '';
        const body = (i.body ?? '').replaceAll(/\s+/gu, ' ').trim().slice(0, 300);
        return {
          link: i.html_url,
          date: (i.closed_at ?? i.created_at).slice(0, 10),
          kind,
          text: `${repo}: ${i.title}${merged}${body === '' ? '' : ` — ${body}`}`,
        };
      };
      const items = [
        ...(authored?.items ?? []).map((i) => item(i, 'pull request')),
        ...(reviewed?.items ?? []).map((i) => item(i, 'review')),
      ].filter((i): i is EvidenceItem => i !== null);
      return ok({ items, ...(renewed === undefined ? {} : { secret: renewed }) });
    },

    async revoke({ secret }) {
      const held = open(secret);
      if (held === null) return;
      // Ends the person's authorisation of the app, not only this token.
      await http(`https://api.github.com/applications/${clientId}/grant`, {
        method: 'DELETE',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ access_token: held.a }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: unknown) => {
        logger.warn(
          { module: 'performance', err: String(e) },
          'GitHub did not take the grant back',
        );
      });
    },
  };
}

/** Every tool this process can link, by source. */
export function toolsFrom(env: NodeJS.ProcessEnv): Partial<Record<string, ToolConnector>> {
  const slack = slackTools(env);
  const github = githubTools(env);
  return {
    ...(slack === undefined ? {} : { slack }),
    ...(github === undefined ? {} : { github }),
  };
}
