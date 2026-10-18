import { createHash, randomBytes } from 'node:crypto';
import type { Result } from '@kithena/domain-kit';

import type { Device } from '../../shared/device.js';
import { chooseAccount, type AccountCandidate } from '../domain/account-choice.js';
import { googleAccount, type GoogleAccount } from '../domain/google.js';
import type { StartedSession } from './sign-in.js';

/**
 * Signing in with Google, beside the passkey (`docs/authentication.md`, "The
 * tenant login page").
 *
 * Two halves, because Google is a trip. `begin` writes down where the trip is
 * from and sends the browser to Google; `finish` takes Google's answer at the
 * one callback Google allows, spends that record, and ends in the same
 * session a passkey would have started. The company comes from the record,
 * never from the URL Google sent back.
 *
 * Who it is, is Google's `sub`. The first time, there is no link yet, so the
 * account is found by its work address at this company — the address Google
 * has verified and a Workspace manages (`googleAccount`) — and the link is
 * written. An invited person who has not set up a passkey is enrolled by that
 * first sign-in: the invitation went to the same mailbox Google has just
 * vouched for.
 *
 * Every refusal looks the same to the person: they are sent back to their
 * company's sign-in page. Whether the Google account was fine and simply has
 * no account here is not theirs to learn.
 */

export interface GoogleTrip {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly verifier: string;
  readonly nonce: string;
  /** The phone app's sign-in, carried through untouched (`app-sign-in.ts`). */
  readonly app: { readonly redirect: string; readonly challenge: string } | null;
}

export interface GoogleSignInDeps {
  readonly clientId: string;
  /** The one URI registered with Google: the auth origin's `/google/callback`. */
  readonly redirectUri: string;
  readonly trips: {
    issue(state: string, trip: GoogleTrip, ttlSeconds: number): Promise<void>;
    /** The trip, once; null when unknown, spent or expired. */
    consume(state: string): Promise<GoogleTrip | null>;
  };
  /** An active company with Google switched on, or null. */
  readonly tenantBySlug: (slug: string) => Promise<{ id: string; slug: string } | null>;
  /** Google's verified ID token claims for this code, or null. */
  readonly exchange: (code: string, verifier: string) => Promise<Record<string, unknown> | null>;
  /** The human a Google `sub` is linked to. */
  readonly linkedIdentity: (sub: string) => Promise<string | null>;
  readonly accountsFor: (identityId: string) => Promise<readonly AccountCandidate[]>;
  /**
   * The account at this company with this work address, linked to `sub` and
   * enrolled if it was only invited; null when there is none it may be.
   */
  readonly link: (tenantId: string, account: GoogleAccount) => Promise<string | null>;
  readonly beginSession: (
    tenantId: string,
    accountId: string,
    device: Device,
    amr: readonly string[],
  ) => Promise<Result<StartedSession>>;
  /**
   * The session swapped for the 60-second code the company's `/auth/callback`
   * redeems, so the session itself never leaves identity. Null when it could
   * not be, and then the session is given back.
   */
  readonly handOff: (tenantId: string, session: StartedSession) => Promise<string | null>;
  readonly onRefusal?: (reason: string) => void;
}

export type GoogleBegin = (request: {
  readonly tenantSlug: string;
  readonly app: GoogleTrip['app'];
}) => Promise<string | null>;

export type GoogleFinished =
  | {
      readonly kind: 'signed-in';
      readonly tenantSlug: string;
      readonly code: string;
      readonly app: GoogleTrip['app'];
    }
  | { readonly kind: 'refused'; readonly tenantSlug: string | null };

export type GoogleFinish = (request: {
  readonly code: string;
  readonly state: string;
  readonly device: Device;
}) => Promise<GoogleFinished>;

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Long enough to pick an account and type a password at Google; no longer. */
const TRIP_SECONDS = 600;

const random = (): string => randomBytes(32).toString('base64url');

export function beginGoogleSignIn(deps: GoogleSignInDeps): GoogleBegin {
  return async ({ tenantSlug, app }) => {
    const tenant = await deps.tenantBySlug(tenantSlug);
    if (tenant === null) return null;

    const state = random();
    const verifier = random();
    const nonce = random();
    await deps.trips.issue(
      state,
      { tenantId: tenant.id, tenantSlug: tenant.slug, verifier, nonce, app },
      TRIP_SECONDS,
    );

    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: deps.clientId,
      redirect_uri: deps.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      // A person with a work and a personal Google account in one browser
      // picks which, rather than being signed in as whichever was last used.
      prompt: 'select_account',
    }).toString();
    return url.toString();
  };
}

export function finishGoogleSignIn(deps: GoogleSignInDeps): GoogleFinish {
  return async ({ code, state, device }) => {
    const trip = state === '' ? null : await deps.trips.consume(state);
    if (trip === null) {
      deps.onRefusal?.('state');
      return { kind: 'refused', tenantSlug: null };
    }
    const refused = (reason: string): GoogleFinished => {
      deps.onRefusal?.(reason);
      return { kind: 'refused', tenantSlug: trip.tenantSlug };
    };

    const claims = code === '' ? null : await deps.exchange(code, trip.verifier);
    if (claims === null) return refused('exchange');

    const google = googleAccount(claims, trip.nonce);
    if (!google.ok) return refused('claims');

    // The link first; the work address only when there is none at this company.
    const identityId = await deps.linkedIdentity(google.value.sub);
    const chosen =
      identityId === null
        ? null
        : chooseAccount(await deps.accountsFor(identityId), { tenantId: trip.tenantId });
    const accountId =
      chosen?.ok === true ? chosen.value.accountId : await deps.link(trip.tenantId, google.value);
    if (accountId === null) return refused('no-account');

    // Not an RFC 8176 method — it has none for a federated sign-in — so the
    // session says plainly where its proof came from.
    const started = await deps.beginSession(trip.tenantId, accountId, device, ['fed']);
    if (!started.ok) return refused(started.error.code);

    const handoff = await deps.handOff(trip.tenantId, started.value);
    if (handoff === null) return refused('handoff');
    return { kind: 'signed-in', tenantSlug: trip.tenantSlug, code: handoff, app: trip.app };
  };
}
